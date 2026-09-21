---
schema: nbook.task/v2
taskId: t04-postinstall-decoupling-matrix-slim
role: leader
---

# postinstall 解耦 + CI matrix 瘦身（P1-9/P1-10）

## 目标

install 链不被单包构建态绑架：根 postinstall 移除；harness dist 由唯一消费者 llmlint 自保证。CI matrix 按 ADR 0020/0021 调整；nb-ui 归档出 install/CI 面。

## 结果（2026-09-22 完成）

- 提交 `88560e00`：postinstall 移除（llmlint `harness:ensure` 挂 typecheck/test 链首）；nb-ui 移出 workspaces 与 matrix（5 格），退出三个 workflow 的 paths 面，目录原地归档加横幅；合同测试归档豁免改显式名单+反向断言。
- 验证：`bun install` 实测 665ms 无 harness 构建；matrix 选择器全量 5 格正确；`harness:ensure` 可用；workspace-workflows 14/14 绿；governance:check 零 failure。
