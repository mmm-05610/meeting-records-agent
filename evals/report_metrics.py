"""Recompute versioned metrics with explicit denominators.

Separates: task completion rate, all-question metrics (failures kept as 0) and
success-only metrics, plus latency distribution and failure reasons.
"""

from __future__ import annotations

import argparse
import json
import statistics
from collections import Counter
from pathlib import Path


def load(path: str) -> list[dict]:
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--results", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--questions", default=str(Path(__file__).parent / "datasets" / "questions.jsonl"))
    args = parser.parse_args()
    records = load(args.results)
    required_by_case: dict[str, int] = {}
    for line in Path(args.questions).read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        case = json.loads(line)
        required_by_case[case["case_id"]] = len(case.get("required_evidence") or [])
    n = len(records)
    completed = [r for r in records if not r.get("error")]

    failures = [
        {
            "case_id": r["case_id"],
            "category": (r.get("error") or {}).get("category"),
            "message": (r.get("error") or {}).get("message", "")[:160],
        }
        for r in records
        if r.get("error")
    ]

    latencies = sorted(r.get("latency_ms", 0) for r in records)
    def pct(p: float) -> int:
        if not latencies:
            return 0
        idx = min(len(latencies) - 1, max(0, int(round(p * len(latencies))) - 1))
        return latencies[idx]

    evidence_all = sum(r["metrics"]["evidence_recall"]["matched"] for r in records)
    evidence_total_all = sum(required_by_case.get(r["case_id"], 0) for r in records)
    evidence_success_total = sum(
        required_by_case.get(r["case_id"], 0) for r in completed
    )

    def success_rate(fn) -> dict:
        hits = sum(1 for r in completed if fn(r))
        return {"matched": hits, "total": len(completed), "rate": (hits / len(completed)) if completed else None}

    def all_rate(fn) -> dict:
        hits = sum(1 for r in records if fn(r))
        return {"matched": hits, "total": n, "rate": (hits / n) if n else None}

    def kind_ok(r) -> bool:
        return r["metrics"]["decision"].get("kind_status") == "matched"

    def conclusion_ok(r) -> bool:
        return r["metrics"]["decision"].get("conclusion_match") is True

    def citation_ok(r) -> bool:
        c = r["metrics"]["citation"]
        return bool(c.get("presence_ok")) and bool(c.get("scope_ok")) and not c.get("dangling_reference_numbers")

    report = {
        "results_file": args.results,
        "cases_total": n,
        "completed": len(completed),
        "completion_rate": (len(completed) / n) if n else None,
        "failures": failures,
        "failure_categories": dict(Counter((r.get("error") or {}).get("category", "unknown") for r in records if r.get("error"))),
        "evidence_recall": {
            "all_questions_quotes_matched": evidence_all,
            "all_questions_quotes_expected": evidence_total_all,
            "success_only": {
                "matched": sum(r["metrics"]["evidence_recall"]["matched"] for r in completed),
                "total": evidence_success_total,
            },
            "note": "分母是题目声明的必需证据条数（按题集统计，失败题也计入 all_questions 分母，匹配数按 0 计）；成功题条件另列。",
        },
        "citation": {
            "all_questions": all_rate(citation_ok),
            "success_only": success_rate(citation_ok),
            "note": "引用存在性与范围正确性是结构检查，不代表引用语义上支持结论。",
        },
        "decision_kind": {
            "all_questions": all_rate(kind_ok),
            "success_only": success_rate(kind_ok),
            "note": "标签匹配只比较 claim.kind 是否包含期望标签。",
        },
        "conclusion_keyword_hit": {
            "all_questions": all_rate(conclusion_ok),
            "success_only": success_rate(conclusion_ok),
            "note": "结论命中是人工标准答案关键词匹配，不是问答准确率，也不是语义正确率。",
        },
        "latency_ms": {
            "p50": pct(0.50),
            "p90": pct(0.90),
            "p95": pct(0.95),
            "max": latencies[-1] if latencies else 0,
            "mean": round(statistics.mean(latencies), 1) if latencies else 0,
        },
        "cost": {"price_known": False, "note": "供应商未提供可核算单价；embedding 为本地模型，无 API 费用。"},
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
