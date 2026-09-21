# 工程标准

`docs/standards/` 保存跨功能域的编码与仓库协作流程。产品可观察行为仍以 [`../specs/README.md`](../specs/README.md) 登记的当前规范为准。

- [`code/README.md`](code/README.md)：按改动路径分流，只加载对应领域与语言的编码、性能和审查规范。
- [`repository-workflow.md`](repository-workflow.md)：维护者 Issue、Task、Git、PR、合并和发布授权流程。
- [`upstream-merge-wiring-checklist.md`](upstream-merge-wiring-checklist.md)：跟随上游整树合并后的 fork 独有接线复核清单与巨型文件体量监控（P1-8/P1-11）。

开发 Agent 的协作、汇报和决策合同位于根 [`../../AGENTS.md`](../../AGENTS.md)；文档职责、生命周期和 Reference 迁移合同位于 [`../README.md`](../README.md)。每项规则只维护一个真相源。

修改标准时同步入口指针，并运行 `bun run docs:check` 与受影响的治理测试。
