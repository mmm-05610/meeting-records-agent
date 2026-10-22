# CopilotKit Runtime 实际接入记录（v0.1.1）

## 接入方式

- 依赖：`@copilotkit/runtime@1.79.0`（使用其 **v2** 运行时：`CopilotRuntime` +
  `createCopilotRuntimeHandler`；`@copilotkit/runtime/langgraph` 提供 `LangGraphHttpAgent`），
  客户端继续使用官方 `@ag-ui/client`。
- 服务端：`apps/web/src/pages/api/copilotkit/[[...slug]].ts`
  - 先做同源会话认证与 `forwardedProps` 白名单/身份字段拒绝（沿用 v0.1 的安全检查）；
  - 每个请求构造 `new CopilotRuntime({ agents: { 'meeting-assistant': new LangGraphHttpAgent({
    url: agentRunUrl(), headers: { 'x-mra-user': session.uid } }) }, runner: new InMemoryAgentRunner() })`；
  - `createCopilotRuntimeHandler({ runtime, basePath: '/api/copilotkit' })` 处理 AG-UI 请求，
    `[[...slug]]` 路由把请求交给运行时；上游 Agent 仍是本项目 LangGraph 图（`POST /agui/meeting-assistant/run`）。
- 客户端：`apps/web/src/hooks/use-meeting-agent.ts` 的 `AGUI_ENDPOINT` 指向
  `/api/copilotkit/agent/meeting-assistant/run`（v2 运行时的 agent run 路由）。

## 真实调用链证据

1. 浏览器（真实 Chrome）完整问答：请求 `POST /api/copilotkit/agent/meeting-assistant/run` 返回
   `200 text/event-stream`，事件含 `RUN_STARTED` / `STATE_SNAPSHOT` / `RUN_FINISHED`；
   页面渲染“事实检索 · 已完成”、编号引用与可展开来源（截图 `v011-chat-answer.png`）。
2. Web 服务日志出现 CopilotKit Runtime 初始化日志：
   `[CopilotKit Runtime] telemetry enabled …`（v0.1.1 已设置 `COPILOTKIT_TELEMETRY_DISABLED=true`，
   本机不再外发遥测）。
3. 历史恢复接口仍由同一运行时链路产生 AnswerRecord（`history-browser.json` 6/6）。

## 边界与未使用的能力

- 未使用 CopilotKit 的前端组件库/工具协商/A2UI 等特性：产品前端沿用既有 Radix + 自写 AG-UI 事件消费；
  运行时只承担协议处理与 agent 调用，符合“复用官方 Runtime、不新写聊天框架”的要求。
- `@copilotkit/runtime` v1 的 Pages Router 端点未使用（已 deprecated）；采用 v2 + 官方 AG-UI 客户端。
- 运行时按请求实例化，避免跨账号共享 agent/identity。
