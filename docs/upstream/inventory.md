# 引入清单与规模

本文件记录三个上游引入目录的规模、构建与测试入口、`.git` 处理方式，以及密钥文件的实际状态。
所有数字来自本地只读命令（`du -sh`、`find -type f | wc -l`、`git check-ignore`、`ls`），
测量日期 2026-10-22。

配套文档：[../upstream.md](../upstream.md)、[patches.md](patches.md)、[licenses.md](licenses.md)。

## 1. 目录规模

| 目录 | 来源 | 含依赖目录 | 不含依赖目录 | 文件数（不含依赖目录） | 目录数（不含依赖目录） |
|---|---|---|---|---|---|
| `apps/agent/` | agent-service-toolkit | 1.1G | 2.7M | 136 | 43 |
| `apps/rag/` | R2R | 601M | 23M | 745 | 178 |
| `apps/web/` | R2R-Application | 1.3G | 3.5M | 180 | 30 |

说明：

- "含依赖目录"把 `.venv/`、`node_modules/` 一并计入，代表磁盘占用；
  "不含依赖目录"（`du -sh --exclude=node_modules --exclude=.venv`）代表源码规模。
- 依赖目录明细：`apps/agent/.venv` 1.1G、`apps/rag/py/.venv` 566M、`apps/web/node_modules` 1.3G、
  `services/model-gateway/.venv` 161M。
- 文件数由 `find <dir> -type f -not -path "*/node_modules/*" -not -path "*/.venv/*" | wc -l` 得出。
- `apps/rag` 最大是因为 R2R 同时包含 `py/`（Python 包）、`js/`、`docs/`、`llms.txt`（339K）等内容。
- 本地参考目录：`upstream/reference/copilotkit-example` 8.9M（含 5.0M `.git`）、
  `upstream/reference/ragas-examples` 1.2M（含 452K `.git`）、`upstream/tmp` 4.0K。

复现命令：

```bash
for d in apps/agent apps/rag apps/web; do
  du -sh --exclude=node_modules --exclude=.venv "$d"
  find "$d" -type f -not -path "*/node_modules/*" -not -path "*/.venv/*" | wc -l
done
```

## 2. 入口文件定位

### 2.1 `apps/agent`（agent-service-toolkit）

| 用途 | 路径 | 说明 |
|---|---|---|
| 依赖与元数据 | `apps/agent/pyproject.toml` | `name = "agent-service-toolkit"`，`requires-python = ">=3.12,<3.15"` |
| 依赖锁 | `apps/agent/uv.lock` | 1.0M，uv 解析结果 |
| LangGraph 图注册 | `apps/agent/langgraph.json` | 只注册一张图：`./src/agents/research_assistant.py:research_assistant` |
| 服务入口 | `apps/agent/src/run_service.py`、`src/run_client.py`、`src/run_agent.py`、`src/streamlit_app.py` | FastAPI 服务与客户端 |
| 业务模块 | `apps/agent/src/agents/`、`src/service/`、`src/memory/`、`src/schema/` | Agent 图、AG-UI 端点、checkpoint saver、契约 schema |
| 测试 | `apps/agent/tests/` | 上游自带 pytest 用例 |
| 环境 | `apps/agent/.venv/` | 已安装，含 `chromadb 1.5.9`、`langchain_chroma 1.1.0` |

产品新增文件：`apps/agent/src/schema/meeting.py`（C01–C08 契约的 Python 实现）、
`apps/agent/src/service/agui.py`（上游已有 AG-UI 端点，未改）。

### 2.2 `apps/rag`（R2R）

| 用途 | 路径 | 说明 |
|---|---|---|
| 依赖与元数据 | `apps/rag/py/pyproject.toml` | `name = "r2r"`，`version = "3.6.6"`，`license = {text = "MIT"}` |
| 依赖锁 | `apps/rag/py/uv.lock` | 上游锁文件，尚未按 P1 重锁 |
| 控制台脚本 | `apps/rag/py/pyproject.toml:122-123` | `r2r-serve = "r2r.serve:run_server"` |
| 服务入口 | `apps/rag/py/r2r/serve.py` | 读取 `R2R_CONFIG_PATH` 渲染后的配置 |
| 实现布局 | `apps/rag/py/core/`、`apps/rag/py/shared/`、`apps/rag/py/sdk/` | R2R 3.x 布局：实现在 `core/`，`r2r/` 只是薄包（`__init__.py`、`mcp.py`、`r2r.toml`、`serve.py`） |
| API 路由 | `apps/rag/py/core/main/api/v3/` | `documents_router.py`、`retrieval_router.py`、`chunks_router.py` 等 |
| 服务层 | `apps/rag/py/core/main/services/` | `retrieval_service.py`、`ingestion_service.py`、`management_service.py`、`graph_service.py`、`auth_service.py` |
| 内置 agent | `apps/rag/py/core/agent/` | `base.py`、`rag.py`、`research.py` |
| 配置 | `apps/rag/py/r2r/r2r.toml` | 上游默认值，未编辑 |
| 测试 | `apps/rag/py/tests/` | 上游自带 pytest 用例 |
| 迁移 | `apps/rag/py/migrations/` | 数据库迁移 |
| 环境 | `apps/rag/py/.venv/` | 已安装 `r2r 3.6.6`、`google_genai 1.2.0`、`mistralai 1.5.2` |

