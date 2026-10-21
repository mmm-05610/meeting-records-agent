# 上游来源与采用方式

本文件记录设计选型，不表示组件已接入。固定提交来自前期源码研究；版本更新、依赖安装和产品功能验收在实施阶段分别记录。

## 组件清单

| 组件 | 选型基线 | 计划采用方式 | 许可记录 |
|---|---|---|---|
| [agent-service-toolkit](https://github.com/JoshuaC215/agent-service-toolkit/tree/0eb5820a1d689743ac834102030f53f4a21dc321) | `0eb5820a1d689743ac834102030f53f4a21dc321` | 分叉到 `apps/agent`，扩展已有 RAG Agent、工具、服务与会话结构 | 根目录 MIT |
| [R2R](https://github.com/SciPhi-AI/R2R/tree/9c5a94d151f90876bd7eb860f300a8fd662dc481) | `9c5a94d151f90876bd7eb860f300a8fd662dc481` | 分叉到 `apps/rag`，保留解析、分块、文件、collection 与检索 API | 根目录 MIT |
| [R2R-Application](https://github.com/SciPhi-AI/R2R-Application/tree/c4612ab48af002d4cd078659d11db88ed61d53b8) | `c4612ab48af002d4cd078659d11db88ed61d53b8` | 分叉到 `apps/web`，改造文档、上传、原文和问答页面 | 根目录 MIT |
| [CopilotKit 示例](https://github.com/CopilotKit/CopilotKit/tree/abc6807f35865e043c498398e3080f137ddbdad9/examples/integrations/langgraph-fastapi) | `abc6807f35865e043c498398e3080f137ddbdad9` | 从官方示例适配 Runtime、headless-chat 和 AG-UI 接口 | 根目录 MIT；复制时核对文件条款 |
| [LangChain Community](https://github.com/langchain-ai/langchain-community) | `langchain-community==0.4.2` | 直接依赖已有 `FlashrankRerank`，不另写重排算法 | MIT |
| [FlashRank](https://github.com/PrithivirajDamodaran/FlashRank) | `FlashRank==0.2.10` | 由重排组件调用，模型另行验证和锁定 | Apache-2.0；权重许可单独核对 |
| [Ragas 示例](https://github.com/vibrantlabsai/ragas/tree/298b68274234c060deacab3cf5fb52aa3a20e885/examples) | `298b68274234c060deacab3cf5fb52aa3a20e885` | 基于 `rag_eval`、`agent_evals` 扩展会议题集与指标 | 根目录 Apache-2.0；examples 另有许可文件，复制时保留并核对 |
| [LangSmith](https://docs.langchain.com/langsmith/home) | 版本待实施时锁定 | 沿用上游 SDK 集成，默认关闭外部追踪 | SDK 与服务条款分别核对 |

## 采用规则

保留上游目录结构、版权声明和适用许可。每次引入或更新记录固定提交、实际复制路径、修改内容及验证结果；库依赖通过所属应用的依赖锁文件管理。`upstream-lock.yaml` 目前只固定研究基线，不能替代安装锁文件或模型权重校验。

在已有应用中调整配置、接口绑定、提示词和业务流程。若上游能力不足，先研究可复用实现，再修改来源清单；不以一个上游项目名称掩盖新写子系统。

三个应用分别管理依赖。Agent 通过 HTTP 使用 R2R，避免把 R2R SDK 与 Agent 安装进同一 Python 环境。R2R 使用 simple orchestration，关闭重复的 Agent、知识图谱、实体抽取与重排链路。

## 已知验证边界

前期局部验证涉及 Agent 接口、AG-UI 通信、PostgreSQL checkpoint 重连和重排元数据。相关夹具与研究环境未随本次仓库初始化发布；这些结果不代表本仓库已经通过产品测试，也不代表中文问答有效。

实施时优先解决：

1. R2R 原依赖约束的解析问题，并验证完整启动、迁移、导入和查询。
2. 上传字段与 metadata 的 collection 归属传递，以及同名文档身份生成。
3. 中文向量召回、重排效果与输入长度预算；不预先声称中文混合检索可用。
4. 页面完整构建、引用定位、AnswerRecord 历史恢复。
5. 删除原文件、文档、分块和旧引用的生命周期一致性。
6. 实际复制文件、示例、模型与前端依赖的许可证和适用性检查。

产品验收以 [设计中的 T01–T18](design-v0.1.md#112-验收用例) 为准，结果在对应实现完成后记录。
