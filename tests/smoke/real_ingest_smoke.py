"""Real-chain smoke test: R2R auth -> collection -> Chinese TXT ingest -> chunks -> scoped search.

Run:  apps/rag/py/.venv/bin/python tests/smoke/real_ingest_smoke.py
Requires the native stack (PostgreSQL + model gateway + R2R) to be running.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import httpx

BASE = os.getenv("R2R_BASE_URL", "http://127.0.0.1:7272")
EMAIL = os.getenv("R2R_ADMIN_EMAIL", "owner@meeting-records.local")
PASSWORD = os.getenv("R2R_ADMIN_PASSWORD", "owner_local_pw_2026")
OUT_DIR = Path(os.getenv("SMOKE_OUT_DIR", ".run/v0.1/smoke"))
DOC_TEXT = """# 演示项目A 第一次会议纪要

会议名称：演示项目A 需求评审会
会议日期：2026-03-02
记录类型：minutes

## 讨论

1. 李四提出把检索方案改为向量检索加关键词混合检索，用于提升召回。
2. 王五负责整理会议记录的导入字段，截止 2026-03-06。
3. 关于上线时间，会议未形成结论。

## 决议

会议明确确认：演示项目A 第一版采用 PostgreSQL 加 pgvector 作为唯一向量存储。
张三负责接口联调，截止 2026-03-10。
"""


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with httpx.Client(base_url=BASE, timeout=120.0) as client:
        login = client.post(
            "/v3/users/login",
            data={"username": EMAIL, "password": PASSWORD},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        login.raise_for_status()
        token = login.json()["results"]["access_token"]["token"]
        headers = {"Authorization": f"Bearer {token}"}

        collection = client.post(
            "/v3/collections",
            json={"name": "演示项目A", "description": "v0.1 real-chain smoke project"},
            headers=headers,
        )
        if collection.status_code == 409:
            listing = client.get("/v3/collections?limit=100", headers=headers)
            listing.raise_for_status()
            collection_id = next(
                item["id"] for item in listing.json()["results"] if item["name"] == "演示项目A"
            )
        else:
            collection.raise_for_status()
            collection_id = collection.json()["results"]["id"]
        print("collection_id:", collection_id)

        # R2R overwrites the stored filename with metadata.title, so the display
        # title is appended after upload (see docs/contracts-v0.1.md, C01).
        metadata = {
            "meeting_date": "2026-03-02",
            "time_precision": "date",
            "record_kind": "minutes",
            "participants": ["李四", "王五", "张三"],
            "schema_version": "meeting-v0.1",
            "collection_ids": [collection_id],
        }
        import hashlib
        import uuid

        digest = hashlib.sha256(DOC_TEXT.encode("utf-8")).hexdigest()
        document_uuid = uuid.uuid5(
            uuid.uuid5(uuid.NAMESPACE_URL, "https://meeting-records-agent.local/ns/meeting-document/v1"),
            f"{collection_id}|2026-03-02|演示项目A 需求评审会|minutes|{digest}",
        )
        files = {"file": ("demo-a-meeting-01.md", DOC_TEXT.encode("utf-8"), "text/markdown")}
        data = {
            "id": str(document_uuid),
            "metadata": json.dumps(metadata, ensure_ascii=False),
            "collection_ids": json.dumps([collection_id]),
            "run_with_orchestration": "false",
        }
        upload = client.post("/v3/documents", files=files, data=data, headers=headers)
        if upload.status_code == 409:
            print("upload_conflict_as_expected_for_existing_document")
        else:
            upload.raise_for_status()
        if upload.status_code == 409:
            document_id = str(document_uuid)
        else:
            document_id = upload.json()["results"]["document_id"]
        print("document_id:", document_id)
        patch = client.patch(
            f"/v3/documents/{document_id}/metadata",
            json=[{"key": "title", "value": "演示项目A 需求评审会"}],
            headers=headers,
        )
        patch.raise_for_status()
        print("title_metadata_patch:", patch.status_code, str(patch.json())[:120])

        status = None
        for _ in range(60):
            detail = client.get(f"/v3/documents/{document_id}", headers=headers)
            detail.raise_for_status()
            payload = detail.json()["results"]
            status = payload.get("ingestion_status") or payload.get("status")
            if status in {"success", "failed", "enriched"}:
                break
            time.sleep(2)
        print("ingestion_status:", status)

        chunks = client.get(f"/v3/documents/{document_id}/chunks?limit=5", headers=headers)
        chunks.raise_for_status()
        chunk_results = chunks.json()["results"]
        print("chunk_count_first_page:", len(chunk_results))
        if chunk_results:
            print("first_chunk_order:", chunk_results[0].get("chunk_order"))
            print("first_chunk_metadata_keys:", sorted((chunk_results[0].get("metadata") or {}).keys()))

        search = client.post(
            "/v3/retrieval/search",
            json={
                "query": "演示项目A 第一版用什么向量存储？",
                "search_settings": {
                    "search_mode": "basic",
                    "limit": 5,
                    "filters": {"collection_ids": [collection_id]},
                    "graph_settings": {"enabled": False},
                    "chunk_settings": {"enabled": True},
                },
            },
            headers=headers,
        )
        search.raise_for_status()
        results = search.json()["results"]["chunk_search_results"]
        print("search_hits:", len(results))
        for hit in results[:3]:
            print("  hit:", hit.get("document_id"), hit.get("chunk_order"), (hit.get("text") or "")[:40].replace("\n", " "))

        summary = {
            "collection_id": collection_id,
            "document_id": document_id,
            "ingestion_status": status,
            "chunks_first_page": len(chunk_results),
            "search_hits": len(results),
            "search_top_document": results[0]["document_id"] if results else None,
        }
        (OUT_DIR / "real-ingest-smoke.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        ok = status == "success" and chunk_results and results
        print("SMOKE_OK" if ok else "SMOKE_FAILED")
        return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
