---
schema: nbook.task/v2
taskId: t03-ci-blindspot-fixes
role: leader
---

# CI 结构性盲区修复（P1-6）

## 目标

`desktop-envelope-contract.yml` 补 push[main] 触发（此前仅 PR，直推 main 时桌面合同零门禁）；`manager:verify-public` 结构性阻断立项处置。

## 结果（2026-09-22 完成）

- 提交 `18dba644`：desktop-envelope 补 push[main]，push/PR 监听面一致；`workspace-workflows.test.ts` 钉住三分支触发与双侧面同步，防上游合并再漂移。
- verify-public 半段：按 PROJECT-STATUS「裁剪门禁属合同任务，待立项」立项为 p-011（提交 `e4e9f6d9`），draft 待开发者评审；不直接改发布合同。
- 验证：workspace-workflows 合同测试 14/14 绿。
