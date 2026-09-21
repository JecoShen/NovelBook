---
schema: nbook.task/v2
taskId: t01-decision-records
role: leader
---

# P1-1/P1-7/P1-8 决策记录落地

## 目标

把开发者 2026-09-22 的三项架构拍板固化为持久记录：ADR 0020（neuro-agent-harness 产品定位收口）、ADR 0021（nb-ui 废弃与单一设计系统）、ADR 0015 追加第 2 轮复核记录（P1-8 维持延期 + 体量监控挂钩）；同步收口 w00002（独立内核重设计）与 w00003（UI 底座迁移）两个 Work 的状态。

## 范围

- 新建 `docs/adr/0020-*`、`docs/adr/0021-*`；追加 `docs/adr/0015-*` 复核记录段。
- 更新 `.agents/works/w00002/README.md`、`.agents/works/w00003/README.md` 收口说明。
- 不动 w00002/w00003 的 tasks 内容（历史 provenance 保留）。

## 验证

- `bun run governance:check` 通过；ADR 编号不与现有冲突（当前最大 0019）。
