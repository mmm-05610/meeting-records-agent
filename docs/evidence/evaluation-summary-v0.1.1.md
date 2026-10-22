# v0.1.1 真实评测报告（版本化）

- 日期：2026-10-22（Asia/Shanghai）
- 代码版本：v0.1.1 交付提交（见文末）
- 数据：`evals/datasets/`，3 个模拟项目 / 18 场会议 / 36 题；本次使用 **24 道冻结题**，
  `questions.jsonl` sha256 `2636851787de4f8600d3e1ec51647200190521580ca3a5af3b46883627923d29`
- 范围映射：`evals/datasets/scope-map.json`（真实 collection/document ID）
- 执行链：`evals/run_eval.py --engine agui`（真实产品 HTTP/AG-UI 入口，经 CopilotKit Runtime）
- 配置：生成 `gateway/deepseek-v4.1-flash`；embedding 本地 `BAAI/bge-small-zh-v1.5`（512 维）；
  重排本地 `BAAI/bge-reranker-base`；分块 300/重叠 60；检索 limit 24、重排 top 8；
  决定类核对读完所选会议全部 chunk。

## 一、任务完成率与口径

| 组 | 完成/总题 | 完成率 | 失败题（保留在总体分母） |
|---|---|---|---|
| B0 纯向量（事实路径） | 24/24 | 100% | 无 |
| B1 向量 + 重排（事实路径） | 23/24 | 95.8% | `sim-a-03` service_failure |
| B2 B1 + 决定类完整会议核对 | 23/24 | 95.8% | `sim-a-03` service_failure（模型超时） |

所有指标同时给出 **全量分母**（失败题保留、指标按 0 计）与 **成功题分母**。两者不可混用。

## 二、结果（24 冻结题）

| 指标 | B0 | B1 | B2 |
|---|---|---|---|
| 证据召回（全量：命中/应有） | 38/51 = 74.5% | 41/51 = 80.4% | 43/51 = 84.3% |
| 证据召回（成功题） | 38/51 = 74.5% | 41/48 = 85.4% | 43/48 = 89.6% |
| 引用可解析且范围正确（全量） | 24/24 = 100% | 23/24 = 95.8% | 23/24 = 95.8% |
| 引用可解析且范围正确（成功题） | 24/24 = 100% | 23/23 = 100% | 23/23 = 100% |
| 决定标签匹配（全量） | 19/24 = 79.2% | 20/24 = 83.3% | 22/24 = 91.7% |
| 决定标签匹配（成功题） | 19/24 = 79.2% | 20/23 = 87.0% | 22/23 = 95.7% |
| 结论关键词命中（全量） | 22/24 = 91.7% | 22/24 = 91.7% | 23/24 = 95.8% |
| 结论关键词命中（成功题） | 22/24 = 91.7% | 22/23 = 95.7% | 23/23 = 100% |
| 延迟 p50 / p90 / p95 / max | 26.3 / 57.6 / 87.0 / 88.2 s | 34.4 / 59.7 / 66.9 / 166.3 s | 37.2 / 171.8 / 205.1 / 226.1 s |

指标含义（避免误读）：
- **证据召回**：题目声明的 `required_evidence` quote 是否出现在产品返回的引用原文中；
  分母是逐题声明的证据条数（按题集统计，失败题也计入全量分母）。
- **引用可解析且范围正确**：结构检查——引用带非空 quote、document 属于请求范围、
  正文 `[n]` 编号能解析；**不代表引用在语义上支持结论**。
- **决定标签匹配**：返回 claims 的 `kind` 是否包含期望标签（提议/确认/变更/冲突/未知）；只反映标签。
- **结论关键词命中**：答案是否命中人工标准答案的关键词集合；**不是问答准确率，也不是语义正确率**。

## 三、原始来源核验（新增，A23 要求）

`evals/verify_sources.py` 逐条核对：引用 document 是否属于请求项目；quote 去掉 Markdown 标记与空白后是否
逐字出现在对应模拟会议文件中；`[n]` 编号是否可解析。

| 组 | 引用条数 | 逐字可验证 | 越项目引用 | 编号可解析 |
|---|---|---|---|---|
| B0 | 54 | 54（100%） | 0 | 是 |
| B1 | 52 | 52（100%） | 0 | 是 |
| B2 | 55 | 55（100%） | 0 | 是 |

证据：`docs/evidence/source-verification-{B0,B1,B2}.json`。

## 四、Ragas 辅助语义评测（官方 evaluate 链，实际运行）

- Ragas 0.4.3，官方 `evaluate`；判分模型 `deepseek-v4.1-flash` 经本地网关（opencode-go），
  embedding 为本地 `BAAI/bge-small-zh-v1.5`；样本为 B2 结果文件中前 2 道成功题；
  `retrieved_contexts` 只使用产品返回的引用 quote，`reference` 使用题集人工结论。
