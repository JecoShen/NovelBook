---
schema: nbook.task/v2
taskId: t05-upstream-merge-checklist
role: leader
---

# 上游整树合并接线复核清单（P1-11）

## 目标

三次静默覆盖事故（typecheck 分层、Source Authoring 投影、docs/tasks 回魂）固化为制度化复核程序；ADR 0015 §4 巨型文件体量监控挂钩。

## 结果（2026-09-22 完成）

- 提交 `cf8392fe`：`docs/standards/upstream-merge-wiring-checklist.md`（盲区探测命令 + 12 条接线核查行 + 体量监控快照 + 复核登记要求）；repository-workflow.md 设「跟随上游整树合并」节强制引用；standards README 登记。
- 验证：`bun run docs:check` 6051 文件零 failure。
