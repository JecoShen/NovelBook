---
schema: nbook.work/v1
workId: w00003-neurobook-ui-foundation-migration
issueId: i191
---

# NeuroBook UI Foundation Migration

把 NeuroBook 主应用 UI 底座迁移到 monorepo 内的 `@notnotype/nb-ui`，先固定当前消费边界、迁移切片与真实 UI 验收合同，再逐片删除主应用重复实现。

## 收口（2026-09-22）

按开发者拍板与 [ADR 0021](../../../docs/adr/0021-nb-ui-retirement-single-design-system.md)，本 Work 收口不再推进：`@notnotype/nb-ui` 废弃归档（移出 workspaces 与 CI matrix，原地保留），NeuroBook 的单一设计系统为应用内基元 + 8 主题。迁移方向放弃的主要原因：主应用全部 UX 投资（8 主题、前端 critique 六步程序）都在应用内系统上，迁移需重做；且 PolyForm-Noncommercial 与 AGPL 的许可冲突使接入前置成本成立。既有任务与证据保留为 provenance。重开条件见 ADR 0021「重开条件」。
