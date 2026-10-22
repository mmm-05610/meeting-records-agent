"""Live history check for v0.1.1 (read-only; never modifies the real thread).

Verifies the API contract that the web pairing relies on: roles are correct,
each AnswerRecord appears at most once, and message ids line up with records.

Run: apps/agent/.venv/bin/python tests/e2e/history_live_check.py [thread_id]
"""

from __future__ import annotations

import http.cookiejar
import json
import os
import sys
import urllib.request
from pathlib import Path

WEB = os.getenv("MRA_WEB_URL", "http://127.0.0.1:3000")
EMAIL = os.getenv("R2R_ADMIN_EMAIL", "owner@meeting-records.local")
PASSWORD = os.getenv("R2R_ADMIN_PASSWORD", "owner_local_pw_2026")
DEFAULT_THREAD = "restart-1792632748"


def main() -> int:
    thread = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_THREAD
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    def call(path: str, payload=None):
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(f"{WEB}{path}", data=data, method="POST" if data else "GET")
        req.add_header("Content-Type", "application/json")
        with opener.open(req, timeout=60) as response:
            return response.status, response.read().decode()

    status, _ = call("/api/auth/login", {"email": EMAIL, "password": PASSWORD})
    assert status == 200, "login failed"
    status, body = call("/api/history", {"thread_id": thread})
    assert status == 200, body
    history = json.loads(body)
    messages = history.get("messages", [])
    records = history.get("answer_records", [])

    record_ids = [r.get("message_id") for r in records if r.get("message_id")]
    duplicates = {rid for rid in record_ids if record_ids.count(rid) > 1}
    message_ids = {m.get("id") for m in messages if m.get("id")}
    paired = [rid for rid in record_ids if rid in message_ids]

    roles = [m.get("role") for m in messages]
    # Legacy records (written before messages carried ids) are paired by exact
    # text in the web layer; they are not a failure as long as ids stay unique.
    legacy_text_pairable = []
    for record in records:
        rid = record.get("message_id")
        if rid in message_ids:
            continue
        text = (record.get("text") or "").strip()
        candidates = [
            m for m in messages if m.get("role") == "assistant" and (m.get("content") or "").strip() == text
        ]
        legacy_text_pairable.append({"record": rid, "exact_text_messages": len(candidates)})

    summary = {
        "thread": thread,
        "messages": len(messages),
        "roles": roles,
        "records": len(records),
        "record_ids_unique": not duplicates,
        "paired_by_message_id": paired,
        "legacy_text_pairable": legacy_text_pairable,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    Path("docs/evidence/history-live-check.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    ok = (
        bool(messages)
        and not duplicates
        and all(role in {"user", "assistant"} for role in roles)
        and roles.count("user") >= 3
        and all(item["exact_text_messages"] >= 1 for item in legacy_text_pairable)
    )
    print("HISTORY_LIVE_CHECK_OK" if ok else "HISTORY_LIVE_CHECK_FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
