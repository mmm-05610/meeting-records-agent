# 许可证核对表

本文件核对引入上游的许可类型、许可文件路径与保留状态，并列出尚未完成的条款核对项。
对应验收项 A20（来源、许可与版本可追溯）。

配套文档：[../upstream.md](../upstream.md)、[patches.md](patches.md)、[inventory.md](inventory.md)。

## 1. 核对表

| # | 上游项目 | 固定提交 | 许可类型 | 版权声明 | 许可文件路径 | 是否保留 | 状态 |
|---|---|---|---|---|---|---|---|
| L1 | agent-service-toolkit | `0eb5820a1d689743ac834102030f53f4a21dc321` | MIT | Copyright (c) 2024 Joshua Carroll | `apps/agent/LICENSE` | 是 | 已核对 |
| L2 | R2R | `9c5a94d151f90876bd7eb860f300a8fd662dc481` | MIT | Copyright (c) 2024 EmergentAGI Inc. | `apps/rag/LICENSE.md` | 是 | 已核对 |
| L3 | R2R-Application | `c4612ab48af002d4cd078659d11db88ed61d53b8` | MIT | Copyright (c) 2021 Acme Co. | `apps/web/LICENSE` | 是 | 已核对 |
| L4 | CopilotKit（含 langgraph-fastapi 示例） | `abc6807f35865e043c498398e3080f137ddbdad9` | MIT | Copyright (c) Atai Barkai | 参考目录内为 `upstream/reference/copilotkit-example/LICENSE` 与 `upstream/reference/copilotkit-example/examples/integrations/langgraph-fastapi/LICENSE` | 待复制 | **未复制进产品目录**，复制时必须带上 MIT 正文 |
| L5 | Ragas | `298b68274234c060deacab3cf5fb52aa3a20e885` | Apache-2.0 | 见 Apache-2.0 正文（无独立版权行） | 参考目录内为 `upstream/reference/ragas-examples/LICENSE` 与 `upstream/reference/ragas-examples/examples/LICENSE` | 待复制 | **未复制进产品目录**；`examples/LICENSE` 是独立文件，见第 3 节 |
| L6 | LangChain Community | 依赖 `langchain-community==0.4.2` | MIT | 由依赖管理 | 无 vendored 副本 | 不适用 | 以锁文件与包元数据为准 |
| L7 | FlashRank | 依赖 `FlashRank==0.2.10` | Apache-2.0 | 由依赖管理 | 无 vendored 副本 | 不适用 | 代码许可已核对；**权重许可未核对**，见第 4 节 |
| L8 | LangSmith | 版本待锁定 | SDK 与服务条款分别适用 | — | — | 不适用 | 默认关闭外部追踪；版本与条款待实施时锁定 |
| L9 | 本项目自身 | — | **未确定** | — | 无 | — | 文档中不声称任何项目许可 |

## 2. 核对方法与命令

```bash
# 1) 三个分叉仓库根目录的许可文件
head -3 apps/rag/LICENSE.md apps/agent/LICENSE apps/web/LICENSE

# 2) R2R 包元数据中的许可声明应与 LICENSE.md 一致
grep -n 'license' apps/rag/py/pyproject.toml

# 3) Web 包元数据中的许可声明
grep -n '"license"' apps/web/package.json

# 4) 参考示例（本地，不进提交）
head -3 upstream/reference/ragas-examples/LICENSE
head -3 upstream/reference/ragas-examples/examples/LICENSE
head -3 upstream/reference/copilotkit-example/LICENSE
head -3 upstream/reference/copilotkit-example/examples/integrations/langgraph-fastapi/LICENSE

# 5) 确认没有把参考目录提交进仓库
git check-ignore -v upstream/reference/ragas-examples/LICENSE
```

预期结果：

- `apps/rag/LICENSE.md` 首行为 `The MIT License (MIT)`，版权行 `Copyright (c) 2024 EmergentAGI Inc.`；
- `apps/agent/LICENSE` 首行为 `MIT License`，版权行 `Copyright (c) 2024 Joshua Carroll`；
- `apps/web/LICENSE` 首行为 `The MIT License (MIT)`，版权行 `Copyright (c) 2021 Acme Co.`；
- `apps/rag/py/pyproject.toml:10` 为 `license = {text = "MIT"}`；
- `apps/web/package.json:28` 为 `"license": "MIT"`；
- 两个参考目录的许可文件均被 `.gitignore:62` 的 `/upstream/` 忽略。

## 3. 示例代码条款待核对项

### 3.1 Ragas `examples/` 的独立许可文件

Ragas 仓库的 `examples/` 目录**自带一个 `LICENSE` 文件**，与仓库根目录的 `LICENSE` 并列：

| 文件 | 大小 | 首行 | 性质 |
|---|---|---|---|
| `upstream/reference/ragas-examples/LICENSE` | 201 行 | `Apache License / Version 2.0, January 2004` | 仓库根许可 |
| `upstream/reference/ragas-examples/examples/LICENSE` | 201 行 | `Apache License / Version 2.0, January 2004` | **examples 子目录独立许可** |

两者正文都是 Apache-2.0，但文件是**两份独立的副本**，不是同一文件的符号链接或引用。

待核对项：

