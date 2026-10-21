# 模块详细设计

下列目标均为待实现。各模块在既有代码中二次开发；必要私有辅助文件可拆出，但不能形成新服务或重复状态库。共享契约见 [interfaces.md](../contracts/interfaces.md)。

## M1 登录、身份与服务入口

- **来源**：R2R-Application `src/context/UserContext.tsx`、既有登录流程；agent-service-toolkit 的 `src/service/agui.py`、`service.py` 和 `schema/schema.py`；CopilotKit 官方 Runtime 示例。
- **输入/输出**：本地账号登录结果 → 经校验的 Web 会话；浏览器请求 → 带绑定账号和内部凭据的上游请求。
- **修改**：保留单账号登录，隐藏/关闭注册；将文档、历史和 Runtime 请求经受限同源入口；为线程、项目和文档增加所有权核对；Agent 禁止任意 configurable 和状态注入。
- **位置**：Web `src/pages/api/`、`src/context/UserContext.tsx`；Agent 上述服务文件。全局 Web 装配文件和包依赖只有集成负责人写。
- **失败**：登录失效、伪造 ID、未知代理路径立即拒绝，不转发任意 URL；日志不输出 Key/原文。
- **验证**：未登录入口、改 user_id/thread ID、越项目 document ID、注册路径和服务端凭据泄漏检查；对应 A03、A16、A19。

## M2 项目、会议列表与导入界面

- **来源**：R2R-Application collection/document 页面、DocumentsTable、UploadDialog、`ChatDemo/upload.tsx`。
- **输入/输出**：文件与会议信息 → C01 上传；R2R 状态 → 待提交/处理中/可查询/失败/待确认；选择会议 → C02。
- **修改**：复用 collection 表示项目；必填标题、会议日期、记录类型；显示真实阶段；上传/重试/删除后让旧缓存失效，刷新重读服务器。
- **位置**：`apps/web/src/pages/documents.tsx`、collection 页面、既有上传与列表组件。若固定版本的具体路径不同，先记录实际对应位置，不新建第二套文档页。
- **失败**：空文件、非 UTF-8、缺字段在调用模型前拒绝；请求超时显示状态待确认；ID 由服务端核对，前端预查不是并发锁。
- **验证**：重复提交、同名异内容、同文跨项目、刷新处理中列表、不可用会议不能加入查询；A01、A02、A14。

## M3 入库、分块与删除

- **来源**：R2R `py/core/main/api/v3/documents_router.py`、`services/ingestion_service.py`、`management_service.py`、`providers/file/postgres.py`、现有解析器及配置。
- **输入/输出**：C01 → 原件、文档、分块、向量与归属；删除 ID → C07 清理结果。
- **修改**：采用文件入口及 simple orchestration，关闭生成摘要/自动抽取/分块扩写；映射会议字段到必要 chunk metadata；校准双字段 collection；修复删除主链对既有文件清理的调用。
- **状态**：R2R 是权威。没有新的 ingestion_jobs 表。非终态在重启后不能凭时间直接当成失败；按既有清理流程判断与处理。
- **失败**：embedding、解析、归属或清理部分失败需要可观察；只有实际条件满足才显示就绪。重复调用不得删除其他文档或覆盖原文。
- **验证**：原文件摘要、所有 chunk 身份与归属、分页、重复/失败重试、删除后下载和检索不可用；A01、A02、A03、A13。

## M4 范围内检索与原文工具

- **来源**：agent-service-toolkit `src/agents/tools.py` 的 `database_search` 和 ToolNode；LangChain `FlashrankRerank`、FlashRank；R2R 检索与 chunks API。
- **输入/输出**：问题+C02 → C03 EvidenceChunk；完整读取 → 文档覆盖情况。
- **修改**：替换 Chroma 示例检索运行依赖为 R2R HTTP；封装既有分页接口、范围过滤和有限网络重试；向量召回后重排，保留 metadata；补读相邻片段仍受同一范围限制。
- **边界**：不安装 R2R SDK 到 Agent 环境；不向模型暴露任意 URL、SQL 或过滤表达式；不实现自己的向量索引和重排算法。
- **失败**：服务失败是工具失败，不能返回空列表冒充无证据；每页身份核对，不假设一页就是全文。
- **验证**：同文不同来源、重排改变顺序、响应越界、分页失败、全文覆盖清单；A03、A09、A15。

## M5 会议 Agent 与决定核对

