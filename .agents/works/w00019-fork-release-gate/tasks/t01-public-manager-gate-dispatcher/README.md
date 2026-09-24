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

## 结果（2026-09-24，Tasker）

完成，验收 1–5 全部实测通过。

### 实现

- `scripts/release/public-manager-gate.ts`：`FORK_PUBLIC_MANAGER_GATE_MODE = "fork"` 常量（注释含收窄理由与恢复条件）+ `NEURO_BOOK_PUBLIC_MANAGER_GATE=upstream|fork` env 覆盖（非法值抛错）。upstream 模式 spawn `bun scripts/release/verify-public-manager.ts`（stdio inherit，退出码透传）；fork 模式依次执行 `bun run manager:pack`、本机 `dist/neuro-book.mjs --version` 与 package 版本断言、best-effort npm 漂移情报（try/catch，离线/HTTP 错误均不阻断），全程 fail-closed。
- 根 `package.json` `manager:verify-public` 一行改指 dispatcher；`scripts/tsconfig.json` include 登记；`release-assets.test.ts` 新增「fork发布门禁dispatcher」合同断言 7 条（`:417-422`、`:438-443` 未动）。
- 文档五处：`scripts/release/AGENTS.md`「fork 发布门禁」小节、`docs/specs/README.md` P1 行补注、ADR 0015「复核记录」段、`PROJECT-STATUS.md` fork 发布门禁条目更新为已裁剪、`RELEASE.md` 0.10.3-canary「内部维护」补条。

### 验收证据

1. `bun run manager:verify-public` → 退出 0；manager:pack 全链通过（隔离安装冷启动、单文件 bundle、blessed 内联），`--version` = `0.1.0-canary.60` 与 package 一致；漂移情报输出公开 gitHead `d0b93d2c5f7c…`（与 p-011 登记一致）。
2. `NEURO_BOOK_PUBLIC_MANAGER_GATE=upstream bun run manager:verify-public` → 退出 1，原报错逐字复现：「当前Manager构建输入晚于npm公开gitHead d0b93d2c…」（是漂移报错而非 fetch 失败，证明 upstream 语义字节保留）。
3. `bun run release -- canary --next patch --dry-run` → 退出 0；计划文本仍字面打印 `command: bun run manager:verify-public`；算出版本 `0.10.3-canary.20260924.132418Z.4cd87c9a`。**dry-run 显示 repo 默认 `notnotype/neuro-book`（上游）——实际切版必须显式 `--repo` 指向 fork**。
4. `bun x vitest run --config scripts/release/release-assets-vitest.config.ts` → 4 文件 33 测试全绿；`bun run manager:test` → 退出 0；`bun x tsc --noEmit -p scripts/tsconfig.json` → 退出 0；`bun x eslint`（两变更文件）→ 零告警；`bun run docs:check` → failures 空（6066 文件）。
5. `git diff` 对 `verify-public-manager.ts`、`release.ts`、`release-container.yml` → 0 行。

### 偏差与决定

- dispatcher 未复用 `#scripts/utils/process.mjs` 的 run/runCapture：该 barrel 是 .mjs 无声明文件，登记进 tsconfig include 后触发 TS7016，且 include 清单内无 .ts 导入它的先例；按 `pack-check.mjs` 自足先例内联 typed `Bun.spawn` 助手（语义等价：stdio inherit 非零拒绝 / stdout 捕获带 stderr）。`verify-public-manager.ts` 本身不在 include 清单内，故从未暴露此问题。
- ADR 0015 实际路径是 `packages/neuro-book/docs/adr/0015-…`（提案误写 `docs/adr/`，以仓库实际为准）；该 ADR 无既有「复核记录」段、`:81` 也无 verify-public 证据行（提案此处为推断），按提案意图新设「复核记录」段记录 fork 注记。

### 未运行项

- 实际 0.10.3-canary 切版（验收 6，H3 批准后按 `scripts/release/AGENTS.md` 执行，命令须显式 `--repo`）。
- 全量 Full tests / 分层 typecheck：本 Task 只触 scripts 面，相关 CI 门禁（preflight 内含 release-assets 合同测试、manager:test、scripts tsc）已逐项等命令实测。
