---
schema: nbook.task/v2
taskId: t01-public-manager-gate-dispatcher
role: tasker
---

# public-manager-gate dispatcher 落地（p-011 全量代码面）

## 目标

新增 `scripts/release/public-manager-gate.ts`：upstream 模式原样 spawn `bun scripts/release/verify-public-manager.ts`；fork 模式执行本地一致性校验（`bun run manager:pack` + 对本机构建 `dist/neuro-book.mjs` 执行 `--version` 断言等于 Manager package 版本 + 显式报告 + best-effort npm 漂移情报）。根 `package.json` 的 `manager:verify-public` script 一行改指 dispatcher；release.ts 四触点与 release-container.yml 零改动。

## 范围

- dispatcher 新文件：`FORK_PUBLIC_MANAGER_GATE_MODE` 常量（注释写明收窄理由与恢复条件，仿 `FORK_CI_TARGET_PLATFORMS` 先例）+ `NEURO_BOOK_PUBLIC_MANAGER_GATE=upstream|fork` env 覆盖；登记进 `scripts/tsconfig.json` include 清单。
- 根 `package.json` script 一行变更。
- 合同测试：`scripts/release/release-assets.test.ts` 新增断言（dispatcher 存在、含 fork 常量与 env 覆盖、upstream 模式委托 verify-public-manager.ts、package.json 指向 dispatcher、fork 模式含 manager:pack 与 --version 比对步骤）；既有 `:417-422` 与 `:438-443` 断言不动；`manager-release-contract.test.ts` 不变。
- 文档：`scripts/release/AGENTS.md` 新增「fork 发布门禁」小节（两模式语义、env 覆盖、切版必须显式 `--repo`、`manager:release` 在 fork 不可用、Manager 版本冻结约束）；`docs/specs/README.md` P1 行补注 fork 门禁语义现状；ADR 0015 下一轮复核记录追加 fork 注记；`PROJECT-STATUS.md:77` 更新为已裁剪并链接提案与证据；`RELEASE.md` 0.10.3-canary 载荷「内部维护」补一条发布门禁 fork 适配。

## 验收

1. fork 本机 `bun run manager:verify-public` 退出 0，输出 fork 模式报告且本地一致性校验通过。
2. `NEURO_BOOK_PUBLIC_MANAGER_GATE=upstream bun run manager:verify-public` 走原逻辑——预期在 fork 上失败并给出原漂移报错（证明上游语义原样保留、未被削弱）。
3. `bun run release -- canary --next patch --dry-run` 通过。
4. release-assets 合同测试（含新断言）、`manager:test`、`bun x tsc --noEmit -p scripts/tsconfig.json` 通过。
5. `verify-public-manager.ts`、`release.ts`、`release-container.yml` diff 为空。
6. 实际 0.10.3-canary 切版不在本 Task（H3 批准后动作）。
