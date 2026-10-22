# 部署修复与容器验证记录（v0.1.1）

日期：2026-10-22 · 环境：无 Docker 守护进程（`sudo` 需交互密码），使用 rootless **podman 5** +
`podman-compose 1.6.0` 做容器级验证；原生路径继续作为日常运行环境。

## 修复项（对照交付要求三）

| # | 问题 | 修复 | 文件 |
|---|---|---|---|
| D1 | 模型网关容器内只监听 `127.0.0.1`，其他容器无法访问 | 新增 `GATEWAY_HOST`（默认 `127.0.0.1`，Compose 设为 `0.0.0.0`） | `services/model-gateway/gateway.py`、`deployment/docker-compose.yaml` |
| D2 | `init-databases.sql` 建角色但未设置密码 | 改为 `init-databases.sh`：从 `RAG_DB_PASSWORD`/`AGENT_DB_PASSWORD` 创建或更新角色密码 | `deployment/postgres/init-databases.sh` |
| D3 | Compose 指定 `/app/config/meeting_records.toml`，但没有构建或挂载来源 | 新增 `deployment/r2r/render-config.py`，启动时用环境变量渲染模板到 `/app/config/meeting_records.toml` | `deployment/r2r/*`、`deployment/docker-compose.yaml` |
| D4 | Compose / 原生脚本 / 环境模板不一致 | 统一变量名与默认模型（`deepseek-v4.1-flash`）、重排后端/模型、健康检查、隔离用项目名/卷名/端口 | `.env.example`、`deployment/env/local.env.example`、Compose |
| D5 | Web 镜像会把本地 `.env*` 打进构建上下文 | `.dockerignore` 增加 `.env*`（保留 `.env.local.example`） | `apps/web/.dockerignore` |
| D6 | `container_name` 之外的健康检查缺失 | postgres/rag/agent/web/model-gateway 均增加健康检查并用于 `depends_on` | `deployment/docker-compose.yaml` |

## 已实际执行的容器验证（podman，隔离资源）

```bash
# 数据库初始化（空 volume，镜像 pgvector/pgvector:pg16）
podman run -d --name mra-verify-pg --network host \
  -v mra-verify-pgdata:/var/lib/postgresql/data \
  -v $PWD/deployment/postgres/init-databases.sh:/docker-entrypoint-initdb.d/01-init-databases.sh:ro \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=superpw \
  -e RAG_DB_PASSWORD=ragpw -e AGENT_DB_PASSWORD=agentpw \
  docker.io/pgvector/pgvector:pg16
```

结果（容器内 `psql` 实测）：

- 角色：`rag_app|t`、`agent_app|t`（可登录）
- 数据库与属主：`rag_db|rag_app`、`agent_db|agent_app`
- 扩展：`rag_db` 中 `vector`、`pg_trgm` 存在
- 以 `rag_app`/`agent_app` 各自密码经 TCP 登录成功；`pg_hba.conf` 对非 loopback 为 `scram-sha-256`

```bash
podman build -t mra-verify-gateway services/model-gateway   # 347 MB
podman run -d --name mra-verify-gw --network host \
  -e GATEWAY_HOST=0.0.0.0 -e GATEWAY_PORT=8091 \
  -e GATEWAY_UPSTREAM_KEY=$OPENCODE_GO_API_KEY \
  -e GATEWAY_USAGE_LOG=/models/usage.jsonl -e HF_HOME=/models/hf \
  -v mra-verify-models:/models mra-verify-gateway
```

结果：

- `/proc/net/tcp` 中监听地址为 `00000000:1FA9`（`0.0.0.0:8091`）→ 容器网络内可被其他容器访问；
- 对照组不设 `GATEWAY_HOST` 时为 `0100007F:1FA9`（`127.0.0.1`），复现并证明修复了原缺陷；
- 容器内 `/v1/embeddings` 返回 512 维向量（本地 `bge-small-zh-v1.5`）；
- 容器内 `/v1/chat/completions` 经网关代理到 opencode-go 成功（HTTP 200，usage 返回）。

## 未完成/受阻（如实记录）

- **完整 Compose 五服务从空 volume 安装未实跑**。原因：本机没有 Docker 守护进程；rootless podman 的
  netavark 默认网络在只读 `/run/user/1000` 下无法创建，`slirp4netns`/`pasta` 二进制缺失，只能使用 host 网络；
  同时磁盘仅余约 6.8 GB，R2R（需 Rust 工具链与完整 `r2r[core]` 依赖）、Agent（uv 同步）与 Web（pnpm + Next
  构建）三个镜像合计预计超过可用空间，继续构建有填满系统盘的风险。
- 因此 R2R/Agent/Web 容器镜像的构建与整套 Compose 的导入/问答/引用/重启恢复**未实测**，
  不能据此声明容器部署通过；原生路径的同等链路已有 v0.1 的完整证据（A18 等）。
- 已用 `podman-compose config` 校验 Compose 文件在环境变量齐全时可解析、依赖条件与挂载路径正确。
