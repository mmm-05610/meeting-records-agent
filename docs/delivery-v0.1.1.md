# v0.1.1 交付说明

基线：v0.1（提交 `5a6fdd0` 之后的运行验证）→ v0.1.1（本提交）。仍为本地单账号产品，架构不变。

## 一、改了什么

### 1. 历史会话错配与重复（确定性缺陷）
- 复现：用旧算法（“取下一条 completed 记录”）的夹具证明：后续成功答案会被塞进更早的失败轮次，
  且同一 AnswerRecord 会被取出两次。
- 修复：新增 `apps/web/src/lib/chat-history.ts` 的严格两遍配对——先按 `message_id`，再按“两侧都唯一”的
  精确正文；绝不重复分配记录；无法可靠匹配的旧消息保留自身正文与真实状态（失败/澄清/未完成）。
  旧版本重复写入的同一答案（同文 + 同一记录）折叠为一条，不再重复展示。
- 回归：9 条夹具用例 + 真实会话 `restart-1792632748` 的 API 校验 + 浏览器回归（刷新/切线程/重新登录
  后角色、顺序、正文、状态、引用一致），见 `docs/evidence/history-browser.json`、截图 11/12。

### 2. 第一版体验
- 品牌统一为「会议记录助手」，中文导航（项目 / 会议记录 / 问答，设置收进次级入口），每页独立标题。
- 会议记录页：顶部上传卡片，支持一次多选 TXT/Markdown，逐文件显示上传中/成功/重复已存在/失败与错误。
- 问答页：显示本轮实际范围；回答默认只给正文 + 可点击编号引用，来源、结构化条目、覆盖与诊断字段折叠；
  事实检索与完整会议核对分别标注；澄清为“需要澄清”（蓝色），不再是“未完成”；
  历史会话显示项目名并对同名会话加时间提示；空状态给演示数据对应的示例问题。
- 长回答/长会议名/380px 窄窗口/键盘（Tab→引用、Enter 打开、Esc 关闭）已检查。

### 3. 安装与容器
- 修复：网关容器绑定（`GATEWAY_HOST`）、数据库初始化角色密码、R2R 配置模板渲染与挂载、健康检查、
  环境变量与默认模型统一、Web 构建上下文排除 `.env*`。
- 验证：rootless podman 实测数据库初始化（角色/密码/双库/扩展）与模型网关容器
  （`0.0.0.0` 监听、embeddings、chat 代理）。整套 compose 因无 Docker 守护进程 + 磁盘余量不足未实跑，
  明确记为“容器实测受阻”。

### 4. 技术栈实际接入
- **CopilotKit Runtime**：`/api/copilotkit` 改为官方 `@copilotkit/runtime` v2 的
  `CopilotRuntime + createCopilotRuntimeHandler`，每请求构造 `LangGraphHttpAgent` 并注入服务器确认的
  `x-mra-user`；前端 `@ag-ui/client` 指向 `/api/copilotkit/agent/meeting-assistant/run`。
  真实浏览器闭环已验证（回答、引用、历史恢复均经该运行时）。
- **Ragas**：新增 `evals/run_ragas.py`，使用官方 `evaluate` 链、本地网关判分模型与 embedding，
  对部分冻结题实际运行并输出逐题分数与限制；与规则评测分开报告，不混为“准确率”。
- **模型网关**：保留薄适配（必需）——opencode-go 需要注入 `x-opencode-session` 且不提供 embedding；
  网关只做 header/CORS/用量记录与本地 embedding，不含业务逻辑；源码与边界见 `services/model-gateway`。
- **重排**：默认 `BAAI/bge-reranker-base`（中文实测优于上游 FlashRank 多语言模型），`flashrank` 保留为可切换后端；
  配置、来源记录、评测说明已统一。

### 5. 评测与验收口径
- 保留 v0.1 冻结题集与历史结果；新增 v0.1.1 版本化结果（B0/B1/B2 × 24 冻结题）。
- 报告拆分：任务完成率、全量题目分母（失败保留）、成功题分母；关键词命中、引用可解析、
  原文逐字一致、语义支持（Ragas 辅助 + 人工复核样例）分别描述。
- 新增 `evals/verify_sources.py`：逐条核对引用 document 归属与 quote 是否逐字出现在模拟原文中。
- 验收表按 PASS / PASS(有限制) / FAIL / BLOCKED / UNVERIFIED 重写，修正旧证据路径。

## 上游复用清单（实际接入）