- **来源**：`src/agents/rag_assistant.py` 的 MessagesState、现有 model/ToolNode 图、LangGraph interrupt/resume 和结构化输出。
- **输入/输出**：已验证问题与范围 → 澄清或 C04 AnswerRecord。
- **修改**：扩展状态为 scope/snapshot/intent/sources/meeting_findings/coverage/answer_records；每轮清空临时证据；事实检索与完整决定核对分支共用一个图。决定分支按会议时间分页读完所选记录，逐场提取证据后归并。
- **规则**：提议不等于确认；重提方案不等于替代；分配责任不等于完成；未记原因不补原因；同日顺序未知时保留冲突；上传顺序不裁定事实先后。
- **生成与提交**：模型只能引用给定 key；检查精确片段、范围可用性、覆盖与结构；最多一次输出修复；经检查后保存完成状态，失败则给可理解原因。
- **验证**：三次会议“提议 A—确认 B—再次提议 A”、明确 B 改 C、同日冲突、超预算、来源在运行中删除、恶意原文；A04–A08、A11、A15–A17。

## M6 会话、范围与历史恢复

- **来源**：agent-service-toolkit `src/memory/postgres.py`、`src/service/service.py`、`src/schema/schema.py` 和 LangGraph saver。
- **输入/输出**：图状态 → agent_db checkpoint；历史请求 → 消息、范围和 AnswerRecord。
- **修改**：扩展现有 ChatHistory 序列化，保存稳定引用编号与来源映射；线程列表仅返回当前绑定账号；范围切换按产品规则开新会话。
- **边界**：不另建聊天表、不调用 R2R conversation 保存第二份历史；未完成轮次不得通过刷新变成完成。
- **删除影响**：旧文本保留，点击来源重新核验当前状态；新轮次不能从旧证据继承事实。
- **验证**：正常停启、刷新引用、澄清后继续、断线后查看状态、旧来源删除；A10–A14。

## M7 聊天、进度与引用界面

- **来源**：R2R-Application `ChatDemo/answer.tsx`、`result.tsx`、SearchResults、`utils/documentDialogInfo.tsx`；CopilotKit headless-chat 官方示例。
- **输入/输出**：AG-UI 事件+C04/C06 → 进度、回答、引用、历史与来源区域。
- **修改**：Pages Router 内接入 Runtime；会议范围/问答/原文布局；数字引用绑定稳定映射；按 order 分页定位后核对 chunk ID；保留相邻块边界；完整文件通过下载入口查看。
- **切换**：退出旧 R2R conversation 和手工 SSE 聊天链路。最终答案来源为同一个 Agent，不出现“列表走新服务、聊天走旧服务”。
- **失败**：未完成显示生成中/中断；删除后显示来源失效；引用渲染不能执行模型 HTML；窄屏和键盘可打开来源。
- **验证**：流式期间刷新、最后检查失败、同文不同来源、跨页来源、窄屏和键盘、历史重开；A09–A12、A16。

## M8 数据集、评测与追踪

- **来源**：Ragas `examples/rag_eval`、`agent_evals` 及既有 SDK 集成；LangSmith 使用上游集成入口且默认关闭。
- **输入/输出**：模拟会议、问题、标准证据、版本配置 → 每题结果、指标、错误案例和成本。
- **修改**：扩展示例的数据加载与输出映射，加入决定/冲突/缺失标签；使用同一冻结集合比较三种检索核对策略。协议与运行失败单独统计，不纳入“正确拒答”。
- **边界**：不另建评测平台，不自动用被测模型回答当标准答案；人工核对模拟材料与预期证据。外部 trace 默认关，开关及出站数据说明明确。
- **验证**：见 [evaluation.md](../acceptance/evaluation.md)；A23 必须包含可复跑命令、模型配置、真实逐题结果及未通过项。

## M9 部署、依赖与交付

- **来源**：三个上游的 Dockerfile/Compose、迁移、配置、测试及启动脚本。
- **输入/输出**：无密钥模板+本地配置 → 可启动服务、持久卷、可复跑命令。
- **修改**：裁剪服务依赖；R2R 与 Agent 分离环境；一个 PostgreSQL 实例启用所需 pgvector；两个数据库/账号；先迁移再就绪；健康检查不反复付费调用模型。
- **依赖**：优先固定基线，仅做有证据的兼容补丁。保留 lock 文件、构建信息和上游许可；不能通过删功能、禁测试或无限放宽版本解决构建。
- **验证**：全新安装、仅 loopback 可达、停止保数据、备份恢复演练、清晰卸载说明；A18–A20、A24。

## 跨模块修改流程

接口和共享类型由 T003 固定。后续发现需要兼容性变化时，提出差异、影响消费者和验证，交集成负责人更新同一契约并安排依赖方；不能各分支私改。纯粹实现 bug 由原模块负责人修复，集成者记录复测结果。
