# 模拟评测数据集（T018）

> **本目录中的全部内容均为人工编写的模拟数据**，不包含任何真实会议、真实人员或真实客户信息。
> 三个项目的名称均以「模拟项目」开头，用于避免与真实业务混淆；如需对外发布，须保持该标识。

## 1. 资产概览

| 项目 | 说明 | 会议文件 | 题数 |
|---|---|---|---|
| 模拟项目A：星河笔记 | 知识库检索产品 | `sim-project-a/meeting-01.md` … `meeting-06.md` | 12 |
| 模拟项目B：云仓物流 | 仓储调度与加盟商接入 | `sim-project-b/meeting-01.md` … `meeting-06.md` | 12 |
| 模拟项目C：青禾医疗 | 门诊系统与用药安全 | `sim-project-c/meeting-01.md` … `meeting-06.md` | 12 |
| **合计** | 3 个项目 | **18 份会议记录** | **36 题** |

- 题集文件：`questions.jsonl`（每行一道题，UTF-8，LF 换行）。
- 划分：**12 道 `split="debug"`**（用于提示词与配置调试）+ **24 道 `split="frozen"`**（用于验收冻结）。
- 每个项目各 12 题，其中 4 道 debug、8 道 frozen。
- 每份会议记录正文 400–900 字，含会议名称、日期、记录类型、参与人与讨论/决议内容。

## 2. 会议文件清单

| 文件 | 会议日期 | 记录类型 | 会议名称 |
|---|---|---|---|
| `sim-project-a/meeting-01.md` | 2026-01-12 | minutes | 星河笔记 v1.0 立项与方案启动会 |
| `sim-project-a/meeting-02.md` | 2026-02-11 | transcript | 星河笔记 用户访谈复盘会 |
| `sim-project-a/meeting-03.md` | 2026-03-11 | minutes | 星河笔记 检索方案评审会 |
| `sim-project-a/meeting-04.md` | 2026-04-09 | transcript | 星河笔记 灰度发布协调会 |
| `sim-project-a/meeting-05.md` | 2026-05-14 | minutes | 星河笔记 版本规划务虚会 |
| `sim-project-a/meeting-06.md` | 2026-05-26 | transcript | 星河笔记 v1.1 方向讨论会 |
| `sim-project-b/meeting-01.md` | 2026-01-20 | minutes | 云仓物流 调度系统选型会 |
| `sim-project-b/meeting-02.md` | 2026-02-17 | transcript | 云仓物流 运力方案评审会 |
| `sim-project-b/meeting-03.md` | 2026-03-19 | minutes | 云仓物流 仓储动线专项会 |
| `sim-project-b/meeting-04.md` | 2026-04-14 | minutes | 云仓物流 加盟商接入协调会（上午场纪要） |
| `sim-project-b/meeting-05.md` | 2026-04-14 | transcript | 云仓物流 加盟商接入协调会（第二次记录） |
| `sim-project-b/meeting-06.md` | 2026-05-19 | minutes | 云仓物流 半年度运营复盘会 |
| `sim-project-c/meeting-01.md` | 2026-01-15 | transcript | 青禾医疗 门诊系统升级启动会 |
| `sim-project-c/meeting-02.md` | 2026-02-12 | minutes | 青禾医疗 病案归档流程讨论会 |
| `sim-project-c/meeting-03.md` | 2026-03-18 | transcript | 青禾医疗 用药安全专题会 |
| `sim-project-c/meeting-04.md` | 2026-04-21 | minutes | 青禾医疗 季度质量分析会 |
| `sim-project-c/meeting-05.md` | 2026-05-12 | minutes | 青禾医疗 医保结算接口对齐会（上午场纪要） |
| `sim-project-c/meeting-06.md` | 2026-05-12 | transcript | 青禾医疗 医保结算接口对齐会（现场逐字稿） |

会议日期全部落在 2026 年 1—5 月；`record_kind` 只有 `minutes`（人工纪要）与 `transcript`（逐字稿）两种，
与产品契约的 `title / meeting_date / record_kind / participants` 字段一一对应。

## 3. 覆盖点与题号对照

| 覆盖点 | 题号 |
|---|---|
| 提议 A → 明确确认 B → 最新会议只是重新建议 A | `sim-a-01`、`sim-a-02`、`sim-a-03` |
| 明确从 X 改为 Y，且记录了原因 | `sim-b-01`、`sim-b-04` |
| 明确变更，但原文没有写原因 | `sim-c-03` |
| 只写了负责人/截止时间，没有完成状态 | `sim-a-05`、`sim-b-05`、`sim-c-04`、`sim-c-06` |
| 同日两份记录互相冲突且无可靠时刻 | `sim-b-06`、`sim-c-07` |
| 同一句话在不同会议/不同项目重复出现 | `sim-a-09`（同句另见 `sim-project-c/meeting-02.md`） |
| 同名人物出现在不同项目 | `sim-a-10`、`sim-c-08` |
| 负责人与截止日期分散在不同会议 | `sim-a-06` |
| 相对日期（「下周三」）未换算成绝对日期 | `sim-a-07` |
| 最新会议未涉及该议题（不能当作覆盖） | `sim-c-10` |
| 有完成状态记录的对照题 | `sim-b-07` |

## 4. 最小演示文件（三件套）

演示使用完整数据集中的三份记录，展示「旧提议 → 明确确认 → 新建议不覆盖确认」：

