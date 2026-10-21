# Web 同源接口 v0.1（T012/T013/T014 的实现契约）

Web 只通过本应用的 Pages Router API 访问 R2R 与 Agent；浏览器不持有 R2R/Agent 服务凭据。
所有接口：`Content-Type: application/json`（上传为 multipart），失败统一返回
`{ "error": { "category": "<C08 分类>", "message": "...", "fields": [], "retryable": false } }`。
身份来自 HttpOnly Cookie `mra_session`（R2R access token，服务端解密前只做透传校验）；未登录返回 401 + `scope_forbidden`。

## 认证

| 方法/路径 | 请求 | 成功响应 |
|---|---|---|
| `POST /api/auth/login` | `{email, password}` | `{user:{id,email}}` + Set-Cookie |
| `POST /api/auth/logout` | – | `{ok:true}`，清 Cookie |
| `GET /api/me` | – | `{user:{id,email}}` |

- 只允许本地单账号；`POST /api/auth/register` 不存在（404），注册页面移除入口（A19）。
- 登录用 R2R `POST /v3/users/login`（form 编码 username/password）在服务端换取 token，token 只存在 Cookie。

## 项目与会议

| 方法/路径 | 请求 | 成功响应 |
|---|---|---|
| `GET /api/projects` | – | `{projects:[{id,name,description,created_at}]}`（R2R collections） |
| `POST /api/projects` | `{name, description?}` | `{project:{id,name}}`；重名 409 `duplicate_processing` |
| `GET /api/projects/{id}/meetings` | `?status=all` | `{meetings:[MeetingSummary]}` |
| `POST /api/projects/{id}/meetings` | multipart: `file`(必填), `title`, `meeting_date`, `record_kind`, `participants`(JSON 字符串数组), `time_precision`(`date`/`datetime`), `meeting_started_at`(ISO，可选) | `{meeting:MeetingSummary}` |
| `GET /api/meetings/{documentId}` | – | `{meeting:MeetingSummary, chunks:{page,page_size,total,items:[{chunk_id,chunk_order,text}]}}` |
| `DELETE /api/meetings/{documentId}` | – | `{deleted:true, document_id, file_deleted, chunks_deleted}`；部分失败返回 500 `service_failure` 且 `deleted:false` |
| `GET /api/meetings/{documentId}/chunks` | `?page=0&page_size=20` | 同上 `chunks` |
| `GET /api/meetings/{documentId}/chunks/{chunkId}/neighbors` | `?radius=1` | `{items:[{chunk_id,chunk_order,text}]}` |

`MeetingSummary`：
```json
{ "document_id":"uuid","collection_id":"uuid","title":"会议标题","meeting_date":"2026-03-02",
  "time_precision":"date","meeting_started_at":null,"record_kind":"minutes",
  "participants":["张三"],"content_sha256":"...","status":"ready|processing|failed|unknown",
  "chunk_count":12,"size_in_bytes":3456,"created_at":"...","identity_verified":true }
```
- 上传使用 `docs/contracts-v0.1.md` 的 C01 身份规则：服务端计算 `content_sha256` 与 `document_id`；
  已存在同 ID → 返回 200 + `existing:true` + 当前状态，不重复导入；处理中 → 409 `duplicate_processing`。
- 上传必须校验：空文件、非 UTF-8、缺字段、日期格式错误 → 400 `input_error`（不调用模型）；
  `title`/`meeting_date`/`record_kind` 必填。
- 上传成功后服务端追加 `title` metadata（R2R 上传时 title 会被当作文件名，见 C01 适配说明），
  并在响应中包含真实 `status` 与 `chunk_count`；未 ready 的文档不进入问答范围。

## 聊天（AG-UI）

| 方法/路径 | 用途 |
|---|---|
| `POST /api/copilotkit` 或 `/api/copilotkit/*` | 同源 AG-UI 入口；转发到 Agent `POST /agui/meeting-assistant/run`（SSE 透传），注入服务凭据与服务器确认的 `user_id` |
| `GET /api/threads` | 当前账号线程列表（Agent `GET /meeting-assistant/threads?user_id=`） |
| `POST /api/history` | `{thread_id}` → Agent `POST /meeting-assistant/history`，返回 `{messages, answer_records, scope, run_status}` |

请求体（AG-UI）：`{threadId, runId, messages, tools, context, state, forwardedProps:{meeting_scope:{collection_id,mode,document_ids}}}`。
`forwardedProps` 白名单：只接受 `meeting_scope` 与 `model`；任何 `user_id`/`configurable`/`sources`/`answer_record` 一律剥离并在服务端日志记录（400 `scope_forbidden` 若伪造身份字段）。
浏览器不直接请求 Agent/R2R 端口。

## 错误分类映射（C08）

| 来源 | category |
|---|---|
| 字段/编码/空文件/空范围 | `input_error` |
| 未登录、越项目、伪造身份 | `scope_forbidden` |
| 文档已存在处理中 | `duplicate_processing` |
| 上传/查询超时或结果未知 | `unknown_result` |
| R2R/Agent 5xx、连接失败、模型失败 | `service_failure` |
| 阅读预算超限 | `budget_exceeded` |
| 引用不存在/片段不匹配 | `invalid_citation` |
| 范围内容在运行中变化 | `stale_scope` |

## 环境变量（服务端唯一读取）

`R2R_API_URL`（默认 http://127.0.0.1:7272）、`AGENT_API_URL`（默认 http://127.0.0.1:8080）、
`R2R_ADMIN_EMAIL`、`R2R_ADMIN_PASSWORD`（仅用于服务端登录换取 token）、`MRA_SESSION_SECRET`（Cookie 签名）。
一律不得使用 `NEXT_PUBLIC_*` 承载这些值。

## 页面

- `/auth/login`：本地单账号登录；`/auth/signup` 移除或 404。
- `/documents`（会议列表/项目选择/上传）：真实状态、会议字段、删除、重试；按项目分组。
- `/chat`：范围选择（项目 all_ready / 指定会议 explicit）、问答、进度、最终答案、编号引用点击查看原文、历史线程切换、刷新恢复。
- 引用点击：按 `source_key → {document_id, chunk_id, chunk_order, quote}` 调 `/api/meetings/{id}/chunks` 定位并核对 chunk_id；来源已删除时显示“引用失效”。
