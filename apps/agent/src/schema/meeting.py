"""Cross-module contract C01-C08 for meeting-records-agent v0.1.

Single source of truth for the Python side. The TypeScript mirror lives in
apps/web/src/types/meeting-contracts.ts and both are pinned by the vectors in
tests/contracts/fixtures/meeting_contract_vectors.json.
"""

from __future__ import annotations

import hashlib
import json
import unicodedata
import uuid
from datetime import date, datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

SCHEMA_VERSION = "meeting-v0.1"
DOCUMENT_ID_NAMESPACE = uuid.uuid5(
    uuid.NAMESPACE_URL, "https://meeting-records-agent.local/ns/meeting-document/v1"
)


def utc_now() -> datetime:
    return datetime.now().astimezone()


def normalize_title(value: str) -> str:
    """NFC, trimmed, single-space separated display title."""
    collapsed = " ".join(unicodedata.normalize("NFC", value).split())
    if not collapsed:
        raise ValueError("title must not be blank")
    return collapsed


def normalize_sha256(value: str) -> str:
    digest = value.strip().lower()
    if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
        raise ValueError("content_sha256 must be 64 lowercase hex characters")
    return digest


def canonical_json(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def compute_document_id(
    collection_id: str | uuid.UUID,
    meeting_date: date | str,
    title: str,
    record_kind: RecordKind | str,
    content_sha256: str,
) -> str:
    """Deterministic document identity (C01).

    Different project, date, title, kind or content always produce a different
    id; retrying the same input produces the same id.
    """
    name = "|".join(
        [
            str(uuid.UUID(str(collection_id))),
            date.fromisoformat(str(meeting_date)).isoformat(),
            normalize_title(title),
            str(RecordKind(str(record_kind))),
            normalize_sha256(content_sha256),
        ]
    )
    return str(uuid.uuid5(DOCUMENT_ID_NAMESPACE, name))


class RecordKind(StrEnum):
    TRANSCRIPT = "transcript"
    MINUTES = "minutes"


class TimePrecision(StrEnum):
    DATE = "date"
    DATETIME = "datetime"


class ScopeMode(StrEnum):
    ALL_READY = "all_ready"
    EXPLICIT = "explicit"


class ClaimKind(StrEnum):
    FACT = "fact"
    PROPOSAL = "proposal"
    CONFIRMED = "confirmed"
    CHANGE = "change"
    CONFLICT = "conflict"
    UNKNOWN = "unknown"


class AnswerStatus(StrEnum):
    COMPLETED = "completed"
    FAILED = "failed"
    INTERRUPTED = "interrupted"


class DocumentStatus(StrEnum):
    READY = "ready"
    PROCESSING = "processing"
    FAILED = "failed"
    UNKNOWN = "unknown"


class ErrorCategory(StrEnum):
    INPUT_ERROR = "input_error"
    SCOPE_FORBIDDEN = "scope_forbidden"
    DUPLICATE_PROCESSING = "duplicate_processing"
    UNKNOWN_RESULT = "unknown_result"
    SERVICE_FAILURE = "service_failure"
    BUDGET_EXCEEDED = "budget_exceeded"
    INVALID_CITATION = "invalid_citation"
    STALE_SCOPE = "stale_scope"


class MeetingMetadata(BaseModel):
    """C01: meeting fields stored in R2R document metadata."""

    collection_id: str
    title: str
    meeting_date: date
    meeting_started_at: datetime | None = None
    time_precision: TimePrecision = TimePrecision.DATE
    record_kind: RecordKind
    participants: list[str] = Field(default_factory=list)
    content_sha256: str
    schema_version: Literal["meeting-v0.1"] = SCHEMA_VERSION
    document_id: str

    @field_validator("collection_id", "document_id")
    @classmethod
    def _uuid_text(cls, value: str) -> str:
        return str(uuid.UUID(str(value)))

    @field_validator("title")
    @classmethod
    def _title(cls, value: str) -> str:
        return normalize_title(value)

    @field_validator("content_sha256")
    @classmethod
    def _sha(cls, value: str) -> str:
        return normalize_sha256(value)

    @field_validator("participants")
    @classmethod
    def _participants(cls, value: list[str]) -> list[str]:
        return [normalize_title(item) for item in value if item and item.strip()]

    @model_validator(mode="after")
    def _precision_matches_time(self) -> MeetingMetadata:
        if self.time_precision is TimePrecision.DATETIME:
            if self.meeting_started_at is None:
                raise ValueError("time_precision=datetime requires meeting_started_at")
            if self.meeting_started_at.tzinfo is None:
                raise ValueError("meeting_started_at must carry a timezone")
        elif self.meeting_started_at is not None:
            raise ValueError("time_precision=date must not carry meeting_started_at")
        return self

    @model_validator(mode="after")
    def _identity_matches_fields(self) -> MeetingMetadata:
        expected = compute_document_id(
            self.collection_id, self.meeting_date, self.title, self.record_kind, self.content_sha256
        )
        if expected != self.document_id:
            raise ValueError(
                f"document_id does not match the deterministic identity ({expected})"
            )
        return self

    def r2r_metadata(self) -> dict[str, Any]:
        """Metadata payload for the R2R upload call (title is appended later, C01/T005)."""
        payload: dict[str, Any] = {
            "meeting_date": self.meeting_date.isoformat(),
            "time_precision": self.time_precision.value,
            "record_kind": self.record_kind.value,
            "participants": self.participants,
            "content_sha256": self.content_sha256,
            "schema_version": self.schema_version,
            "collection_ids": [self.collection_id],
        }
        if self.meeting_started_at is not None:
            payload["meeting_started_at"] = self.meeting_started_at.isoformat()
        return payload


class ScopeRequest(BaseModel):
    """C02: query scope requested by the client."""

    collection_id: str
    mode: ScopeMode
    document_ids: list[str] = Field(default_factory=list)

    @field_validator("collection_id")
    @classmethod
    def _collection(cls, value: str) -> str:
        return str(uuid.UUID(str(value)))

    @field_validator("document_ids")
    @classmethod
    def _documents(cls, value: list[str]) -> list[str]:
        return [str(uuid.UUID(str(item))) for item in value]

    @model_validator(mode="after")
    def _explicit_needs_documents(self) -> ScopeRequest:
        if self.mode is ScopeMode.EXPLICIT and not self.document_ids:
            raise ValueError("explicit scope requires at least one document id")
        if self.mode is ScopeMode.ALL_READY and self.document_ids:
            raise ValueError("all_ready scope must not carry an explicit document list")
        return self


class ScopeDocument(BaseModel):
    document_id: str
    collection_id: str
    title: str | None = None
    content_sha256: str | None = None
    meeting_date: date | None = None
    time_precision: TimePrecision | None = None
    record_kind: RecordKind | None = None
    status: DocumentStatus = DocumentStatus.UNKNOWN


class ScopeSnapshot(BaseModel):
    """C02: server-resolved immutable scope for one turn."""

    collection_id: str
    mode: ScopeMode
    documents: list[ScopeDocument]
    created_at: datetime = Field(default_factory=utc_now)
    fingerprint: str = ""

    def compute_fingerprint(self) -> str:
        payload = {
            "collection_id": self.collection_id,
            "mode": self.mode.value,
            "documents": [
                {
                    "document_id": document.document_id,
                    "content_sha256": document.content_sha256,
                    "status": document.status.value,
                }
                for document in sorted(self.documents, key=lambda item: item.document_id)
            ],
        }
        return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()

    @model_validator(mode="after")
    def _fill_fingerprint(self) -> ScopeSnapshot:
        expected = self.compute_fingerprint()
        if self.fingerprint and self.fingerprint != expected:
            raise ValueError("scope fingerprint does not match its content")
        self.fingerprint = expected
        return self

    def document_ids(self) -> list[str]:
        return [document.document_id for document in self.documents]


class EvidenceChunk(BaseModel):
    """C03: one retrieved chunk with a stable citation identity."""

    source_key: str
    document_id: str
    chunk_id: str
    chunk_order: int
    text: str
    title: str | None = None
    meeting_date: date | None = None
    meeting_started_at: datetime | None = None
    record_kind: RecordKind | None = None
    content_sha256: str | None = None
    score: float | None = None


class SourceRef(BaseModel):
    """C04: stable citation target saved in the AnswerRecord."""

    source_key: str
    document_id: str
    chunk_id: str
    chunk_order: int
    title: str | None = None
    meeting_date: date | None = None
    record_kind: RecordKind | None = None
    quote: str
    display_index: int | None = None


class Claim(BaseModel):
    text: str
    kind: ClaimKind
    evidence_ids: list[str] = Field(default_factory=list)


class Coverage(BaseModel):
    checked: list[str] = Field(default_factory=list)
    unchecked: list[str] = Field(default_factory=list)
    failed: list[str] = Field(default_factory=list)
    budget_exhausted: bool = False


class AnswerRecord(BaseModel):
    """C04: the only object that may be published as a completed answer."""

    message_id: str
    run_id: str
    text: str
    claims: list[Claim] = Field(default_factory=list)
    sources: dict[str, SourceRef] = Field(default_factory=dict)
    scope_snapshot: ScopeSnapshot
    coverage: Coverage = Field(default_factory=Coverage)
    created_at: datetime = Field(default_factory=utc_now)
    model_config_id: str
    status: AnswerStatus = AnswerStatus.COMPLETED

    @model_validator(mode="after")
    def _completed_needs_support(self) -> AnswerRecord:
        if self.status is not AnswerStatus.COMPLETED:
            return self
        if not self.text.strip():
            raise ValueError("completed answer needs a non-empty text")
        known = set(self.sources)
        for claim in self.claims:
            unknown = [key for key in claim.evidence_ids if key not in known]
            if unknown:
                raise ValueError(f"claim cites unknown evidence ids: {unknown}")
            if claim.kind is not ClaimKind.UNKNOWN and not claim.evidence_ids:
                raise ValueError(f"{claim.kind.value} claim needs evidence")
        return self


class MeetingError(BaseModel):
    """C08: stable error envelope shared by both applications."""

    category: ErrorCategory
    message: str
    fields: list[str] = Field(default_factory=list)
    retryable: bool = False

    def to_payload(self) -> dict[str, Any]:
        return self.model_dump(mode="json")


class AgUiStateProjection(BaseModel):
    """C05: the only answer/scope state the Web layer may render."""

    meeting_scope: ScopeSnapshot
    progress: list[str] = Field(default_factory=list)
    answer_record: AnswerRecord | None = None
    clarification: str | None = None


def _dedupe_by_id(documents: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for document in documents:
        if document["document_id"] in seen:
            continue
        seen.add(document["document_id"])
        unique.append(document)
    return unique


def meeting_contract_vectors() -> dict[str, Any]:
    """Deterministic vectors shared with the TypeScript test.

    Values are computed by the Python implementation and asserted by both sides.
    """
    collection_id = "11111111-1111-5111-8111-111111111111"
    cases = [
        {
            "collection_id": collection_id,
            "meeting_date": "2026-03-02",
            "title": " 演示项目A  需求评审会 ",
            "record_kind": "minutes",
            "content_sha256": hashlib.sha256("会议内容示例一".encode("utf-8")).hexdigest(),
        },
        {
            "collection_id": collection_id,
            "meeting_date": "2026-03-02",
            "title": "演示项目A 需求评审会",
            "record_kind": "minutes",
            "content_sha256": hashlib.sha256("会议内容示例一".encode("utf-8")).hexdigest(),
        },
        {
            "collection_id": "22222222-2222-5222-8222-222222222222",
            "meeting_date": "2026-03-09",
            "title": "演示项目B 复盘会",
            "record_kind": "transcript",
            "content_sha256": hashlib.sha256("会议内容示例二".encode("utf-8")).hexdigest(),
        },
        {
            "collection_id": collection_id,
            "meeting_date": "2026-03-16",
            "title": "演示项目A 变更评审会",
            "record_kind": "transcript",
            "content_sha256": hashlib.sha256("会议内容示例三".encode("utf-8")).hexdigest(),
        },
    ]
    documents = [
        {
            "document_id": compute_document_id(
                case["collection_id"],
                case["meeting_date"],
                case["title"],
                case["record_kind"],
                case["content_sha256"],
            ),
            "collection_id": case["collection_id"],
            "title": normalize_title(case["title"]),
            "content_sha256": case["content_sha256"],
            "meeting_date": case["meeting_date"],
            "time_precision": "date",
            "status": "ready",
        }
        for case in cases
    ]
    snapshot = ScopeSnapshot(
        collection_id=collection_id,
        mode=ScopeMode.ALL_READY,
        documents=[
            ScopeDocument(**document)
            for document in _dedupe_by_id(
                [doc for doc in documents if doc["collection_id"] == collection_id]
            )
        ],
    )
    return {
        "schema_version": SCHEMA_VERSION,
        "document_id_cases": [
            {**case, "expected_document_id": document["document_id"]}
            for case, document in zip(cases, documents)
        ],
        "scope_snapshot_case": {
            "snapshot": json.loads(snapshot.model_dump_json()),
            "expected_fingerprint": snapshot.fingerprint,
        },
        "answer_record_case": {
            "message_id": "msg-1",
            "run_id": "run-1",
            "text": "第一版采用 PostgreSQL + pgvector。",
            "claims": [
                {
                    "text": "第一版采用 PostgreSQL + pgvector。",
                    "kind": "confirmed",
                    "evidence_ids": ["e1"],
                }
            ],
            "sources": {
                "e1": {
                    "source_key": "e1",
                    "document_id": documents[0]["document_id"],
                    "chunk_id": "chunk-0",
                    "chunk_order": 0,
                    "title": documents[0]["title"],
                    "meeting_date": "2026-03-02",
                    "record_kind": "minutes",
                    "quote": "会议明确确认：第一版采用 PostgreSQL 加 pgvector 作为唯一向量存储。",
                }
            },
            "scope_snapshot": json.loads(snapshot.model_dump_json()),
            "coverage": {"checked": [documents[0]["document_id"]], "unchecked": [], "failed": []},
            "created_at": "2026-03-11T09:00:00+08:00",
            "model_config_id": "gateway/minimax-m3.1-flash-free",
            "status": "completed",
        },
    }