1. `sim-project-a/meeting-01.md`（2026-01-12）——提出「标签过滤 + 关键词匹配」，记录写明只是提议。
2. `sim-project-a/meeting-03.md`（2026-03-11）——正式确认「向量召回 + 关键词兜底」的混合检索方案。
3. `sim-project-a/meeting-06.md`（2026-05-26）——只重新建议改回标签过滤，记录写明没有形成新的决议。

对应题目为 `sim-a-01` / `sim-a-02` / `sim-a-03`。演示答案不另建文件，直接以本目录的 `questions.jsonl`
与会议原文为准，避免与评测题集脱节。

## 5. 题目字段说明

| 字段 | 含义 |
|---|---|
| `case_id` | 题号，全局唯一 |
| `split` | `debug`（12 道，可调） / `frozen`（24 道，冻结） |
| `project` | 所属模拟项目名 |
| `scope_mode` | `all_ready` / `explicit`，与契约 C02 的 `ScopeRequest.mode` 对应 |
| `document_ids` | `explicit` 时给会议文件名列表；集成方导入后按 C01 的确定性 ID 换成真实 UUID |
| `question` | 中文问句 |
| `expected_kind` | `fact` / `proposal` / `confirmed` / `change` / `conflict` / `unknown`，与契约 C04 的 `Claim.kind` 对齐 |
| `required_evidence` | 必需证据 `{file, quote}`，`quote` 必须逐字出现在对应 `.md` 中 |
| `acceptable_conclusion` | 可接受结论（人工审阅基准） |
| `conclusion_must_contain_any` | 规则化判定用：答案中出现其中任一关键词才算结论命中（非 LLM 判定） |
| `must_include_uncertainty` | 答案必须显式表达不确定/未记载 |
| `forbidden_inferences` | 禁止推断清单，供人工审阅，不做自动判定 |
| `expected_coverage` | 正确结论应当核对过的会议文件 |
| `notes` | 题目说明与覆盖点标注 |

标注规则：`required_evidence[].quote` 与 `acceptable_conclusion` 都来自会议原文的人工摘录，
**不得**用被测模型的输出回填；标准答案不随模型表现调整。

## 6. 冻结版本摘要

冻结对象为 `questions.jsonl` 与全部 18 份会议记录。摘要算法为 SHA-256（对文件原始字节）。

| 文件 | SHA-256 |
|---|---|
| `questions.jsonl` | `2636851787de4f8600d3e1ec51647200190521580ca3a5af3b46883627923d29` |
| `sim-project-a/meeting-01.md` | `8776373b8fdcf99758573696f48346703bfc5aa54e86ad5e7f5719a083929d80` |
| `sim-project-a/meeting-02.md` | `0cf1eda463656f212b78cc6830b317a878f70f899ec7b9d4326278f409121b7d` |
| `sim-project-a/meeting-03.md` | `feca43510632b52bc3a8cc8239fd4daed91e4ec78a7670c05a01c62be1fb53b4` |
| `sim-project-a/meeting-04.md` | `7d1c2b33543ed9f4053f2142211861ec205987ad2e510de003b0c29847a7b805` |
| `sim-project-a/meeting-05.md` | `8d3faaa1e4357310d4144c2890136faa4940b9cc41364f0cc4fab37697edf50e` |
| `sim-project-a/meeting-06.md` | `87864dfa0ade1b360ed3708efd4d5fee08cee997012aca2445d87b7e368f81f9` |
| `sim-project-b/meeting-01.md` | `c6d8e3bf0285274c2f78fe9693e7c1db2d061af29f53640c8fc837d1b1f6c8e8` |
| `sim-project-b/meeting-02.md` | `38b020c758994152d7bd30b832627b8bf9783f02b4988d7e90be72db1843fec2` |
| `sim-project-b/meeting-03.md` | `8f106eab735debd9ddcc23903f6d0a2df66446b00f418a3241af34bfe84ba6a9` |
| `sim-project-b/meeting-04.md` | `0f52e958de01368473971f41d634aa0f535fbdad7314a07a106dcb02c12429f1` |
| `sim-project-b/meeting-05.md` | `2f99b6f6a08af879d000936aa678a4dc2da64a46aa3e39b0cfc602f5482dd102` |
| `sim-project-b/meeting-06.md` | `414a287e8119013936f0729d1f7ff7a74909aec5859a924141a34fd550646c89` |
| `sim-project-c/meeting-01.md` | `fe6729d29e38654ea8366502ccce8fb40dc65c1ddd0a55f666e0da0b20db1b25` |
| `sim-project-c/meeting-02.md` | `e877ffc840f064cbf26ebd18e919773fd1ae9be4ce84d6647d680be5c01cf9f8` |
| `sim-project-c/meeting-03.md` | `b035adfb4fd6886a17feacd2dce9db52fe89d59753b124519e893d18c30c22f2` |
| `sim-project-c/meeting-04.md` | `8394754bbe36650c2bc2b71d57765359e082c2e39e49fb1433b535932e90b5fa` |
| `sim-project-c/meeting-05.md` | `d44ac5005228213fa67a7a9500118c389316a14442e8b05c600ccd06cecef393` |
| `sim-project-c/meeting-06.md` | `5140de7a598bfacc5c1afe34eace15178ffaed953c1e80e77082e6229df671d0` |

摘要变化即视为数据集改动：需在 `.run/v0.1/receipts/evals.md` 记录修订原因，并重跑所有受影响的对照组。

## 7. 校验

```bash
python3 evals/validate_dataset.py
```

校验内容：18 份会议文件存在且字段/日期/记录类型/字数合规；36 题、split 计数 12/24；
每题 `required_evidence` 的 quote 逐字命中；`explicit` 的文档存在；本文件记录的 SHA-256 与实际一致。
