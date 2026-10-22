"""A13: delete cleans file/chunks/document and a partial failure is retryable."""

from __future__ import annotations

import base64
import http.cookiejar
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

WEB = os.getenv("MRA_WEB_URL", "http://127.0.0.1:3000")
EMAIL = os.getenv("R2R_ADMIN_EMAIL", "owner@meeting-records.local")
PASSWORD = os.getenv("R2R_ADMIN_PASSWORD", "owner_local_pw_2026")
PROJECT = json.loads(Path("evals/datasets/scope-map.json").read_text(encoding="utf-8"))["projects"]["模拟项目A：星河笔记"]
results: list[dict] = []


def record(name: str, ok: bool, detail: str = "") -> None:
    results.append({"name": name, "ok": ok, "detail": detail})
    print(f"{'PASS' if ok else 'FAIL'} {name}{' — ' + detail if detail else ''}")


def psql(sql: str) -> str:
    source = "source scripts/native/pg-env.sh >/dev/null 2>&1; "
    return subprocess.run(
        ["bash", "-c", f"{source}psql -h 127.0.0.1 -p 55432 -U postgres -d rag_db -tAc {json.dumps(sql)}"],
        capture_output=True, text=True, check=False,
    ).stdout.strip()


class Session:
    def __init__(self) -> None:
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def call(self, method: str, path: str, payload=None, timeout: float = 300.0):
        data = json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None
        req = urllib.request.Request(f"{WEB}{path}", data=data, method=method)
        req.add_header("Content-Type", "application/json")
        try:
            with self.opener.open(req, timeout=timeout) as response:
                return response.status, response.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read().decode("utf-8", "replace")

    def login(self) -> None:
        status, body = self.call("POST", "/api/auth/login", {"email": EMAIL, "password": PASSWORD})
        assert status == 200, body


def main() -> int:
    session = Session()
    session.login()
    content = (
        "# 删除注入测试会议\n\n会议日期：2026-06-20\n\n"
        "结论：本会议仅用于验证删除清理与部分失败重试，不含真实信息。\n"
    )
    status, body = session.call(
        "POST",
        f"/api/projects/{PROJECT['collection_id']}/meetings",
        {
            "file_base64": base64.b64encode(content.encode()).decode(),
            "file_name": "delete-injection.md",
            "title": "删除注入测试会议",
            "meeting_date": "2026-06-20",
            "record_kind": "minutes",
            "participants": ["测试"],
        },
    )
    record("准备删除用的会议已入库", status in (200, 201), f"http={status}")
    if status not in (200, 201):
        return 1
    document_id = (json.loads(body).get("meeting") or {}).get("document_id")
    record("拿到文档 ID", bool(document_id), document_id or "")

    # Inject a partial failure: the file provider cannot delete rows for a moment.
    psql("REVOKE DELETE ON meeting_records_agent.files FROM rag_app;")
    status, body = session.call("DELETE", f"/api/meetings/{document_id}")
    record("部分失败返回失败而不是成功", status >= 500 and '"deleted":false' in body.replace(" ", ""), f"http={status} {body[:120]}")
    doc_left = psql(f"select count(*) from meeting_records_agent.documents where id='{document_id}'")
    record("部分失败后文档记录保留以便重试", doc_left == "1", f"documents={doc_left}")

    psql("GRANT DELETE ON meeting_records_agent.files TO rag_app;")
    status, body = session.call("DELETE", f"/api/meetings/{document_id}")
    record("恢复后重试删除成功", status == 200 and '"deleted":true' in body.replace(" ", ""), f"http={status} {body[:120]}")

    chunks = psql(f"select count(*) from meeting_records_agent.chunks where document_id='{document_id}'")
    files = psql(f"select count(*) from meeting_records_agent.files where document_id='{document_id}'")
    docs = psql(f"select count(*) from meeting_records_agent.documents where id='{document_id}'")
    record("删除后分块/原件/文档全部清零", (chunks, files, docs) == ("0", "0", "0"), f"chunks={chunks} files={files} docs={docs}")

    # Other documents stay untouched.
    others = psql(f"select count(*) from meeting_records_agent.documents where id <> '{document_id}'")
    record("其他会议不受影响", int(others) >= 6, f"others={others}")

    summary = {"passed": sum(1 for r in results if r["ok"]), "failed": sum(1 for r in results if not r["ok"]), "results": results}
    Path("docs/evidence/delete-failure.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n{summary['passed']} passed, {summary['failed']} failed")
    return 0 if summary["failed"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
