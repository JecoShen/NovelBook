---
schema: nbook.task/v2
taskId: t14-agent-profile-nav-lab-migration
role: tasker
---

# Agent Profile Nav Lab 迁移（provenance 重建）

> 本 README 由 fork 治理修复时依据 `evidences/product-exclusion-2026-09-04.json` 与目录名重建。该 Task 由上游 `4b10ab1d chore: checkpoint current master changes` 带入，README 在本仓全历史与 upstream/master 上均从未存在；以下为可考事实，不是原始任务合同。

## 目标（据证据重建）

把 agent profile 导航的 Lab（开发 fixture UI）迁出产品面：产品构建产物不再包含 `component-lab`、`AgentProfileNavListFixture`、`LabShell`、`data-lab-subject` 与 `/lab` 路由。

## 现状（fork 已验证）

- 唯一原始产物是一次失败的排除扫描（`scanResult: "failed"`、`scannedFiles: 0`）：构建输出根指向上游作者本机的 Windows 路径（`C:\Users\notnotype\...\.nuxt\product-raw`），在扫描环境中不存在，未产出任何命中结论。
- 2026-09-12 在 fork 当前源码树（`packages/neuro-book`，排除测试与证据文件）全量检索上述四个禁词与 `app/` 下的 lab 路由文件：0 残留。「Lab 不进入产品面」在 fork 已成立。

## 任务产物

- `evidences/product-exclusion-2026-09-04.json`：排除扫描证据（执行失败），含构建命令 `bun run --cwd packages/neuro-book nuxt:build:raw`、禁词表、路由模式与 sourceRevision `b5da5000`。

## 完成门禁（据证据重建）

- 产品构建产物中扫描不到禁词与 `/lab` 路由（证据定义的验证方式）；原始扫描因构建输出缺失未能执行。
- fork 侧以源码树零残留作为等价验证，已于 2026-09-12 满足。

## 非目标

不重做 Lab 迁移实现，不恢复 Lab 入口，不据此新增产品行为；本 Task 只固定 provenance 与排除事实。
