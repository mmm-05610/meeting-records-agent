"""Direct graph smoke test for the meeting assistant (real R2R + real models).

Run from apps/agent:  PYTHONPATH=src .venv/bin/python ../../tests/smoke/agent_graph_smoke.py "<question>" <collection_id>
"""

from __future__ import annotations

import asyncio
import json
import sys

from langchain_core.messages import HumanMessage
from langchain_core.runnables import RunnableConfig

from agents.meeting_assistant import meeting_assistant


async def main() -> int:
    question = sys.argv[1] if len(sys.argv) > 1 else "演示项目A 第一版用什么向量存储？"
    collection_id = (
        sys.argv[2] if len(sys.argv) > 2 else "cae4d6d2-307e-46b3-a718-f0e05fa7b3e7"
    )
    config = RunnableConfig(
        configurable={
            "meeting_scope": {"collection_id": collection_id, "mode": "all_ready", "document_ids": []},
            "user_id": "smoke-user",
            "run_id": "smoke-run-1",
            "strategy": "B2",
        }
    )
    state = await meeting_assistant.ainvoke(
        {"messages": [HumanMessage(content=question)]}, config=config
    )
    record = state.get("answer_record")
    summary = {
        "intent": state.get("intent"),
        "error": state.get("error"),
        "progress": state.get("progress"),
        "answer": (record or {}).get("text"),
        "claims": (record or {}).get("claims"),
        "source_keys": sorted(((record or {}).get("sources") or {}).keys()),
        "coverage": (record or {}).get("coverage"),
        "status": (record or {}).get("status"),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2)[:6000])
    return 0 if record and record.get("status") == "completed" else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