- 指标与逐题输出（`docs/evidence/ragas-results.json`）：

| 题 | faithfulness | context_precision |
|---|---|---|
| `sim-a-05` 访谈纪要是否完成 | 失败（判分输出未完成，见限制） | 1.000 |
| `sim-a-06` 灰度范围与回滚 | 0.143 | 0.500 |
| **均值（成功样本）** | 0.143（n=1，失败 1） | **0.750（n=2）** |

- 限制（必须与数字一起读）：
  1. 判分模型与生成模型同源，存在自评偏好；且它是 reasoning 模型， faithfulness 需要较长结构化输出，
     本次 1 条因 “LLM generation not completed” 失败（已记录，不用失败当 0 分）。
  2. 只跑 2 条样本，是“链路实际可用”的有界验证，不是 24 题语义准确率。
  3. contexts 仅为最终引用片段，context 类指标偏低估计真实检索覆盖。
  4. Ragas 通用判分模板对中文会议的决定/提议细微差别不敏感，故语义结论以人工复核样例为主、
     Ragas 仅作辅助参考。

## 五、人工复核样例（6 例，B2 结果）

| 题 | 语义支持 | 说明 |
|---|---|---|
| `sim-a-05` 访谈纪要完成了吗 | 全支持 | 明确“未记载已完成”，只引用负责人/截止与“未写明完成状态” |
| `sim-b-04` 出库口调整与原因 | 全支持 | 变更与原因均有原文；把“马会认为不影响叉车动线”标为提议而非确认 |
| `sim-b-11` 运单编排建议是否定下 | 全支持 | 正确区分“建议未形成决议”与另一场会议的 TMS 确认 |
| `sim-c-04` 病案归档改造完成了吗 | 全支持 | 明确未记载完成，引用备注原文 |
| `sim-c-10` 配送周期最新结论 | 部分支持 | 48→24 与“原因未写”正确；“最近两场是否有新建议”答成无法判断，未完成对最新两场会议的核对 |
| `sim-a-03` 最新提议是否生效 | 失败排除 | 本轮 `service_failure`（模型超时），无答案，不参与语义统计 |

逐题原文、引用与批注：`docs/evidence/human-review-samples.json`。

## 六、坏例（逐题保留）

- B2：`sim-a-03` service_failure（超时，无 AnswerRecord）；`sim-c-10` 标签为 confirmed/fact 而未体现 change/
  proposal 的细微差别；`sim-a-08` 结论关键词未命中。
- B1：`sim-a-03` service_failure；`sim-b-04`、`sim-b-11`、`sim-c-10` 标签不匹配（B1 只走事实路径，
  按设计不对提议/变更给语义标签，标签指标系统性偏低）。
- B0：除上述外，`sim-a-05` 标签未出现 unknown（事实路径）；`sim-c-11` 结论关键词未命中。
- 失败与坏例全部保留在总体分母，未为了数字删题。

## 七、与 v0.1 结果的关系

- v0.1 冻结题集与历史结果原样保留（`evals/results/{B0,B1,B2}-frozen/`），本报告是 v0.1.1 新版本结果
  （`evals/results/v0.1.1-*-frozen/`）。
- 两次运行数字有波动（模型非确定性、外部服务偶发超时），**不据此宣称质量提升或下降**；
  三组之间的策略差异才是本报告可比较的部分（同一版本、同一数据、同一模型配置）。

## 八、复跑命令

```bash
for S in B0 B1 B2; do
  python3 evals/run_eval.py --engine agui \
    --url http://127.0.0.1:8080/agui/meeting-assistant/run \
    --split frozen --strategy $S \
    --scope-map evals/datasets/scope-map.json \
    --out-dir evals/results --run-id v0.1.1-$S-frozen
  python3 evals/report_metrics.py --results evals/results/v0.1.1-$S-frozen/per_case.jsonl \
    --out docs/evidence/metrics-v0.1.1-$S.json
  python3 evals/verify_sources.py --results evals/results/v0.1.1-$S-frozen/per_case.jsonl \
    --out docs/evidence/source-verification-$S.json
done
.local/tools/venv/bin/python evals/run_ragas.py \
  --results evals/results/v0.1.1-B2-frozen/per_case.jsonl --limit 4 \
  --out docs/evidence/ragas-results.json
```

## 九、已知限制

1. 冻结题集只有 24 题，分项目样本少；决定类只覆盖少数议题链。
2. 生成模型通过外部端点，偶发超时/限流（本轮 1 题 service_failure）；失败已计入分母。
3. 关键词命中与标签匹配是规则化近似，需结合人工复核与 Ragas 辅助阅读。
4. 人工复核是执行者按原文核对（未做双人盲评）。
5. 成本：供应商未提供可核算单价，费用标为未知；embedding 为本地模型无 API 费用。