1. 复制 `examples/` 下的任何代码进 `evals/` 时，是否必须把 `examples/LICENSE` 一并复制到
   `evals/` 的对应位置，或在 `evals/` 下放置一份说明指向 Apache-2.0。
   → 本项目的做法：在 `evals/` 建立时随附一份 Apache-2.0 副本 + NOTICE 说明，
     并在 `docs/upstream.md` 与本表记录来源提交号 `298b6827…`。
2. Apache-2.0 第 4(d) 条要求：若分发的是衍生作品，必须保留 NOTICE 文件内容（或写入显著声明）。
   → 已在本地参考副本中核对：`upstream/reference/ragas-examples/` 与
     `upstream/reference/ragas-examples/examples/` 下均**没有** NOTICE 文件
     （`find upstream/reference/ragas-examples -maxdepth 2 -iname "NOTICE*"` 无输出），
     因此复制时不需要附 NOTICE，但需在 `evals/` 文档中声明"衍生自 Ragas examples，Apache-2.0"。
3. `upstream-lock.yaml:40` 的 `license_note: Check and retain the examples-specific license before copying.`
   这一条仍然有效，**复制动作尚未发生**，因此 A20 的"示例代码条款"部分目前只能算部分完成。

### 3.2 CopilotKit 示例的许可

`upstream/reference/copilotkit-example/examples/integrations/langgraph-fastapi/LICENSE`
是一份 21 行的 MIT 正文（Copyright (c) Atai Barkai），与仓库根目录 `LICENSE` 内容一致，
但同样是**独立副本**。

待核对项：复制示例进 `apps/web` 时保留该 MIT 正文，并在复制位置的说明中注明来源提交号
`abc6807f…` 与原始路径 `examples/integrations/langgraph-fastapi`。

### 3.3 未复制前的表述纪律

在 CopilotKit / Ragas 示例真正复制进产品目录之前：

- 不得声称"本项目已包含并遵循这两个示例的许可条款"；
- 只能声称"已固定来源提交并保留本地参考副本，待复制时携带许可文件"。

## 4. 依赖与权重许可

| 对象 | 许可 | 核对状态 |
|---|---|---|
| `langchain-community==0.4.2` | MIT | 依赖声明已核对（`apps/agent/pyproject.toml:27`） |
| `FlashRank==0.2.10` | Apache-2.0 | 依赖声明已核对；**模型权重许可未核对**，权重另行下载前必须确认来源与授权 |
| `google-genai`（P1 放宽后解析到 1.2.0） | Apache-2.0 | 由依赖管理；本产品不调用该 provider |
| `mistralai`（P2 固定 1.5.2） | Apache-2.0 | 由依赖管理；仅 R2R OCR provider 使用，本产品不走该路径 |
| `fastembed==0.5.1`（模型网关） | Apache-2.0 | `services/model-gateway/requirements.txt:4` |
| `BAAI/bge-small-zh-v1.5` 权重 | **未核对** | 本地 ONNX/fastembed 加载，权重来源与授权需单独确认；见第 5 节 |
| `minimax-m3.1-flash-free`（生成模型） | **未核对** | 经 opencode-go 端点调用，属服务条款而非随仓分发；见第 5 节 |

## 5. 尚未完成的核对项（汇总）

| 编号 | 核对项 | 阻塞原因 | 建议动作 |
|---|---|---|---|
| C1 | Ragas `examples/LICENSE` 在 `evals/` 中的落位 | 示例尚未复制 | 复制 `evals/` 时一并放置 Apache-2.0 副本与来源说明 |
| C2 | CopilotKit 示例 MIT 在 `apps/web` 中的落位 | 示例尚未复制 | 复制时保留 `LICENSE` |
| C3 | Ragas 仓库根是否有 `NOTICE` | **已核对：本地参考副本中没有 NOTICE 文件** | 复制 `evals/` 时按 Apache-2.0 第 4(d) 条写明衍生来源声明即可 |
| C4 | FlashRank 权重许可 | 未下载、未核对 | 首次接入重排时确认权重来源与授权 |
| C5 | `BAAI/bge-small-zh-v1.5` 权重许可 | 未核对 | 首次准备本地 embedding 权重时确认；模型卡通常声明 Apache-2.0，但需以实际分发件为准 |
| C6 | `minimax-m3.1-flash-free` 服务条款 | 走第三方端点 | 记录服务提供方条款，并在 README 说明数据流向 |
| C7 | LangSmith SDK 版本与条款 | 默认关闭 | 开启追踪前锁定版本并核对条款 |
| C8 | 本项目自身许可 | 未确定 | 由项目负责人决定后补入 README 与本表；在此之前不声称任何项目许可 |

## 6. 合规基线

- 所有分叉目录的根许可文件保持原样、未改名、未改内容（见 [patches.md](patches.md) P6）。
- 本次核对只覆盖**引入的上游与示例**；产品自有代码（`apps/agent/src/schema/meeting.py`、
  `apps/web/src/types/meeting-contracts.ts`、`apps/web/src/server/meeting-identity.ts`、
  `deployment/r2r/`、`services/model-gateway/`、`tests/`、`scripts/`）的许可取决于本项目自身的许可选择（待定）。
- 本项目当前**不声称**拥有任何上游项目的原创功能；上游功能以分叉方式使用并保留其版权声明。
