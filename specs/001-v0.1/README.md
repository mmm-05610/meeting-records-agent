# v0.1 实施包

修订：IP-v0.1-r1 · 2026-10-22（北京时间）· 输入：D0.1-r1。

目标：交付一个能在本地安装、导入中文会议记录、跨会议问答、核对引用并恢复历史的第一版。此目录是实施说明，尚未执行其中的产品开发或验收。

本包依据已确认的产品设计展开，保留全部功能模块二次开发、三个应用服务、一个 PostgreSQL 实例的边界。状态为 `CONVERTED_DRAFT`：文档已形成并完成作者自查，不冒充独立评审或产品验收。用户把 [dsh-goal.md](dsh-goal.md) 的 `/goal` 交给执行 Agent 后，以该用户指令启动实施，不需要把本状态误当成必须等待另一次人工盖章的门禁。

## 阅读顺序

1. [baseline.md](baseline.md)：版本、真实起点、实施自由与缺口。
2. [spec.md](spec.md)：第一版行为与边界。
3. [design/architecture.md](design/architecture.md)：部署、调用、状态所有权和目标目录。
4. [contracts/interfaces.md](contracts/interfaces.md)：跨模块契约，先固定再分工。
5. [design/modules.md](design/modules.md)：逐模块来源、修改位置、输入输出和失败处理。
6. [plan.md](plan.md) 与 [tasks.md](tasks.md)：实施顺序、依赖和并行写入分工。
7. [acceptance/checklist.md](acceptance/checklist.md) 与 [acceptance/evaluation.md](acceptance/evaluation.md)：最终验收及证据要求。
8. [operations/resume.md](operations/resume.md)：第一步建立夜间定时恢复检查。
9. [dsh-goal.md](dsh-goal.md)：可直接复制的完整工作目标。

[change-map.md](change-map.md) 提供设计—任务—验收追溯；[review.md](review.md) 记录实施包自查及未验证边界。

## 执行入口

工作目录为本 Git 仓库根目录，能够看到 `README.md`、`upstream-lock.yaml`、`docs/design-v0.1.md` 和本目录。先运行 T001；在依赖获取等初始化之外，必须实际建立并回读确认北京时间 01:30–09:30 每半小时一次的恢复检查。

这里不预设 DeepSeek Harness 的启动命令或调度 API。执行者使用自己实际具备的工具完成调度，不把示意文字当成已创建的任务。本包本身不会启动开发、模型调用或定时任务。

## 可以推进与条件限制

来源获取、依赖兼容修复、契约、组件适配、模拟测试、样本制作和文档可按依赖图推进。真实模型验收需要有效的生成与 embedding 配置；调度验收需要可回读且能在工作会话中断后触发的调度机制。缺少这些条件只阻塞相关验收，不能用替身结果宣称第一版完成。

完成标准是验收表的实际证据，不是代码量、某个时间点或“所有任务都打勾”。09:30 是恢复检查窗口的终点，不是允许降低质量的交付期限。
