"""Extract a small, deterministic human-review sample from an eval result file.

The reviewer (executor) annotates each sample as support=full/partial/none with a
note; this script only prepares the material and later merges annotations.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

CASES = [
    "sim-a-03",  # proposal vs confirmation
    "sim-a-05",  # completion not recorded
    "sim-b-04",  # explicit change with reason
    "sim-c-04",  # completion not recorded
    "sim-b-11",  # proposal not confirmed
    "sim-c-10",  # change + latest suggestion
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--results", required=True)
    parser.add_argument("--out", default="docs/evidence/human-review-samples.json")
    parser.add_argument("--annotations", default=None)
    args = parser.parse_args()
    records = {json.loads(line)["case_id"]: json.loads(line) for line in Path(args.results).read_text(encoding="utf-8").splitlines() if line.strip()}
    annotations = {}
    if args.annotations and Path(args.annotations).exists():
        annotations = json.loads(Path(args.annotations).read_text(encoding="utf-8"))

    samples = []
    for case_id in CASES:
        record = records.get(case_id)
        if not record:
            continue
        citations = record.get("citations") or []
        samples.append(
            {
                "case_id": case_id,
                "project": record.get("project"),
                "question": record.get("question"),
                "expected_kind": record.get("expected_kind"),
                "expected_conclusion": record.get("manual_review", {}).get("acceptable_conclusion"),
                "answer": record.get("answer"),
                "model_claim_kinds": [claim.get("kind") for claim in (record.get("raw") or {}).get("claims") or []]
                if isinstance(record.get("raw"), dict)
                else [],
                "citations": [
                    {
                        "document_id": c.get("document_id"),
                        "chunk_order": c.get("chunk_order"),
                        "title": c.get("title"),
                        "meeting_date": c.get("meeting_date"),
                        "quote": (c.get("quote") or "")[:500],
                    }
                    for c in citations
                ],
                "error": record.get("error"),
                "review": annotations.get(case_id, {"support": None, "note": None}),
            }
        )
    output = {
        "results_file": args.results,
        "rubric": {
            "full": "引用原文足以支持答案中的每个事实/决定结论，未引入原文没有的内容",
            "partial": "主要结论有据，但存在过度概括、缺少关键证据或标签不当",
            "none": "结论无原文依据或与原文矛盾",
        },
        "samples": samples,
    }
    Path(args.out).write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    for sample in samples:
        print(f"{sample['case_id']} | {sample['question'][:50]} | answer={sample['answer'][:70]!r}")
    print("HUMAN_REVIEW_SAMPLE_WRITTEN", args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