产品配置：`deployment/r2r/meeting_records.toml.template`，
由 `scripts/native/start-r2r.sh` 用 `envsubst` 渲染到 `.run/r2r/meeting_records.toml`。

### 2.3 `apps/web`（R2R-Application）

| 用途 | 路径 | 说明 |
|---|---|---|
| 包与脚本 | `apps/web/package.json` | `name = "r2r-dashboard"`，`version = "1.0.4"`，`license = "MIT"` |
| 脚本 | `apps/web/package.json:6-12` | `dev`（`next dev -p 3005`）、`build`、`start`、`lint`、`format` |
| 依赖锁 | `apps/web/pnpm-lock.yaml` | 375K |
| 包管理配置 | `apps/web/pnpm-workspace.yaml` | P3 新增内容所在 |
| 构建配置 | `apps/web/next.config.js`、`tailwind.config.js`、`postcss.config.js`、`tsconfig.json` | Next.js 14.2.5，Pages Router |
| 页面入口 | `apps/web/src/pages/` | `_app.tsx`、`index.tsx`、`chat.tsx`、`documents.tsx`、`collections.tsx`、`search.tsx`、`settings.tsx`、`users.tsx`、`account.tsx`、`analytics.tsx` |
| API 路由 | `apps/web/src/pages/api/` | 目前只有 `sentry-example-api.js` |
| 组件 | `apps/web/src/components/` | `ChatDemo/`（上传、回答、原文、结果流）、`SearchResults/`、`Layout/`、`Sidebar.tsx` 等 |
| 上下文 | `apps/web/src/context/UserContext.tsx` | R2R 客户端与登录态 |
| 依赖 | `apps/web/node_modules/` | 已安装 |

产品新增文件：`apps/web/src/types/meeting-contracts.ts`（TS 契约镜像）、
`apps/web/src/server/meeting-identity.ts`（服务端身份/摘要助手）。

### 2.4 产品自有服务

| 用途 | 路径 |
|---|---|
| 模型网关 | `services/model-gateway/gateway.py`、`services/model-gateway/requirements.txt` |
| 部署配置 | `deployment/r2r/meeting_records.toml.template`、`deployment/r2r/user_tools/`（空目录） |
| 原生栈脚本 | `scripts/native/`（`init-db.sh`、`install-postgres.sh`、`pg-env.sh`、`service.sh`、`start-gateway.sh`、`start-r2r.sh`） |
| 契约测试 | `tests/contracts/test_contracts.py`、`tests/contracts/contracts.test.ts`、`tests/contracts/fixtures/meeting_contract_vectors.json` |
| 真实链路 smoke | `tests/smoke/real_ingest_smoke.py` |

## 3. `.git` 删除说明

- 引入方式为 `git init` + `git fetch --depth 1 <sha>` + `git checkout FETCH_HEAD`
  （脚本 `.run/scripts/clone_upstreams.sh:8-11`），每个目标目录都会产生一个 `.git`。
- 引入完成后删除了 `apps/agent/.git`、`apps/rag/.git`、`apps/web/.git`。
- **原因**：父仓库不能包含 embedded repo。若保留嵌套 `.git`，Git 会把子目录识别为独立仓库，
  既不跟踪其内容，又会在 `git add` 时报 "adding embedded git repository" 警告，
  子目录里的文件也就无法作为本仓库内容提交。
- **核对命令与结果**：
  ```bash
  find apps -name ".git" -not -path "*/node_modules/*" -not -path "*/.venv/*"
  # 无输出
  ```
  目录内保留的 `.gitignore`、`.github`、`.gitattributes` 是普通文件，不是仓库元数据。
