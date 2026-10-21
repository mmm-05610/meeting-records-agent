"""HTTP client for the R2R document service.

The agent never imports the R2R SDK: everything goes through the v3 HTTP API.
Scope, identity and status checks are performed here because the agent is the
only component allowed to decide what the model may read (C02/C03).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any
from uuid import UUID

import httpx

from core.settings import settings
from schema.meeting import (
    DocumentStatus,
    ErrorCategory,
    EvidenceChunk,
    MeetingMetadata,
    RecordKind,
    ScopeDocument,
    ScopeMode,
    ScopeRequest,
    ScopeSnapshot,
    TimePrecision,
)

logger = logging.getLogger(__name__)

_STATUS_MAP = {
    "success": DocumentStatus.READY,
    "ready": DocumentStatus.READY,
    "enriched": DocumentStatus.READY,
    "parsing": DocumentStatus.PROCESSING,
    "pending": DocumentStatus.PROCESSING,
    "processing": DocumentStatus.PROCESSING,
    "failed": DocumentStatus.FAILED,
    "error": DocumentStatus.FAILED,
}


class MeetingAgentError(Exception):
    def __init__(self, category: ErrorCategory, message: str, *, retryable: bool = False):
        super().__init__(message)
        self.category = category
        self.message = message
        self.retryable = retryable


def _parse_document(payload: dict[str, Any]) -> dict[str, Any]:
    metadata = payload.get("metadata") or {}
    status = _STATUS_MAP.get(str(payload.get("ingestion_status") or payload.get("status") or ""), DocumentStatus.UNKNOWN)
    created = payload.get("created_at")
    return {
        "document_id": str(payload.get("id")),
        "collection_id": (payload.get("collection_ids") or [None])[0] or metadata.get("collection_ids", [None])[0],
        "title": metadata.get("title") or payload.get("title"),
        "meeting_date": metadata.get("meeting_date"),
        "meeting_started_at": metadata.get("meeting_started_at"),
        "time_precision": metadata.get("time_precision") or TimePrecision.DATE.value,
        "record_kind": metadata.get("record_kind"),
        "participants": metadata.get("participants") or [],
        "content_sha256": metadata.get("content_sha256"),
        "schema_version": metadata.get("schema_version"),
        "status": status.value,
        "created_at": str(created) if created else None,
        "size_in_bytes": payload.get("size_in_bytes"),
        "chunk_count": payload.get("chunk_count"),
        "raw_metadata": metadata,
    }


class R2RClient:
    """Small async wrapper with a cached service token."""

    def __init__(self, base_url: str | None = None):
        self.base_url = (base_url or settings.R2R_BASE_URL).rstrip("/")
        self._token: str | None = None
        self._token_lock = asyncio.Lock()

    async def _login(self) -> str:
        email = settings.R2R_SERVICE_EMAIL
        password = settings.R2R_SERVICE_PASSWORD
        if not email or not password:
            raise MeetingAgentError(
                ErrorCategory.SERVICE_FAILURE,
                "R2R service credentials are not configured (R2R_SERVICE_EMAIL/R2R_SERVICE_PASSWORD).",
            )
        try:
            async with httpx.AsyncClient(timeout=settings.R2R_TIMEOUT_SECONDS) as client:
                response = await client.post(
                    f"{self.base_url}/v3/users/login",
                    data={"username": email, "password": password.get_secret_value()},
                )
        except httpx.HTTPError as exc:
            raise MeetingAgentError(ErrorCategory.SERVICE_FAILURE, f"R2R login failed: {exc}") from exc
        if response.status_code != 200:
            raise MeetingAgentError(
                ErrorCategory.SERVICE_FAILURE,
                f"R2R login rejected ({response.status_code}).",
            )
        return response.json()["results"]["access_token"]["token"]

    async def _auth_headers(self, force: bool = False) -> dict[str, str]:
        async with self._token_lock:
            if self._token is None or force:
                self._token = await self._login()
            return {"Authorization": f"Bearer {self._token}"}

    async def request(self, method: str, path: str, **kwargs: Any) -> Any:
        headers = await self._auth_headers()
        headers.update(kwargs.pop("headers", {}) or {})
        try:
            async with httpx.AsyncClient(timeout=settings.R2R_TIMEOUT_SECONDS) as client:
                response = await client.request(method, f"{self.base_url}{path}", headers=headers, **kwargs)
        except httpx.TimeoutException as exc:
            raise MeetingAgentError(
                ErrorCategory.UNKNOWN_RESULT, f"R2R request timed out: {path}", retryable=True
            ) from exc
        except httpx.HTTPError as exc:
            raise MeetingAgentError(ErrorCategory.SERVICE_FAILURE, f"R2R request failed: {exc}") from exc
        if response.status_code == 401:
            headers = await self._auth_headers(force=True)
            async with httpx.AsyncClient(timeout=settings.R2R_TIMEOUT_SECONDS) as client:
                response = await client.request(method, f"{self.base_url}{path}", headers=headers, **kwargs)
        if response.status_code >= 500:
            raise MeetingAgentError(
                ErrorCategory.SERVICE_FAILURE,
                f"R2R error {response.status_code}: {response.text[:200]}",
                retryable=True,
            )
        if response.status_code >= 400:
            raise MeetingAgentError(
                ErrorCategory.INPUT_ERROR,
                f"R2R rejected the request ({response.status_code}): {response.text[:200]}",
            )
        return response.json()["results"] if response.content else None

    # -- reads -------------------------------------------------------------

    async def list_collections(self) -> list[dict[str, Any]]:
        payload = await self.request("GET", "/v3/collections", params={"limit": 100})
        return payload or []

    async def list_documents(self, collection_id: str) -> list[dict[str, Any]]:
        # Upstream /v3/documents has no collection query parameter: it filters by the
        # caller's own collections, which returns everything for the service account.
        # Filtering by the server-confirmed collection id happens here, not in the client.
        payload = await self.request("GET", "/v3/documents", params={"limit": 1000})
        documents = [_parse_document(item) for item in (payload or [])]
        scoped = [
            document
            for document in documents
            if document.get("collection_id") == collection_id
            or collection_id in (document.get("raw_metadata", {}).get("collection_ids") or [])
        ]
        if len(scoped) != len(documents):
            logger.info(
                "collection %s: kept %s of %s documents after server-side scope filtering",
                collection_id,
                len(scoped),
                len(documents),
            )
        return scoped

    async def get_document(self, document_id: str) -> dict[str, Any]:
        payload = await self.request("GET", f"/v3/documents/{document_id}")
        return _parse_document(payload)

    async def document_chunks(self, document_id: str, page: int = 0, page_size: int = 100) -> dict[str, Any]:
        payload = await self.request(
            "GET",
            f"/v3/documents/{document_id}/chunks",
            params={"offset": page * page_size, "limit": page_size},
        )
        items = [
            {
                "chunk_id": str(item.get("id")),
                "document_id": str(item.get("document_id")),
                "chunk_order": int((item.get("metadata") or {}).get("chunk_order", 0)),
                "text": item.get("text") or "",
                "metadata": item.get("metadata") or {},
            }
            for item in (payload or [])
        ]
        total = payload.get("total_entries") if isinstance(payload, dict) else None
        return {"items": items, "total": total}

    async def search(
        self,
        query: str,
        collection_id: str,
        document_ids: list[str],
        limit: int,
    ) -> list[dict[str, Any]]:
        filters: dict[str, Any] = {"collection_ids": [collection_id]}
        if document_ids:
            filters["document_id"] = {"$in": document_ids}
        payload = await self.request(
            "POST",
            "/v3/retrieval/search",
            json={
                "query": query,
                "search_mode": "custom",
                "search_settings": {
                    "limit": limit,
                    "filters": filters,
                    "use_semantic_search": True,
                    "use_fulltext_search": False,
                    "graph_settings": {"enabled": False},
                    "chunk_settings": {"enabled": True},
                },
            },
        )
        return (payload or {}).get("chunk_search_results") or []

    # -- writes (only used by integration tests) ----------------------------

    async def delete_document(self, document_id: str) -> dict[str, Any]:
        return await self.request("DELETE", f"/v3/documents/{document_id}") or {}


r2r_client = R2RClient()


def _scope_document(payload: dict[str, Any]) -> ScopeDocument:
    meeting_date = payload.get("meeting_date")
    try:
        parsed_date = (
            __import__("datetime").date.fromisoformat(meeting_date) if meeting_date else None
        )
    except ValueError as exc:
        raise MeetingAgentError(ErrorCategory.INPUT_ERROR, f"invalid meeting_date: {meeting_date}") from exc
    precision = payload.get("time_precision") or TimePrecision.DATE.value
    return ScopeDocument(
        document_id=payload["document_id"],
        collection_id=str(payload.get("collection_id") or ""),
        title=payload.get("title"),
        content_sha256=payload.get("content_sha256"),
        meeting_date=parsed_date,
        time_precision=TimePrecision(precision) if precision in TimePrecision._value2member_map_ else TimePrecision.DATE,
        record_kind=(
            RecordKind(payload["record_kind"])
            if payload.get("record_kind") in RecordKind._value2member_map_
            else None
        ),
        status=DocumentStatus(payload.get("status") or "unknown"),
    )


async def resolve_scope(scope_request: ScopeRequest) -> ScopeSnapshot:
    """Server-side resolution of a requested scope (C02)."""
    if scope_request.mode is ScopeMode.ALL_READY:
        documents = await r2r_client.list_documents(scope_request.collection_id)
        ready = [doc for doc in documents if doc["status"] == DocumentStatus.READY.value]
        scope_documents = [_scope_document(doc) for doc in ready]
    else:
        scope_documents = []
        for document_id in scope_request.document_ids:
            try:
                document = await r2r_client.get_document(document_id)
            except MeetingAgentError as exc:
                raise MeetingAgentError(
                    ErrorCategory.SCOPE_FORBIDDEN,
                    f"document {document_id} is not available in the requested scope",
                ) from exc
            if str(document.get("collection_id")) != scope_request.collection_id:
                raise MeetingAgentError(
                    ErrorCategory.SCOPE_FORBIDDEN,
                    f"document {document_id} does not belong to the requested project",
                )
            if document["status"] != DocumentStatus.READY.value:
                raise MeetingAgentError(
                    ErrorCategory.INPUT_ERROR,
                    f"document {document_id} is not ready ({document['status']}); adjust the scope",
                )
            scope_documents.append(_scope_document(document))
    if not scope_documents:
        raise MeetingAgentError(ErrorCategory.INPUT_ERROR, "the resolved scope is empty; import or select meetings first")
    return ScopeSnapshot(
        collection_id=scope_request.collection_id,
        mode=scope_request.mode,
        documents=scope_documents,
    )


def document_ids_of(snapshot: ScopeSnapshot) -> list[str]:
    return [document.document_id for document in snapshot.documents]
