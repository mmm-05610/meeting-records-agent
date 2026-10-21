"""Real-chain checks used by scripts/verify/clean-install.sh (A18/A01/A04/A10).

Only standard library; talks to the freshly installed web/agent endpoints.
"""

from __future__ import annotations

import argparse
import http.cookiejar
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

results: list[dict] = []


def record(name: str, ok: bool, detail: str = "") -> None:
    results.append({"name": name, "ok": ok, "detail": detail})
    print(f"{'PASS' if ok else 'FAIL'} {name}{' — ' + detail if detail else ''}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--web", required=True)
    parser.add_argument("--agent", required=True)
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    def call(method: str, url: str, payload=None, timeout: float = 300.0):
        data = json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        req.add_header("Accept", "application/json, text/event-stream")
        try:
            with opener.open(req, timeout=timeout) as response:
                return response.status, response.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read().decode("utf-8", "replace")

    status, body = call("POST", f"{args.web}/api/auth/login", {"email": args.email, "password": args.password})
    record("新装环境登录成功", status == 200, f"http={status}")

    status, body = call("GET", f"{args.web}/api/projects")
    projects = json.loads(body).get("projects", []) if status == 200 else []
    project = next((p for p in projects if p["name"].startswith("模拟项目A")), None)
    record("新装环境读到导入的项目", project is not None, f"projects={len(projects)}")

    if project:
        status, body = call("GET", f"{args.web}/api/projects/{project['id']}/meetings")
        meetings = json.loads(body).get("meetings", []) if status == 200 else []
        record("新装环境会议列表完整", len(meetings) >= 6, f"meetings={len(meetings)}")
        scope = {"collection_id": project["id"], "mode": "all_ready"}
        payload = {
            "threadId": f"clean-{int(time.time())}",
            "runId": f"run-{int(time.time())}",
            "messages": [{"id": "m1", "role": "user", "content": "星河笔记 v1.0 的检索方案最后怎么定的？"}],
            "tools": [],
            "context": [],
            "state": None,
            "forwardedProps": {"meeting_scope": scope},
        }
        status, body = call("POST", f"{args.web}/api/copilotkit", payload)
        answer = None
        citations = 0
        for line in body.splitlines():
            if not line.startswith("data:"):
                continue
            try:
                event = json.loads(line[5:].strip())
            except json.JSONDecodeError:
                continue
            if event.get("type") == "STATE_SNAPSHOT":
                snapshot = event.get("snapshot") or {}
                record_value = snapshot.get("answer_record")
                if record_value and record_value.get("status") == "completed":
                    answer = record_value
                    citations = len(record_value.get("sources") or {})
        record("新装环境真实问答返回完成答案", answer is not None, f"http={status}")
        record("答案带稳定引用", citations > 0, f"citations={citations}")
        if answer:
            record("答案内容正确（混合检索）", "混合检索" in answer.get("text", ""))

    summary = {
        "passed": sum(1 for r in results if r["ok"]),
        "failed": sum(1 for r in results if not r["ok"]),
        "results": results,
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n{summary['passed']} passed, {summary['failed']} failed")
    return 0 if summary["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
