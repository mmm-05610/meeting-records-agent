"""Evidence tools for the meeting agent (C03).

All reads go through the R2R HTTP client. Reranking uses LangChain's
FlashrankRerank/FlashRank integration and keeps document/chunk identity in
metadata so a reranked document can never be re-matched by text.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from langchain_community.document_compressors.flashrank_rerank import FlashrankRerank
from langchain_core.documents import Document

from agents.r2r_client import MeetingAgentError, document_ids_of, r2r_client
from core.settings import settings
from schema.meeting import (
    Coverage,
    ErrorCategory,
    EvidenceChunk,
    RecordKind,
    ScopeSnapshot,
    TimePrecision,
)

logger = logging.getLogger(__name__)

_reranker = None


def _reranker_instance():
    """Cross-encoder reranker.

    The upstream FlashRank multilingual model was measured on real Chinese meeting
    chunks and ranked the answer-bearing passage last (see
    docs/evidence/evaluation-summary.md), so the default backend is FastEmbed's
    BAAI/bge-reranker-base. MEETING_RERANK_BACKEND=flashrank keeps the upstream
    LangChain FlashrankRerank path available for comparison runs.
    """
    global _reranker
    if _reranker is None:
        if settings.MEETING_RERANK_BACKEND == "flashrank":
            from flashrank import Ranker

            _reranker = FlashrankRerank(
                client=Ranker(model_name="ms-marco-MultiBERT-L-12", cache_dir=settings.MEETING_RERANK_CACHE_DIR),
                top_n=settings.MEETING_RERANK_TOP_N,
            )
        else:
            from fastembed.rerank.cross_encoder import TextCrossEncoder

            _reranker = TextCrossEncoder(
                model_name=settings.MEETING_RERANK_MODEL,
                cache_dir=settings.MEETING_RERANK_CACHE_DIR,
            )
    return _reranker


def source_key(document_id: str, chunk_order: int) -> str:
    return f"{document_id}#{chunk_order}"


def _chunk_to_evidence(hit: dict[str, Any], document: dict[str, Any] | None) -> EvidenceChunk | None:
    metadata = hit.get("metadata") or {}
    chunk_id = hit.get("id") or hit.get("chunk_id")
    document_id = str(hit.get("document_id") or metadata.get("document_id") or "")
    if not chunk_id or not document_id:
        return None
    chunk_order = int(hit.get("chunk_order", metadata.get("chunk_order", 0)) or 0)
    record_kind = metadata.get("record_kind") or (document or {}).get("record_kind")
    return EvidenceChunk(
        source_key=source_key(document_id, chunk_order),
        document_id=document_id,
        chunk_id=str(chunk_id),
        chunk_order=chunk_order,
        text=hit.get("text") or "",
        title=metadata.get("title") or (document or {}).get("title"),
        meeting_date=metadata.get("meeting_date") or (document or {}).get("meeting_date"),
        record_kind=RecordKind(record_kind) if record_kind in RecordKind._value2member_map_ else None,
        content_sha256=metadata.get("content_sha256") or (document or {}).get("content_sha256"),
        score=hit.get("score"),
    )


async def _metadata_for(snapshot: ScopeSnapshot, document_id: str) -> dict[str, Any]:
    for scope_document in snapshot.documents:
        if scope_document.document_id == document_id:
            return scope_document.model_dump()
    return {}


def _rerank(query: str, chunks: list[EvidenceChunk]) -> list[EvidenceChunk]:
    if not chunks:
        return []
    documents = [
        Document(
            page_content=chunk.text,
            metadata={
                "source_key": chunk.source_key,
                "document_id": chunk.document_id,
                "chunk_id": chunk.chunk_id,
                "chunk_order": chunk.chunk_order,
                "title": chunk.title,
                "meeting_date": str(chunk.meeting_date or ""),
                "record_kind": chunk.record_kind.value if chunk.record_kind else None,
                "content_sha256": chunk.content_sha256,
            },
        )
        for chunk in chunks
    ]
    reranker = _reranker_instance()
    if hasattr(reranker, "compress_documents"):
        compressed = reranker.compress_documents(documents, query)
        by_key = {chunk.source_key: chunk for chunk in chunks}
        ranked: list[EvidenceChunk] = []
        for document in compressed:
            original = by_key.get(document.metadata.get("source_key"))
            if original is None:
                continue
            original.score = float(document.metadata.get("relevance_score", original.score or 0.0))
            ranked.append(original)
        return ranked or chunks[: settings.MEETING_RERANK_TOP_N]

    scores = list(reranker.rerank(query, [chunk.text for chunk in chunks]))
    ranked = []
    for chunk, score in zip(chunks, scores):
        chunk.score = float(score)
        ranked.append(chunk)
    ranked.sort(key=lambda item: item.score or 0.0, reverse=True)
    return ranked[: settings.MEETING_RERANK_TOP_N]


async def search_evidence(
    snapshot: ScopeSnapshot,
    query: str,
    limit: int | None = None,
    top_n: int | None = None,
    rerank: bool = True,
) -> list[EvidenceChunk]:
    allowed = set(document_ids_of(snapshot))
    hits = await r2r_client.search(
        query,
        snapshot.collection_id,
        list(allowed),
        limit or settings.MEETING_RETRIEVAL_LIMIT,
    )
    chunks: list[EvidenceChunk] = []
    for hit in hits:
        chunk = _chunk_to_evidence(hit, None)
        if chunk is None:
            continue
        if chunk.document_id not in allowed:
            # Defense in depth: never surface a chunk outside the server-confirmed scope.
            logger.warning("dropping out-of-scope search hit %s", chunk.document_id)
            continue
        metadata = await _metadata_for(snapshot, chunk.document_id)
        chunk.title = chunk.title or metadata.get("title")
        chunk.meeting_date = chunk.meeting_date or metadata.get("meeting_date")
        chunks.append(chunk)
    if not rerank:
        return chunks[: top_n or settings.MEETING_RERANK_TOP_N]
    ranked = await asyncio.to_thread(_rerank, query, chunks)
    return ranked[:top_n] if top_n else ranked


async def fetch_all_meeting_chunks(
    snapshot: ScopeSnapshot,
) -> tuple[list[dict[str, Any]], Coverage]:
    """Read every chunk of every meeting in scope, page by page (C02/N04)."""
    meetings: list[dict[str, Any]] = []
    coverage = Coverage()
    total_chars = 0
    for scope_document in snapshot.documents:
        chunks: list[dict[str, Any]] = []
        page = 0
        while True:
            try:
                payload = await r2r_client.document_chunks(
                    scope_document.document_id, page=page, page_size=settings.MEETING_CHUNK_PAGE_SIZE
                )
            except MeetingAgentError as exc:
                coverage.failed.append(scope_document.document_id)
                raise MeetingAgentError(
                    exc.category,
                    f"failed to read meeting {scope_document.document_id}: {exc.message}",
                    retryable=exc.retryable,
                ) from exc
            items = payload.get("items") or []
            chunks.extend(items)
            total_chars += sum(len(item.get("text") or "") for item in items)
            if total_chars > settings.MEETING_DECISION_MAX_CHARS:
                coverage.budget_exhausted = True
                coverage.unchecked = [
                    document.document_id
                    for document in snapshot.documents
                    if document.document_id not in coverage.checked
                ]
                raise MeetingAgentError(
                    ErrorCategory.BUDGET_EXCEEDED,
                    "reading all selected meetings exceeds the configured budget "
                    f"({settings.MEETING_DECISION_MAX_CHARS} characters); narrow the scope or ask a specific meeting",
                )
            if len(items) < settings.MEETING_CHUNK_PAGE_SIZE:
                break
            page += 1
            if page > 200:
                raise MeetingAgentError(ErrorCategory.SERVICE_FAILURE, "pagination did not terminate")
        chunks.sort(key=lambda item: item["chunk_order"])
        meetings.append(
            {
                "document_id": scope_document.document_id,
                "title": scope_document.title,
                "meeting_date": scope_document.meeting_date.isoformat() if scope_document.meeting_date else None,
                "time_precision": (
                    scope_document.time_precision.value if scope_document.time_precision else TimePrecision.DATE.value
                ),
                "record_kind": scope_document.record_kind.value if scope_document.record_kind else None,
                "chunks": chunks,
            }
        )
        coverage.checked.append(scope_document.document_id)
    return meetings, coverage


async def read_neighbors(document_id: str, chunk_order: int, radius: int = 1) -> list[dict[str, Any]]:
    payload = await r2r_client.document_chunks(document_id, page=0, page_size=settings.MEETING_CHUNK_PAGE_SIZE)
    items = payload.get("items") or []
    wanted = [item for item in items if abs(item["chunk_order"] - chunk_order) <= radius]
    return sorted(wanted, key=lambda item: item["chunk_order"])


def format_meetings_for_prompt(meetings: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for meeting in meetings:
        lines.append(
            f"### 会议 {meeting['title']}（{meeting['meeting_date']}，{meeting['record_kind'] or '未知类型'}）"
        )
        for chunk in meeting["chunks"]:
            lines.append(f"[{source_key(meeting['document_id'], chunk['chunk_order'])}] {chunk['text']}")
    return "\n".join(lines)


def format_evidence_for_prompt(chunks: list[EvidenceChunk]) -> str:
    return "\n\n".join(
        f"[{chunk.source_key}] 会议：{chunk.title or '未知'}（{chunk.meeting_date or '日期未知'}）\n{chunk.text}"
        for chunk in chunks
    )
