"""A15: an unavailable document service must surface as a service failure, never as
"no evidence", and the system must recover after the service returns."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

AGENT = os.getenv("MRA_AGENT_URL", "http://127.0.0.1:8080") + "/agui/meeting-assistant/run"
PROJECT = json.loads(Path("evals/datasets/scope-map.json").read_text(encoding="utf-8"))["projects"]["模拟项目A：星河笔记"]
results: list[dict] = []


def record(name: str, ok: bool, detail: str = "") -> None:
    results.append({"name": name, "ok": ok, "detail": detail})
    print(f"{'PASS' if ok else 'FAIL'} {name}{' — ' + detail if detail else ''}")


def ask(question: str) -> dict:
    payload = {
        "threadId": f"fault-{int(time.time()*1000)}",
        "runId": f"run-{int(time.time()*1000)}",
        "messages": [{"id": "m1", "role": "user", "content": question}],
        "tools": [], "context": [], "state": None,
        "forwardedProps": {"meeting_scope": {"collection_id": PROJECT["collection_id"], "mode": "all_ready"}},
    }
    req = urllib.request.Request(AGENT, data=json.dumps(payload, ensure_ascii=False).encode(), method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "text/event-stream")
    error = None
    answer = None
    with urllib.request.urlopen(req, timeout=600) as response:
        for line in response:
            text = line.decode("utf-8", "replace").strip()
            if not text.startswith("data:"):
                continue
            try:
                event = json.loads(text[5:].strip())
            except json.JSONDecodeError:
                continue
            if event.get("type") == "STATE_SNAPSHOT":
                snapshot = event.get("snapshot") or {}
                if snapshot.get("error"):
                    error = snapshot["error"]
                if (snapshot.get("answer_record") or {}).get("status") == "completed":
                    answer = snapshot["answer_record"]
    return {"error": error, "answer": answer}


def service(action: str, name: str, extra=None) -> None:
    args = ["bash", "scripts/native/service.sh", action, name] + (extra or [])
    subprocess.run(args, check=True, capture_output=True)


def main() -> int:
    healthy = ask("谁负责检索方案的技术验证？")
    record("R2R 正常时可以得到答案", healthy["answer"] is not None, f"status={(healthy['answer'] or {}).get('status')}")

    service("stop", "r2r")
    time.sleep(2)
    down = ask("谁负责检索方案的技术验证？")
    record(
        "R2R 不可用返回真实服务故障",
        down["answer"] is None and down["error"] and down["error"].get("category") in {"service_failure", "unknown_result"},
        f"error={down['error']}",
    )
    record(
        "故障未被伪装成无证据",
        down["answer"] is None,
        "no completed AnswerRecord",
    )

    service("start", "r2r", ["bash", "scripts/native/start-r2r.sh"])
    for _ in range(30):
        time.sleep(2)
        try:
            with urllib.request.urlopen("http://127.0.0.1:7272/v3/health", timeout=3) as response:
                if response.status == 200:
                    break
        except Exception:  # noqa: BLE001
            continue
    recovered = ask("谁负责检索方案的技术验证？")
    record("R2R 恢复后重新可用", recovered["answer"] is not None, f"status={(recovered['answer'] or {}).get('status')}")

    summary = {"passed": sum(1 for r in results if r["ok"]), "failed": sum(1 for r in results if not r["ok"]), "results": results}
    Path("docs/evidence/service-failure.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n{summary['passed']} passed, {summary['failed']} failed")
    return 0 if summary["failed"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
