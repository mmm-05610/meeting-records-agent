"""Ragas-based auxiliary semantic evaluation (official Ragas `evaluate` chain).

Uses the product's own gateways: the judge LLM and embeddings both go through the
local OpenAI-compatible model gateway. This is an *auxiliary* judge report; the
rule-based metrics in run_eval.py remain the primary, reproducible acceptance
metrics.

Run:
  .local/tools/venv/bin/python evals/run_ragas.py \
    --results evals/results/v0.1.1-B2-frozen/per_case.jsonl --limit 8 \
    --out docs/evidence/ragas-results.json
"""

from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path

# httpx rejects the socks:// ALL_PROXY used by this host; local calls go direct.
os.environ.pop("ALL_PROXY", None)
os.environ.pop("all_proxy", None)
os.environ["NO_PROXY"] = "localhost,127.0.0.1"
os.environ["no_proxy"] = "localhost,127.0.0.1"

from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from ragas import evaluate
from ragas.run_config import RunConfig
from ragas.dataset_schema import EvaluationDataset, SingleTurnSample
from ragas.embeddings import LangchainEmbeddingsWrapper
from ragas.llms import LangchainLLMWrapper

METRIC_NAMES = ["faithfulness", "answer_relevancy", "context_precision", "context_recall"]


def load_metrics(selected: list[str]):
    # Ragas 0.4 keeps the stable metrics namespace; the collections API requires
    # wiring llm/embeddings into every metric constructor and is still deprecated.
    from ragas.metrics import (
        AnswerRelevancy,
        ContextPrecision,
        ContextRecall,
        Faithfulness,
    )

    catalogue = {
        "faithfulness": Faithfulness,
        "answer_relevancy": AnswerRelevancy,
        "context_precision": ContextPrecision,
        "context_recall": ContextRecall,
    }
    return [catalogue[name]() for name in selected]


def build_samples(records: list[dict], limit: int) -> tuple[list[SingleTurnSample], list[dict]]:
    samples: list[SingleTurnSample] = []
    meta: list[dict] = []
    for record in records:
        if record.get("error"):
            continue
        answer = (record.get("answer") or "").strip()
        citations = record.get("citations") or []
        contexts = [c.get("quote") or "" for c in citations if (c.get("quote") or "").strip()]
        reference = record.get("manual_review", {}).get("acceptable_conclusion") or ""
        if not answer or not contexts or not reference:
            continue
        samples.append(
            SingleTurnSample(
                user_input=record["question"],
                response=answer,
                retrieved_contexts=contexts,
                reference=reference,
            )
        )
        meta.append({"case_id": record["case_id"], "split": record.get("split"), "project": record.get("project")})
        if len(samples) >= limit:
            break
    return samples, meta


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--results", required=True)
    parser.add_argument("--limit", type=int, default=8)
    parser.add_argument("--out", default="docs/evidence/ragas-results.json")
    parser.add_argument(
        "--metrics",
        nargs="+",
        default=["faithfulness", "context_precision"],
        choices=["faithfulness", "answer_relevancy", "context_precision", "context_recall"],
    )
    parser.add_argument("--judge-model", default=os.getenv("RAGAS_JUDGE_MODEL", "deepseek-v4.1-flash"))
    parser.add_argument("--base-url", default=os.getenv("GATEWAY_BASE_URL", "http://127.0.0.1:8081/v1"))
    args = parser.parse_args()

    records = [json.loads(line) for line in Path(args.results).read_text(encoding="utf-8").splitlines() if line.strip()]
    samples, meta = build_samples(records, args.limit)
    if not samples:
        raise SystemExit("no completed cases with answer/contexts/reference found")

    llm = LangchainLLMWrapper(
        ChatOpenAI(
            model=args.judge_model,
            base_url=args.base_url,
            api_key="local-gateway",
            temperature=0,
            # deepseek is a reasoning model: without a generous budget the judge
            # response can be all reasoning tokens with empty content.
            max_tokens=8192,
            timeout=180,
            max_retries=2,
        )
    )
    embeddings = LangchainEmbeddingsWrapper(
        OpenAIEmbeddings(
            model="text-embedding-3-small",
            base_url=args.base_url,
            api_key="local-gateway",
        )
    )
    metrics = load_metrics(args.metrics)
    started = time.time()
    result = evaluate(
        dataset=EvaluationDataset(samples=samples),
        metrics=metrics,
        llm=llm,
        embeddings=embeddings,
        raise_exceptions=False,
        show_progress=False,
        batch_size=1,
        run_config=RunConfig(max_workers=1, timeout=90, max_retries=1),
    )
    elapsed = round(time.time() - started, 1)

    rows: list[dict] = []
    try:
        frame = result.to_pandas()
        for index, row in frame.iterrows():
            scores = {}
            for name in args.metrics:
                if name not in frame.columns:
                    scores[name] = None
                    continue
                value = row.get(name)
                try:
                    scores[name] = None if value is None or value != value else float(value)
                except (TypeError, ValueError):
                    scores[name] = None
            rows.append({**meta[index], **scores})
    except Exception as exc:  # noqa: BLE001 - report the limitation instead of faking rows
        rows = [{"error": f"could not serialise per-sample scores: {exc}"}]

    aggregate: dict[str, dict] = {}
    for name in args.metrics:
        values = [row[name] for row in rows if isinstance(row.get(name), float)]
        aggregate[name] = {
            "mean": (sum(values) / len(values)) if values else None,
            "n": len(values),
            "failed": len(rows) - len(values),
        }

    report = {
        "engine": "ragas",
        "metrics": list(args.metrics),
        "ragas_version": __import__("ragas").__version__,
        "judge_model": args.judge_model,
        "judge_endpoint": "local model gateway -> opencode-go",
        "embedding_model": "BAAI/bge-small-zh-v1.5 (512d, via gateway /v1/embeddings)",
        "results_file": args.results,
        "cases_total_in_file": len(records),
        "cases_evaluated": len(samples),
        "selection_rule": "按文件顺序取成功题，最多 limit 条；失败题不进入 Ragas 样本但保留在规则评测的全量分母中。",
        "contexts_source": "仅使用产品实际返回的引用 quote 作为 retrieved_contexts（不是全库召回上下文）",
        "reference_source": "题集人工标注的 acceptable_conclusion",
        "elapsed_seconds": elapsed,
        "aggregate": aggregate,
        "per_case": rows,
        "limitations": [
            "Ragas judge 与生成模型同源（deepseek-v4.1-flash），存在自评偏好，仅作辅助。",
            "只评测少量样本（--limit），不等于全量 24 题语义准确率。",
            "retrieved_contexts 只含最终引用片段，偏低估计召回类指标（真实检索覆盖更广）。",
            "Ragas 指标提示词与判定风格为通用英文/多语言模板，中文会议语义判断需人工复核样例配合。",
            "answer_relevancy 依赖 embedding 相似度，本部署 embedding 为本地中文小模型。",
        ],
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("cases_evaluated", "aggregate", "elapsed_seconds")}, ensure_ascii=False, indent=2))
    print("RAGAS_RUN_DONE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
