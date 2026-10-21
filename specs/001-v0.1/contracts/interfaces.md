# 模块契约

契约修订：C-v0.1-r1。下列是拟实现的产品契约，当前没有对应实现。T003 负责核对上游固定源码、验证最小序列化示例并形成唯一类型定义，后续任务按其消费；不能各自创造同名异义字段。

Python 类型放在已有 `apps/agent/src/schema/schema.py`；Web 对应类型放在拟新增 `apps/web/src/types/meeting-contracts.ts`。JSON 示例与契约验证放在拟新增 `tests/contracts/`。采用现有 Pydantic/TypeScript 能力，不开发 schema 平台或共享服务。

## C01 会议输入与身份

| 字段 | 约束 | 所有者 |
|---|---|---|
| `collection_id` | 合法 UUID，服务器核对可访问项目；每份记录只归属一个项目 | R2R collection |
| `title` | 必填，保留可展示标题 | R2R document metadata |
| `meeting_date` | 必填 ISO 日期，表示会议日期 | 同上 |
| `meeting_started_at` | 可空，非空时有时区 | 同上 |
| `time_precision` | `date` 或 `datetime`，与时间字段一致 | 同上 |
| `record_kind` | `transcript` 或 `minutes` | 同上 |
| `participants` | 可空字符串数组；不是责任分配证明 | 同上 |
| `content_sha256` | 对原文件字节计算并由服务端确认 | 同上 |
| `schema_version` | `meeting-v0.1` | 同上 |
| `document_id` | 按项目、会议日期、标题、记录类型、原文件摘要确定性生成 | 标准 UUID/上游 ID 工具 |

T003 固定 ID 规范化规则、UUID namespace 和测试向量，所有上传与重试只使用这一实现。不同项目、日期、标题、类型或内容必须有不同身份；重试同一输入身份一致；不能只凭文件名覆盖记录。不在未说明的情况下改写已有记录的会议时间或内容。

上传适配同时填写表单 `collection_ids` 和 `metadata.collection_ids`，都只有该项目 ID；采用文件入口、`run_with_orchestration=false` 和禁用摘要/抽取/扩写的配置。成功定义为原始入库成功、存在分块、集合归属复核一致，不以单个 2xx 代替。

## C02 范围与本轮快照

```json
{
  "collection_id": "<项目 UUID>",
  "mode": "explicit",
  "document_ids": ["<文档 UUID>"]
}
```

`mode` 仅为 `all_ready` 或 `explicit`。前者每轮重新列出项目内全部就绪会议，后者只使用显式列表并逐一核对当前状态。空范围拒绝执行；显式列表含不可用或无权访问的文档时提示调整范围，不能静默扩大到全项目。

`ScopeSnapshot` 包含 `collection_id`、`mode`、实际 `documents`、`created_at`、`fingerprint`。每个 document 项保留 ID、内容摘要、会议时间/精度、状态和所属项目。fingerprint 是稳定序列化的状态摘要，用于变更检测，不能代替鉴权。

所有工具调用使用服务器得到的同一快照。`all_ready` 新增会议只在下一轮纳入；`explicit` 不自动加新会议。最终发布前复核快照内来源的存在性、可用性和身份；来源失效时本轮失败并提示重试。新会议到达本身不使已固定的本轮快照失效。

## C03 检索与原文工具

| 调用 | 输入 | 输出和限制 |
|---|---|---|
| 既有 `database_search` 二开 | 问题、服务端范围、配置预算 | `EvidenceChunk[]`；只走范围内 R2R 向量检索，再重排 |
| 同一工具组的原文读取适配 | document ID、分页参数、服务端范围 | 完整分页的 chunk，明确是否读完和下一页，不含向量 |
| 相邻片段读取 | 命中 ID/order 和同文档范围 | 相邻原始 chunk，保持各自身份，不能按重复文本猜来源 |

`EvidenceChunk`：`source_key`、`document_id`、`chunk_id`、`chunk_order`、`text`、`title`、`meeting_date`、`meeting_started_at`、`record_kind`、`content_sha256`；分数可选，不能用浮点分数作身份。

检索过滤由 Agent 构造 `collection_ids` 与 `document_id` 的交集，并在响应后再次核对。模型不可覆盖过滤或调用任意 URL。重排通过 `Document.metadata` 保留标识，不将重排后的文本重新按字符串匹配回来源。

基线实验值：字符分块 800/重叠 120、召回 24、重排 8。它们是调试起点，实际值在配置和评测结果中锁定。决定核对必须分页读完全部选定会议，不能只读取检索命中的 8 块。

## C04 AnswerRecord 与引用

