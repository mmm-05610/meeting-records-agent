"""Meeting records assistant graph (C02-C04, C08).

One LangGraph graph serves two paths:
  - fact questions: scoped vector retrieval -> FlashRank rerank -> grounded claims
  - current-decision / change questions: read *every* selected meeting page by
    page, extract per-meeting statements, then merge chronologically

Nothing is published as a completed answer until the AnswerRecord validates:
claims may only cite keys produced by this run, and every quoted source must be
an exact substring of the chunk it claims to come from.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime
from typing import Any, Literal
from uuid import uuid4

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AnyMessage, HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, StateGraph
from typing_extensions import Annotated, TypedDict

from agents.meeting_tools import (
    fetch_all_meeting_chunks,
    format_evidence_for_prompt,
    format_meetings_for_prompt,
    search_evidence,
    source_key,
)
from agents.r2r_client import MeetingAgentError, document_ids_of, resolve_scope
from core import get_model, settings
from langgraph.graph.message import add_messages
from schema.meeting import (
    AnswerRecord,
    AnswerStatus,
    Claim,
    ClaimKind,
    Coverage,
    ErrorCategory,
    ScopeRequest,
    ScopeSnapshot,
)

logger = logging.getLogger(__name__)

FACT_LIMIT = 8


class MeetingState(TypedDict, total=False):
    messages: Annotated[list[AnyMessage], add_messages]
    scope_request: dict[str, Any] | None
    scope_snapshot: dict[str, Any] | None
    intent: str | None
    question: str | None
    evidence: list[dict[str, Any]]
    evidence_index: dict[str, dict[str, Any]]
    meetings: list[dict[str, Any]]
    meeting_findings: list[dict[str, Any]]
    coverage: dict[str, Any]
    answer_record: dict[str, Any] | None
    answer_records: list[dict[str, Any]]
    progress: list[str]
    error: dict[str, Any] | None
    model_config_id: str


def _model(config: RunnableConfig) -> BaseChatModel:
    return get_model(config["configurable"].get("model", settings.DEFAULT_MODEL))


def _text_of(message: AnyMessage) -> str:
    content = message.content
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(part.get("text", "") for part in content if isinstance(part, dict))
    return str(content)


def _extract_json(raw: str) -> dict[str, Any]:
    cleaned = raw.strip()
    cleaned = re.sub(r"^```(?:json)?", "", cleaned).strip()
    cleaned = re.sub(r"```$", "", cleaned).strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("no JSON object in model output")
    return json.loads(cleaned[start : end + 1])


async def _invoke_with_retry(model: BaseChatModel, messages: list[AnyMessage]) -> AnyMessage:
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            return await asyncio.wait_for(
                model.ainvoke(messages), timeout=settings.MEETING_MODEL_TIMEOUT_SECONDS
            )
        except Exception as exc:  # noqa: BLE001 - bounded retry, then surface the failure
            last_error = exc
            if attempt == 0:
                await asyncio.sleep(2)
    raise MeetingAgentError(
        ErrorCategory.SERVICE_FAILURE,
        f"model call failed after one retry: {last_error}",
    )


async def _json_call(
    model: BaseChatModel,
    system: str,
    user: str,
    repair_hint: str = "输出必须是一个合法 JSON 对象，不要包含解释或代码块。",
) -> dict[str, Any]:
    """One structured call plus at most one bounded repair (C08)."""
    messages = [SystemMessage(content=system), HumanMessage(content=user)]
    response = await _invoke_with_retry(model, messages)
    try:
        return _extract_json(_text_of(response))
    except Exception as exc:  # noqa: BLE001 - bounded repair below
        repair = [*messages, AIMessage(content=_text_of(response)), HumanMessage(content=f"{repair_hint}\n解析失败：{exc}")]
        response = await _invoke_with_retry(model, repair)
        try:
            return _extract_json(_text_of(response))
        except Exception as exc2:  # noqa: BLE001
            raise MeetingAgentError(
                ErrorCategory.INVALID_CITATION,
                f"model did not return usable structured output after one repair: {exc2}",
            ) from exc2


def _fail(state: MeetingState, category: ErrorCategory, message: str) -> MeetingState:
    return {
        "error": {"category": category.value, "message": message},
        "messages": [AIMessage(content=f"无法完成本轮回答：{message}")],
        "progress": [*state.get("progress", []), f"中止：{message}"],
    }


async def prepare_scope(state: MeetingState, config: RunnableConfig) -> MeetingState:
    raw_scope = config["configurable"].get("meeting_scope")
    if not raw_scope:
        return _fail(state, ErrorCategory.INPUT_ERROR, "缺少查询范围（meeting_scope）。")
    try:
        scope_request = ScopeRequest.model_validate(raw_scope)
        snapshot = await resolve_scope(scope_request)
    except MeetingAgentError as exc:
        return _fail(state, exc.category, exc.message)
    except Exception as exc:  # noqa: BLE001
        return _fail(state, ErrorCategory.INPUT_ERROR, f"查询范围无效：{exc}")
    question = _text_of(state["messages"][-1]) if state.get("messages") else ""
    # Deterministic pronoun binding (A11): if the user refers back ("那次会议"/"那个方案")
    # and a previous assistant message named a meeting in scope, bind that meeting.
    if re.search(r"那次|那个|该会议|上述|这个会|它", question) and len(state.get("messages", [])) >= 2:
        prior = " ".join(_text_of(message) for message in state["messages"][-4:])
        titles = [doc.title for doc in snapshot.documents if doc.title]
        hits = [title for title in titles if title and title in prior]
        if hits:
            question = f"{question}\n（上文所指的会议：{hits[0]}）"
    return {
        "scope_request": scope_request.model_dump(mode="json"),
        "scope_snapshot": json.loads(snapshot.model_dump_json()),
        "question": question,
        "progress": [f"范围已确认：{len(snapshot.documents)} 份会议"],
        "model_config_id": settings.MEETING_MODEL_LABEL,
    }


async def classify_intent(state: MeetingState, config: RunnableConfig) -> MeetingState:
    snapshot = ScopeSnapshot.model_validate(state["scope_snapshot"])
    system = (
        "你是会议记录问答助手的意图判断器。判断用户问题属于哪一类：\n"
        '- "fact"：事实、分工、日期、讨论内容、某人负责什么；\n'
        '- "decision"：当前最终决定、是否改了、为什么改、谁定的、变化过程、冲突。\n'
        "若问题缺少必要指代（例如只说“那件事”“这个方案”且历史中无法确定），"
        '返回 {"intent":"fact","needs_clarification":true,"clarification":"要向用户提出的一个具体澄清问题"}。\n'
        '否则返回 {"intent":"fact|decision","needs_clarification":false,"clarification":null,'
        '"resolved_question":"用最近对话补全指代后的完整问题","issue":"一句话概括要核对的议题"}。\n'
        "resolved_question 必须自包含：把“那次会议”“那个方案”等指代替换成对话中明确的对象；"
        "如果无法从对话确定指代，则把 needs_clarification 置为 true。\n"
        "只输出 JSON。"
    )
    history = "\n".join(
        f"{child.type}: {_text_of(child)[:300]}" for child in state.get("messages", [])[-6:]
    )
    meetings = "、".join(document.title or document.document_id for document in snapshot.documents)
    user = f"问题：{state.get('question')}\n最近对话：\n{history}\n可选会议：{meetings}"
    try:
        result = await _json_call(_model(config), system, user)
    except MeetingAgentError as exc:
        return _fail(state, exc.category, exc.message)
    if result.get("needs_clarification") and state.get("messages") and len(state["messages"]) >= 2:
        # A pronoun that the assistant itself just resolved should bind to that object,
        # not trigger a clarification round (A11).
        retry_system = (
            system
            + "\n注意：最近对话中助手已经提到具体会议/方案；用户使用“那次会议/那个方案”时，"
            "必须绑定最近对话中的对象并给出 resolved_question，禁止反问是哪一场。"
        )
        try:
            retried = await _json_call(_model(config), retry_system, user)
        except MeetingAgentError:
            retried = {}
        if retried.get("resolved_question") and not retried.get("needs_clarification"):
            result = retried
    if result.get("needs_clarification"):
        question = result.get("clarification") or "你指的是哪一场会议或哪一个方案？"
        return {
            "intent": "clarify",
            "messages": [AIMessage(content=question)],
            "progress": [*state.get("progress", []), "需要澄清后才能继续"],
        }
    resolved = result.get("resolved_question")
    updates: dict[str, Any] = {}
    if isinstance(resolved, str) and resolved.strip() and resolved.strip() != state.get("question"):
        updates["question"] = resolved.strip()
    intent = result.get("intent")
    if intent not in {"fact", "decision"}:
        intent = "fact"
    # B0/B1 evaluation strategies never use the full decision review path.
    if config.get("configurable", {}).get("strategy") in {"B0", "B1"}:
        intent = "fact"
    return {
        **updates,
        "intent": intent,
        "progress": [*state.get("progress", []), f"问题类型：{'决定/变更核对' if intent == 'decision' else '事实问答'}"],
    }


async def search_evidence_node(state: MeetingState, config: RunnableConfig) -> MeetingState:
    snapshot = ScopeSnapshot.model_validate(state["scope_snapshot"])
    query = state.get("question") or ""
    strategy = config.get("configurable", {}).get("strategy")
    try:
        if strategy == "B0":
            chunks = await search_evidence(snapshot, query, top_n=FACT_LIMIT, rerank=False)
        else:
            chunks = await search_evidence(snapshot, query, top_n=FACT_LIMIT)
    except MeetingAgentError as exc:
        return _fail(state, exc.category, exc.message)
    index = {
        chunk.source_key: {
            "text": chunk.text,
            "document_id": chunk.document_id,
            "chunk_id": chunk.chunk_id,
            "chunk_order": chunk.chunk_order,
            "title": chunk.title,
            "meeting_date": str(chunk.meeting_date or ""),
            "record_kind": chunk.record_kind.value if chunk.record_kind else None,
        }
        for chunk in chunks
    }
    return {
        "evidence": [chunk.model_dump(mode="json") for chunk in chunks],
        "evidence_index": index,
        "progress": [*state.get("progress", []), f"检索到 {len(chunks)} 条候选证据并完成重排"],
    }


FACT_SYSTEM = (
    "你是会议记录问答助手。只能使用给定证据回答，不得使用常识或历史对话补充事实。\n"
    "规则：\n"
    "1. 每条事实必须引用证据 key（方括号中的标识），不得编造 key。\n"
    "2. 负责人、截止时间、参与人名单不等于任务已完成；原文没写完成就明确说未记载。\n"
    "3. 相对日期不要擅自换算成绝对日期。\n"
    "4. 没有证据支持的结论写 kind=unknown 且不带证据。\n"
    "5. 回答正文中每处引用都要写成 [[source_key]]（例如 [[abc#0]]），不能只把 key 放在 claims 里。\n"
    "输出 JSON：{\"answer\": \"中文回答\", \"claims\": [{\"text\": \"...\", \"kind\": \"fact|unknown\", \"evidence_ids\": [\"...\"]}]}。\n"
    "只输出 JSON。"
)


async def answer_fact(state: MeetingState, config: RunnableConfig) -> MeetingState:
    model = _model(config)
    evidence_text = format_evidence_for_prompt(
        [chunk for chunk in (_EvidenceModel(**item) for item in state.get("evidence", []))]
    )
    if not evidence_text.strip():
        return _fail(state, ErrorCategory.SERVICE_FAILURE, "检索没有返回可用证据，无法生成有依据的回答。")
    user = f"问题：{state.get('question')}\n\n证据：\n{evidence_text}"
    try:
        result = await _json_call(model, FACT_SYSTEM, user)
    except MeetingAgentError as exc:
        return _fail(state, exc.category, exc.message)
    return {
        "answer_record": {
            "draft_answer": result.get("answer") or "",
            "draft_claims": result.get("claims") or [],
            "path": "fact",
        },
        "progress": [*state.get("progress", []), "已生成有依据的草稿，等待引用校验"],
    }


class _EvidenceModel:
    """Tiny adapter so the fact prompt can reuse the shared formatter."""

    def __init__(self, **payload: Any):
        self.source_key = payload.get("source_key")
        self.title = payload.get("title")
        self.meeting_date = payload.get("meeting_date")
        self.text = payload.get("text")


async def gather_meetings(state: MeetingState, config: RunnableConfig) -> MeetingState:
    snapshot = ScopeSnapshot.model_validate(state["scope_snapshot"])
    coverage = Coverage()
    try:
        meetings, coverage = await fetch_all_meeting_chunks(snapshot)
    except MeetingAgentError as exc:
        return {
            **_fail(state, exc.category, exc.message),
            "coverage": coverage.model_dump(mode="json"),
        }
    index: dict[str, dict[str, Any]] = {}
    for meeting in meetings:
        for chunk in meeting["chunks"]:
            key = source_key(meeting["document_id"], chunk["chunk_order"])
            index[key] = {
                "text": chunk["text"],
                "document_id": meeting["document_id"],
                "chunk_id": chunk["chunk_id"],
                "chunk_order": chunk["chunk_order"],
                "title": meeting["title"],
                "meeting_date": meeting["meeting_date"],
                "record_kind": meeting["record_kind"],
            }
    return {
        "meetings": meetings,
        "evidence_index": index,
        "coverage": coverage.model_dump(mode="json"),
        "progress": [
            *state.get("progress", []),
            f"已完整读取 {len(meetings)} 份会议（共 {len(index)} 个片段）",
        ],
    }


EXTRACT_SYSTEM = (
    "你是会议证据抽取器。针对给定议题，只从这一场会议原文中抽取相关陈述。\n"
    "每条陈述标注：proposal（提议/建议）、confirmed（明确确认/决定）、change（明确改变之前的决定）、"
    "conflict（与其它记录冲突或同一会议内表述矛盾）、fact（普通事实）、unknown（议题未被提及）。\n"
    "只引用给出的 key；原文没有的内容不要写。\n"
    "输出 JSON：{\"statements\": [{\"text\": \"...\", \"kind\": \"proposal|confirmed|change|conflict|fact|unknown\", \"evidence_ids\": [\"...\"]}], \"mentions_issue\": true|false}。只输出 JSON。"
)


async def extract_per_meeting(state: MeetingState, config: RunnableConfig) -> MeetingState:
    model = _model(config)
    findings: list[dict[str, Any]] = []
    meetings = state.get("meetings", [])
    if len(meetings) > settings.MEETING_DECISION_MAX_MEETINGS:
        return _fail(
            state,
            ErrorCategory.BUDGET_EXCEEDED,
            f"选中会议数 {len(meetings)} 超过核对上限 {settings.MEETING_DECISION_MAX_MEETINGS}，请缩小范围。",
        )
    for meeting in meetings:
        chunk_text = "\n".join(
            f"[{source_key(meeting['document_id'], chunk['chunk_order'])}] {chunk['text']}"
            for chunk in meeting["chunks"]
        )
        user = (
            f"议题：{state.get('question')}\n"
            f"会议：{meeting['title']}（日期 {meeting['meeting_date']}，类型 {meeting['record_kind']}）\n"
            f"原文：\n{chunk_text}"
        )
        try:
            result = await _json_call(model, EXTRACT_SYSTEM, user)
        except MeetingAgentError as exc:
            return _fail(state, exc.category, exc.message)
        findings.append(
            {
                "document_id": meeting["document_id"],
                "title": meeting["title"],
                "meeting_date": meeting["meeting_date"],
                "statements": result.get("statements") or [],
                "mentions_issue": bool(result.get("mentions_issue")),
            }
        )
    return {
        "meeting_findings": findings,
        "progress": [*state.get("progress", []), f"已逐场抽取 {len(findings)} 份会议的相关陈述"],
    }


MERGE_SYSTEM = (
    "你是最终决定归并器。按会议日期从早到晚归并各场会议的陈述，回答用户的当前决定/变化问题。\n"
    "硬性规则：\n"
    "1. 提议（proposal）不等于确认；只有明确确认（confirmed）才可视为已定；后续提议不覆盖之前确认，除非原文明确 change。\n"
    "2. 明确改变时，给出原确认、替代方案与原文写明的理由；原文没写理由时明确说“记录中没有说明原因”。\n"
    "3. 同日会议无法区分先后时，保留冲突结论，不要按上传顺序或文件名裁定。\n"
    "4. 最新会议没有提到该议题，不等于撤销之前的决定。\n"
    "5. 每条 claim 引用给出的 key；没有证据支持的写 unknown。不得编造 key。\n"
    "6. 回答正文中每处引用都要写成 [[source_key]]（例如 [[abc#0]]），不能只把 key 放在 claims 里。\n"
    "输出 JSON：{\"answer\": \"中文回答\", \"claims\": [{\"text\": \"...\", \"kind\": \"confirmed|proposal|change|conflict|fact|unknown\", \"evidence_ids\": [\"...\"]}], \"notes\": \"覆盖/冲突/不明之处的简短说明\"}。只输出 JSON。"
)


async def merge_decisions(state: MeetingState, config: RunnableConfig) -> MeetingState:
    model = _model(config)
    blocks: list[str] = []
    for finding in sorted(
        state.get("meeting_findings", []),
        key=lambda item: (item.get("meeting_date") or "", item.get("document_id") or ""),
    ):
        if not finding.get("mentions_issue"):
            continue
        statements = "\n".join(
            f"- [{statement.get('kind')}] {statement.get('text')} {statement.get('evidence_ids')}"
            for statement in finding.get("statements", [])
        )
        blocks.append(
            f"## {finding['title']}（{finding['meeting_date']}）\n{statements}"
        )
    if not blocks:
        return _fail(
            state,
            ErrorCategory.INVALID_CITATION,
            "所有选中会议都没有提到该议题，不能给出最终决定。",
        )
    user = f"问题：{state.get('question')}\n\n按时间排列的逐场证据：\n" + "\n\n".join(blocks)
    try:
        result = await _json_call(model, MERGE_SYSTEM, user)
    except MeetingAgentError as exc:
        return _fail(state, exc.category, exc.message)
    return {
        "answer_record": {
            "draft_answer": result.get("answer") or "",
            "draft_claims": result.get("claims") or [],
            "notes": result.get("notes"),
            "path": "decision",
        },
        "progress": [*state.get("progress", []), "已按会议时间归并决定线索，等待引用校验"],
    }


def _valid_kind(value: Any) -> ClaimKind:
    try:
        return ClaimKind(str(value))
    except ValueError:
        return ClaimKind.FACT


async def finalize_answer(state: MeetingState, config: RunnableConfig) -> MeetingState:
    draft = state.get("answer_record") or {}
    index = state.get("evidence_index") or {}
    text = (draft.get("draft_answer") or "").strip()
    if not text:
        return _fail(state, ErrorCategory.INVALID_CITATION, "模型没有给出可发布的答案。")
    sources: dict[str, Any] = {}
    claims: list[Claim] = []
    unknown_keys: list[str] = []
    for raw_claim in draft.get("draft_claims") or []:
        kind = _valid_kind(raw_claim.get("kind"))
        evidence_ids = [key for key in (raw_claim.get("evidence_ids") or []) if isinstance(key, str)]
        for key in evidence_ids:
            if key not in index:
                unknown_keys.append(key)
        claims.append(Claim(text=str(raw_claim.get("text") or "").strip(), kind=kind, evidence_ids=evidence_ids))
    if unknown_keys:
        return _fail(
            state,
            ErrorCategory.INVALID_CITATION,
            f"回答引用了不存在的证据标识：{sorted(set(unknown_keys))[:3]}",
        )
    ordered_keys: list[str] = []
    for match in re.finditer(r"\[\[([^\]]+)\]\]", text):
        key = match.group(1).strip()
        if key not in index:
            return _fail(
                state,
                ErrorCategory.INVALID_CITATION,
                f"回答正文引用了不存在的证据标识：{key}",
            )
        if key not in ordered_keys:
            ordered_keys.append(key)
    for claim in claims:
        for key in claim.evidence_ids:
            if key not in ordered_keys:
                ordered_keys.append(key)
    for number, key in enumerate(ordered_keys, 1):
        source = index[key]
        sources[key] = {
            "source_key": key,
            "document_id": source["document_id"],
            "chunk_id": source["chunk_id"],
            "chunk_order": source["chunk_order"],
            "title": source["title"],
            "meeting_date": source.get("meeting_date") or None,
            "record_kind": source.get("record_kind"),
            "quote": source["text"],
            "display_index": number,
        }
    display_numbers = {key: str(number) for number, key in enumerate(ordered_keys, 1)}

    def _marker(match: re.Match[str]) -> str:
        return f"[{display_numbers[match.group(1).strip()]}]"

    text = re.sub(r"\[\[([^\]]+)\]\]", _marker, text)
    if ordered_keys and not re.search(r"\[\d+\]", text):
        text = f"{text}\n\n参考来源：" + " ".join(f"[{n}]" for n in range(1, len(ordered_keys) + 1))
    snapshot = ScopeSnapshot.model_validate(state["scope_snapshot"])
    coverage = Coverage.model_validate(state.get("coverage") or {})
    run_id = str(config.get("configurable", {}).get("run_id") or uuid4())
    try:
        record = AnswerRecord(
            message_id=str(uuid4()),
            run_id=run_id,
            text=text,
            claims=claims,
            sources=sources,
            scope_snapshot=snapshot,
            coverage=coverage,
            created_at=datetime.now().astimezone(),
            model_config_id=state.get("model_config_id") or settings.MEETING_MODEL_LABEL,
            status=AnswerStatus.COMPLETED,
        )
    except Exception as exc:  # noqa: BLE001
        return _fail(state, ErrorCategory.INVALID_CITATION, f"回答未通过引用/结构校验：{exc}")
    notes = draft.get("notes")
    if notes:
        text = f"{text}\n\n覆盖说明：{notes}"
        record.text = text
    return {
        "answer_record": json.loads(record.model_dump_json()),
        "answer_records": [*state.get("answer_records", []), json.loads(record.model_dump_json())],
        "messages": [AIMessage(id=record.message_id, content=text)],
        "progress": [*state.get("progress", []), "引用与范围校验通过，回答已完成并保存"],
    }


def _route_after_node(state: MeetingState, next_node: str) -> str:
    return "end" if state.get("error") else next_node


def _route_after_scope(state: MeetingState) -> str:
    if state.get("error"):
        return "end"
    return "classify"


def _route_after_classify(state: MeetingState) -> str:
    if state.get("error") or state.get("intent") == "clarify":
        return "end"
    return "decision" if state.get("intent") == "decision" else "fact"


def build_meeting_graph():
    graph = StateGraph(MeetingState)
    graph.add_node("prepare_scope", prepare_scope)
    graph.add_node("classify", classify_intent)
    graph.add_node("search_evidence", search_evidence_node)
    graph.add_node("answer_fact", answer_fact)
    graph.add_node("gather_meetings", gather_meetings)
    graph.add_node("extract_per_meeting", extract_per_meeting)
    graph.add_node("merge_decisions", merge_decisions)
    graph.add_node("finalize", finalize_answer)

    graph.set_entry_point("prepare_scope")
    graph.add_conditional_edges("prepare_scope", _route_after_scope, {"classify": "classify", "end": END})
    graph.add_conditional_edges(
        "classify",
        _route_after_classify,
        {"fact": "search_evidence", "decision": "gather_meetings", "end": END},
    )
    def after(node: str):
        return lambda state: _route_after_node(state, node)

    graph.add_conditional_edges(
        "search_evidence", after("answer_fact"), {"answer_fact": "answer_fact", "end": END}
    )
    graph.add_conditional_edges("answer_fact", after("finalize"), {"finalize": "finalize", "end": END})
    graph.add_conditional_edges(
        "gather_meetings", after("extract_per_meeting"), {"extract_per_meeting": "extract_per_meeting", "end": END}
    )
    graph.add_conditional_edges(
        "extract_per_meeting", after("merge_decisions"), {"merge_decisions": "merge_decisions", "end": END}
    )
    graph.add_conditional_edges(
        "merge_decisions", after("finalize"), {"finalize": "finalize", "end": END}
    )
    graph.add_edge("finalize", END)
    return graph.compile()


meeting_assistant = build_meeting_graph()
