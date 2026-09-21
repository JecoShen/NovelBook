---
schema: nbook.work/v1
workId: w00014-p1-architecture-convergence
issueId: null
---

# P1 架构级风险收敛

2026-09-20 全量架构审查（报告：`.local/architecture-review-2026-09-20.md`）P1 层 11 条的收敛执行。开发者 2026-09-22 拍板：

- **P1-1 双 harness**：独立内核（`packages/neuro-agent-harness`）降级收口为 llmlint 专用验证件，冻结产品语义扩张（ADR 0020）。
- **P1-7 nb-ui**：废弃归档，主应用继续自有基元 + 8 主题单一设计系统（ADR 0021）。
- **P1-8 巨型文件**：维持 ADR 0015 §4 延期，体量监控纳入上游合并复核清单。
- **执行模式**：低风险工程波与 proposal 起草并行。

## 范围

本 Work 内收口：P1-1（决策落地）、P1-5（lint ratchet 门禁）、P1-6a（desktop-envelope push 触发）、P1-7（nb-ui 归档）、P1-8（登记维持）、P1-9（CI matrix 瘦身）、P1-10（postinstall 解耦）、P1-11（上游合并接线复核清单）。

以 proposal 交开发者评审、另立实施：P1-2（p-008 nb-memory 接主链）、P1-3（p-009 Provider 韧性）、P1-4（p-010 并发治理）、P1-6b（p-011 fork 发布门禁裁剪）。