| 字段 | 语义 |
|---|---|
| `message_id`, `run_id` | 绑定该轮最终回答和运行 |
| `text` | 用户可读回答；检查前只能作为生成草稿 |
| `claims` | 每项含 `text`、`kind`、`evidence_ids` |
| `kind` | `fact/proposal/confirmed/change/conflict/unknown` |
| `sources` | `source_key` 到稳定文档/块身份、标题、日期、精确引用片段的映射 |
| `scope_snapshot` | 本轮实际依据范围 |
| `coverage` | 核对过、未核对、失败的会议及预算中止情况；不得伪装完整 |
| `created_at`, `model_config_id` | 生成时间和去除密钥的配置标识 |
| `status` | 仅验证与持久化成功的记录为 `completed`；失败/中断不能混入完成结果 |

每条事实必须引用当轮工具产生的 key。未知项可无证据，但不能含隐含事实。服务器检查 key、范围和引用片段在对应 chunk 中精确存在；这些结构检查不证明语义成立，语义支持另做评测。

显示编号 `[1]` 等在该条回答内生成并保存到 AnswerRecord 的展示映射。排序变化、相同文本、刷新、重排均不改变编号对应的实际来源。点击时按稳定 ID 和 order 查片段并复核 chunk ID；禁止直接执行模型给的链接或 HTML。

## C05 AG-UI 与 Web 边界

外部使用同源 `POST /api/copilotkit`，Runtime 转发上游已存在的 `POST /agui/{agent_id}/run`。上游路径顺序以固定源码为准；使用官方 AG-UI 事件与客户端，不发明另一套 SSE 协议。

拟采用 `forwardedProps.meeting_scope` 传 C02；运行入口白名单解析该字段。浏览器不可提供可信 `user_id`、任意 configurable、checkpoint namespace、sources 或 meeting_findings。线程身份从标准 thread ID 与已认证账号关系核对，持久状态来自服务器；客户端消息和 state 不能覆盖服务器证据及历史。

Runtime 的身份和服务凭据仅在服务器端组装，不能放进 `NEXT_PUBLIC_*`。Web 的 R2R/Agent 同源代理按方法与路径白名单开放，不能接受任意目标 URL；collection/doc/thread ID 都要核对，不把登录状态等同于所有外部对象均可信。

通过标准状态快照/状态更新传递 UI 必需的进度和 AnswerRecord 投影；不透传 RAW 事件、完整内部提示词或内部推理。T003 用所锁版本的官方 API 证明最小输入、状态和终态可传递；若 API 形态不同，只适配承载方式，不改变 C02/C04 语义。

## C06 历史与澄清

保留上游 `GET /{agent_id}/threads` 与 `POST /{agent_id}/history`。扩展既有 `ChatHistory`，至少返回 `messages`、`answer_records`、当前 `scope` 和可供 UI 判断的运行完成状态。服务端核对线程所属本地账号；忽略调用方伪造的 user_id。

AnswerRecord 与聊天写入同一 checkpoint，历史转换不能只保留文字。未完成轮次显示中断/待处理，不算最终回答。澄清采用既有 LangGraph interrupt/resume 机制，保存澄清上下文；继续前重新核对当前范围，不能直接复用失效证据。

## C07 移除与来源失效

用户明确移除单份记录后，沿用既有 DELETE 入口，二开主链路接上已有 file provider 清理方法；分别核对文档、分块、原件不可查询。部分失败不得返回“全部清理成功”，重试先读取现状，不误删其他 ID。

旧回答文本保留；引用打开时确认当前来源不存在则显示失效，不能用历史快照伪装仍存在的原件。新一轮只使用当前可用文档，历史证据不作为事实输入。该操作不等于抹除历史回答、备份或外部日志。

## C08 错误与预算

错误沿用上游 FastAPI/Pydantic 处理，在原 schema 映射稳定类别。具体响应字段在 T003 定义，禁止各前端自行根据错误文本猜测。

| 类别 | 用户行为 | 可否给确定结论 |
|---|---|---|
| 输入/编码/空范围错误 | 指出字段、文件或范围 | 否，不调用模型 |
| 身份或对象范围不符 | 拒绝访问 | 否 |
| 文档重复/处理中 | 查询并显示当前状态 | 不重复创建 |
| 结果未知/网络超时 | 显示未确认，先查询状态 | 否 |
| 模型配置/限流/检索服务失败 | 显示服务失败和可重试信息 | 否，不能变成“无相关证据” |
| 阅读预算超限/部分读取失败 | 缩小范围或重试 | 不能输出全范围的最后决定 |
| 引用不合法/结构输出失败 | 有界修复，失败则结束 | 不能显示伪引用 |
| 发布前范围失效 | 提示资料变化，重新提问 | 否 |

沿用图步数上限；结构化输出最多修复一次。重试、阅读和模型预算必须有限且可配置，不能由模型无限延长。除已给定的次数外，本包不编造超时秒数和吞吐阈值；T003 记录采用值及理由，T022 实测。
