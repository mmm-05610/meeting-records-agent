"""Import simulated meeting records into R2R through the product's C01 adapter.

This mirrors `apps/web/src/server`'s upload path (deterministic document id,
server-side sha256, title appended after upload) so the demo/eval data goes
through the same identity rules the product uses.

Usage:
  PYTHONPATH=apps/agent/src apps/agent/.venv/bin/python scripts/demo/import_dataset.py \
      --dir evals/datasets/sim-project-a --collection-name "模拟项目A：星河笔记"
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import re
import sys
import time
import uuid
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps/agent/src"))

from schema.meeting import compute_document_id  # noqa: E402

META_PATTERNS = {
    "title": re.compile(r"^-\s*会议名称[:：]\s*(.+)$"),
    "meeting_date": re.compile(r"^-\s*会议日期[:：]\s*(.+)$"),
    "record_kind": re.compile(r"^-\s*记录类型[:：]\s*(\w+)"),
    "participants": re.compile(r"^-\s*参与人[:：]\s*(.+)$"),
}


def parse_meeting(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    values: dict[str, str] = {}
    for line in text.splitlines():
        for key, pattern in META_PATTERNS.items():
            match = pattern.match(line.strip())
            if match and key not in values:
                values[key] = match.group(1).strip()
    missing = [key for key in ("title", "meeting_date", "record_kind") if key not in values]
    if missing:
        raise ValueError(f"{path}: missing metadata fields {missing}")
    participants = [
        item.split("（")[0].strip()
        for item in re.split(r"[、,，]", values.get("participants", ""))
        if item.strip()
    ]
    return {
        "title": values["title"],
        "meeting_date": values["meeting_date"],
        "record_kind": "transcript" if values["record_kind"].startswith("transcript") else "minutes",
        "participants": participants,
        "text": text,
    }


class Importer:
    def __init__(self, base_url: str, email: str, password: str):
        self.base_url = base_url.rstrip("/")
        self.email = email
        self.password = password
        self.token: str | None = None

    async def login(self) -> None:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                f"{self.base_url}/v3/users/login",
                data={"username": self.email, "password": self.password},
            )
            response.raise_for_status()
            self.token = response.json()["results"]["access_token"]["token"]

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}

    async def ensure_collection(self, name: str) -> str:
        async with httpx.AsyncClient(timeout=60) as client:
            listing = await client.get(f"{self.base_url}/v3/collections", headers=self.headers, params={"limit": 100})
            listing.raise_for_status()
            for item in listing.json()["results"]:
                if item["name"] == name:
                    return item["id"]
            created = await client.post(
                f"{self.base_url}/v3/collections",
                headers=self.headers,
                json={"name": name, "description": "模拟演示项目（v0.1 演示数据）"},
            )
            created.raise_for_status()
            return created.json()["results"]["id"]

    async def upload(self, collection_id: str, meeting: dict, filename: str) -> dict:
        digest = hashlib.sha256(meeting["text"].encode("utf-8")).hexdigest()
        document_id = compute_document_id(
            collection_id, meeting["meeting_date"], meeting["title"], meeting["record_kind"], digest
        )
        metadata = {
            "meeting_date": meeting["meeting_date"],
            "time_precision": "date",
            "record_kind": meeting["record_kind"],
            "participants": meeting["participants"],
            "content_sha256": digest,
            "schema_version": "meeting-v0.1",
            "collection_ids": [collection_id],
        }
        async with httpx.AsyncClient(timeout=300) as client:
            existing = await client.get(f"{self.base_url}/v3/documents/{document_id}", headers=self.headers)
            if existing.status_code == 200:
                status = existing.json()["results"].get("ingestion_status")
                if status in {"success", "enriched"}:
                    return {"document_id": document_id, "status": "existing", "chunks": await self._chunk_count(document_id)}
            response = await client.post(
                f"{self.base_url}/v3/documents",
                headers=self.headers,
                files={"file": (filename, meeting["text"].encode("utf-8"), "text/markdown")},
                data={
                    "id": document_id,
                    "metadata": json.dumps(metadata, ensure_ascii=False),
                    "collection_ids": json.dumps([collection_id]),
                    "run_with_orchestration": "false",
                },
            )
            if response.status_code not in (200, 201, 202, 409):
                raise RuntimeError(f"upload failed {response.status_code}: {response.text[:300]}")
            await client.patch(
                f"{self.base_url}/v3/documents/{document_id}/metadata",
                headers=self.headers,
                json=[{"title": meeting["title"]}],
            )
        status = await self.wait_ready(document_id)
        return {"document_id": document_id, "status": status, "chunks": await self._chunk_count(document_id)}

    async def wait_ready(self, document_id: str, timeout: float = 180.0) -> str:
        deadline = time.time() + timeout
        status = "unknown"
        async with httpx.AsyncClient(timeout=60) as client:
            while time.time() < deadline:
                response = await client.get(f"{self.base_url}/v3/documents/{document_id}", headers=self.headers)
                if response.status_code == 200:
                    status = response.json()["results"].get("ingestion_status") or "unknown"
                    if status in {"success", "enriched", "failed"}:
                        return status
                await asyncio.sleep(1.5)
        return status

    async def _chunk_count(self, document_id: str) -> int:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.get(
                f"{self.base_url}/v3/documents/{document_id}/chunks",
                headers=self.headers,
                params={"limit": 1000},
            )
            response.raise_for_status()
            return len(response.json()["results"])


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", required=True)
    parser.add_argument("--collection-name", required=True)
    parser.add_argument("--output", default=None)
    args = parser.parse_args()

    import os

    importer = Importer(
        os.getenv("R2R_BASE_URL", "http://127.0.0.1:7272"),
        os.getenv("R2R_SERVICE_EMAIL", "owner@meeting-records.local"),
        os.getenv("R2R_SERVICE_PASSWORD", "owner_local_pw_2026"),
    )
    await importer.login()
    collection_id = await importer.ensure_collection(args.collection_name)
    files = sorted(Path(args.dir).glob("*.md"))
    results = []
    for path in files:
        meeting = parse_meeting(path)
        result = await importer.upload(collection_id, meeting, path.name)
        result.update({"file": path.name, "title": meeting["title"], "meeting_date": meeting["meeting_date"]})
        results.append(result)
        print(f"{path.name}: {result['status']} chunks={result['chunks']} id={result['document_id']}")
    summary = {"collection_id": collection_id, "collection_name": args.collection_name, "meetings": results}
    output = Path(args.output or f"data/imports/{args.collection_name.replace('：', '-').replace(':', '-')}.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"IMPORT_DONE {len(results)} meetings -> {output}")
    return 0 if all(item["status"] in {"existing", "success", "enriched"} for item in results) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
