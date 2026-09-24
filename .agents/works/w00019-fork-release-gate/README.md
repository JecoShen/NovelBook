---
schema: nbook.work/v1
workId: w00019-fork-release-gate
issueId: null
---

# fork 发布门禁适配（manager:verify-public dispatcher）

p-011（2026-09-24 accepted）的实施 Work。目标：fork 恢复合法切版能力——`manager:verify-public` 改 dispatcher 分派，fork 模式以本地一致性校验（manager:pack + 版本断言）替代 npm provenance；upstream 语义字节级保留，恢复一行开关。解开 0.10.3-canary 切版卡点。

## 拍板要点（p-011 决策记录 2026-09-24）

- fork 模式复用完整 `manager:pack`（fail-closed）；保留 npm 漂移 best-effort 报告（try/catch 兜底，离线不阻断）。
- `manager:release` 仅文档声明 fork 不可用；接受 Portable/GHCR 嵌上游 npm Manager + **Manager 版本冻结约束**（fork 不得提升 `packages/neuro-book-manager` 版本号）。
- 命名 `scripts/release/public-manager-gate.ts` / `FORK_PUBLIC_MANAGER_GATE_MODE`；env 覆盖 `NEURO_BOOK_PUBLIC_MANAGER_GATE=upstream|fork`。

## 范围

- t01：dispatcher 实现 + 合同测试 + 文档登记 + 本地验收（p-011 验收 1–5）。
- 不在范围：0.10.3-canary 实际切版（H3 批准后按 `scripts/release/AGENTS.md` 执行，`--repo` 必须显式指向 fork）。
