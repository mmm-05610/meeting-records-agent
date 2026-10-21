# 评测执行说明（T018 / T019）

本目录只包含**模拟数据**与**评测执行器**：

| 路径 | 内容 |
|---|---|
| `datasets/` | 3 个模拟项目、18 份模拟会议记录、36 道题（12 debug + 24 frozen）与冻结摘要 |
| `datasets/questions.jsonl` | 题目与人工标注（标准答案来源） |
| `datasets/scope-map.example.json` | 项目 → 真实 `collection_id`、会议文件 → 真实 `document_id` 的映射示例（占位 UUID，集成时替换） |
| `datasets/README.md` | 数据集说明、覆盖点对照、最小演示三件套、冻结摘要 |
| `validate_dataset.py` | 数据集校验脚本（仅标准库） |
| `run_eval.py` | 评测执行器（仅标准库；可选使用已安装的 ragas） |
| `results/` | 真实运行结果，默认被 `.gitignore` 忽略（仅保留本说明文件） |

## 1. 先校验数据集

```bash
python3 evals/validate_dataset.py
```

通过时退出码为 0，并打印会议数、题数、split 分布、标签分布、证据条数与摘要文件数。

## 2. 真实运行（由集成本人执行）

前置条件：产品已启动、三个模拟项目已导入、令牌可用。执行器**不内置任何替身**，
没有接口地址或范围映射时直接报错退出，不产出任何分数。

```bash
export MRA_AGENT_URL=http://127.0.0.1:8000/chat     # 产品问答接口
export MRA_WEB_TOKEN=<本地登录令牌>                   # 访问令牌
export MRA_SCOPE_MAP=evals/datasets/scope-map.json   # 或用 --scope-map 指定

python3 evals/run_eval.py --engine http --split frozen --strategy B2
```

常用参数：

| 参数 | 说明 |
|---|---|
| `--engine http` | 默认，调用真实产品 HTTP 接口 |
| `--engine ragas` | 走 Ragas 官方示例的 `Dataset` / `experiment` 流程；需要本地已安装 ragas，未安装时报错退出 |
| `--split frozen\|debug\|all` | 按划分过滤，默认 `frozen`（24 题） |
| `--strategy B0\|B1\|B2` | 对照组策略，写入请求体（默认 `forwardedProps.configurable.strategy`，可用 `--strategy-field` 改位置） |
| `--scope-map PATH` | 项目与会议的真实 UUID 映射；缺 `explicit` 题会记录 `scope_unresolved` 错误，不会瞎猜 |
| `--auth-header` | 令牌请求头模板，默认 `Authorization: Bearer {token}`，可改为 `X-Web-Token: {token}` |
| `--timeout` | 单题超时秒数，默认 180 |
| `--limit N` | 只跑前 N 题，冒烟用 |
| `--dry-run` | 只打印执行计划，不调用产品、不写结果文件 |
| `--self-check` | 用合成样本验证计数与结果格式，不调用产品、不写结果文件 |

请求体形状（与 C05 的 `forwardedProps.meeting_scope` 一致）：

```json
{
  "message": "<题目原文>",
  "forwardedProps": {
    "meeting_scope": {"collection_id": "<项目 UUID>", "mode": "all_ready", "document_ids": []}
  }
}
```

`explicit` 题会把题目里的会议文件名按 `--scope-map` 换成真实 `document_id` 填入 `document_ids`。

## 3. 三组对照

三组使用**同一份冻结的 24 道 frozen 题**、同一范围、同一生成模型与 embedding 模型、同一份数据版本，
唯一差别是检索与核对策略（策略由集成本人在产品侧实现，本执行器只负责把 `--strategy` 传给产品）：

| 组 | 策略 | 期望差异 |
|---|---|---|
| B0 | 范围内纯向量检索 | 基线：决定链与跨会议信息容易漏 |
| B1 | 同一向量检索 + FlashRank 重排 | 顺序相关的问题改善，决定类仍可能漏读后场会议 |
| B2 | B1 基础上，决定/变更类问题使用完整会议核对 | 决定类（提议/确认/变更/冲突）应显著变好 |

```bash
python3 evals/run_eval.py --engine http --split frozen --strategy B0 --run-id b0
python3 evals/run_eval.py --engine http --split frozen --strategy B1 --run-id b1
python3 evals/run_eval.py --engine http --split frozen --strategy B2 --run-id b2
```

对照时必须比较同一题集：报告要给**全体 24 题**和**决定类子集**两个分母，
不能拿不同题集的数字比较后宣称改进。

## 4. 指标定义（全部规则化，不用模型输出当标准答案）

标准答案只来自 `datasets/questions.jsonl` 的人工标注。执行器做三类指标：

1. **证据召回**：`required_evidence[].quote` 是否逐字出现在返回的 `sources.quote` 中（忽略空白差异）。
   分母为成功返回题目的必需证据条数；失败题不计入分母，另在 `counts.error` 中单列。
2. **引用存在性与范围正确性**：非 `unknown` 题必须返回带非空 quote 的来源；`explicit` 题的引用文档必须属于请求的
   `document_ids`，`all_ready` 题的引用文档必须属于该项目；答案中的 `[n]` 编号必须能找到对应来源。
3. **决定类判定**：产品返回的 `claim.kind` 是否包含题目的 `expected_kind`（没有 `claims` 时记 `undetermined`，不计分）；
   答案是否命中 `conclusion_must_contain_any`；`must_include_uncertainty` 的题是否出现不确定性标记。

`forbidden_inferences`（禁止推断）与语义支持**不做自动判定**，随 `per_case.jsonl` 输出供人工按原文审阅
（对应评测规范：语义支持由原文标注审阅，judge 只作辅助）。

## 5. 产物

每次运行写入 `evals/results/<run-id>/`：

- `per_case.jsonl`：逐题的 `answer`、`citations`、`coverage`、`error`、`latency_ms`、`tokens`、
  三类指标明细，以及待人工审阅的 `forbidden_inferences` 与 `acceptable_conclusion`。
- `summary.json`：计数、错误分类、三类指标及分母、split/标签分项、延迟与 token（供应商未返回用量时记未知，
  不估算金额）、待人工审阅项。

`evals/results/` 已被 `.gitignore` 忽略，只保留本说明文件；对外发布前需去敏。

## 6. 未运行不写分数

- 本目录当前**没有任何评测分数**：`results/` 下除本说明外为空。
- `--dry-run` 与 `--self-check` 都不会写出结果文件；`--self-check` 的合成样本只打印到标准输出，
  并在输出中标注「不是产品成绩」。
- 没有产品接口、令牌或范围映射时，执行器直接报错退出，不生成占位分数、不把错误当成「无依据」。
- 真实跑分属于 T022，由集成本人执行并负责记录模型与版本。
