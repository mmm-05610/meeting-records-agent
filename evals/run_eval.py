#!/usr/bin/env python3
"""meeting-records-agent 评测执行器（T019）。

结构复用 Ragas 官方示例（upstream/reference/ragas-examples/examples）：
数据集加载 → 逐条执行 → 逐条打分 → 落盘原始结果与统计。

与官方示例的差别：本题集是决定/变更类业务题，标准答案来自人工标注的
`evals/datasets/questions.jsonl`，**不使用被测模型的输出作为标准答案**；
指标全部是规则化判定（子串命中、引用范围检查、标签与关键词匹配），
不依赖 LLM judge，也不需要评测模型凭据。

引擎：
  * ``--engine http``  真实产品 HTTP 接口（默认）。地址与令牌来自环境变量
    ``MRA_AGENT_URL`` / ``MRA_WEB_TOKEN``，请求体为
    ``{"message": <question>, "forwardedProps": {"meeting_scope": {...}}}``。
  * ``--engine ragas`` 可选，把同一批题目交给 Ragas ``Dataset`` / ``experiment``
    官方示例流程；仅在本地已安装 ragas 时可用，不可用时明确报错并退出（不产出结果）。

用法（真实运行由集成本人执行）::

    export MRA_AGENT_URL=http://127.0.0.1:8000/chat
    export MRA_WEB_TOKEN=<本地登录令牌>
    python3 evals/run_eval.py --engine http --split frozen --strategy B2 \
        --scope-map evals/datasets/scope-map.json

未真实运行前不会生成任何分数：``--dry-run`` 只打印计划，不写结果文件。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import statistics
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
DATASETS = ROOT / "datasets"
QUESTIONS = DATASETS / "questions.jsonl"
RESULTS_ROOT = ROOT / "results"

# 规则化判定用的不确定性标记（must_include_uncertainty 的判据）
UNCERTAINTY_MARKERS = (
    "未说明",
    "没有说明",
    "未写明",
    "没有写明",
    "未记录",
    "没有记录",
    "无法判断",
    "无法确定",
    "无法判定",
    "不能确定",
    "不确定",
    "未知",
    "没有说明完成状态",
    "未形成",
)

# 合同 C08 的错误分类；本执行器只做归类，不改写产品返回
ERROR_CATEGORIES = (
    "input_error",
    "scope_forbidden",
    "duplicate_processing",
    "unknown_result",
    "service_failure",
    "budget_exceeded",
    "invalid_citation",
    "stale_scope",
)

WHITESPACE_RE = re.compile(r"\s+")


# --------------------------------------------------------------------------- 工具
def normalize(text: str) -> str:
    """去掉空白差异，便于子串命中（不改变字面内容）。"""
    return WHITESPACE_RE.sub("", text)


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_cases(path: Path, splits: list[str]) -> list[dict]:
    cases: list[dict] = []
    for line_no, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not raw.strip():
            continue
        try:
            case = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise SystemExit(f"questions.jsonl 第 {line_no} 行不是合法 JSON：{exc}")
        case["_line"] = line_no
        cases.append(case)
    if "all" in splits:
        return cases
    wanted = set(splits)
    return [case for case in cases if case.get("split") in wanted]


def deep_find(payload: Any, key: str) -> list[Any]:
    """在任意嵌套结构中收集所有同名键的值。"""
    found: list[Any] = []
    if isinstance(payload, dict):
        for name, value in payload.items():
            if name == key:
                found.append(value)
            found.extend(deep_find(value, key))
    elif isinstance(payload, list):
        for item in payload:
            found.extend(deep_find(item, key))
    return found


def first_value(payload: Any, keys: tuple[str, ...]) -> Any:
    for key in keys:
        values = deep_find(payload, key)
        for value in values:
            if value not in (None, "", [], {}):
                return value
    return None


def normalize_sources(raw: Any) -> list[dict]:
    """把产品返回的 sources/citations 统一成 {source_key, document_id, quote, title} 列表。"""
    items: list[Any]
    if isinstance(raw, dict):
        items = list(raw.values())
    elif isinstance(raw, list):
        items = raw
    else:
        items = []

    sources: list[dict] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        quote = ""
        for field in ("quote", "text", "content", "snippet"):
            value = item.get(field)
            if isinstance(value, str) and value.strip():
                quote = value
                break
        sources.append(
            {
                "source_key": item.get("source_key") or item.get("id") or item.get("key"),
                "document_id": item.get("document_id") or item.get("documentId"),
                "chunk_id": item.get("chunk_id"),
                "title": item.get("title"),
                "meeting_date": item.get("meeting_date"),
                "quote": quote,
                "display_index": item.get("display_index"),
            }
        )
    return sources


def parse_sse(body: str) -> list[Any]:
    """解析 AG-UI 风格的 SSE 流，返回事件对象列表。"""
    events: list[Any] = []
    for block in body.split("\n\n"):
        for line in block.splitlines():
            if not line.startswith("data:"):
                continue
            raw = line[5:].strip()
            if not raw or raw == "[DONE]":
                continue
            try:
                events.append(json.loads(raw))
            except json.JSONDecodeError:
                continue
    return events


def classify_error(exc: BaseException) -> str:
    text = str(exc).lower()
    if isinstance(exc, urllib.error.HTTPError):
        if exc.code in (401, 403):
            return "scope_forbidden"
        if exc.code == 422:
            return "input_error"
        if exc.code == 429:
            return "service_failure"
        return "service_failure"
    if "timeout" in text or "timed out" in text:
        return "service_failure"
    for category in ERROR_CATEGORIES:
        if category in text:
            return category
    return "service_failure"


# --------------------------------------------------------------------------- 调用
def build_request(case: dict, scope: dict, strategy: str | None, strategy_field: str) -> dict:
    body: dict[str, Any] = {
        "message": case["question"],
        "forwardedProps": {"meeting_scope": scope},
    }
    if strategy:
        parts = strategy_field.split(".")
        target = body
        for part in parts[:-1]:
            target = target.setdefault(part, {})
        target[parts[-1]] = strategy
    return body


def call_product(
    url: str,
    token: str | None,
    auth_header: str,
    case: dict,
    scope: dict,
    strategy: str | None,
    strategy_field: str,
    timeout: float,
) -> dict:
    """调用一次产品接口，返回 answer/citations/coverage/error/latency_ms/tokens。"""
    payload = build_request(case, scope, strategy, strategy_field)
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(url, data=data, method="POST")
    request.add_header("Content-Type", "application/json")
    request.add_header("Accept", "application/json, text/event-stream")
    if token:
        header, _, template = auth_header.partition(":")
        value = template.strip().replace("{token}", token)
        request.add_header(header.strip(), value)

    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
            content_type = response.headers.get("Content-Type", "")
        latency_ms = int((time.perf_counter() - started) * 1000)
    except Exception as exc:  # noqa: BLE001 - 错误要分类记录，不能当成无依据
        latency_ms = int((time.perf_counter() - started) * 1000)
        return {
            "answer": "",
            "citations": [],
            "coverage": None,
            "error": {"type": type(exc).__name__, "message": str(exc)[:500],
                      "category": classify_error(exc)},
            "latency_ms": latency_ms,
            "tokens": None,
            "raw": None,
        }

    parsed: Any
    if "text/event-stream" in content_type or body.lstrip().startswith("data:"):
        events = parse_sse(body)
        parsed = events
    else:
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            parsed = {"raw_text": body[:2000]}

    answer = first_value(parsed, ("answer", "answer_text", "text", "content", "message"))
    if isinstance(answer, dict):
        answer = first_value(answer, ("text", "content")) or ""
    answer_text = answer if isinstance(answer, str) else ""

    sources_raw = first_value(parsed, ("sources", "citations"))
    citations = normalize_sources(sources_raw)
    coverage = first_value(parsed, ("coverage",))
    claims = first_value(parsed, ("claims",)) or []
    usage = first_value(parsed, ("usage", "tokens", "token_usage"))
    tokens: int | None = None
    if isinstance(usage, dict):
        for key in ("total_tokens", "total", "totalTokens"):
            if isinstance(usage.get(key), int):
                tokens = usage[key]
                break
        else:
            prompt = usage.get("prompt_tokens") or usage.get("input_tokens")
            completion = usage.get("completion_tokens") or usage.get("output_tokens")
            if isinstance(prompt, int) and isinstance(completion, int):
                tokens = prompt + completion
    elif isinstance(usage, int):
        tokens = usage

    return {
        "answer": answer_text,
        "citations": citations,
        "coverage": coverage,
        "error": None,
        "latency_ms": latency_ms,
        "tokens": tokens,
        "raw": {"claims": claims, "source_keys": [c.get("source_key") for c in citations]},
    }


def call_product_agui(
    url: str,
    token: str | None,
    auth_header: str,
    case: dict,
    scope: dict,
    strategy: str | None,
    timeout: float,
) -> dict:
    """调用产品真实的 AG-UI 入口（SSE），从 STATE_SNAPSHOT 取最终 AnswerRecord。"""
    import uuid as _uuid

    payload = {
        "threadId": f"eval-{case['case_id']}-{_uuid.uuid4().hex[:8]}",
        "runId": f"run-{_uuid.uuid4().hex}",
        "messages": [
            {"id": _uuid.uuid4().hex, "role": "user", "content": case["question"]}
        ],
        "tools": [],
        "context": [],
        "state": None,
        "forwardedProps": {"meeting_scope": scope},
    }
    if strategy:
        payload["forwardedProps"]["strategy"] = strategy
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(url, data=data, method="POST")
    request.add_header("Content-Type", "application/json")
    request.add_header("Accept", "text/event-stream")
    if token:
        header, _, template = auth_header.partition(":")
        request.add_header(header.strip(), template.strip().replace("{token}", token))

    started = time.perf_counter()
    try:
        answer_record: dict | None = None
        run_error: dict | None = None
        with urllib.request.urlopen(request, timeout=timeout) as response:
            for raw_line in response:
                line = raw_line.decode("utf-8", errors="replace").strip()
                if not line.startswith("data:"):
                    continue
                try:
                    event = json.loads(line[5:].strip())
                except json.JSONDecodeError:
                    continue
                event_type = event.get("type")
                if event_type == "STATE_SNAPSHOT":
                    snapshot = event.get("snapshot") or {}
                    candidate = snapshot.get("answer_record")
                    if candidate and candidate.get("status") == "completed":
                        answer_record = candidate
                elif event_type == "RUN_ERROR":
                    run_error = {"type": "RUN_ERROR", "message": str(event.get("message"))[:500],
                                 "category": "service_failure"}
        latency_ms = int((time.perf_counter() - started) * 1000)
    except Exception as exc:  # noqa: BLE001 - 错误分类记录，不能当无依据
        return {
            "answer": "",
            "citations": [],
            "coverage": None,
            "error": {"type": type(exc).__name__, "message": str(exc)[:500],
                      "category": classify_error(exc)},
            "latency_ms": int((time.perf_counter() - started) * 1000),
            "tokens": None,
            "raw": None,
        }

    if run_error:
        return {
            "answer": "",
            "citations": [],
            "coverage": None,
            "error": run_error,
            "latency_ms": latency_ms,
            "tokens": None,
            "raw": None,
        }
    if not answer_record:
        return {
            "answer": "",
            "citations": [],
            "coverage": None,
            "error": {"type": "no_answer_record", "message": "SSE 流中没有 completed 的 AnswerRecord",
                      "category": "service_failure"},
            "latency_ms": latency_ms,
            "tokens": None,
            "raw": None,
        }
    citations = []
    for key, source in (answer_record.get("sources") or {}).items():
        citations.append({**source, "source_key": key})
    return {
        "answer": answer_record.get("text") or "",
        "citations": citations,
        "coverage": answer_record.get("coverage"),
        "error": None,
        "latency_ms": latency_ms,
        "tokens": None,
        "raw": {"claims": answer_record.get("claims"),
                "source_keys": [c["source_key"] for c in citations],
                "status": answer_record.get("status")},
    }


# --------------------------------------------------------------------------- 指标
def evidence_recall(case: dict, citations: list[dict]) -> dict:
    """证据召回：必需证据的 quote 是否出现在返回的 sources.quote 中。"""
    haystack = normalize(" ".join(c.get("quote") or "" for c in citations))
    matched = 0
    details = []
    for item in case["required_evidence"]:
        hit = normalize(item["quote"]) in haystack if haystack else False
        matched += int(hit)
        details.append({"file": item["file"], "quote": item["quote"], "hit": hit})
    total = len(case["required_evidence"])
    return {
        "matched": matched,
        "total": total,
        "rate": (matched / total) if total else None,
        "rule": "required_evidence.quote 逐字出现在返回 sources.quote（忽略空白差异）中",
        "details": details,
    }


def citation_checks(case: dict, citations: list[dict], scope: dict, scope_map: dict | None) -> dict:
    """引用存在性与范围正确性。"""
    answer = normalize(case.get("_answer_text", ""))
    references = set(re.findall(r"\[(\d+)\]", answer))
    keys = {str(c.get("source_key")) for c in citations if c.get("source_key") is not None}
    cited_ids = {str(c.get("document_id")) for c in citations if c.get("document_id")}

    presence_ok = bool(citations) and all(
        (c.get("quote") or "").strip() for c in citations
    )
    if case.get("expected_kind") == "unknown":
        presence_required = False
    else:
        presence_required = True

    # [n] numbers map to the returned sources by display_index, or by list order.
    number_to_key: dict[str, str] = {}
    for index, citation in enumerate(citations, 1):
        display = citation.get("display_index")
        number = str(display) if isinstance(display, int) else str(index)
        number_to_key[number] = str(citation.get("source_key"))
    dangling = sorted(ref for ref in references if keys and ref not in number_to_key)
    dangling_unknown = sorted(ref for ref in references if not keys and ref)

    scope_ids = set(scope.get("document_ids") or [])
    project_docs: set[str] = set()
    if scope_map:
        project_docs = {
            str(doc_id)
            for doc_id in (scope_map.get("projects", {})
                           .get(case["project"], {})
                           .get("documents", {})
                           .values())
        }
    if scope.get("mode") == "explicit":
        allowed = scope_ids
        scope_checkable = bool(allowed)
    else:
        allowed = project_docs
        scope_checkable = bool(allowed)
    out_of_scope = sorted(cited_ids - allowed) if scope_checkable else []

    return {
        "citation_count": len(citations),
        "presence_required": presence_required,
        "presence_ok": presence_ok if presence_required else True,
        "scope_checkable": scope_checkable,
        "scope_ok": not out_of_scope,
        "out_of_scope_document_ids": out_of_scope,
        "dangling_reference_numbers": dangling or dangling_unknown,
        "rule": (
            "存在性：非 unknown 题必须返回带非空 quote 的来源；"
            "范围：explicit 题的引用文档必须属于请求的 document_ids，all_ready 题的引用文档必须属于该项目；"
            "答案中的 [n] 编号必须能在返回来源里找到对应来源。"
        ),
    }


def decision_judgement(case: dict, result: dict) -> dict:
    """决定类标签与可接受结论的规则化判定（不用模型输出当标准答案）。"""
    answer = normalize(case.get("_answer_text", ""))
    claims = (result.get("raw") or {}).get("claims") or []
    kinds: list[str] = []
    for claim in claims:
        if isinstance(claim, dict):
            kind = claim.get("kind")
            if isinstance(kind, str):
                kinds.append(kind.lower())
    expected_kind = case["expected_kind"]
    if kinds:
        kind_match = expected_kind in kinds
        kind_status = "matched" if kind_match else "mismatched"
    else:
        kind_match = None
        kind_status = "undetermined"

    must_contain = case.get("conclusion_must_contain_any") or []
    if must_contain:
        conclusion_hit = any(normalize(term) in answer for term in must_contain)
    else:
        conclusion_hit = None

    if case.get("must_include_uncertainty"):
        uncertainty_ok = any(marker in case.get("_answer_text", "") for marker in UNCERTAINTY_MARKERS)
    else:
        uncertainty_ok = None

    return {
        "expected_kind": expected_kind,
        "returned_kinds": kinds,
        "kind_status": kind_status,
        "kind_match": kind_match,
        "conclusion_match": conclusion_hit,
        "uncertainty_required": bool(case.get("must_include_uncertainty")),
        "uncertainty_ok": uncertainty_ok,
        "rule": (
            "标签：产品返回的 claim.kind 中是否出现 expected_kind（未返回 claims 时记为 undetermined，不计分）；"
            "结论：答案中是否出现 conclusion_must_contain_any 里的任一关键词；"
            "不确定性：must_include_uncertainty=true 时答案是否出现不确定性标记。"
        ),
    }


# --------------------------------------------------------------------------- 范围
def resolve_scope(case: dict, scope_map: dict | None) -> tuple[dict | None, str | None]:
    project = case["project"]
    if not scope_map:
        return None, "缺少 scope 映射（--scope-map），无法解析 collection_id / document_ids"
    entry = scope_map.get("projects", {}).get(project)
    if not entry:
        return None, f"scope 映射中没有项目 {project}"
    collection_id = entry.get("collection_id")
    if not collection_id:
        return None, f"scope 映射中项目 {project} 缺少 collection_id"
    documents = entry.get("documents", {})
    mode = case["scope_mode"]
    document_ids: list[str] = []
    if mode == "explicit":
        for name in case.get("document_ids") or []:
            doc_id = documents.get(name)
            if not doc_id:
                return None, f"scope 映射中缺少文档 {name} 的真实 UUID"
            document_ids.append(doc_id)
        if not document_ids:
            return None, "explicit 范围没有可用的 document_ids"
    return {"collection_id": collection_id, "mode": mode, "document_ids": document_ids}, None


# --------------------------------------------------------------------------- 主流程
def run(args: argparse.Namespace) -> int:
    if not QUESTIONS.is_file():
        raise SystemExit(f"缺少题集文件：{QUESTIONS}")
    cases = load_cases(QUESTIONS, args.split)
    if not cases:
        raise SystemExit("按 --split 过滤后没有题目")
    if args.limit:
        cases = cases[: args.limit]

    scope_map = None
    if args.scope_map:
        scope_map = json.loads(Path(args.scope_map).read_text(encoding="utf-8"))

    url = args.url or os.environ.get("MRA_AGENT_URL")
    token = args.token or os.environ.get("MRA_WEB_TOKEN")

    run_id = args.run_id or datetime.now().strftime("%Y%m%d-%H%M%S")
    out_dir = Path(args.out_dir) / run_id
    strategy = args.strategy

    print(f"run_id            : {run_id}")
    print(f"引擎              : {args.engine}")
    print(f"题目              : {len(cases)}（split={'/'.join(args.split)}）")
    print(f"对照策略          : {strategy or '未指定'}")
    print(f"数据文件 sha256   : {sha256_file(QUESTIONS)}")
    if url:
        print(f"产品地址          : {url}")

    if args.dry_run:
        print("-")
        print("dry-run：不调用产品、不写结果文件、不产生任何分数。")
        for case in cases:
            scope, problem = resolve_scope(case, scope_map)
            print(
                f"  {case['case_id']}  {case['split']:6s} {case['project']}  "
                f"scope={case['scope_mode']}"
                + (f"  （{problem}）" if problem else "")
            )
        return 0

    if args.engine in ("http", "agui") and not url:
        raise SystemExit(
            "缺少产品地址：请设置环境变量 MRA_AGENT_URL 或传入 --url（本次运行不产出任何分数）"
        )

    out_dir.mkdir(parents=True, exist_ok=True)
    per_case_path = out_dir / "per_case.jsonl"
    started_at = now_iso()
    records: list[dict] = []

    with per_case_path.open("w", encoding="utf-8", newline="\n") as sink:
        for index, case in enumerate(cases, 1):
            scope, problem = resolve_scope(case, scope_map)
            base: dict[str, Any] = {
                "case_id": case["case_id"],
                "split": case["split"],
                "project": case["project"],
                "scope_mode": case["scope_mode"],
                "question": case["question"],
                "expected_kind": case["expected_kind"],
                "strategy": strategy,
                "started_at": now_iso(),
            }
            if problem or scope is None:
                result = {
                    "answer": "",
                    "citations": [],
                    "coverage": None,
                    "error": {"type": "scope_unresolved", "message": problem, "category": "input_error"},
                    "latency_ms": 0,
                    "tokens": None,
                    "raw": None,
                }
            elif args.engine == "agui":
                result = call_product_agui(
                    url, token, args.auth_header, case, scope, strategy, args.timeout
                )
            else:
                result = call_product(
                    url, token, args.auth_header, case, scope, strategy,
                    args.strategy_field, args.timeout,
                )
            case["_answer_text"] = result["answer"]
            evidence = evidence_recall(case, result["citations"])
            citations = citation_checks(case, result["citations"], scope or {}, scope_map)
            decision = decision_judgement(case, result)

            record = {
                **base,
                "answer": result["answer"],
                "citations": result["citations"],
                "coverage": result["coverage"],
                "error": result["error"],
                "latency_ms": result["latency_ms"],
                "tokens": result["tokens"],
                "metrics": {
                    "evidence_recall": evidence,
                    "citation": citations,
                    "decision": decision,
                },
                "manual_review": {
                    "forbidden_inferences": case.get("forbidden_inferences", []),
                    "acceptable_conclusion": case.get("acceptable_conclusion", ""),
                    "expected_coverage": case.get("expected_coverage", []),
                    "note": "禁止推断与语义支持由人工按原文审阅，本执行器不做自动判定",
                },
            }
            sink.write(json.dumps(record, ensure_ascii=False) + "\n")
            records.append(record)
            status = "error" if result["error"] else "ok"
            print(
                f"[{index:>3}/{len(cases)}] {case['case_id']} {status} "
                f"evidence={evidence['matched']}/{evidence['total']} "
                f"kind={decision['kind_status']} {result['latency_ms']}ms"
            )

    summary = summarize(records, args, started_at, run_id, url, strategy)
    (out_dir / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print("-")
    print(f"结果目录：{out_dir}")
    print(f"per_case.jsonl / summary.json 已写出（{len(records)} 条）")
    return 0


def summarize(
    records: list[dict],
    args: argparse.Namespace,
    started_at: str,
    run_id: str,
    url: str | None,
    strategy: str | None,
) -> dict:
    total = len(records)
    ok = [r for r in records if not r["error"]]
    errors = [r for r in records if r["error"]]
    error_by_category: dict[str, int] = {}
    for record in errors:
        category = (record["error"] or {}).get("category", "service_failure")
        error_by_category[category] = error_by_category.get(category, 0) + 1

    matched = sum(r["metrics"]["evidence_recall"]["matched"] for r in ok)
    evidence_total = sum(r["metrics"]["evidence_recall"]["total"] for r in ok)
    presence_denominator = sum(
        1 for r in ok if r["metrics"]["citation"]["presence_required"]
    )
    presence_ok = sum(
        1 for r in ok
        if r["metrics"]["citation"]["presence_required"]
        and r["metrics"]["citation"]["presence_ok"]
    )
    scope_denominator = sum(1 for r in ok if r["metrics"]["citation"]["scope_checkable"])
    scope_ok = sum(
        1 for r in ok
        if r["metrics"]["citation"]["scope_checkable"] and r["metrics"]["citation"]["scope_ok"]
    )
    kind_determined = [
        r for r in ok if r["metrics"]["decision"]["kind_status"] != "undetermined"
    ]
    kind_matched = sum(
        1 for r in kind_determined if r["metrics"]["decision"]["kind_match"]
    )
    conclusion_cases = [
        r for r in ok if r["metrics"]["decision"]["conclusion_match"] is not None
    ]
    conclusion_ok = sum(
        1 for r in conclusion_cases if r["metrics"]["decision"]["conclusion_match"]
    )
    uncertainty_cases = [
        r for r in ok if r["metrics"]["decision"]["uncertainty_ok"] is not None
    ]
    uncertainty_ok = sum(
        1 for r in uncertainty_cases if r["metrics"]["decision"]["uncertainty_ok"]
    )

    latencies = [r["latency_ms"] for r in records if r["latency_ms"] is not None]
    tokens = [r["tokens"] for r in records if isinstance(r["tokens"], int)]

    per_split: dict[str, Any] = {}
    for split in sorted({r["split"] for r in records}):
        subset = [r for r in records if r["split"] == split]
        sub_ok = [r for r in subset if not r["error"]]
        per_split[split] = {
            "total": len(subset),
            "completed": len(sub_ok),
            "error": len(subset) - len(sub_ok),
            "evidence_recall": {
                "matched": sum(r["metrics"]["evidence_recall"]["matched"] for r in sub_ok),
                "total": sum(r["metrics"]["evidence_recall"]["total"] for r in sub_ok),
            },
        }

    per_kind: dict[str, Any] = {}
    for kind in sorted({r["expected_kind"] for r in records}):
        subset = [r for r in records if r["expected_kind"] == kind]
        determined = [
            r for r in subset
            if not r["error"] and r["metrics"]["decision"]["kind_status"] != "undetermined"
        ]
        per_kind[kind] = {
            "total": len(subset),
            "error": sum(1 for r in subset if r["error"]),
            "kind_determined": len(determined),
            "kind_matched": sum(1 for r in determined if r["metrics"]["decision"]["kind_match"]),
        }

    return {
        "run_id": run_id,
        "engine": args.engine,
        "strategy": strategy,
        "started_at": started_at,
        "finished_at": now_iso(),
        "endpoint": {"url": url, "token_present": bool(args.token or os.environ.get("MRA_WEB_TOKEN"))},
        "dataset": {
            "questions_file": str(QUESTIONS.relative_to(ROOT.parent)),
            "sha256": sha256_file(QUESTIONS),
            "cases_in_file": sum(
                1 for _ in QUESTIONS.read_text(encoding="utf-8").splitlines() if _.strip()
            ),
            "cases_selected": total,
            "splits": args.split,
        },
        "counts": {
            "total": total,
            "completed": len(ok),
            "error": len(errors),
            "error_by_category": error_by_category,
        },
        "metrics": {
            "evidence_recall": {
                "matched": matched,
                "total": evidence_total,
                "rate": (matched / evidence_total) if evidence_total else None,
                "denominator": "成功返回的题目的必需证据条数；失败题不计入分母，另在 counts.error 报告",
                "rule": "required_evidence.quote 逐字出现在返回 sources.quote（忽略空白差异）中",
            },
            "citation": {
                "presence_denominator": presence_denominator,
                "presence_ok": presence_ok,
                "presence_rate": (presence_ok / presence_denominator) if presence_denominator else None,
                "scope_denominator": scope_denominator,
                "scope_ok": scope_ok,
                "scope_rate": (scope_ok / scope_denominator) if scope_denominator else None,
                "out_of_scope_cases": [
                    r["case_id"] for r in ok if not r["metrics"]["citation"]["scope_ok"]
                ],
                "dangling_reference_cases": [
                    r["case_id"] for r in ok if r["metrics"]["citation"]["dangling_reference_numbers"]
                ],
            },
            "decision": {
                "kind_determined": len(kind_determined),
                "kind_matched": kind_matched,
                "kind_match_rate": (kind_matched / len(kind_determined)) if kind_determined else None,
                "kind_undetermined": len(ok) - len(kind_determined),
                "conclusion_denominator": len(conclusion_cases),
                "conclusion_matched": conclusion_ok,
                "conclusion_match_rate": (conclusion_ok / len(conclusion_cases)) if conclusion_cases else None,
                "uncertainty_denominator": len(uncertainty_cases),
                "uncertainty_ok": uncertainty_ok,
                "uncertainty_rate": (uncertainty_ok / len(uncertainty_cases)) if uncertainty_cases else None,
                "rule": (
                    "标签：产品返回的 claim.kind 是否包含 expected_kind（无 claims 记 undetermined 不计分）；"
                    "结论：答案是否命中 conclusion_must_contain_any；"
                    "不确定性：must_include_uncertainty 题的答案是否出现不确定性标记。"
                ),
            },
        },
        "per_split": per_split,
        "per_expected_kind": per_kind,
        "engineering": {
            "latency_ms": {
                "mean": round(statistics.fmean(latencies), 1) if latencies else None,
                "p50": round(statistics.median(latencies), 1) if latencies else None,
                "max": max(latencies) if latencies else None,
            },
            "tokens_total": sum(tokens) if tokens else None,
            "tokens_note": "供应商未返回用量时记为未知，不估算金额",
        },
        "manual_review_pending": {
            "cases_with_forbidden_inferences": sum(
                1 for r in records if r["manual_review"]["forbidden_inferences"]
            ),
            "note": "禁止推断与语义支持需人工按会议原文审阅，未在本执行器中自动判定",
        },
        "notes": [
            "标准答案全部来自 evals/datasets/questions.jsonl 的人工标注，未使用被测模型输出。",
            "失败题保留在分母口径内并单列 error，不按拒答成功处理。",
            "本文件由真实运行生成；未运行不产生任何分数。",
        ],
    }


def run_with_ragas(args: argparse.Namespace) -> int:
    """可选的 Ragas 官方示例流程（需要本地已安装 ragas）。"""
    try:
        from ragas import Dataset, experiment  # type: ignore
    except ImportError:  # pragma: no cover - 取决于本地环境
        try:
            from ragas.dataset import Dataset  # type: ignore
            from ragas.experiment import experiment  # type: ignore
        except ImportError:
            print(
                "未安装 ragas，无法使用 --engine ragas。"
                "请在评测环境安装后重试；本次不产出任何结果，也不产生分数。",
                file=sys.stderr,
            )
            return 2
    if not args.url and not os.environ.get("MRA_AGENT_URL"):
        raise SystemExit("缺少产品地址：MRA_AGENT_URL")

    cases = load_cases(QUESTIONS, args.split)
    if args.limit:
        cases = cases[: args.limit]
    scope_map = (
        json.loads(Path(args.scope_map).read_text(encoding="utf-8")) if args.scope_map else None
    )
    run_id = args.run_id or datetime.now().strftime("%Y%m%d-%H%M%S")
    work_dir = RESULTS_ROOT / f"ragas_{run_id}"
    work_dir.mkdir(parents=True, exist_ok=True)
    csv_path = work_dir / "mra_cases.csv"
    import csv

    lookup: dict[str, dict] = {}
    with csv_path.open("w", encoding="utf-8", newline="") as sink:
        writer = csv.DictWriter(sink, fieldnames=["case_id", "question", "split"])
        writer.writeheader()
        for case in cases:
            lookup[case["case_id"]] = case
            writer.writerow(
                {"case_id": case["case_id"], "question": case["question"], "split": case["split"]}
            )

    dataset = Dataset.load(name="mra_cases", backend="local/csv", root_dir=str(work_dir))
    url = args.url or os.environ.get("MRA_AGENT_URL")
    token = args.token or os.environ.get("MRA_WEB_TOKEN")

    @experiment()
    async def run_case(row):  # pragma: no cover - 依赖真实服务
        import asyncio

        case = lookup[row["case_id"]]
        scope, problem = resolve_scope(case, scope_map)
        if problem or scope is None:
            return {"case_id": case["case_id"], "error": problem}
        result = await asyncio.to_thread(
            call_product, url, token, args.auth_header, case, scope,
            args.strategy, args.strategy_field, args.timeout,
        )
        case["_answer_text"] = result["answer"]
        return {
            "case_id": case["case_id"],
            "answer": result["answer"],
            "citations": result["citations"],
            "coverage": result["coverage"],
            "error": result["error"],
            "latency_ms": result["latency_ms"],
            "tokens": result["tokens"],
            "evidence_recall": evidence_recall(case, result["citations"]),
        }

    import asyncio

    asyncio.run(run_case.arun(dataset, name="mra_eval"))
    print("Ragas 实验已完成，实验结果按官方示例的存储位置保存。")
    return 0


def self_check() -> int:
    """受控自检：用合成样本验证计数与结果格式，不调用产品、不写结果文件。

    合成数据仅用于检查判定逻辑与输出结构，**不是产品成绩**，不会写进 evals/results/。
    """
    scope_map = json.loads(
        (DATASETS / "scope-map.example.json").read_text(encoding="utf-8")
    )
    wanted = ["sim-a-01", "sim-a-05", "sim-b-06", "sim-c-03"]
    cases = {
        case["case_id"]: case
        for case in load_cases(QUESTIONS, ["all"])
        if case["case_id"] in wanted
    }
    if len(cases) != len(wanted):
        print("自检失败：题集中缺少自检样本题号", file=sys.stderr)
        return 1

    doc_a3 = scope_map["projects"]["模拟项目A：星河笔记"]["documents"]["sim-project-a/meeting-03.md"]
    doc_a6 = scope_map["projects"]["模拟项目A：星河笔记"]["documents"]["sim-project-a/meeting-06.md"]
    doc_b4 = scope_map["projects"]["模拟项目B：云仓物流"]["documents"]["sim-project-b/meeting-04.md"]
    outside = "00000000-0000-4000-8000-000000000999"

    def source(key: str, doc: str, quote: str) -> dict:
        return {"source_key": key, "document_id": doc, "chunk_id": f"{key}-c0",
                "title": "合成标题", "meeting_date": "2026-01-01", "quote": quote}

    samples = {
        "sim-a-01": {
            "answer": "最终确认的检索方案是「向量召回 + 关键词兜底」的混合检索方案。",
            "citations": [
                source("k1", doc_a3, "正式确认采用「向量召回 + 关键词兜底」的混合检索方案"),
                source("k2", doc_a6, "本次会议只记录了这一建议，没有形成新的决议"),
                source("k3", doc_a3, "此前讨论的「标签过滤 + 关键词匹配」方案本次不再采用"),
            ],
            "coverage": {"checked": [], "unchecked": [], "failed": [], "budget_exhausted": False},
            "error": None, "latency_ms": 120, "tokens": 900,
            "raw": {"claims": [{"text": "混合检索方案已确认", "kind": "confirmed"}]},
        },
        "sim-a-05": {
            "answer": "记录中未说明访谈纪要整理是否完成，只写了负责人与截止时间。",
            "citations": [],
            "coverage": {"checked": [], "unchecked": [], "failed": [], "budget_exhausted": False},
            "error": None, "latency_ms": 90, "tokens": None,
            "raw": {"claims": []},
        },
        "sim-b-06": {
            "answer": "两份记录互相冲突，无法判定先后，需要按冲突呈现。",
            "citations": [
                source("k1", doc_b4, "加盟商接入接口由平台技术团队统一开发并发布"),
                source("k2", outside, "加盟商接入接口由信息部外包团队开发，平台方只负责对接"),
            ],
            "coverage": None,
            "error": None, "latency_ms": 150, "tokens": 1200,
            "raw": {"claims": [{"text": "两份记录冲突", "kind": "conflict"}]},
        },
        "sim-c-03": {
            "answer": "",
            "citations": [],
            "coverage": None,
            "error": {"type": "TimeoutError", "message": "合成故障样本", "category": "service_failure"},
            "latency_ms": 180000, "tokens": None, "raw": None,
        },
    }

    records: list[dict] = []
    for case_id, result in samples.items():
        case = cases[case_id]
        scope, problem = resolve_scope(case, scope_map)
        if problem or scope is None:
            raise SystemExit(f"自检范围解析失败：{case_id} {problem}")
        case["_answer_text"] = result["answer"]
        records.append(
            {
                "case_id": case_id,
                "split": case["split"],
                "project": case["project"],
                "expected_kind": case["expected_kind"],
                "answer": result["answer"],
                "citations": result["citations"],
                "coverage": result["coverage"],
                "error": result["error"],
                "latency_ms": result["latency_ms"],
                "tokens": result["tokens"],
                "metrics": {
                    "evidence_recall": evidence_recall(case, result["citations"]),
                    "citation": citation_checks(case, result["citations"], scope, scope_map),
                    "decision": decision_judgement(case, result),
                },
                "manual_review": {"forbidden_inferences": case["forbidden_inferences"]},
            }
        )

    class _Args:
        engine = "self-check"
        strategy = "B2"
        split = ["all"]
        token = None

    summary = summarize(records, _Args(), now_iso(), "self-check", None, "B2")
    summary["_说明"] = "合成自检数据，仅验证计数与结果格式，不是产品成绩，也未写入 results/"

    metrics = summary["metrics"]
    checks = [
        (summary["counts"]["total"] == 4, "总题数"),
        (summary["counts"]["completed"] == 3, "成功题数"),
        (summary["counts"]["error"] == 1, "失败题数"),
        (summary["counts"]["error_by_category"].get("service_failure") == 1, "错误分类"),
        (metrics["evidence_recall"]["matched"] == 5, "证据召回命中数"),
        (metrics["evidence_recall"]["total"] == 7, "证据召回分母"),
        (metrics["citation"]["presence_denominator"] == 2, "引用存在性分母"),
        (metrics["citation"]["scope_denominator"] == 3, "引用范围分母"),
        (metrics["citation"]["scope_ok"] == 2, "引用范围通过数"),
        (metrics["decision"]["kind_determined"] == 2, "标签可判定题数"),
        (metrics["decision"]["kind_matched"] == 2, "标签命中数"),
        (metrics["decision"]["uncertainty_denominator"] == 2, "不确定性判定题数"),
        (metrics["decision"]["uncertainty_ok"] == 2, "不确定性判定通过数"),
    ]
    failed = [name for ok, name in checks if not ok]
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if failed:
        print("-" * 72)
        print("自检未通过：" + "、".join(failed))
        return 1
    print("-" * 72)
    print("自检通过：计数、证据召回、引用存在性/范围、决定标签与不确定性判定均符合预期。")
    print("说明：以上为合成样本，仅验证计数与结果格式，不是产品成绩。")
    return 0


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="meeting-records-agent 评测执行器（复用 Ragas 官方示例结构）"
    )
    parser.add_argument("--engine", choices=["http", "agui", "ragas"], default="http",
                        help="http：调用真实产品接口；ragas：走 Ragas 官方示例流程（需已安装 ragas）")
    parser.add_argument("--split", action="append", default=None,
                        help="要跑的 split，可重复；默认 frozen；all 表示全部 36 题")
    parser.add_argument("--strategy", choices=["B0", "B1", "B2"], default=None,
                        help="对照组策略，传给产品：B0 纯向量 / B1 +重排 / B2 +完整会议核对")
    parser.add_argument("--strategy-field", default="forwardedProps.configurable.strategy",
                        help="strategy 写入请求体的位置（点分路径）")
    parser.add_argument("--scope-map", default=os.environ.get("MRA_SCOPE_MAP"),
                        help="项目与会议真实 UUID 的映射 JSON（--scope-map 或 MRA_SCOPE_MAP）")
    parser.add_argument("--url", default=None, help="产品接口地址，默认取 MRA_AGENT_URL")
    parser.add_argument("--token", default=None, help="访问令牌，默认取 MRA_WEB_TOKEN")
    parser.add_argument("--auth-header", default="Authorization: Bearer {token}",
                        help="令牌请求头模板，例如 'X-Web-Token: {token}'")
    parser.add_argument("--timeout", type=float, default=180.0, help="单题超时秒数")
    parser.add_argument("--limit", type=int, default=0, help="只跑前 N 题（冒烟用）")
    parser.add_argument("--run-id", default=None, help="运行标识，默认用当前时间")
    parser.add_argument("--out-dir", default=str(RESULTS_ROOT), help="结果根目录")
    parser.add_argument("--dry-run", action="store_true", help="只打印计划，不调用产品、不写结果")
    parser.add_argument("--self-check", action="store_true",
                        help="用合成样本验证计数与结果格式，不调用产品、不写结果")
    args = parser.parse_args(argv)
    if not args.split:
        args.split = ["frozen"]
    flat: list[str] = []
    for item in args.split:
        for part in item.split(","):
            if part.strip():
                flat.append(part.strip())
    args.split = flat
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    if args.self_check:
        return self_check()
    if args.engine == "ragas":
        return run_with_ragas(args)
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
