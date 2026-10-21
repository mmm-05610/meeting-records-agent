#!/usr/bin/env python3
"""校验 evals/datasets 的模拟评测数据集（T018）。

仅使用标准库。校验项：
  1. 3 个模拟项目、18 份会议记录文件存在，字段与产品契约一致，正文字数在 400–900；
  2. questions.jsonl 共 36 题，split 计数为 12 debug / 24 frozen，每项目 12 题；
  3. 每题 required_evidence 的 quote 逐字出现在所述 .md 中；
  4. explicit 范围的 document_ids 与 expected_coverage 指向的文件都存在；
  5. datasets/README.md 记录的 SHA-256 与当前文件一致（冻结版本摘要）。

用法：python3 evals/validate_dataset.py
退出码：0 通过；1 存在校验错误。
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATASETS = ROOT / "datasets"
QUESTIONS = DATASETS / "questions.jsonl"
README = DATASETS / "README.md"

PROJECTS = {
    "sim-project-a": "模拟项目A：星河笔记",
    "sim-project-b": "模拟项目B：云仓物流",
    "sim-project-c": "模拟项目C：青禾医疗",
}
MEETINGS_PER_PROJECT = 6
TOTAL_MEETINGS = len(PROJECTS) * MEETINGS_PER_PROJECT
TOTAL_QUESTIONS = 36
SPLIT_COUNTS = {"debug": 12, "frozen": 24}
ALLOWED_KINDS = {"fact", "proposal", "confirmed", "change", "conflict", "unknown"}
ALLOWED_SCOPE_MODES = {"all_ready", "explicit"}
BODY_MIN, BODY_MAX = 400, 900

DATE_RE = re.compile(r"^- 会议日期：(\d{4})-(\d{2})-(\d{2})$", re.M)
KIND_RE = re.compile(r"^- 记录类型：(minutes|transcript)", re.M)
TITLE_RE = re.compile(r"^- 会议名称：(.+)$", re.M)
PARTICIPANTS_RE = re.compile(r"^- 参与人：(.+)$", re.M)
DIGEST_ROW_RE = re.compile(r"^\|\s*`([^`]+)`\s*\|\s*`([0-9a-f]{64})`\s*\|\s*$", re.M)

REQUIRED_FIELDS = (
    "case_id",
    "split",
    "project",
    "scope_mode",
    "document_ids",
    "question",
    "expected_kind",
    "required_evidence",
    "acceptable_conclusion",
    "must_include_uncertainty",
    "forbidden_inferences",
    "expected_coverage",
    "notes",
)

errors: list[str] = []
notes: list[str] = []


def fail(message: str) -> None:
    errors.append(message)


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def non_whitespace(text: str) -> int:
    return len("".join(text.split()))


def chinese_chars(text: str) -> int:
    return sum(1 for ch in text if "一" <= ch <= "鿿")


def check_meetings() -> list[Path]:
    files: list[Path] = []
    for project_dir, project_name in PROJECTS.items():
        folder = DATASETS / project_dir
        if not folder.is_dir():
            fail(f"缺少项目目录：{project_dir}")
            continue
        for index in range(1, MEETINGS_PER_PROJECT + 1):
            path = folder / f"meeting-{index:02d}.md"
            if not path.is_file():
                fail(f"缺少会议文件：{path.relative_to(DATASETS)}")
                continue
            files.append(path)
            text = path.read_text(encoding="utf-8")

            title = TITLE_RE.search(text)
            if not title:
                fail(f"{path.relative_to(DATASETS)}：缺少「- 会议名称：」字段")
            else:
                expected_title = title.group(1).strip()
                if project_name.split("：")[1] not in expected_title:
                    fail(
                        f"{path.relative_to(DATASETS)}：会议名称与项目不符：{expected_title}"
                    )

            date = DATE_RE.search(text)
            if not date:
                fail(f"{path.relative_to(DATASETS)}：缺少或非法的「- 会议日期：」字段")
            else:
                year, month, _day = (int(part) for part in date.groups())
                if year != 2026 or not 1 <= month <= 5:
                    fail(
                        f"{path.relative_to(DATASETS)}：会议日期应在 2026 年 1—5 月，实际 {date.group(1)}"
                    )

            if not KIND_RE.search(text):
                fail(
                    f"{path.relative_to(DATASETS)}：记录类型必须是 minutes 或 transcript"
                )
            if not PARTICIPANTS_RE.search(text):
                fail(f"{path.relative_to(DATASETS)}：缺少「- 参与人：」字段")

            body = text.split("## 讨论", 1)[-1]
            length_cn = chinese_chars(body)
            length_nw = non_whitespace(body)
            if not BODY_MIN <= length_cn <= BODY_MAX:
                fail(
                    f"{path.relative_to(DATASETS)}：正文中文字数 {length_cn} 不在 {BODY_MIN}–{BODY_MAX}"
                )
            if not BODY_MIN <= length_nw <= BODY_MAX:
                fail(
                    f"{path.relative_to(DATASETS)}：正文非空白字符数 {length_nw} 不在 {BODY_MIN}–{BODY_MAX}"
                )
    extra = [
        p.relative_to(DATASETS).as_posix()
        for p in sorted(DATASETS.rglob("*.md"))
        if p.name != "README.md" and p not in files
    ]
    if extra:
        fail(f"数据目录中出现未登记的会议文件：{', '.join(extra)}")
    return files


def check_questions(meeting_files: list[Path]) -> list[dict]:
    if not QUESTIONS.is_file():
        fail("缺少 questions.jsonl")
        return []
    cases: list[dict] = []
    seen_ids: set[str] = set()
    for line_no, raw in enumerate(
        QUESTIONS.read_text(encoding="utf-8").splitlines(), start=1
    ):
        if not raw.strip():
            fail(f"questions.jsonl 第 {line_no} 行为空行")
            continue
        try:
            case = json.loads(raw)
        except json.JSONDecodeError as exc:
            fail(f"questions.jsonl 第 {line_no} 行不是合法 JSON：{exc}")
            continue
        cases.append(case)
        case_id = case.get("case_id", f"<第{line_no}行>")

        for field in REQUIRED_FIELDS:
            if field not in case:
                fail(f"{case_id}：缺少字段 {field}")
        if case_id in seen_ids:
            fail(f"{case_id}：case_id 重复")
        seen_ids.add(case_id)

        if case.get("split") not in SPLIT_COUNTS:
            fail(f"{case_id}：split 必须是 debug 或 frozen")
        if case.get("expected_kind") not in ALLOWED_KINDS:
            fail(f"{case_id}：expected_kind 非法：{case.get('expected_kind')}")
        if case.get("scope_mode") not in ALLOWED_SCOPE_MODES:
            fail(f"{case_id}：scope_mode 非法：{case.get('scope_mode')}")
        if not isinstance(case.get("must_include_uncertainty"), bool):
            fail(f"{case_id}：must_include_uncertainty 必须是布尔值")
        if not isinstance(case.get("forbidden_inferences"), list) or not case.get(
            "forbidden_inferences"
        ):
            fail(f"{case_id}：forbidden_inferences 必须是非空数组")
        if not isinstance(case.get("question"), str) or not case.get("question").strip():
            fail(f"{case_id}：question 不能为空")
        if not isinstance(case.get("acceptable_conclusion"), str) or not case.get(
            "acceptable_conclusion"
        ).strip():
            fail(f"{case_id}：acceptable_conclusion 不能为空")
        must_contain = case.get("conclusion_must_contain_any")
        if must_contain is not None and (
            not isinstance(must_contain, list)
            or not must_contain
            or not all(isinstance(item, str) and item for item in must_contain)
        ):
            fail(f"{case_id}：conclusion_must_contain_any 必须是非空字符串数组")

        document_ids = case.get("document_ids")
        if not isinstance(document_ids, list):
            fail(f"{case_id}：document_ids 必须是数组")
            document_ids = []
        if case.get("scope_mode") == "explicit" and not document_ids:
            fail(f"{case_id}：explicit 范围必须给出 document_ids")
        if case.get("scope_mode") == "all_ready" and document_ids:
            fail(f"{case_id}：all_ready 范围不应带 document_ids")
        for name in document_ids:
            if not (DATASETS / name).is_file():
                fail(f"{case_id}：document_ids 指向不存在的文件 {name}")

        coverage = case.get("expected_coverage")
        if not isinstance(coverage, list) or not coverage:
            fail(f"{case_id}：expected_coverage 必须是非空数组")
        else:
            for name in coverage:
                if not (DATASETS / name).is_file():
                    fail(f"{case_id}：expected_coverage 指向不存在的文件 {name}")

        evidence = case.get("required_evidence")
        if not isinstance(evidence, list) or not evidence:
            fail(f"{case_id}：required_evidence 必须是非空数组")
            continue
        for item in evidence:
            if not isinstance(item, dict) or "file" not in item or "quote" not in item:
                fail(f"{case_id}：required_evidence 元素必须包含 file 与 quote")
                continue
            target = DATASETS / item["file"]
            if not target.is_file():
                fail(f"{case_id}：required_evidence 指向不存在的文件 {item['file']}")
                continue
            if item["quote"] not in target.read_text(encoding="utf-8"):
                fail(
                    f"{case_id}：quote 未逐字出现在 {item['file']} -> 「{item['quote'][:40]}」"
                )

    if len(cases) != TOTAL_QUESTIONS:
        fail(f"题目数量应为 {TOTAL_QUESTIONS}，实际 {len(cases)}")

    split_counts: dict[str, int] = {}
    project_counts: dict[str, int] = {}
    for case in cases:
        split_counts[case.get("split")] = split_counts.get(case.get("split"), 0) + 1
        project_counts[case.get("project")] = project_counts.get(case.get("project"), 0) + 1
    for split, expected in SPLIT_COUNTS.items():
        if split_counts.get(split, 0) != expected:
            fail(f"{split} 题数应为 {expected}，实际 {split_counts.get(split, 0)}")
    for project_name in PROJECTS.values():
        if project_counts.get(project_name, 0) != TOTAL_QUESTIONS // len(PROJECTS):
            fail(
                f"{project_name} 题数应为 {TOTAL_QUESTIONS // len(PROJECTS)}，"
                f"实际 {project_counts.get(project_name, 0)}"
            )
    if len(meeting_files) != TOTAL_MEETINGS:
        fail(f"会议文件应为 {TOTAL_MEETINGS} 份，实际 {len(meeting_files)}")
    return cases


def check_digests(meeting_files: list[Path]) -> None:
    if not README.is_file():
        fail("缺少 datasets/README.md")
        return
    readme = README.read_text(encoding="utf-8")
    recorded: dict[str, str] = {}
    for name, digest in DIGEST_ROW_RE.findall(readme):
        recorded[name] = digest
    if not recorded:
        fail("datasets/README.md 中没有找到 SHA-256 摘要表")

    expected_files = [QUESTIONS.name] + [
        path.relative_to(DATASETS).as_posix() for path in meeting_files
    ]
    for name in expected_files:
        if name not in recorded:
            fail(f"datasets/README.md 缺少 {name} 的摘要记录")
            continue
        path = DATASETS / name
        actual = sha256_file(path)
        if actual != recorded[name]:
            fail(
                f"{name} 摘要不匹配：README 记录 {recorded[name]}，实际 {actual}"
            )
    for name in recorded:
        if name not in expected_files:
            fail(f"datasets/README.md 记录了多余条目：{name}")


def check_demo_files() -> None:
    demo = [
        "sim-project-a/meeting-01.md",
        "sim-project-a/meeting-03.md",
        "sim-project-a/meeting-06.md",
    ]
    readme = README.read_text(encoding="utf-8") if README.is_file() else ""
    for name in demo:
        if not (DATASETS / name).is_file():
            fail(f"最小演示文件缺失：{name}")
        if name not in readme:
            fail(f"datasets/README.md 未标注最小演示文件：{name}")


def main() -> int:
    meeting_files = check_meetings()
    cases = check_questions(meeting_files)
    check_digests(meeting_files)
    check_demo_files()

    split_counts: dict[str, int] = {}
    kind_counts: dict[str, int] = {}
    for case in cases:
        split_counts[case["split"]] = split_counts.get(case["split"], 0) + 1
        kind_counts[case["expected_kind"]] = kind_counts.get(case["expected_kind"], 0) + 1

    print("=" * 72)
    print("模拟评测数据集校验（T018）")
    print("=" * 72)
    print(f"数据集目录        : {DATASETS}")
    print(f"会议记录          : {len(meeting_files)} 份（期望 {TOTAL_MEETINGS}）")
    print(f"题目              : {len(cases)} 题（期望 {TOTAL_QUESTIONS}）")
    print(f"split 分布        : " + "，".join(f"{k}={v}" for k, v in sorted(split_counts.items())))
    print(f"标签分布          : " + "，".join(f"{k}={v}" for k, v in sorted(kind_counts.items())))
    print(f"证据条目          : {sum(len(c['required_evidence']) for c in cases)} 条（全部逐字命中）")
    print(f"摘要文件          : {len(meeting_files) + 1} 个（questions.jsonl + 全部 .md）")
    if errors:
        print("-" * 72)
        print(f"校验未通过，共 {len(errors)} 个问题：")
        for item in errors:
            print(f"  - {item}")
        return 1
    print("-" * 72)
    print("校验通过：会议文件、题集、证据逐字命中、范围文件与 SHA-256 摘要全部一致。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
