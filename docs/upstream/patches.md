# 补丁与适配记录

本文件逐条记录 meeting-records-agent 对引入上游所做的改动与调用侧适配。
每条给出：问题、原始行为、最小改动、依据、验证命令、影响模块。

总览见 [../upstream.md](../upstream.md#4-修改记录摘要)；许可证核对见 [licenses.md](licenses.md)。

## 变更分类

| 类别 | 条目 | 是否改动上游源码 |
|---|---|---|
| 依赖约束修复 | P1、P2 | 是（仅依赖声明与环境层） |
| 构建配置 | P3 | 是（仅包管理器配置） |
| 调用参数适配 | P4、P5 | 否 |
| 合规保留 | P6 | 否（新增/保留文件） |
| 配置裁剪 | P7 | 否（产品自有配置文件） |
| 模型配置 | P8 | 否（产品自有服务与配置） |

## P1 · `google-genai` 版本约束

- **问题**：R2R 的依赖约束在当前 PyPI 上不可满足，安装直接失败。
- **原始行为**：上游 `apps/rag/py/pyproject.toml` 声明 `"google-genai >=0.6.0,<0.7.0"`。
  该区间内 PyPI 上只有 `0.6.0` 一个发行版，而 `0.6.0` 已被撤回（yanked），
  撤回原因为 `Pillow vulnerability issues CVE-2026-54058 etc`；
  下一个可用版本 `0.7.0` 落在约束区间之外。
- **最小改动**：把约束放宽到 `>=1.0.0,<2.0.0`，并在同一处加注释说明原因。
  ```toml
  # PATCH(meeting-records-agent): google-genai 0.6.0 was yanked upstream (Pillow CVE).
  # Original constraint >=0.6.0,<0.7.0 is unsatisfiable; relaxed to >=1.0.0,<2.0.0.
  "google-genai >=1.0.0,<2.0.0",
  ```
- **文件**：`apps/rag/py/pyproject.toml:55-57`。
- **依据**：PyPI 发行信息 `google-genai 0.6.0` 的 `yanked=true`、
  `yanked_reason="Pillow vulnerability issues CVE-2026-54058 etc"`；
  简单索引中 `>=0.6.0,<0.7.0` 区间只有 `0.6.0` 一个版本。
- **验证命令**：
  ```bash
  curl -s https://pypi.org/pypi/google-genai/0.6.0/json | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["info"]["yanked"], d["info"]["yanked_reason"])'
  # 期望输出：True Pillow vulnerability issues CVE-2026-54058 etc
  ls -d apps/rag/py/.venv/lib/python3.12/site-packages/google_genai-*.dist-info
  # 期望输出：apps/rag/py/.venv/lib/python3.12/site-packages/google_genai-1.2.0.dist-info
  ```
- **影响模块**：R2R 的 Google GenAI provider（`apps/rag/py/core/providers/llm/` 下的 Gemini 相关实现）。
  该 provider 在本产品中不被调用（生成统一走本地网关），因此放宽约束不改变产品行为。
- **遗留**：上游的 `apps/rag/py/uv.lock` 仍记录 `google-genai==0.6.0` 与
  `specifier = ">=0.6.0,<0.7.0"`（`apps/rag/py/uv.lock:1099-1100`、`:3130`），需要重锁。

## P2 · `mistralai` 固定为 1.5.2

- **问题**：R2R 启动时 OCR provider 导入失败。
- **原始行为**：上游 `apps/rag/py/pyproject.toml:62` 声明 `"mistralai>=1.5.2"`，没有上界。
  解析结果落到了 `3.3.0`（`logs/r2r-install.log:149` 记录 `+ mistralai==3.3.0`）。
  R2R 3.6.6 有两处依赖 `mistralai.models`：
  `apps/rag/py/core/providers/ocr/mistral.py:6` 与
  `apps/rag/py/core/parsers/media/pdf_parser.py:13`，均为
  `from mistralai.models import OCRResponse`。
  `mistralai 3.3.0` 的包内只有 `azure/`、`client/`、`extra/`、`gcp/` 四个子包，
  **没有 `models` 包**；`mistralai 1.5.2` 才有 `models/`，且含 `ocrresponse.py`。
- **最小改动**：不改上游声明，把 R2R venv 中的 `mistralai` 固定为 `1.5.2`（不升级、不降级上游其他包）。
- **文件 / 环境**：R2R 虚拟环境 `apps/rag/py/.venv`（`mistralai-1.5.2.dist-info`）。
- **依据**：包内容核对见验证命令；R2R 成功初始化的运行日志见 `logs/r2r.log:49`
  （`Initializing OCRProvider with config: ... provider='mistral' model='mistral-ocr-latest'`）。
- **验证命令**：
  ```bash
  ls -d apps/rag/py/.venv/lib/python3.12/site-packages/mistralai-*.dist-info
  # 期望输出：apps/rag/py/.venv/lib/python3.12/site-packages/mistralai-1.5.2.dist-info
  ls .local/uv-cache/archive-v0/*/mistralai/   # 3.3.0 解包目录中无 models/
  apps/rag/py/.venv/bin/python -c "from mistralai.models import OCRResponse; print('OCRResponse OK')"
  # 期望输出：OCRResponse OK
  ```
- **影响模块**：R2R OCR provider（`apps/rag/py/core/providers/ocr/mistral.py`）与
  PDF 解析器（`apps/rag/py/core/parsers/media/pdf_parser.py`）。
  本产品只处理 UTF-8 TXT / Markdown，不走 OCR 与 PDF 路径，但服务启动会实例化 OCR provider，
  因此该固定是启动必需项。
- **遗留**：这个固定只存在于环境层，`pyproject.toml` 与 `uv.lock` 都没有表达上界；
  重建环境会再次解析到 3.3.0。建议后续把声明改为 `mistralai>=1.5.2,<2.0.0`（属于上游文件修改，需重新评审）。

## P3 · pnpm 12 构建脚本策略

- **问题**：`pnpm install` 在 pnpm 12 下因依赖自带构建脚本被阻止而无法完成。
- **原始行为**：pnpm 12 默认不放行依赖的安装脚本（postinstall 等），需要显式声明允许清单；
  否则安装中断或产物缺失（`@parcel/watcher` 的原生模块、`@sentry/cli` 的二进制、
  `core-js` 的 postinstall 提示）。
- **最小改动**：
  1. `apps/web/package.json` 末尾新增 `pnpm.onlyBuiltDependencies` 白名单；
  2. `apps/web/pnpm-workspace.yaml` 新增 `strictDepBuilds: false` 与同名 `onlyBuiltDependencies`。
- **文件**：`apps/web/package.json:113-119`、`apps/web/pnpm-workspace.yaml:1-10`。
- **依据**：本机工具链 pnpm `12.4.2`、Node `v22.22.1`；
  安装日志 `logs/web-install.log`、`logs/pnpm-tsx.log`、`logs/pnpm-copilotkit.log`。
- **验证命令**：
  ```bash
  pnpm --version                                  # 12.4.2
  node -e "const p=require('./apps/web/package.json'); console.log(p.pnpm.onlyBuiltDependencies)"
  # 期望输出：[ '@parcel/watcher', '@sentry/cli', 'core-js' ]
  cat apps/web/pnpm-workspace.yaml
  ```
- **影响模块**：`apps/web` 的依赖安装与 Next.js 构建。无运行时行为变化。
- **遗留**：`apps/web/pnpm-workspace.yaml:1-5` 的 `allowBuilds` 块仍是 pnpm 交互式提问留下的占位文本
  （`set this to true or false`）。当前靠 `strictDepBuilds: false` 与 `onlyBuiltDependencies` 生效，
  但该占位块应在正式交付前改成明确的布尔值，避免后续 pnpm 版本改变解析结果。

## P4 · 检索显式关闭图检索

- **问题**：R2R 检索在无知识图谱数据时，把 `collection_ids` 过滤值错误绑定为 UUID 参数而报错。
- **原始行为**：`SearchSettings.graph_settings` 默认取 `GraphSearchSettings` 默认工厂实例
  （`apps/rag/py/shared/abstractions/search.py:514-517`），图检索分支在
  `apps/rag/py/core/main/services/retrieval_service.py:313` 与 `:642` 被触发；
  图侧过滤条件走 `apps/rag/py/core/providers/database/filters.py` 的
  `collection_ids` 处理（`438-521`），把值按 UUID 转换，而图表使用的是
  `collection_id` / `parent_id` 列（`apps/rag/py/core/providers/database/graphs.py:1130`、`:1550`）。
  产品记录见 `docs/contracts-v0.1.md:41-42`。
- **最小改动**：不改上游代码，在调用侧每次检索都显式传 `search_settings.graph_settings.enabled = false`，
  只用语义检索 + 后置重排。
- **文件**：`tests/smoke/real_ingest_smoke.py:137-138`。
- **依据**：`docs/contracts-v0.1.md` 第 41–42 行；
  上游自己在 chunk 检索上也做了同样的关闭（`apps/rag/py/core/main/api/v3/chunks_router.py:86`）。
- **验证命令**：
  ```bash
  apps/rag/py/.venv/bin/python tests/smoke/real_ingest_smoke.py
  # 期望输出含：search_hits: 1 / SMOKE_OK
  cat .run/v0.1/smoke/real-ingest-smoke.json
  ```
- **影响模块**：R2R 检索服务、产品 Agent 的检索工具。知识图谱与实体抽取在本产品内不启用。

## P5 · 上传后再 PATCH 标题

- **问题**：R2R `POST /v3/documents` 在 `metadata.title` 存在时，把该值当作文件名，扩展名丢失导致 415。
- **原始行为**：R2R 用 `metadata.title` 覆盖落库的文件名；上传 `demo-a-meeting-01.md` 时若
  `metadata.title = "演示项目A 需求评审会"`，服务端得到的文件名没有扩展名，解析器拒绝（415）。
- **最小改动**：上传时 `metadata` 不含 `title`，显式传 `id`（确定性文档身份）、`collection_ids`、
  `run_with_orchestration=false`；上传成功后 `PATCH /v3/documents/{id}/metadata` 追加
  `[{"key": "title", "value": "..."}]` 作为展示标题。
- **文件**：`tests/smoke/real_ingest_smoke.py:68-69`（说明注释）、`:86-92`（上传参数）、`:103-107`（PATCH）。
- **依据**：`docs/contracts-v0.1.md` 第 17–20 行（C01）与第 38–43 行（上游核对结论）。
- **验证命令**：
  ```bash
  apps/rag/py/.venv/bin/python tests/smoke/real_ingest_smoke.py
  # 期望输出含：title_metadata_patch: 200 ... / ingestion_status: success / SMOKE_OK
  ```
- **影响模块**：R2R 文档上传与元数据接口；产品 Agent 侧同样的调用规则写入
  `apps/agent/src/schema/meeting.py`（C01 身份规则的 Python 实现）。
- **遗留**：这是调用侧规避，上游行为未改；若上游后续修复，本条可回退。

## P6 · 保留上游许可与版权声明

- **问题**：引入分叉后必须保留上游版权声明与适用许可。
- **原始行为**：三个上游仓库根目录各自带许可文件。
- **最小改动**：原样保留，不改名、不改内容。
- **文件**：`apps/rag/LICENSE.md`（MIT，Copyright (c) 2024 EmergentAGI Inc.）、
  `apps/agent/LICENSE`（MIT，Copyright (c) 2024 Joshua Carroll）、
  `apps/web/LICENSE`（MIT，Copyright (c) 2021 Acme Co.）。
- **依据**：MIT 要求"上述版权声明和本许可声明应包含在软件的所有副本或实质性部分中"。
- **验证命令**：
  ```bash
  head -3 apps/rag/LICENSE.md apps/agent/LICENSE apps/web/LICENSE
  grep -n 'license = {text = "MIT"}' apps/rag/py/pyproject.toml
  ```
- **影响模块**：全部三个引入目录的分发形态。
- **遗留**：CopilotKit 与 Ragas 示例尚未复制，复制时须带上各自的 `LICENSE`（见 [licenses.md](licenses.md)）。

## P7 · R2R 配置裁剪

- **问题**：上游 R2R 默认配置启用了本产品不需要、且会产生额外调用或行为的链路。
- **原始行为**（`apps/rag/py/r2r/r2r.toml`）：
  `require_authentication = false`（`:41`）、`default_admin_email = "admin@example.com"`（`:43`）、
  `default_admin_password = "change_me_immediately"`（`:44`）、
  `fast_llm/quality_llm = openai/gpt-5-*-2025-08-07`（`:12-15`）、
  `chunk_size = 1_024` / `chunk_overlap = 512`（`:105-106`）、
  `automatic_extraction = true`（`:108`）、`batch_size = 128`（`:99`）。
- **最小改动**：新增产品配置模板，只写与上游不同的键，其余继承上游默认值。
  - `deployment/r2r/meeting_records.toml.template:9-10`：`fast_llm` / `quality_llm` 改为
    `openai/minimax-m3.1-flash-free`；
  - `:12-18`：强制认证，管理员邮箱与密码用 `${R2R_ADMIN_EMAIL}` / `${R2R_ADMIN_PASSWORD}` 占位；
  - `:24-34`：`base_dimension = 512`、`batch_size = 16`；
  - `:38-40`：`chunk_size = 800`、`chunk_overlap = 120`；
  - `:42`：`automatic_extraction = false`；
  - `:44`：`skip_document_summary = true`；
  - `[orchestration] provider = "simple"` 沿用上游默认（`apps/rag/py/r2r/r2r.toml:125-126`），模板不重复声明。
- **附带改动**：新建空目录 `deployment/r2r/user_tools/`（R2R 安装 user tools 时会解析该目录下的依赖，
  留空可避免依赖安装失败），通过 `.env` 的 `R2R_USER_TOOLS_PATH` 指向它。
- **依据**：`docs/design-v0.1.md` 第 98 行（"LangGraph 是唯一 Agent 编排器。关闭 R2R Agent、知识图谱、
  自动实体提取和重复重排。首版采用 R2R simple orchestration 与直接入库路径"）、第 326–343 行（配置清单）。
- **验证命令**：
  ```bash
  diff <(envsubst < deployment/r2r/meeting_records.toml.template) .run/r2r/meeting_records.toml
  grep -n "automatic_extraction\|skip_document_summary\|chunk_size\|base_dimension" \
    deployment/r2r/meeting_records.toml.template
  ls -A deployment/r2r/user_tools   # 期望输出为空
  ```
- **影响模块**：R2R 服务端全部配置行为。
- **遗留**：模板用 `${...}` 占位，渲染依赖 `envsubst`（见 `scripts/native/start-r2r.sh`），
  渲染结果写在被忽略的 `.run/r2r/meeting_records.toml`，不会进提交。

## P8 · 模型与网关

- **问题**：本产品需要一个可控的生成端点和一个中文 embedding，且不能把密钥写进代码或文档。
- **原始行为**：上游无对应设施；R2R 通过 litellm 直连上游模型服务，embedding 走
  `openai/text-embedding-3-small`（`apps/rag/py/r2r/r2r.toml:95-99`）。
- **最小改动**：新增本地模型网关 `services/model-gateway/`：
  - `/v1/embeddings` 用本地 ONNX 模型 `BAAI/bge-small-zh-v1.5`（512 维）产出向量
    （`services/model-gateway/gateway.py:21-22`、`:33-37`、`:76-105`）；
  - `/v1/chat/completions` 代理到 opencode-go 端点，模型 `minimax-m3.1-flash-free`，
    请求头带 `x-opencode-session`（`services/model-gateway/gateway.py:23-25`、`:111-115`）；
  - 向量维度与配置不一致时直接报错（`services/model-gateway/gateway.py:83-84`）；
  - R2R 通过 `OPENAI_API_BASE=http://127.0.0.1:8081/v1` 指向网关（`.env`）。
- **依据**：`docs/design-v0.1.md` 第 326–343 行；`.run/v0.1/status.md` 第 33 行。
- **验证命令**：
  ```bash
  curl -s http://127.0.0.1:8081/healthz
  # 期望输出含："embedding_model":"BAAI/bge-small-zh-v1.5" 与 "embedding_dim":512
  cat services/model-gateway/requirements.txt   # fastembed==0.5.1
  ```
- **影响模块**：模型网关服务、R2R 的 completion / embedding provider、Agent 的模型配置。
- **遗留**：重排模型（FlashRank）尚未接线；密钥只存在于被忽略的 `.env`，本文档不记录其值。

## 未修改上游业务逻辑的部分

以下内容**没有**被修改，用于对照"哪些是上游原样保留"：

| 保持原样的上游部分 | 位置 |
|---|---|
| R2R 文档解析、分块、文件与 collection、检索 API 实现 | `apps/rag/py/core/main/`、`apps/rag/py/core/providers/` |
| R2R 的 `GraphSearchSettings` / `SearchSettings` 数据结构与默认值 | `apps/rag/py/shared/abstractions/search.py` |
| R2R 的 filter 构造与 UUID 处理 | `apps/rag/py/core/providers/database/filters.py` |
| R2R 的 agent 实现（R2RAgent、RAG agent、research agent） | `apps/rag/py/core/agent/` |
| R2R 的图谱服务 | `apps/rag/py/core/main/services/graph_service.py` |
| R2R 上游配置文件的默认值 | `apps/rag/py/r2r/r2r.toml`（产品只做外部覆盖，未编辑该文件） |
| agent-service-toolkit 的服务骨架、AG-UI 端点、checkpoint saver | `apps/agent/src/service/`、`apps/agent/src/memory/` |
| agent-service-toolkit 的多 agent 注册表 | `apps/agent/src/agents/agents.py` |
| R2R-Application 的页面、组件、认证上下文 | `apps/web/src/`（新增文件仅为产品契约镜像） |
| CopilotKit 与 Ragas 示例本体 | 尚未复制，仅作本地参考 |

产品的会议语义、文档身份、范围与引用规则写在产品自有文件中
（`apps/agent/src/schema/meeting.py`、`apps/web/src/types/meeting-contracts.ts`、
`apps/web/src/server/meeting-identity.ts`、`deployment/r2r/meeting_records.toml.template`、
`services/model-gateway/`），没有回写进上游模块。

## P9 删除主链补齐 file provider 清理（T006 / A13）

- 问题：上游 `delete_documents_and_chunks_by_filter` 只删分块与文档行，`files` 表与 large object 残留，
  删除后原件仍可下载/查询，违反 C07。
- 改动：在 `apps/rag/py/core/main/services/management_service.py` 的删除主链中先调用
  `providers.file.delete_file(doc_id)`，成功后才删除文档行；失败则保留文档行、返回 `success=false`
  与 `file_cleanup_failures`，router 映射为 500，重试可完成清理。
- 依据：实测“删除后 files=1、chunks=0、docs=0”；修复后实测三处全 0；注入 `REVOKE DELETE` 时
  返回 500 且文档保留，恢复权限后重试成功（`docs/evidence/delete-failure.json`）。

## P10 重排后端：FlashRank → FastEmbed bge-reranker-base（T008 / A23）

- 问题：FlashRank `ms-marco-MultiBERT-L-12` 在真实中文会议片段上排序不可靠（含答案片段 0.0075 vs
  会议头部 0.1479）。上游要求的“LangChain FlashrankRerank/FlashRank”仍保留为可切换后端。
- 改动：`apps/agent/src/agents/meeting_tools.py` 增加 `MEETING_RERANK_BACKEND`（`fastembed` 默认 /
  `flashrank`），默认模型 `BAAI/bge-reranker-base`；两者都在进程内本地运行，无外部服务。
- 依据：`docs/evidence/evaluation-summary.md` 的“重排模型选择依据”。

## P11 图错误传播与指代绑定（T010/T011 / A11/A15）

- 问题：节点返回错误后仍沿固定边继续执行，最终错误被后续节点的错误覆盖（预算超限被报成 `invalid_citation`）。
- 改动：`apps/agent/src/agents/meeting_assistant.py` 在 `search_evidence/answer_fact/gather_meetings/
  extract_per_meeting/merge_decisions` 后增加 `state.error → END` 的条件路由；`prepare_scope` 增加
  确定性指代绑定（把“那次会议”绑定到上一轮助手提到的、当前范围内的会议标题）。
- 依据：`docs/evidence/budget.json`（`budget_exceeded`）、`docs/evidence/behavior-focus.json`
  （追问解析、澄清）。

## P12 R2R 上传/元数据适配（T005 / A01）

- 问题：`POST /v3/documents` 在 `metadata.title` 存在时把 title 当文件名（扩展名丢失→415）；
  `PATCH /documents/{id}/metadata` 实际把请求体数组中的字典合并进 metadata，而非 OpenAPI 示例的
  `[{key,value}]` 形式。
- 改动：上传显式传确定性 UUID `id`、metadata 不含 title，成功后用 `[{"title": ...}]` 追加展示标题；
  `apps/web/src/server/ingest.ts` 与 `scripts/demo/import_dataset.py` 一致实现。
- 依据：`tests/smoke/real_ingest_smoke.py`、`docs/contracts-v0.1.md` 第 2 条。
