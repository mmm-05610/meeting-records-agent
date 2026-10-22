# v0.1 真实中文评测结果（A23）

- 运行日期：2026-10-22 09:35–09:47（Asia/Shanghai）
- 代码版本：`65b538e`（评测执行器含引用编号映射修复）之后的本地工作区；产品代码由同一提交构建
- 数据：`evals/datasets/` 3 个模拟项目、18 份中文会议记录、36 题（12 debug / 24 frozen）；
  `questions.jsonl` sha256 `2636851787de4f8600d3e1ec51647200190521580ca3a5af3b46883627923d29`
- 范围映射：`evals/datasets/scope-map.json`（真实 collection/document UUID，导入后生成）
- 引擎：`evals/run_eval.py --engine agui`（真实产品 AG-UI 入口，SSE + STATE_SNAPSHOT 的 AnswerRecord）
- 调用命令（三组并行）：

```bash
for S in B0 B1 B2; do
  python3 evals/run_eval.py --engine agui \
    --url http://127.0.0.1:8080/agui/meeting-assistant/run \
    --split frozen --strategy $S \
    --scope-map evals/datasets/scope-map.json \
    --out-dir evals/results --run-id ${S}-frozen
done
```

## 模型与检索配置（固定）

| 项 | 值 |
|---|---|
| 生成模型 | `gateway/deepseek-v4.1-flash`（opencode-go `/zen/go/v1`，经本地模型网关代理，`x-opencode-session` 由网关注入） |
| embedding | `BAAI/bge-small-zh-v1.5`，ONNX/fastembed，512 维（本地，无外部调用） |
| 重排 | `BAAI/bge-reranker-base`（FastEmbed cross-encoder，top-8）；上游 FlashRank 为可切换后端 |
| 分块 | 递归分块 300 字符 / 重叠 60（按会议段落级，便于引用定位） |
| 检索 | R2R 语义检索 limit=24，关闭图检索；范围过滤在服务端，命中后再核对 |
| 决定类核对 | 分页读完所选范围全部会议的 chunk，再逐场抽取、按会议日期归并 |
| 阅读预算 | `MEETING_DECISION_MAX_CHARS=240000`、`MEETING_DECISION_MAX_MEETINGS=24` |

## 三组对照（同一 24 道冻结题、同一范围/模型/数据）

| 组 | 策略差异 | 完成 | 证据召回* | 引用存在 | 引用范围 | 悬空编号 | 决定标签 | 结论命中 | 不确定性 |
|---|---|---|---|---|---|---|---|---|---|
| B0 | 纯向量检索（不重排、事实路径） | 24/24 | 43/51 = 84.3% | 24/24 = 100% | 24/24 = 100% | 0 | 20/24 = 83.3% | 23/24 = 95.8% | 4/4 |
| B1 | 向量 + bge 重排（事实路径） | 24/24 | 45/51 = 88.2% | 24/24 = 100% | 24/24 = 100% | 0 | 20/24 = 83.3% | 23/24 = 95.8% | 4/4 |
| B2 | B1 + 决定/变更类走完整会议核对 | 23/24 | 44/48 = 91.7% | 23/23 = 100% | 23/23 = 100% | 0 | 20/23 = 87.0% | 22/23 = 95.7% | 3/4 |

\* 分母只含成功返回答案的题目；失败题单独计入“完成”列，不从分母中悄悄删除。原始逐题记录：
`evals/results/B0-frozen/per_case.jsonl`、`B1-frozen`、`B2-frozen`（本地，默认不提交；`summary.json` 同目录）。

### 延迟与工程代价

| 组 | 平均 | p95 | 最长 |
|---|---|---|---|
| B0 | 15.5 s | 25.0 s | 69.7 s |
| B1 | 15.1 s | 22.3 s | 29.6 s |
| B2 | 27.6 s | 81.7 s | 106.4 s |

- 三次运行窗口内网关记录：179 次 chat 调用、prompt 136,253 tokens、completion 119,358 tokens、合计 255,611 tokens；
  embedding 调用 69 次（本地模型，1,612 字符）。该窗口还包含一次重启恢复验证，因此不是严格的逐组 token 归因。
- **费用**：供应商未提供可核算单价，**金额未知，不编造**；embedding 为本地模型，无 API 费用。
  预算约束（$10）未被用于外部 embedding 服务。

## 坏例（逐题可查）

- B2 `sim-a-03`：一次 `service_failure`（模型调用在重试后仍失败），无 AnswerRecord，未计入分母；
  这是真实故障，未用“无证据”伪装。
- B2 `sim-c-04`（unknown）：答案已说明“会议没有记载是否完成”，但未命中标准答案的关键词集合，结论判定为不匹配；
  不确定性判定也未通过（答案未使用标准答案要求的措辞）。属判定规则与措辞差异，需人工复核。
- B2 `sim-b-05`（unknown）、`sim-b-10`（fact）、`sim-c-10`（change）：claim 标签与期望不一致
  （如把“负责人/截止时间”写为 fact 而非 unknown 标签、把变更过程写成 confirmed/fact）。
- B0/B1 的 4 个标签不匹配（`sim-a-03`/`sim-b-04`/`sim-b-11`/`sim-c-10`）：这两组按设计只走事实检索路径，
  不承诺决定/提议/变更语义标签，因此在标签指标上系统性偏低——这是对照设计的结果，不是隐藏失败。
- 结论命中率在 B0/B1/B2 均 ≥95%，唯一失败项是 `sim-a-08`（B0/B1）与 `sim-c-04`（B2，见上）。

## 重排模型选择依据（真实验证后的工程决定）

上游 FlashRank 的 `ms-marco-MultiBERT-L-12` 在真实中文会议片段上排序不可靠：同一查询下，
含答案的“决议”片段得分 `0.0075`，而无信息的会议头部片段 `0.1479`（排名更高）。
改用 FastEmbed `BAAI/bge-reranker-base` 后，同一查询下含答案片段排名第一（得分 `0.6777`）。
因此默认 `MEETING_RERANK_BACKEND=fastembed`；`MEETING_RERANK_BACKEND=flashrank` 可复现上游对比。
该结论由 2026-10-22 的本地诊断命令得出，记录于 `docs/upstream/patches.md`（P6）。

## 复现与限制

- 复现：启动 native 栈 → 导入 18 份会议（`scripts/demo/import_dataset.py`，三个项目）→ 运行上面的命令。
- 评测器只做规则化判定（证据逐字召回、引用存在/范围、标签、结论关键词、不确定性措辞）；
  Ragas 仅作为可选引擎（`--engine ragas`）用于辅助 judge，不替代人工审阅。
- 冻结题集未因结果修改；坏例保留在原样输出中。