- **后果**：工作区无法用 `git log` 自证上游来源，上游提交号以
  [../upstream.md](../upstream.md#1-固定来源) 与 `.run/scripts/clone_upstreams.sh` 为准。
  两个参考示例（`upstream/reference/*`）保留了 `.git`（各 5.0M / 452K），
  因为它们本身就是独立克隆，不属于父仓库跟踪范围（整个 `upstream/` 被 `.gitignore:62` 忽略）。

## 4. `.env` 与密钥

### 4.1 仓库中提交的文件不含密钥

父仓库在记录时刻跟踪的文件只有 10 个（`git ls-files`）：
`.gitattributes`、`.gitignore`、`README.md`、`docs/assets/*.svg`（4 个）、`docs/design-v0.1.md`、
`docs/upstream.md`、`upstream-lock.yaml`。其中没有 `.env`，也没有任何凭据文件。
（工作区尚有未提交改动，其他并行任务也在写入，正式提交时需重新核对一次 `git ls-files`。）

### 4.2 `.env` 被忽略，不会进入提交

| 文件 | 忽略来源 | 核对命令 |
|---|---|---|
| `.env`（仓库根） | `.gitignore:2` 的 `.env` | `git check-ignore -v .env` → `.gitignore:2:.env	.env` |
| `apps/agent/.env` | `apps/agent/.gitignore:142` | `git check-ignore -v apps/agent/.env` |
| `apps/web/.env*` | `apps/web/.gitignore:2` | `git check-ignore -v apps/web/.env` |

- 工作区的根 `.env` **确实包含本地运行凭据**（opencode-go 上游 API key、本地 PostgreSQL 密码、
  R2R 管理员邮箱与口令、模型网关地址）。这些值只存在于被忽略的工作区文件里，
  本文档、提交内容与任何交付物都不复制它们。
- 渲染后的 R2R 运行配置 `.run/r2r/meeting_records.toml` 同样含本地口令，
  它位于被忽略的 `/.run/` 下，由 `scripts/native/start-r2r.sh` 在启动时从模板渲染。
- 模板本身使用占位符：`deployment/r2r/meeting_records.toml.template:17-18` 为
  `${R2R_ADMIN_EMAIL}` / `${R2R_ADMIN_PASSWORD}`。
- 上游自带的 `.env.example` 是占位模板，可安全提交：
  `apps/agent/.env.example`、`apps/rag/.env.example`、
  `upstream/reference/copilotkit-example/examples/integrations/langgraph-fastapi/.env.example`。

### 4.3 其他被忽略的敏感或大体积路径

`.gitignore` 中与本项目相关的忽略项：

| 路径 | 作用 |
|---|---|
| `/.run/` | 调度与运行回执、渲染后的 R2R 配置、PID 文件 |
| `/upstream/` | 本地参考示例与临时目录 |
| `/.local/`、`/.pnpm-store/` | 本地工具链与 pnpm 缓存 |
| `/services/model-gateway/.venv/` | 网关虚拟环境 |
| `/data/`、`/logs/`、`/uploads/`、`/backups/` | 运行数据与日志 |
| `.env`、`.env.*`（`!.env.example`） | 本地凭据 |

`.gitignore` 中有一条注释 `Keep dependency lock files tracked once implementation begins.`
（`.gitignore:55`），即锁文件（`apps/agent/uv.lock`、`apps/rag/py/uv.lock`、`apps/web/pnpm-lock.yaml`）
应当纳入提交；它们目前仍处于未跟踪状态。

## 5. 参考示例的本地状态

| 目录 | 上游 | 固定提交 | 工作区状态 |
|---|---|---|---|
| `upstream/reference/copilotkit-example` | CopilotKit | `abc6807f35865e043c498398e3080f137ddbdad9` | shallow clone（`git rev-list --count HEAD` = 1），sparse checkout `examples/integrations/langgraph-fastapi` |
| `upstream/reference/ragas-examples` | Ragas | `298b68274234c060deacab3cf5fb52aa3a20e885` | shallow clone（1 个提交），sparse checkout `examples` |

核对命令：

```bash
git -C upstream/reference/copilotkit-example rev-parse HEAD
git -C upstream/reference/ragas-examples rev-parse HEAD
git -C upstream/reference/ragas-examples rev-list --count HEAD
```

两个目录都在 `.gitignore` 的 `/upstream/` 范围内，不进入提交。
CopilotKit 示例的实际可读内容位于
`upstream/reference/copilotkit-example/examples/integrations/langgraph-fastapi/`（Next.js App Router 版，
含 `src/app/api/copilotkit/[[...slug]]/route.ts`、`src/components/headless-chat.tsx`、
`agent/src/agent.py`、自带 `LICENSE`）；Ragas 示例位于
`upstream/reference/ragas-examples/examples/`（含 `ragas_examples/`、`iterate_prompt/`、自带 `LICENSE`）。
