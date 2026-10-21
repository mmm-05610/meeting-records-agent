"""Boundary and failure-injection checks for v0.1 (A03/A15/A16/A19/A02).

Run with the full native stack up:
  apps/agent/.venv/bin/python tests/e2e/api_boundaries.py
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

WEB = os.getenv("MRA_WEB_URL", "http://127.0.0.1:3000")
AGENT = os.getenv("MRA_AGENT_URL", "http://127.0.0.1:8080")
EMAIL = os.getenv("R2R_ADMIN_EMAIL", "owner@meeting-records.local")
PASSWORD = os.getenv("R2R_ADMIN_PASSWORD", "owner_local_pw_2026")
SCOPE_MAP = json.loads(Path("evals/datasets/scope-map.json").read_text(encoding="utf-8"))
PROJECT_A = SCOPE_MAP["projects"]["模拟项目A：星河笔记"]
PROJECT_B = SCOPE_MAP["projects"]["模拟项目B：云仓物流"]

results: list[dict] = []


def record(name: str, ok: bool, detail: str = "") -> None:
    results.append({"name": name, "ok": ok, "detail": detail})
    print(f"{'PASS' if ok else 'FAIL'} {name}{' — ' + detail if detail else ''}")


def request(method: str, url: str, payload=None, token: str | None = None, cookie: str | None = None):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    if cookie:
        req.add_header("Cookie", cookie)
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            return response.status, response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")


def login_cookie() -> str:
    status, body = request("POST", f"{WEB}/api/auth/login", {"email": EMAIL, "password": PASSWORD})
    assert status == 200, body
    import http.cookiejar

    # re-login with cookie jar to capture Set-Cookie
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    data = json.dumps({"email": EMAIL, "password": PASSWORD}).encode()
    req = urllib.request.Request(f"{WEB}/api/auth/login", data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    opener.open(req, timeout=60)
    return "; ".join(f"{c.name}={c.value}" for c in jar)


def agui_outcome(status: int, body: str) -> tuple[str | None, bool]:
    """AG-UI always answers 200 with an SSE stream; read the final state from it."""
    error_category = None
    has_answer = False
    for line in body.splitlines():
        if not line.startswith("data:"):
            continue
        try:
            event = json.loads(line[5:].strip())
        except json.JSONDecodeError:
            continue
        if event.get("type") == "STATE_SNAPSHOT":
            snapshot = event.get("snapshot") or {}
            if snapshot.get("error"):
                error_category = snapshot["error"].get("category")
            if (snapshot.get("answer_record") or {}).get("status") == "completed":
                has_answer = True
    return error_category, has_answer


def agui(scope: dict, question: str, extra: dict | None = None, token: str | None = None):
    payload = {
        "threadId": f"boundary-{os.urandom(4).hex()}",
        "runId": f"run-{os.urandom(4).hex()}",
        "messages": [{"id": "m1", "role": "user", "content": question}],
        "tools": [],
        "context": [],
        "state": None,
        "forwardedProps": {"meeting_scope": scope},
    }
    if extra:
        payload["forwardedProps"].update(extra)
    return request("POST", f"{AGENT}/agui/meeting-assistant/run", payload, token=token)


def main() -> int:
    cookie = login_cookie()
    record("登录获得 HttpOnly 会话", bool(cookie), cookie.split("=")[0] if cookie else "")

    status, body = request("GET", f"{WEB}/api/projects")
    record("未登录访问项目列表被拒绝", status == 401 and "scope_forbidden" in body, f"{status}")

    status, body = request("POST", f"{WEB}/api/auth/register", {"email": "x@y.z", "password": "x"})
    record("不存在注册入口（404）", status == 404, f"{status}")

    status, body = request("GET", f"{WEB}/api/projects", cookie=cookie)
    record("登录后可读项目列表", status == 200, f"{status}")

    # A03: explicit scope containing a document from another project must be rejected.
    other_doc = next(iter(PROJECT_B["documents"].values()))
    status, body = request(
        "POST",
        f"{AGENT}/agui/meeting-assistant/run",
        {
            "threadId": "t-cross",
            "runId": "r-cross",
            "messages": [{"id": "m1", "role": "user", "content": "这个项目里有什么决定？"}],
            "tools": [],
            "context": [],
            "state": None,
            "forwardedProps": {
                "meeting_scope": {
                    "collection_id": PROJECT_A["collection_id"],
                    "mode": "explicit",
                    "document_ids": [other_doc],
                }
            },
        },
    )
    category, has_answer = agui_outcome(status, body)
    record(
        "跨项目显式范围被拒绝",
        status == 200 and category in {"scope_forbidden", "input_error"} and not has_answer,
        f"http={status} category={category} answer={has_answer}",
    )

    # A16: client-forged identity is rejected by the agent.
    status, body = agui({"collection_id": PROJECT_A["collection_id"], "mode": "all_ready"}, "谁负责技术验证？", extra={"user_id": "attacker"})
    record("伪造 user_id 被拒绝", status == 400 and "server-owned" in body, f"{status}")

    status, body = agui({"collection_id": PROJECT_A["collection_id"], "mode": "explicit", "document_ids": []}, "问题")
    category, has_answer = agui_outcome(status, body)
    record("空显式范围被拒绝", category == "input_error" and not has_answer, f"category={category}")

    status, body = agui({"collection_id": "00000000-0000-4000-8000-000000000000", "mode": "all_ready"}, "问题")
    category, has_answer = agui_outcome(status, body)
    record("未知项目范围被拒绝", category == "input_error" and not has_answer, f"category={category}")

    # A02: invalid upload inputs rejected before any model call.
    status, body = request(
        "POST",
        f"{WEB}/api/projects/{PROJECT_A['collection_id']}/meetings",
        {"file_base64": "", "title": "空文件", "meeting_date": "2026-06-01", "record_kind": "minutes"},
        cookie=cookie,
    )
    record("空文件上传被拒绝", status == 400 and "input_error" in body, f"{status}")

    status, body = request(
        "POST",
        f"{WEB}/api/projects/{PROJECT_A['collection_id']}/meetings",
        {"file_base64": "5L2g5aW9", "title": "", "meeting_date": "2026-06-01", "record_kind": "minutes"},
        cookie=cookie,
    )
    record("缺少标题上传被拒绝", status == 400 and "input_error" in body, f"{status}")

    status, body = request(
        "POST",
        f"{WEB}/api/projects/{PROJECT_A['collection_id']}/meetings",
        {"file_base64": "5L2g5aW9", "title": "日期错误", "meeting_date": "2026/06/01", "record_kind": "minutes"},
        cookie=cookie,
    )
    record("非法日期上传被拒绝", status == 400 and "input_error" in body, f"{status}")

    status, body = request("GET", f"{WEB}/api/meetings/00000000-0000-4000-8000-000000000000/chunks", cookie=cookie)
    record("不存在的会议分块返回 404", status == 404, f"{status}")

    # A13: deleting a nonexistent document reports failure, not success.
    status, body = request("DELETE", f"{WEB}/api/meetings/00000000-0000-4000-8000-000000000000", cookie=cookie)
    record("删除不存在的会议返回失败", status >= 400, f"{status}")

    summary = {"passed": sum(1 for r in results if r["ok"]), "failed": sum(1 for r in results if not r["ok"]), "results": results}
    Path("docs/evidence/api-boundaries.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n{summary['passed']} passed, {summary['failed']} failed")
    return 0 if summary["failed"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
