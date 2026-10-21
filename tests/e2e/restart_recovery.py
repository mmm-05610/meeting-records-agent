"""Restart / persistence checks (A10, A12, A14, A18 partial).

Requires the full stack; it stops and restarts the agent and web services through
scripts/native/service.sh, then verifies the persisted answer, scope and run status.

Run: apps/agent/.venv/bin/python tests/e2e/restart_recovery.py
"""

from __future__ import annotations

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
SCOPE_MAP = json.loads(Path("evals/datasets/scope-map.json").read_text(encoding="utf-8"))
PROJECT = SCOPE_MAP["projects"]["模拟项目A：星河笔记"]
results: list[dict] = []


def record(name: str, ok: bool, detail: str = "") -> None:
    results.append({"name": name, "ok": ok, "detail": detail})
    print(f"{'PASS' if ok else 'FAIL'} {name}{' — ' + detail if detail else ''}")


class Session:
    def __init__(self) -> None:
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def call(self, method: str, path: str, payload=None, timeout: float = 300.0):
        data = json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None
        req = urllib.request.Request(f"{WEB}{path}", data=data, method=method)
        req.add_header("Content-Type", "application/json")
        req.add_header("Accept", "application/json, text/event-stream")
        try:
            with self.opener.open(req, timeout=timeout) as response:
                return response.status, response.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read().decode("utf-8", "replace")

    def login(self) -> None:
        status, body = self.call("POST", "/api/auth/login", {"email": EMAIL, "password": PASSWORD})
        assert status == 200, body


def ask(session: Session, thread_id: str, question: str, scope: dict) -> tuple[int, str]:
    payload = {
        "threadId": thread_id,
        "runId": f"run-{int(time.time()*1000)}",
        "messages": [{"id": f"m-{int(time.time()*1000)}", "role": "user", "content": question}],
        "tools": [],
        "context": [],
        "state": None,
        "forwardedProps": {"meeting_scope": scope},
    }
    return session.call("POST", "/api/copilotkit", payload)


def history(session: Session, thread_id: str) -> dict:
    status, body = session.call("POST", "/api/history", {"thread_id": thread_id})
    assert status == 200, body
    return json.loads(body)


def service(action: str, name: str, extra: list[str] | None = None) -> None:
    args = ["bash", "scripts/native/service.sh", action, name]
    if extra:
        args.extend(extra)
    subprocess.run(args, check=True, capture_output=True)


def main() -> int:
    session = Session()
    session.login()
    scope = {"collection_id": PROJECT["collection_id"], "mode": "all_ready"}
    thread_id = f"restart-{int(time.time())}"

    status, body = ask(session, thread_id, "谁负责检索方案的技术验证？", scope)
    record("重启前完成一轮带引用问答", status == 200 and "answer_record" in body, f"http={status}")
    before = history(session, thread_id)
    record(
        "历史返回 AnswerRecord 与范围",
        bool(before.get("answer_records")) and bool(before.get("scope")) and before.get("run_status") == "completed",
        f"records={len(before.get('answer_records') or [])} status={before.get('run_status')}",
    )
    answer_before = (before.get("answer_records") or [{}])[-1].get("text", "")

    # A failed run must not be reported as completed.
    failed_thread = f"failed-{int(time.time())}"
    ask(session, failed_thread, "问题", {"collection_id": PROJECT["collection_id"], "mode": "explicit", "document_ids": []})
    failed_history = history(session, failed_thread)
    record(
        "失败轮次不显示为已完成",
        failed_history.get("run_status") in {"failed", "interrupted"},
        f"status={failed_history.get('run_status')}",
    )

    service("stop", "web")
    service("stop", "agent")
    time.sleep(3)
    service("start", "agent", ["bash", "scripts/native/start-agent.sh"])
    time.sleep(12)
    service("start", "web", ["bash", "scripts/native/start-web.sh"])
    time.sleep(8)

    session2 = Session()
    session2.login()
    after = history(session2, thread_id)
    answer_after = (after.get("answer_records") or [{}])[-1].get("text", "")
    record("重启后历史仍可读", bool(after.get("answer_records")), f"records={len(after.get('answer_records') or [])}")
    record("重启后答案文本一致", answer_before == answer_after)
    record("重启后范围快照一致", (after.get("scope") or {}).get("fingerprint") == (before.get("scope") or {}).get("fingerprint"))
    record("重启后引用映射保留", bool((after.get("answer_records") or [{}])[-1].get("sources")))

    status, body = session2.call("GET", "/api/projects")
    record("重启后 R2R 数据仍在", status == 200 and "模拟项目A" in body, f"http={status}")

    summary = {"passed": sum(1 for r in results if r["ok"]), "failed": sum(1 for r in results if not r["ok"]), "results": results}
    Path("docs/evidence/restart-recovery.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n{summary['passed']} passed, {summary['failed']} failed")
    return 0 if summary["failed"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
