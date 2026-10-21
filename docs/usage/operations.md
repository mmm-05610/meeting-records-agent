# 运行、备份与恢复操作（v0.1）

## 服务与端口（native 模式）

| 服务 | 地址 | 说明 |
|---|---|---|
| web | 127.0.0.1:3000 | 唯一对外入口（loopback） |
| agent | 127.0.0.1:8080 | LangGraph / AG-UI 服务 |
| rag (R2R) | 127.0.0.1:7272 | 文档/检索 HTTP 服务 |
| model-gateway | 127.0.0.1:8081 | embedding（本地 ONNX）+ 生成代理 |
| postgres | 127.0.0.1:55432 | `rag_db` + `agent_db` |

PID 文件：`.run/pids/*.pid`；日志：`logs/*.log`。

## 常用命令

```bash
bash scripts/native/service.sh status
bash scripts/native/service.sh stop web        # 停止某个服务
bash scripts/native/service.sh stop agent
bash scripts/native/service.sh start agent bash scripts/native/start-agent.sh
```

## 备份

```bash
mkdir -p backups
source scripts/native/pg-env.sh
pg_dump -h 127.0.0.1 -p 55432 -U postgres -d rag_db   -Fc -f backups/rag_db-$(date +%F).dump
pg_dump -h 127.0.0.1 -p 55432 -U postgres -d agent_db -Fc -f backups/agent_db-$(date +%F).dump
```

`rag_db` 包含原件（PostgreSQL large objects）、文档/分块/向量（schema `meeting_records_agent`）；
`agent_db` 包含 LangGraph checkpoint（对话、范围快照、AnswerRecord）。

## 恢复演练（隔离资源）

```bash
createdb -h 127.0.0.1 -p 55432 -U postgres rag_restore
pg_restore -h 127.0.0.1 -p 55432 -U postgres -d rag_restore backups/rag_db-YYYY-MM-DD.dump
psql -h 127.0.0.1 -p 55432 -U postgres -d rag_restore -c "select count(*) from meeting_records_agent.documents;"
# 验证后删除演练库，避免误用
dropdb -h 127.0.0.1 -p 55432 -U postgres rag_restore
```

真实演练记录见 `docs/evidence/v0.1-acceptance.md` 的 A18 条目。

## 删除数据

- 单份会议：在「会议」页删除（会同时清理分块、向量、原件与文件记录；部分失败会返回失败而不是假成功）。
- 全部数据：停止服务后 `dropdb rag_db && createdb ...`（会丢失所有会议与向量），以及 `agent_db` 的 checkpoint。
- 模型缓存：`.local/hf`、`data/flashrank`，可安全删除，下次运行会重新下载。
