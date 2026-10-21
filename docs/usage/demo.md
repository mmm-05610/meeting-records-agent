# 演示数据与体验步骤（v0.1）

演示数据全部是模拟会议，不含任何真实私人记录，位于 `evals/datasets/`。

## 三份最小演示记录（项目 A：星河笔记）

| 顺序 | 文件 | 会议日期 | 类型 | 作用 |
|---|---|---|---|---|
| 1 | `evals/datasets/sim-project-a/meeting-01.md` | 2026-01-12 | 纪要 | 只提出「标签过滤 + 关键词匹配」候选，未定案 |
| 2 | `evals/datasets/sim-project-a/meeting-03.md` | 2026-03-11 | 纪要 | 明确确认「向量召回 + 关键词兜底」混合检索 |
| 3 | `evals/datasets/sim-project-a/meeting-06.md` | 2026-05-26 | 逐字稿 | 重新建议改回标签过滤，未形成决议 |

这组数据演示产品最核心的判断：**最新会议的重新提议不覆盖此前的明确确认**。

## 导入

```bash
source scripts/native/agent-env.sh
apps/agent/.venv/bin/python scripts/demo/import_dataset.py \
  --dir evals/datasets/sim-project-a \
  --collection-name "模拟项目A：星河笔记"
# 另外两个项目（可选，评测用）
apps/agent/.venv/bin/python scripts/demo/import_dataset.py --dir evals/datasets/sim-project-b --collection-name "模拟项目B：云仓物流"
apps/agent/.venv/bin/python scripts/demo/import_dataset.py --dir evals/datasets/sim-project-c --collection-name "模拟项目C：青禾医疗"
```

脚本使用与 Web 上传相同的 C01 身份规则（确定性 uuid5 + 服务端 sha256），重复执行是幂等的。

## 体验步骤（浏览器）

1. 打开 <http://127.0.0.1:3000>，用本地账号登录。
2. 「会议」页选择 `模拟项目A：星河笔记`：应看到 6 场会议、每场 4 个分块、状态「已就绪」。
3. 上传一份新的中文 TXT（填标题/日期/类型/参与人），列表出现新会议；重复上传提示已存在、不重复导入。
4. 「问答」页选择该项目，范围选「全部已就绪会议」，提问：
   - `星河笔记 v1.0 的检索方案最后怎么定的？最新会议重新建议改回标签过滤方案，会影响当前决定吗？`
     → 应回答：最终仍是 2026-03-11 确认的混合检索；5 月的建议只是提议，不覆盖确认；并给出覆盖说明。
   - 点击答案里的编号引用 → 打开来源面板，显示对应会议标题、日期与原文片段（按 chunk 定位）。
   - 追问：`那次会议是谁负责检索方案的技术验证？` → 应回答「何静牵头…周航配合…」，并说明原文未记载是否已完成。
5. 刷新页面 → 历史线程与上一轮答案、引用应恢复。
6. 删除一份被引用的会议 → 再提问不再使用它；打开旧引用显示「引用失效」。

## 评测

```bash
# 24 道冻结题，三组策略（B0 纯向量 / B1 +重排 / B2 +完整会议核对）
python3 evals/run_eval.py --engine agui --split frozen --strategy B2 \
  --url http://127.0.0.1:8080/agui/meeting-assistant/run \
  --scope-map evals/datasets/scope-map.json
```

真实结果写入 `evals/results/<run-id>/`，汇总见 `docs/evidence/evaluation-summary.md`。
