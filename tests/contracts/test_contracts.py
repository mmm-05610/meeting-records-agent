"""C01-C08 contract vectors: the Python side of the cross-module contract test.

Run: PYTHONPATH=apps/agent/src apps/agent/.venv/bin/python -m pytest tests/contracts -q
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from schema.meeting import (
    AnswerRecord,
    ClaimKind,
    MeetingMetadata,
    ScopeMode,
    ScopeRequest,
    ScopeSnapshot,
    compute_document_id,
)

FIXTURES = Path(__file__).parent / "fixtures" / "meeting_contract_vectors.json"
VECTORS = json.loads(FIXTURES.read_text(encoding="utf-8"))


def test_document_id_vectors() -> None:
    for case in VECTORS["document_id_cases"]:
        actual = compute_document_id(
            case["collection_id"],
            case["meeting_date"],
            case["title"],
            case["record_kind"],
            case["content_sha256"],
        )
        assert actual == case["expected_document_id"], case


def test_whitespace_only_title_variants_share_identity() -> None:
    first, second = VECTORS["document_id_cases"][0], VECTORS["document_id_cases"][1]
    assert first["expected_document_id"] == second["expected_document_id"]
    different = VECTORS["document_id_cases"][2]
    assert different["expected_document_id"] != first["expected_document_id"]


def test_meeting_metadata_round_trip() -> None:
    for case, document in zip(
        VECTORS["document_id_cases"], VECTORS["scope_snapshot_case"]["snapshot"]["documents"] * 2
    ):
        metadata = MeetingMetadata(
            collection_id=case["collection_id"],
            title=case["title"],
            meeting_date=case["meeting_date"],
            time_precision="date",
            record_kind=case["record_kind"],
            participants=[" 张三 ", "李四"],
            content_sha256=case["content_sha256"],
            document_id=case["expected_document_id"],
        )
        assert metadata.title == "演示项目A 需求评审会" or metadata.title.startswith("演示项目")
        dumped = metadata.model_dump(mode="json")
        assert MeetingMetadata.model_validate(dumped).document_id == metadata.document_id
        assert metadata.r2r_metadata()["collection_ids"] == [case["collection_id"]]


def test_meeting_metadata_rejects_identity_mismatch() -> None:
    case = VECTORS["document_id_cases"][0]
    with pytest.raises(ValueError):
        MeetingMetadata(
            collection_id=case["collection_id"],
            title="另一个标题",
            meeting_date=case["meeting_date"],
            time_precision="date",
            record_kind=case["record_kind"],
            content_sha256=case["content_sha256"],
            document_id=case["expected_document_id"],
        )


def test_scope_snapshot_fingerprint_matches_vector() -> None:
    case = VECTORS["scope_snapshot_case"]
    snapshot = ScopeSnapshot.model_validate(case["snapshot"])
    assert snapshot.fingerprint == case["expected_fingerprint"]
    dumped = snapshot.model_dump(mode="json")
    dumped["documents"] = sorted(dumped["documents"], key=lambda item: item["document_id"])
    expected = {**case["snapshot"], "documents": sorted(case["snapshot"]["documents"], key=lambda item: item["document_id"])}
    assert dumped == expected
    assert snapshot.mode is ScopeMode.ALL_READY


def test_scope_request_rules() -> None:
    with pytest.raises(ValueError):
        ScopeRequest(collection_id="11111111-1111-5111-8111-111111111111", mode="explicit")
    with pytest.raises(ValueError):
        ScopeRequest(
            collection_id="11111111-1111-5111-8111-111111111111",
            mode="all_ready",
            document_ids=["22222222-2222-5222-8222-222222222222"],
        )
    ok = ScopeRequest(
        collection_id="11111111-1111-5111-8111-111111111111",
        mode="explicit",
        document_ids=["22222222-2222-5222-8222-222222222222"],
    )
    assert ok.mode is ScopeMode.EXPLICIT


def test_answer_record_round_trip_and_validation() -> None:
    case = VECTORS["answer_record_case"]
    record = AnswerRecord.model_validate(case)
    assert record.status.value == "completed"
    assert record.claims[0].kind is ClaimKind.CONFIRMED
    assert AnswerRecord.model_validate(record.model_dump(mode="json")) == record

    bad = dict(case)
    bad["claims"] = [{"text": "无来源事实", "kind": "fact", "evidence_ids": ["missing"]}]
    with pytest.raises(ValueError):
        AnswerRecord.model_validate(bad)


def test_unknown_claim_needs_no_evidence_but_no_hidden_facts() -> None:
    case = dict(VECTORS["answer_record_case"])
    case["claims"] = [
        {"text": "没有记录完成状态。", "kind": "unknown", "evidence_ids": []},
    ]
    AnswerRecord.model_validate(case)
