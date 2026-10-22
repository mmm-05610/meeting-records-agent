"""Verify returned citations against the original simulated meeting files.

Checks, per case:
  - the cited document_id belongs to the requested project (scope-map);
  - the returned quote appears verbatim (whitespace-normalised) in that file;
  - every answer reference number resolves to a returned source.

Run: python3 evals/verify_sources.py --results evals/results/v0.1.1-B2-frozen/per_case.jsonl
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATASETS = ROOT / "evals" / "datasets"
SCOPE_MAP = DATASETS / "scope-map.json"


def normalize(text: str) -> str:
    """Strip markdown formatting (R2R chunk text drops #/-/* markers) and whitespace."""
    text = re.sub(r"[#>*_`|]+", " ", text)
    text = re.sub(r"(?m)^\s*[-+]\s+", " ", text)
    text = re.sub(r"(?m)^\s*\d+[.)]\s+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--results", required=True)
    parser.add_argument("--out", default="docs/evidence/source-verification.json")
    args = parser.parse_args()

    scope = json.loads(SCOPE_MAP.read_text(encoding="utf-8"))
    doc_to_file: dict[str, str] = {}
    doc_to_project: dict[str, str] = {}
    for project, entry in scope["projects"].items():
        for rel, doc_id in entry["documents"].items():
            doc_to_file[doc_id] = rel
            doc_to_project[doc_id] = project

    cases = []
    total = verified = out_of_scope = missing_file = 0
    for line in Path(args.results).read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        case = json.loads(line)
        case_id = case["case_id"]
        project = case["project"]
        sources = case.get("citations") or []
        numbers = set(re.findall(r"\[(\d+)\]", case.get("answer") or ""))
        case_out_of_scope = 0
        case_verified = 0
        case_missing = 0
        details = []
        for source in sources:
            total += 1
            doc_id = str(source.get("document_id") or "")
            quote = normalize(source.get("quote") or "")
            file_rel = doc_to_file.get(doc_id)
            if not file_rel:
                missing_file += 1
                case_missing += 1
                details.append({"document_id": doc_id, "status": "document_not_in_scope_map"})
                continue
            if doc_to_project.get(doc_id) != project:
                out_of_scope += 1
                case_out_of_scope += 1
                details.append({"document_id": doc_id, "status": "other_project"})
                continue
            content = normalize((DATASETS / file_rel).read_text(encoding="utf-8"))
            if quote and quote in content:
                verified += 1
                case_verified += 1
            else:
                details.append({"document_id": doc_id, "status": "quote_not_found", "quote": quote[:80]})
        resolved_numbers = len(numbers) == 0 or all(
            int(number) <= len(sources) for number in numbers
        )
        cases.append(
            {
                "case_id": case_id,
                "project": project,
                "sources": len(sources),
                "verified": case_verified,
                "out_of_scope": case_out_of_scope,
                "missing": case_missing,
                "reference_numbers_resolve": resolved_numbers,
                "details": details,
            }
        )

    summary = {
        "results_file": args.results,
        "cases": len(cases),
        "quotes_total": total,
        "quotes_verified_verbatim": verified,
        "quotes_out_of_project": out_of_scope,
        "quotes_document_not_in_map": missing_file,
        "all_reference_numbers_resolve": all(c["reference_numbers_resolve"] for c in cases),
        "rule": "引用 document_id 必须属于请求项目；quote 忽略空白后必须逐字出现在对应模拟会议文件中；[n] 编号必须能在返回来源内解析。",
        "cases_detail": cases,
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in summary.items() if k != "cases_detail"}, ensure_ascii=False, indent=2))
    ok = total > 0 and verified == total and out_of_scope == 0 and missing_file == 0
    print("SOURCE_VERIFICATION_OK" if ok else "SOURCE_VERIFICATION_FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
