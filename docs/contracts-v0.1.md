# 跨模块契约 v0.1（T003 决策记录）

契约修订 C-v0.1-r1 的唯一实现：

- Python：`apps/agent/src/schema/meeting.py`
- TypeScript 类型：`apps/web/src/types/meeting-contracts.ts`
- 服务端身份/摘要助手：`apps/web/src/server/meeting-identity.ts`
- 共享测试向量：`tests/contracts/fixtures/meeting_contract_vectors.json`
- 两端验证：`tests/contracts/test_contracts.py`（8 passed）、`tests/contracts/contracts.test.ts`（`tsx` 运行，全部 ok）

## 已固定的规则

1. **文档身份（C01）**：`uuid5(NS, "<collection_id>|<meeting_date YYYY-MM-DD>|<NFC 标题>|<record_kind>|<content_sha256>")`，
   其中 `NS = uuid5(NAMESPACE_URL, "https://meeting-records-agent.local/ns/meeting-document/v1")`。
   标题先 NFC、去首尾空白、连续空白折叠为单个空格；`content_sha256` 为原文件字节的 64 位小写十六进制。
   向量见 fixtures：空白差异标题得到同一 ID，不同项目/日期/类型/内容得到不同 ID。
2. **上传适配（C01）**：R2R `POST /v3/documents` 在 `metadata.title` 存在时会把该值当作文件名，导致扩展名丢失（415）。
   因此本产品上传时：显式传 `id`（上述确定性 ID）、`collection_ids`、`run_with_orchestration=false`、
   `metadata` 不含 `title`；上传成功后再 `PATCH /v3/documents/{id}/metadata` 追加展示标题；注意该端点实际把请求体数组里的字典合并进 metadata（不是 OpenAPI 示例里的 `[{key,value}]` 形式），因此发送 `[{"title": "<标题>"}]`。
   这是实际验证过的链路（`tests/smoke/real_ingest_smoke.py`）。
3. **范围（C02）**：`ScopeRequest.mode ∈ {all_ready, explicit}`；explicit 必须带非空 `document_ids`，
   all_ready 必须不带；`ScopeSnapshot.fingerprint = sha256(canonical_json({collection_id, mode, documents[{document_id, content_sha256, status}] 按 document_id 排序}))`。
   canonical JSON：`sort_keys`、`ensure_ascii=false`、分隔符 `,`/`:`。
4. **证据（C03）**：`EvidenceChunk.source_key` 是稳定引用键，`document_id`/`chunk_id`/`chunk_order` 才是身份，
   分数不参与身份。检索过滤由服务器生成 `collection_ids` 与 `document_id` 交集，响应后再核对。
5. **回答（C04）**：`AnswerRecord.status=completed` 的必要条件：非空 text；每条非 `unknown` claim 至少一个已知
   `sources` key；`unknown` 可以无证据但不得含隐含事实。展示编号在同一回答内生成并写入 `sources`。
6. **AG-UI（C05）**：输入只接受白名单 `forwardedProps.meeting_scope`（C02 形状）；状态投影
   `AgUiStateProjection{meeting_scope, progress, answer_record, clarification}`；不透传 RAW/内部提示/密钥。
   浏览器不得提交 `user_id`、`sources`、`answer_record`、checkpoint namespace。
7. **历史（C06）**：沿用 `ChatHistory` 扩展字段 `answer_records`、`scope`、`run_status`；未完成轮次
   `interrupted/failed` 不得显示为完成。
8. **错误（C08）**：分类固定为 `input_error / scope_forbidden / duplicate_processing / unknown_result /
   service_failure / budget_exceeded / invalid_citation / stale_scope`；服务故障不得伪装成“无证据”。

## 上游核对结论（T003）

- R2R 3.6.6（commit 9c5a94d）：`/v3/documents`（multipart）、`/v3/documents/{id}`、`/v3/documents/{id}/chunks`、
  `/v3/documents/{id}/metadata`(PATCH append)、`/v3/retrieval/search`、`/v3/collections`、`/v3/users/login`
  （OAuth2 表单编码）与契约一致。
- `SearchSettings.graph_settings.enabled=false` 必须显式传入：默认图检索会在无图谱数据时把 `collection_ids`
  过滤值错误绑定为 UUID 参数（上游缺陷），本产品所有检索请求都关闭图检索并使用语义检索 + 后置重排。
- 结论：不改 C02/C04 语义即可承载；差异仅在上传标题处理与检索参数，已记录为适配点。

## 变更流程

任何字段语义变更须更新本文件、Python/TS 两端、fixtures 与两端测试，再通知消费者；不允许各模块私自定义同名异义字段。
