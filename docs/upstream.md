# 上游来源、采用方式与许可

本文件是 meeting-records-agent 的来源权威记录：固定了引入的上游项目与提交、说明采用方式、
列出许可文件位置、汇总对上游的改动，并给出需要退役的旧链路清单。

配套文档：

- [补丁与适配记录](upstream/patches.md)：逐条改动的问题、依据、验证命令与影响模块。
- [引入清单与规模](upstream/inventory.md)：每个引入目录的规模、入口文件、`.git` 处理与密钥情况。
- [许可证核对表](upstream/licenses.md)：上游项目的许可类型、文件路径与待核对条款。

状态：三个上游已按固定提交引入工作区（记录日期 2026-10-22）；产品功能验收尚未完成。

## 1. 固定来源

| 组件 | 仓库 | 固定提交 | 采用方式 | 引入位置 |
|---|---|---|---|---|
| [agent-service-toolkit](https://github.com/JoshuaC215/agent-service-toolkit) | `https://github.com/JoshuaC215/agent-service-toolkit` | `0eb5820a1d689743ac834102030f53f4a21dc321` | 分叉 | `apps/agent` |
| [R2R](https://github.com/SciPhi-AI/R2R) | `https://github.com/SciPhi-AI/R2R` | `9c5a94d151f90876bd7eb860f300a8fd662dc481` | 分叉 | `apps/rag` |
| [R2R-Application](https://github.com/SciPhi-AI/R2R-Application) | `https://github.com/SciPhi-AI/R2R-Application` | `c4612ab48af002d4cd078659d11db88ed61d53b8` | 分叉 | `apps/web` |
| [CopilotKit 示例](https://github.com/CopilotKit/CopilotKit/tree/abc6807f35865e043c498398e3080f137ddbdad9/examples/integrations/langgraph-fastapi) | `https://github.com/CopilotKit/CopilotKit` | `abc6807f35865e043c498398e3080f137ddbdad9` | 示例适配（尚未复制进 `apps/web`） | 本地参考 `upstream/reference/copilotkit-example` |
| [Ragas 示例](https://github.com/vibrantlabsai/ragas/tree/298b68274234c060deacab3cf5fb52aa3a20e885/examples) | `https://github.com/vibrantlabsai/ragas` | `298b68274234c060deacab3cf5fb52aa3a20e885` | 示例适配（尚未复制进 `evals/`） | 本地参考 `upstream/reference/ragas-examples` |
| LangChain Community | `https://github.com/langchain-ai/langchain-community` | 依赖 `langchain-community==0.4.2`（`apps/agent/pyproject.toml:27`） | 直接依赖 `FlashrankRerank` | — |
| FlashRank | `https://github.com/PrithivirajDamodaran/FlashRank` | 依赖 `FlashRank==0.2.10` | 由重排组件调用 | — |
| LangSmith | SDK | 版本待实施时锁定，默认关闭 | 沿用上游 SDK 集成 | — |

`upstream-lock.yaml` 记录的是同一组选型基线；本文件描述实际引入结果。两者的提交号一致。

## 2. 采用方式

### 2.1 引入过程

三个分叉仓库用同一套脚本引入，脚本位于被忽略的 `.run/` 目录：

- `.run/scripts/clone_upstreams.sh`：对每个上游执行
  `git init` → `git remote add origin <url>` → `git fetch --depth 1 origin <sha>` →
  `git checkout FETCH_HEAD`（第 8–11 行的 `clone_at()` 函数）。
- `.run/scripts/clone_extra.sh`：两个参考示例用
  `git clone --filter=blob:none --no-checkout --depth 1` → `git fetch --depth 1 origin <sha>` →
  `git sparse-checkout set <子目录>` → `git checkout FETCH_HEAD`。

采用浅克隆是刻意的：只要目标提交，不引入上游历史，也不把上游的 `.git` 带进本仓库。

引入完成后删除了三个分叉目录内的嵌套 `.git`（`apps/agent/.git`、`apps/rag/.git`、`apps/web/.git`）。
原因是父仓库不能包含 embedded repo，嵌套 `.git` 会让 Git 把子目录当成独立仓库而不跟踪其内容。
核对结果：`find apps -name .git -not -path "*/node_modules/*" -not -path "*/.venv/*"` 无输出。
删除后各目录的上游来源由本文件第 1 节的固定提交号与 `.run/scripts/clone_upstreams.sh` 共同承担，
工作区不再能直接执行 `git log` 查看上游历史。

### 2.2 目录映射

| 上游 | 引入目录 | 本项目的使用边界 |
|---|---|---|
| agent-service-toolkit | `apps/agent/` | FastAPI 服务、LangGraph 图注册、AG-UI 端点、checkpoint saver 沿用；`src/agents/` 下的工具与图需按产品需要裁剪 |
| R2R | `apps/rag/`（Python 包在 `apps/rag/py/`） | 解析、分块、文件与 collection、检索 API 沿用；配置通过 `deployment/r2r/meeting_records.toml.template` 覆盖 |
| R2R-Application | `apps/web/` | 页面、组件、认证与 `r2r-js` 客户端沿用；聊天链路改为 CopilotKit/AG-UI，旧入口见第 6 节 |
| CopilotKit 示例 | `upstream/reference/copilotkit-example/examples/integrations/langgraph-fastapi`（本地参考） | 尚未复制；复制时保留其 `LICENSE` |
| Ragas 示例 | `upstream/reference/ragas-examples/examples`（本地参考） | 尚未复制；复制时保留其 `LICENSE` |

### 2.3 参考示例是本地参考，不是提交内容

`upstream/` 整个目录被 `.gitignore` 忽略（`.gitignore:62` 的 `/upstream/`），因此：

- 参考示例（含两个仓库的 `.git` 与全部文件）只存在于本地工作区，**不进入提交、不随仓库分发**；
- 每次引入或更新上游都必须重新拉取参考示例，步骤见 `.run/scripts/clone_extra.sh`；
- 参考示例目录里的 `LICENSE` 副本（`upstream/reference/ragas-examples/LICENSE`、
  `upstream/reference/ragas-examples/examples/LICENSE`、
  `upstream/reference/copilotkit-example/LICENSE`、
  `upstream/reference/copilotkit-example/examples/integrations/langgraph-fastapi/LICENSE`）
  只是上游文件的就地副本，不构成产品的一部分；真正需要保留的是**复制进产品目录时**带上对应许可文件。

当前两个参考目录规模：`upstream/reference/copilotkit-example` 8.9M（含 5.0M `.git`），
`upstream/reference/ragas-examples` 1.2M（含 452K `.git`）。

## 3. 许可与版权

| 上游 | 许可 | 文件路径 | 状态 |
|---|---|---|---|
| agent-service-toolkit | MIT（Copyright (c) 2024 Joshua Carroll） | `apps/agent/LICENSE` | 已保留 |
| R2R | MIT（Copyright (c) 2024 EmergentAGI Inc.） | `apps/rag/LICENSE.md` | 已保留 |
| R2R-Application | MIT（Copyright (c) 2021 Acme Co.） | `apps/web/LICENSE` | 已保留 |
| CopilotKit 示例 | MIT（Copyright (c) Atai Barkai） | 复制时放入 `apps/web/.../langgraph-fastapi/LICENSE` | 尚未复制，待保留 |
| Ragas 示例 | Apache-2.0 | 根目录与 `examples/LICENSE` 各一份，均为 Apache-2.0 | 尚未复制，待保留 |
| LangChain Community | MIT | 由依赖管理 | — |
| FlashRank | Apache-2.0 | 由依赖管理 | 权重许可需单独核对 |
| LangSmith | SDK 与服务条款分别适用 | 默认关闭 | 版本待锁定 |

R2R 的 `pyproject.toml` 中 `license = {text = "MIT"}`（`apps/rag/py/pyproject.toml:10`）与
`apps/rag/LICENSE.md` 的正文一致。

本项目自身许可尚未确定，文档中不声称任何项目许可。

详细核对表与待核对项见 [licenses.md](upstream/licenses.md)。

## 4. 修改记录摘要

改动全部记录在 [patches.md](upstream/patches.md)，摘要如下：

| 编号 | 对象 | 改动 | 性质 |
|---|---|---|---|
| P1 | `apps/rag/py/pyproject.toml:55-57` | `google-genai` 约束 `>=0.6.0,<0.7.0` → `>=1.0.0,<2.0.0` | 依赖约束修复 |
| P2 | `apps/rag/py/.venv` | `mistralai` 固定为 `1.5.2` | 环境依赖固定 |
| P3 | `apps/web/package.json:113-119`、`apps/web/pnpm-workspace.yaml:1-10` | 新增 `pnpm.onlyBuiltDependencies`、`strictDepBuilds: false` 与构建脚本白名单 | 构建配置 |
| P4 | 调用侧（`tests/smoke/real_ingest_smoke.py:137-138`） | 检索显式 `graph_settings.enabled=false` | 调用参数适配 |
| P5 | 调用侧（`tests/smoke/real_ingest_smoke.py:103-107`） | 上传后 `PATCH /v3/documents/{id}/metadata` 追加 `title` | 调用参数适配 |
| P6 | `apps/rag/LICENSE.md`、`apps/agent/LICENSE`、`apps/web/LICENSE` | 保留上游许可 | 合规保留 |
| P7 | `deployment/r2r/meeting_records.toml.template`、`deployment/r2r/user_tools/` | 配置裁剪 | 配置覆盖 |
| P8 | `services/model-gateway/`、`.env` | 生成走本地网关，embedding 用本地 `BAAI/bge-small-zh-v1.5` | 配置证据 |

P1–P3 是对上游文件的实际修改；P4–P5 是在调用侧规避上游行为，未改上游代码；
P6–P8 是保留与配置，不改上游逻辑。

## 5. 模型与配置证据

不记录任何密钥；密钥只存在于被忽略的 `.env` 中。

| 用途 | 模型 / 端点 | 证据位置 |
|---|---|---|
| 生成（对话与 R2R 内部 LLM） | `minimax-m3.1-flash-free`，经本地网关转发到 opencode-go 端点 | `deployment/r2r/meeting_records.toml.template:9-10`；`services/model-gateway/gateway.py:23-25`；网关请求带 `x-opencode-session` 头（`services/model-gateway/gateway.py:113`） |
| Embedding | 本地 `BAAI/bge-small-zh-v1.5`，512 维，ONNX/fastembed | `services/model-gateway/gateway.py:21-22`、`:33-37`；`services/model-gateway/requirements.txt:4`（`fastembed==0.5.1`）；R2R 侧 `deployment/r2r/meeting_records.toml.template:24-34` |
| 维度一致性校验 | 网关比对实际向量长度与配置维度，不一致直接报错 | `services/model-gateway/gateway.py:83-84` |

上游 R2R 默认的 `fast_llm`/`quality_llm` 是 `openai/gpt-5-nano-2025-08-07` 与
`openai/gpt-5-2025-08-07`（`apps/rag/py/r2r/r2r.toml:12-15`），产品配置把它们改写为
`openai/minimax-m3.1-flash-free`，由网关按 OpenAI 兼容协议落地。

## 6. 退役计划与旧链路清单（A19）

A19 要求"仅三个应用和一个 PostgreSQL 实例；独立 Python 环境；LangGraph 唯一编排；
无重复业务表、旧聊天运行依赖或公开内部端口"。下面只列事实与代码位置，不做修改。

### 6.1 Chroma `database_search`（旧向量库检索链路）

| 位置 | 内容 |
|---|---|
| `apps/agent/src/agents/tools.py:5` | `from langchain_chroma import Chroma` |
| `apps/agent/src/agents/tools.py:50-62` | `load_chroma_db()`：本地 `./chroma_db` 持久化目录 + `OpenAIEmbeddings` |
| `apps/agent/src/agents/tools.py:65-76` | `database_search_func(query)` |
| `apps/agent/src/agents/tools.py:79-80` | 工具注册，`database_search.name = "Database_Search"` |
| `apps/agent/src/agents/rag_assistant.py:16` | `from agents.tools import database_search` |
| `apps/agent/src/agents/rag_assistant.py:30` | `tools = [database_search]` |
| `apps/agent/src/agents/rag_assistant.py:98` | `agent.add_node("tools", ToolNode(tools))` |
| `apps/agent/pyproject.toml:30` | 依赖 `"langchain-chroma ~=1.1.0"` |
| `apps/agent/.venv/lib/python3.12/site-packages/` | 已安装 `chromadb-1.5.9`、`langchain_chroma-1.1.0` |

退役方向：会议检索只走 R2R HTTP 接口（`docs/contracts-v0.1.md` C01/C02），不再需要本地
Chroma 目录与 `langchain-chroma` 依赖；`tools.py` 中的 `database_search` 与
`rag_assistant.py` 的工具注册应一并移除。当前状态：**未修改**。

### 6.2 旧 R2R conversation / SSE 聊天入口（`apps/web`）

| 位置 | 内容 |
|---|---|
| `apps/web/src/pages/chat.tsx:57` | `useState<'rag' \| 'rag_agent'>('rag_agent')`，默认走 R2R 自带 agent |
| `apps/web/src/pages/chat.tsx:202-222` | `handleConversationSelect()`；`209` 行 `client.conversations.retrieve(...)` |
| `apps/web/src/pages/chat.tsx:299-306` | 模式选择器，`305` 行 `<SelectItem value="rag_agent">RAG Agent</SelectItem>` |
| `apps/web/src/components/ChatDemo/result.tsx:18-20` | SSE 事件常量 `search_results` / `message` |
| `apps/web/src/components/ChatDemo/result.tsx:184` | `client.conversations.create()` |
| `apps/web/src/components/ChatDemo/result.tsx:218-220` | `graphSearchSettings` 默认 `enabled: true`（旧图检索开关） |
| `apps/web/src/components/ChatDemo/result.tsx:237` | `client.retrieval.agent(...)`（R2R 自带 agent 端点） |
| `apps/web/src/components/ChatDemo/result.tsx:243` | `client.retrieval.rag(...)` |
| `apps/web/src/components/ChatDemo/result.tsx:250-290` | SSE 流解析：`reader.read()`、`\n\n` 切分、`event:` / `data:` 解析 |
| `apps/web/src/components/ChatDemo/result.tsx:357` | `client.conversations.addMessage(...)` |
| `apps/web/src/components/Sidebar.tsx:86` | `client.conversations.list(...)`；`109-129` 的会话历史块已被上游注释 |
| `apps/web/src/components/ChatDemo/answer.tsx:42-78` | 旧 `sources` 解析：`parseVectorSearchSources`（`:42`）/ `parseKGSearchResults`（`:59`） |
| `apps/web/src/pages/api/` | 目前只有 `sentry-example-api.js`，尚无 CopilotKit Runtime 路由（目标见 `docs/web-api-v0.1.md`） |

退役方向：浏览器只走本应用的 Pages Router API（`docs/web-api-v0.1.md`）与 CopilotKit/AG-UI，
不直接持有 R2R conversation 与 SSE 通道。当前状态：**未修改**。

### 6.3 R2R 的第二套 agent / graph 能力及其关闭证据

R2R 自带一套 agent 与知识图谱实现，与本项目的 LangGraph 编排重复：

| 位置 | 内容 |
|---|---|
| `apps/rag/py/core/agent/base.py:42` | `class R2RAgent(Agent, metaclass=CombinedMeta)` |
| `apps/rag/py/core/agent/base.py:351` / `:788` / `:1310` | `R2RStreamingAgent` / `R2RXMLStreamingAgent` / `R2RXMLToolsAgent` |
| `apps/rag/py/core/agent/rag.py:39,115,165,215,269` | RAG agent 混入与各变体 |
| `apps/rag/py/core/agent/research.py:35,478,537,597,652` | research agent 混入与各变体 |
| `apps/rag/py/core/main/api/v3/retrieval_router.py:87-88` | `POST /v3/retrieval/search` |
| `apps/rag/py/core/main/api/v3/retrieval_router.py:240-241` | `POST /v3/retrieval/rag` |
| `apps/rag/py/core/main/api/v3/retrieval_router.py:428-429` | `POST /v3/retrieval/agent`（R2R 自带 agent） |
| `apps/rag/py/core/main/services/graph_service.py` | R2R 知识图谱服务 |
| `apps/rag/py/core/main/services/retrieval_service.py:313` / `:642` | 图检索分支入口（受 `graph_settings.enabled` 控制） |
| `apps/rag/py/core/main/services/retrieval_service.py:746` | 图检索未启用时直接返回空结果 |
| `apps/rag/py/shared/abstractions/search.py:514-517` | `graph_settings: GraphSearchSettings = Field(default_factory=GraphSearchSettings, ...)` |

本项目配置中关闭这套能力的证据：

| 证据 | 位置 |
|---|---|
| 检索请求显式关闭图检索 | `tests/smoke/real_ingest_smoke.py:137-138`（`"graph_settings": {"enabled": False}`） |
| 上游 R2R 自身对 chunk 检索也关闭图检索 | `apps/rag/py/core/main/api/v3/chunks_router.py:86`（`search_settings.graph_settings = GraphSearchSettings(enabled=False)`） |
| 关闭自动实体/关系抽取 | `deployment/r2r/meeting_records.toml.template:42`（`automatic_extraction = false`；上游默认 `apps/rag/py/r2r/r2r.toml:108` 为 `true`） |
| 关闭文档摘要 | `deployment/r2r/meeting_records.toml.template:44`（`skip_document_summary = true`） |
| 只用 simple orchestration | `apps/rag/py/r2r/r2r.toml:125-126`（上游默认已是 `provider = "simple"`，产品模板未覆盖该键） |
| 分块与 embedding 维度收敛 | `deployment/r2r/meeting_records.toml.template:27,33,39-40`（512 维、chunk 800/120；上游默认 `apps/rag/py/r2r/r2r.toml:98,105-106` 为 512 维、1024/512） |
| LangGraph 是唯一编排器 | `apps/agent/langgraph.json` 只注册一张图（`./src/agents/research_assistant.py:research_assistant`）；`apps/agent/src/agents/agents.py:34-64` 的注册表是上游自带的多 agent 集合 |

注意：上表是"配置与注册证据"，不是"R2R 的 agent 代码已被删除"的证据。R2R 的 agent 实现仍在
源码树中并可通过 `/v3/retrieval/agent` 触达；产品侧靠不调用该端点、关闭图检索与自动抽取来避免
重复能力，而不是删改上游代码。

## 7. 已知复核项

- `apps/rag/py/uv.lock` 仍是上游锁文件，其中 `google-genai` 条目仍记 `0.6.0`、
  `specifier = ">=0.6.0,<0.7.0"`（`apps/rag/py/uv.lock:1099-1100`、`:3130`），
  与 P1 改后的 `pyproject.toml` 不一致，需要重锁并纳入提交。
- `apps/rag/py/pyproject.toml:62` 的 `mistralai>=1.5.2` 没有上界，
  `uv` 曾解析到 `3.3.0`（`logs/r2r-install.log:149`）；当前 venv 固定为 `1.5.2`，
  但该固定只存在于环境层，未写进依赖声明，重建环境会重现问题。
- CopilotKit 与 Ragas 示例尚未复制进产品目录，复制时必须带上各自的 `LICENSE`
  （Ragas 的 `examples/LICENSE` 是独立文件，与根目录 Apache-2.0 并列）。
- 三个上游的引入提交号目前只记录在本文档与 `.run/scripts/` 中，`apps/*` 内没有 `.git`，
  因此无法在工作区用 `git log` 自证来源；建议在正式提交前补一份 `apps/*/UPSTREAM.md`
  或在首次提交信息中记录 SHA。
- 重排模型（FlashRank）的权重许可、中文效果与预算仍未验证。
