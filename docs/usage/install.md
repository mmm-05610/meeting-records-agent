# 安装与运行（v0.1）

v0.1 是本地单用户产品：一个 Web 入口（只监听 127.0.0.1:3000）、一个 Agent 服务、一个 R2R 文档服务、
一个 PostgreSQL 实例（`rag_db` + `agent_db`）和一个本地模型网关（embedding + 生成代理）。

本仓库提供两种运行方式：

| 方式 | 状态 | 说明 |
|---|---|---|
| **native（本机进程）** | **已实际验证**（2026-10-22，A18/A23 证据即此模式） | 不需要 Docker；PostgreSQL 18 + pgvector 装进仓库 `.local/`，各服务用脚本启动 |
| docker compose | 交付形态，**本机未实跑**（本机无 Docker 守护进程、sudo 需交互密码） | `deployment/docker-compose.yaml`，拓扑与 native 模式一致 |

## 0. 前提

- Linux x86_64，约 10 GB 磁盘、4 GB 内存以上；Python 3.12（uv 可自动下载）、Node.js 22、pnpm。
- 一个可用的 OpenAI 兼容生成端点。本机验证使用 opencode-go 端点（`https://opencode.ai/zen/go/v1`），
  生成模型 `minimax-m3.1-flash-free`，需要 `OPENCODE_GO_API_KEY`。
- embedding 不需要外部服务：模型网关用本地 ONNX 模型 `BAAI/bge-small-zh-v1.5`（512 维），
  首次启动下载约 100 MB；重排用 `BAAI/bge-reranker-base`（首次约 1 GB，缓存于 `.local/`）。

## 1. 配置

```bash
cp .env.example .env            # 填入 OPENCODE_GO_API_KEY 等；.env 已被 .gitignore 忽略
```

关键变量（完整列表见 `.env.example` 与 `apps/web/.env.local.example`）：

| 变量 | 用途 |
|---|---|
| `OPENCODE_GO_API_KEY` | 生成端点密钥（仅服务端使用） |
| `COMPATIBLE_BASE_URL` / `COMPATIBLE_MODEL` | Agent 指向模型网关的地址与模型名 |
| `R2R_ADMIN_EMAIL` / `R2R_ADMIN_PASSWORD` | 本地单账号；R2R 启动时创建管理员 |
| `MRA_SESSION_SECRET` | Web 会话 Cookie 签名密钥（`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`） |
| `POSTGRES_*` / `R2R_POSTGRES_*` | 双库连接（native 默认端口 55432） |

## 2. native 模式（已验证）

```bash
# 2.1 安装 PostgreSQL 18 + pgvector（无需 root，产物在 .local/）
bash scripts/native/install-postgres.sh

# 2.2 初始化集群、双库与角色
bash scripts/native/init-db.sh

# 2.3 Python/Node 依赖（每个应用独立环境）
source scripts/native/uv-env.sh
(cd apps/rag/py && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -e ".[core]")
(cd apps/agent && uv sync --frozen --python 3.12)
(cd apps/web && pnpm install --no-frozen-lockfile)
(cd services/model-gateway && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt)

# 2.4 启动（PID 文件在 .run/pids/，日志在 logs/）
bash scripts/native/service.sh start gateway bash scripts/native/start-gateway.sh
bash scripts/native/service.sh start r2r     bash scripts/native/start-r2r.sh
bash scripts/native/service.sh start agent   bash scripts/native/start-agent.sh
(cd apps/web && node_modules/.bin/next build)   # 首次或前端改动后
bash scripts/native/service.sh start web     bash scripts/native/start-web.sh
bash scripts/native/service.sh status
```

打开 <http://127.0.0.1:3000>，用 `R2R_ADMIN_EMAIL` / `R2R_ADMIN_PASSWORD` 登录。

## 3. 导入演示数据（可选）

```bash
source scripts/native/agent-env.sh
for p in a b c; do
  apps/agent/.venv/bin/python scripts/demo/import_dataset.py \
    --dir evals/datasets/sim-project-$p \
    --collection-name "模拟项目$p"
done
```

（完整命令见 `docs/usage/demo.md`；数据全部为模拟会议，不含真实私人记录。）

## 4. 停止、备份与恢复

```bash
# 停止（保留数据）
bash scripts/native/service.sh stop web
bash scripts/native/service.sh stop agent
bash scripts/native/service.sh stop r2r
bash scripts/native/service.sh stop gateway
bash scripts/native/pg-env.sh && pg_ctl -D "$PGDATA" stop

# 备份（两个数据库分别 dump）
source scripts/native/pg-env.sh
pg_dump -h 127.0.0.1 -p 55432 -U postgres -d rag_db   -Fc -f backups/rag_db.dump
pg_dump -h 127.0.0.1 -p 55432 -U postgres -d agent_db -Fc -f backups/agent_db.dump

# 恢复（先停服务；隔离演练时用新数据目录和不同端口）
createdb -h 127.0.0.1 -p 55432 -U postgres rag_restore
pg_restore -h 127.0.0.1 -p 55432 -U postgres -d rag_restore backups/rag_db.dump
```

`pgvector` 索引与 R2R schema（`meeting_records_agent`）随 `rag_db` 一起备份；Agent 的 checkpoint 在 `agent_db`。

## 5. 容器部署（docker compose / podman-compose）

```bash
cp deployment/env/local.env.example deployment/env/local.env   # 填入密码与密钥
docker compose -f deployment/docker-compose.yaml --env-file deployment/env/local.env up -d --build
# 或
podman-compose -f deployment/docker-compose.yaml --env-file deployment/env/local.env up -d --build
```

只有 web 发布到 `127.0.0.1:3000`（可用 `WEB_PORT` 覆盖）；R2R、Agent、PostgreSQL、模型网关都在内部网络。
v0.1.1 修复：网关在容器内绑定 `0.0.0.0`；数据库初始化脚本用环境变量设置两个应用角色密码；
R2R 配置由 `deployment/r2r/render-config.py` 在启动时从模板渲染；五个服务都有健康检查；
Web 镜像不再打包本地 `.env*`（`.dockerignore`）。

完整容器验证记录见 [deployment-verification](../evidence/deployment-verification.md)。
**本机没有 Docker 守护进程**：数据库初始化与模型网关已用 rootless podman 实测通过；
R2R/Agent/Web 三个镜像的构建因磁盘余量与容器网络限制未实跑，因此整套 compose 的
“从空 volume 安装→导入→问答→重启恢复”**仍属未验证**（A18 的通过证据来自 native 全新安装）。

## 6. 已知限制

- 单账号本地登录，无注册入口；团队共享、ASR、自动入会、任务派发不在 v0.1 范围。
- 生成端点依赖外部服务；限流/欠费时界面显示真实失败（`service_failure`），不会伪装成“无证据”。
- 决定类问题需要读完所选范围全部会议；超预算时明确中止并要求缩小范围，不会退化为 top-k。
- 重排默认使用 `BAAI/bge-reranker-base`；上游 FlashRank 多语言模型在中文片段上实测排序不可靠
  （见 `docs/evidence/evaluation-summary.md`），可通过 `MEETING_RERANK_BACKEND=flashrank` 复现对比。
- 本地 embedding 模型首次运行需要下载；离线环境请预先放置缓存到 `.local/hf`。