| 组件 | 版本/来源 | 许可证 | 本项目用途与修改范围 |
|---|---|---|---|
| agent-service-toolkit | `0eb5820a…` | MIT | Agent 服务骨架（FastAPI/LangGraph/AG-UI）；新增 `meeting_assistant.py`、`r2r_client.py`、`meeting_tools.py`，扩展 schema/service/agui |
| R2R | `9c5a94d1…` (3.6.6) | MIT | 文档/分块/向量/检索；补丁：删除同步清理 file provider（P9）、pyproject 依赖约束（P1/P2）、配置裁剪 |
| R2R-Application | `c4612ab4…` | MIT | Web 骨架与 Radix/Tailwind 组件；新增同源 API、会议/聊天 UI，退役旧 SSE 聊天/搜索页 |
| CopilotKit Runtime | `1.79.0`（v2 API） | MIT | 官方 Runtime 接入 `/api/copilotkit`（`CopilotRuntime` + `createCopilotRuntimeHandler` + `LangGraphHttpAgent`）；不引入其前端组件 |
| @ag-ui/client/core | 随 CopilotKit 依赖 | MIT | 官方 AG-UI 客户端，消费 Runtime 的 SSE 事件 |
| Ragas | 0.4.3 | Apache-2.0 | 辅助语义评测（`evaluate` + 本地网关判分模型/embedding）；规则评测仍是主口径 |
| LangChain FlashrankRerank / FlashRank | `0.2.10` | MIT / Apache-2.0 | 保留为可切换重排后端；实测后默认改用 FastEmbed `bge-reranker-base`（中文效果） |
| FastEmbed（BAAI 模型） | `0.5.1` / bge-small-zh、bge-reranker-base | Apache-2.0（FastEmbed）/ MIT（BAAI 模型） | 本地 embedding 与重排，无外部调用 |

模型网关替代性审查：可考虑的成熟组件是 LiteLLM Proxy（可代理生成并注入部分 header）与 Ollama（可提供本地
embedding）。本项目仍需：(1) 向 opencode-go 注入官方要求的 `x-opencode-session` 并保留单一密钥边界；
(2) 同时暴露 OpenAI 兼容的本地 embedding 端点；(3) 记录请求用量供评测核算。LiteLLM Proxy 与 Ollama
分别只覆盖其中一部分，组合起来会引入两套额外服务；因此保留约 200 行、无业务逻辑的薄网关，并在
评测中记录其调用量。若后续迁移到具备统一 OpenAI 兼容入口的供应商，可直接替换该薄层。

## 二、怎么验证

```bash
# 契约与历史配对
PYTHONPATH=apps/agent/src apps/agent/.venv/bin/python -m pytest tests/contracts -q
apps/web/node_modules/.bin/tsx tests/e2e/history-pairing.test.ts
apps/web/node_modules/.bin/tsx tests/contracts/contracts.test.ts

# 真实链路（服务已在本机运行）
apps/agent/.venv/bin/python tests/e2e/api_boundaries.py
apps/agent/.venv/bin/python tests/e2e/restart_recovery.py
apps/agent/.venv/bin/python tests/e2e/delete_failure_injection.py
apps/agent/.venv/bin/python tests/e2e/history_live_check.py
cd apps/web && node ../../tests/e2e/history-browser.test.mjs
# 评测
for S in B0 B1 B2; do python3 evals/run_eval.py --engine agui \
  --url http://127.0.0.1:8080/agui/meeting-assistant/run --split frozen --strategy $S \
  --scope-map evals/datasets/scope-map.json --out-dir evals/results --run-id v0.1.1-$S-frozen; done
python3 evals/verify_sources.py --results evals/results/v0.1.1-B2-frozen/per_case.jsonl
.local/tools/venv/bin/python evals/run_ragas.py --results evals/results/v0.1.1-B2-frozen/per_case.jsonl --limit 8
```

## 三、仍然存在的问题（明确列出）

1. 整套容器 Compose 未实跑（无 Docker 守护进程；podman 网络/磁盘限制），只完成了数据库与模型网关的容器级验证。
2. 宿主机挂起期间的调度唤醒未证明（沿用 v0.1 的限制说明）。
3. 决定类问题的 claim 标签粒度仍不完美（评测坏例保留）；关键词命中不等于语义准确。
4. 旧版本（账号绑定之前）的线程仍无法恢复历史，界面会提示并新建会话。
5. 外部生成服务偶发失败（评测中出现个别 service_failure），按真实失败展示。
6. 未做多用户/团队权限、ASR、自动入会、任务派发。

## 四、启动体验

1. `bash scripts/native/service.sh status` 确认 gateway/r2r/agent/web 运行（本机已启动）。
2. 浏览器打开 <http://127.0.0.1:3000>，用 `owner@meeting-records.local` + `.env` 中密码登录。
3. 「会议记录」→ 选择 `模拟项目A：星河笔记` → 可一次选多个文件上传，观察逐文件结果。
4. 「问答」→ 选项目与范围 → 点示例问题或输入问题 → 查看正文与引用，点击 `[1]` 核对原文；
   展开「查看来源 / 查看核对详情」看来源与结构化条目；刷新后历史与引用仍在。
