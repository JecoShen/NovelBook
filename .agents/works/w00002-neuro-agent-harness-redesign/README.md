---
schema: nbook.work/v1
workId: w00002-neuro-agent-harness-redesign
issueId: i193
---

# NeuroAgentHarness Redesign

独立研究并重新设计 `neuro-agent-harness`，由真实宿主需求和可观察成功标准约束后续 Session、Runtime、持久化、Capability、API、Proposal 与 Spec 工作；不接入 NeuroBook 产品。

## 收口（2026-09-22）

按开发者拍板与 [ADR 0020](../../../docs/adr/0020-neuro-agent-harness-scope-freeze.md)，本 Work 收口：`neuro-agent-harness` 的长期定位固化为 **llmlint 专用验证件/研究件**，冻结产品语义扩张（维护性修复与 llmlint 需求不受限），不再保留"未来接入生产"的开放方向。t01 的宿主成功标准研究结论继续有效，其中"不接入 NeuroBook 产品"成为长期定位。本 Work 的任务链不再推进；既有任务与证据保留为 provenance。重开条件见 ADR 0020「重开条件」。
