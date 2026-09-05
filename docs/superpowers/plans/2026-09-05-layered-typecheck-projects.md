# Layered Non-Desktop Typecheck Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立不安装或检查 Desktop、可在单 worker 资源防线内完成的正式非桌面 typecheck 门禁。

**Architecture:** 把类型检查拆成 `contracts -> workspace-history -> agent -> runtime/scripts/web-server -> nuxt-vue` 的无环 TypeScript project graph；每层只消费上游声明输出。一个串行 runner 拥有 `.agent/tmp/typecheck/<runId>`，逐层执行、采样资源、失败即停，并在退出或信号中止时终止进程组和清理输出。

**Tech Stack:** Bun, TypeScript 5.9 project references, Nuxt 4, Vue TSC 3, Vitest 4, Linux `/proc` resource sampling, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-05-layered-typecheck-projects.md`

## Global Constraints

- 正式入口命名为 `typecheck:non-desktop`；不得安装、执行或隐式解析 `desktop/electron`。
- 所有层严格串行，同一时刻最多一个子进程；本地使用 `taskset -c 0` 和单 worker。
- 单进程 `MAX_SINGLE_RSS_KIB >= 1048576` 或 `MemAvailable < 2097152 KiB` 时立即终止当前进程组，后续层不得运行。
- 输出只写入 `.agent/tmp/typecheck/<runId>/`，成功、失败、SIGINT、SIGTERM 后都必须清理。
- 下游必须解析上游 `.d.ts`，不得通过路径回退到上游 Source；项目图必须无环且每个源码文件只有一个 owner。
- 保持现有正式配置的 `skipLibCheck: true`，子项目不得单独覆盖或扩大跳过范围；不用 `any`、`noResolve`、文本检查或提高 heap 掩盖源码错误和资源超限。
- 运行时 `nbook/*` import specifier、模块初始化顺序、数据库合同和用户数据行为保持不变。
- Desktop、全量 Vitest、浏览器验收和部署 smoke 不属于本计划。
- Phase 0 是硬闸门：样板不能在资源线内完成或仍解析上游 Source 时，停止执行 Task 4-7，回到规格评审。

---

## File Map

- `scripts/typecheck/non-desktop-runner.ts`：唯一聚合入口，创建 run root、拓扑执行层、采样 `/proc`、处理信号和清理。
- `scripts/typecheck/non-desktop-layers.ts`：纯数据层定义及拓扑顺序，供 runner 和测试共同消费。
- `scripts/typecheck/non-desktop-runner.test.ts`：串行、失败即停、资源止损、进程组终止和清理合同。
- `scripts/typecheck/fixtures/`：仅供 runner 测试使用的成功、失败、长驻与分配内存子进程。
- `tsconfig.typecheck.base.json`：非桌面声明项目共享严格编译选项，不包含任何源码。
- `tsconfig.typecheck.json`：正式 solution config，只声明 project references。
- `typecheck/contracts/tsconfig.json`：共享类型、Project/History token 与纯合同 owner。
- `typecheck/workspace-history/tsconfig.json`：Project Session、History、Plot/World 数据面 owner。
- `typecheck/agent/tsconfig.json`：Agent/Profile/Harness/Workflow owner。
- `typecheck/runtime/tsconfig.json`、`typecheck/scripts/tsconfig.json`：Runtime 与脚本 owner。
- `typecheck/web-server/tsconfig.json`、`typecheck/nuxt-vue/tsconfig.json`：Nitro server 与 Vue/Nuxt owner。
- `server/workspace-files/project-session-contract.ts`：稳定 Project generation/token 类型。
- `server/workspace-files/project-session-data-plane.ts`：只读 ready generation 和 module handle 操作，不导入注册副作用。
- `server/workspace-history/project-history-contract.ts`：History handle、token、diagnostic 类型。
- `server/workspace-history/project-history-data-plane.ts`：History inbox/diff/cursor/record 操作，不注册模块。
- `server/workspace-files/project-session.ts`、`server/workspace-history/project-history.ts`：保留生产组合根及兼容 re-export。
- `server/agent/profiles/profile-turn-context.ts`：改为只依赖轻量 contract/data-plane。
- `scripts/ci/code-baseline-workflow.test.ts`、`.github/workflows/code-baseline.yml`：验证并切换 CI 非桌面门禁。
- `package.json`：注册 `typecheck:non-desktop`。
- `docs/testing/README.md`、`docs/tasks/125-runtime-artifact-storage-lifecycle/README.md`、`PROJECT-STATUS.md`：记录正式命令、精确资源证据和未验证边界。

### Task 1: Serial Resource-Guarded Runner

**Files:**
- Create: `scripts/typecheck/non-desktop-layers.ts`
- Create: `scripts/typecheck/non-desktop-runner.ts`
- Create: `scripts/typecheck/non-desktop-runner.test.ts`
- Create: `scripts/typecheck/fixtures/exit.ts`
- Create: `scripts/typecheck/fixtures/hold.ts`

**Interfaces:**
- Produces: `TypecheckLayer { name: string; command: readonly string[] }`, `NON_DESKTOP_TYPECHECK_LAYERS`, `runNonDesktopTypecheck(options): Promise<TypecheckRunReport>`.
- Produces: per-layer `exitCode`, `durationMs`, `maxSingleRssKiB`, `maxGroupRssKiB`, `minMemAvailableKiB`, `stopReason`.
- Test helpers local to this test: `ok(name)`, `fail(name)`, `holdWithChild(name)`, `pathExists(path): Promise<boolean>`, and `processGroupExists(pgid): Promise<boolean>` build fixture commands and assert cleanup; they are not production exports.
- Consumes later: Task 3-6 append only layer definitions; Task 7 calls the CLI without duplicating orchestration.

- [ ] **Step 1: Write runner contract tests**

```ts
it('runs one layer at a time and stops after the first failure', async () => {
    const report = await runNonDesktopTypecheck({
        runRoot,
        layers: [ok('first'), fail('second'), ok('never')],
        sampleIntervalMs: 20,
    })
    expect(report.layers.map(layer => layer.name)).toEqual(['first', 'second'])
    expect(report.exitCode).not.toBe(0)
    await expect(pathExists(runRoot)).resolves.toBe(false)
})

it('kills the whole process group at the RSS limit and leaves no child', async () => {
    const report = await runNonDesktopTypecheck({
        runRoot,
        layers: [holdWithChild('rss-limit')],
        maxSingleRssKiB: 32_768,
        minMemAvailableKiB: 1,
        sampleIntervalMs: 20,
    })
    expect(report.layers[0]?.stopReason).toBe('max-single-rss')
    await expect(processGroupExists(report.layers[0]!.pgid)).resolves.toBe(false)
})
```

- [ ] **Step 2: Run the test and verify RED**

Run: `taskset -c 0 nice -n 15 bun --bun node_modules/vitest/vitest.mjs run scripts/typecheck/non-desktop-runner.test.ts --maxWorkers=1`

Expected: FAIL because `non-desktop-runner.ts` and exported interfaces do not exist.

- [ ] **Step 3: Implement layer data and guarded process ownership**

```ts
export type TypecheckLayer = {
    readonly name: string
    readonly command: readonly [string, ...string[]]
}

export const RESOURCE_LIMITS = Object.freeze({
    maxSingleRssKiB: 1_048_576,
    minMemAvailableKiB: 2_097_152,
    sampleIntervalMs: 250,
})

export async function runNonDesktopTypecheck(options: RunOptions): Promise<TypecheckRunReport> {
    await mkdir(options.runRoot, { recursive: true })
    try {
        for (const layer of options.layers) {
            const result = await runGuardedLayer(layer, options)
            results.push(result)
            if (result.exitCode !== 0 || result.stopReason !== null) break
        }
        return summarize(results)
    }
    finally {
        await terminateOwnedProcessGroup(activeChild)
        await rm(options.runRoot, { recursive: true, force: true })
    }
}
```

Implementation requirements: spawn each layer detached so its PID is its PGID; sample every member from `/proc/<pid>/stat` and `/proc/<pid>/status`; read `MemAvailable` from `/proc/meminfo`; on stop send `SIGINT`, then `SIGTERM`, then `SIGKILL` to `-pgid`; install and remove SIGINT/SIGTERM handlers in `finally`; CI mode may disable `/proc` sampling but may not alter layer commands or order.

- [ ] **Step 4: Run runner tests and lint**

Run: `taskset -c 0 nice -n 15 bun --bun node_modules/vitest/vitest.mjs run scripts/typecheck/non-desktop-runner.test.ts --maxWorkers=1`

Expected: PASS; the failure fixture prevents the third layer from starting, the RSS fixture reports `max-single-rss`, no fixture PID remains, and `runRoot` is absent.

Run: `bun x eslint scripts/typecheck`

Expected: exit `0`.

- [ ] **Step 5: Commit Task 1**

```bash
git add scripts/typecheck
git commit -m "test(typecheck): add serial resource guard"
```

### Task 2: Split Project and History Contracts From Composition Roots

**Files:**
- Create: `server/workspace-files/project-session-contract.ts`
- Create: `server/workspace-files/project-session-data-plane.ts`
- Create: `server/workspace-history/project-history-contract.ts`
- Create: `server/workspace-history/project-history-data-plane.ts`
- Modify: `server/workspace-files/project-session.ts`
- Modify: `server/workspace-history/project-history.ts`
- Modify: `server/agent/profiles/profile-turn-context.ts`
- Test: `server/agent/profiles/profile-turn-context-generation.test.ts`
- Test: `server/workspace-files/project-session.test.ts`
- Test: `server/workspace-history/project-history.test.ts`

**Interfaces:**
- Produces: `ReadyProjectSessionRef`, `ProjectOpener`, `ProjectHistoryHandle`, `PROJECT_HISTORY_MODULE_TOKEN` from contract files.
- Produces: `requireReadyProject`, `requireActiveReadyProject`, `requireReadyModuleHandle`, `readUnseenForAgent`, `advanceAgentCursor`, and record operations from data-plane files.
- Preserves: all existing exports from `project-session.ts` and `project-history.ts` through explicit re-exports.

- [ ] **Step 1: Add boundary behavior tests before moving code**

```ts
vi.mock('nbook/server/workspace-files/project-session-data-plane', () => ({
    requireReadyModuleHandle: vi.fn(() => historyHandle),
}))
vi.mock('nbook/server/workspace-history/project-history-data-plane', () => ({
    readUnseenForAgent: vi.fn(async () => unseen),
    advanceAgentCursor: vi.fn(async () => undefined),
}))

it('materializes and settles through data-plane ports without loading composition roots', async () => {
    const result = await materializeProfileTurnContexts(input)
    expect(result.settlements).toHaveLength(1)
    await settleProfileTurnContexts(result.settlements)
    expect(advanceAgentCursor).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `taskset -c 0 nice -n 15 bun --bun node_modules/vitest/vitest.mjs run server/agent/profiles/profile-turn-context-generation.test.ts --maxWorkers=1`

Expected: FAIL because both data-plane modules are missing.

- [ ] **Step 3: Move contracts and data-plane logic, then re-export compatibility API**

```ts
// project-history-contract.ts
export interface ProjectHistoryHandle extends ProjectModuleHandle {
    readonly history: Promise<WorkspaceHistory | null>
    waitForWarmup(): Promise<void>
    diagnostics(): ProjectHistoryDiagnostics
    reconcileRawEvents(batch: SnapshotRawEventBatch<WorkspaceFileChangeEventDto>): Promise<void>
    readonly pathPolicy: (relativePath: string) => ProjectWorkspacePathPolicyResult
}
export const PROJECT_HISTORY_MODULE_TOKEN
    = projectModuleToken<ProjectHistoryHandle>('history', 'required')

// project-history.ts
export * from 'nbook/server/workspace-history/project-history-contract'
export * from 'nbook/server/workspace-history/project-history-data-plane'
registerProjectModule(projectHistoryModule)
```

Move code without changing bodies. `project-session-data-plane.ts` may own its small global service access port, but it must not import `project-history.ts`, database modules, Plot, Agent SQL, or any other registration entry. `project-history-data-plane.ts` may consume only its handle and pure diff/history helpers; it must not import config loading or `registerProjectModule`.

- [ ] **Step 4: Run behavior regression and import-boundary checks**

Run: `taskset -c 0 nice -n 15 bun --bun node_modules/vitest/vitest.mjs run server/agent/profiles/profile-turn-context-generation.test.ts server/workspace-files/project-session.test.ts server/workspace-history/project-history.test.ts --maxWorkers=1`

Expected: PASS with existing test counts plus the new data-plane test; open/close, History inbox/diff/cursor and stale generation behavior remain unchanged.

Run: `bun x eslint server/workspace-files/project-session-contract.ts server/workspace-files/project-session-data-plane.ts server/workspace-history/project-history-contract.ts server/workspace-history/project-history-data-plane.ts server/workspace-files/project-session.ts server/workspace-history/project-history.ts server/agent/profiles/profile-turn-context.ts`

Expected: exit `0`.

- [ ] **Step 5: Commit Task 2**

```bash
git add server/workspace-files/project-session-contract.ts server/workspace-files/project-session-data-plane.ts server/workspace-files/project-session.ts server/workspace-history/project-history-contract.ts server/workspace-history/project-history-data-plane.ts server/workspace-history/project-history.ts server/agent/profiles/profile-turn-context.ts server/agent/profiles/profile-turn-context-generation.test.ts
git commit -m "refactor(workspace): isolate session history data plane"
```

### Task 3: Phase 0 Declaration-Consumption Feasibility Gate

**Files:**
- Create: `tsconfig.typecheck.base.json`
- Create: `typecheck/contracts/tsconfig.json`
- Create: `typecheck/fixtures/profile-turn-context/tsconfig.json`
- Create: `scripts/typecheck/project-graph.test.ts`
- Modify: `scripts/typecheck/non-desktop-layers.ts`

**Interfaces:**
- Produces: composite `contracts` declarations under `<runRoot>/contracts`.
- Produces: sample consumer that maps contract aliases to `<runRoot>/contracts/*.d.ts` and checks `profile-turn-context.ts` without resolving contract Source.
- Test helpers local to `project-graph.test.ts`: `buildAndTraceSample(runRoot): Promise<ResolutionTrace>` and `collectResolvedGraph(configPath): Promise<ResolvedGraph>` invoke the TypeScript compiler API; `ResolvedGraph` exposes `toContainPath(path)` for Vitest assertions.

- [ ] **Step 1: Write graph ownership and resolution tests**

```ts
it('resolves the sample consumer to emitted declarations only', async () => {
    const trace = await buildAndTraceSample(runRoot)
    expect(trace.resolvedContracts).not.toHaveLength(0)
    expect(trace.resolvedContracts.every(file => file.startsWith(join(runRoot, 'contracts')))).toBe(true)
    expect(trace.resolvedContracts.some(file => file.endsWith('.ts') && !file.endsWith('.d.ts'))).toBe(false)
})

it('keeps contract closure free of composition roots', async () => {
    const graph = await collectResolvedGraph(contractConfig)
    expect(graph).not.toContainPath('server/workspace-files/project-session.ts')
    expect(graph).not.toContainPath('server/workspace-history/project-history.ts')
    expect(graph).not.toContainPath('server/agent/harness')
    expect(graph).not.toContainPath('server/plot/index.ts')
})
```

- [ ] **Step 2: Run graph tests and verify RED**

Run: `taskset -c 0 nice -n 15 bun --bun node_modules/vitest/vitest.mjs run scripts/typecheck/project-graph.test.ts --maxWorkers=1`

Expected: FAIL because the composite configs and trace helper do not exist.

- [ ] **Step 3: Add strict composite configs and exact declaration paths**

```json
{
    "compilerOptions": {
        "strict": true,
        "composite": true,
        "declaration": true,
        "emitDeclarationOnly": true,
        "module": "ESNext",
        "moduleResolution": "Bundler",
        "target": "ESNext",
        "baseUrl": ".",
        "skipLibCheck": true
    }
}
```

The runner supplies unique `outDir`, `declarationDir` and `tsBuildInfoFile` through generated per-run configs inside `runRoot`; committed configs never point at a persistent output directory. The sample consumer's `paths` entries must point at emitted `.d.ts` roots, not repository directories.
`project-graph.test.ts` must also assert every child config inherits `skipLibCheck: true` from this base and none declares its own `skipLibCheck` key.

- [ ] **Step 4: Prove the dry graph, real check, resource limit and cleanup**

Run through the guarded runner: `taskset -c 0 nice -n 15 bun scripts/typecheck/non-desktop-runner.ts --through phase0-sample`

Expected: exit `0`; `tsc --build --dry` reports an acyclic build; the consumer trace contains emitted `.d.ts` and no upstream Source; `MAX_SINGLE_RSS_KIB < 1048576`; `MIN_MEM_AVAILABLE_KIB >= 2097152`; no TypeScript child or run directory remains.

Run: `taskset -c 0 nice -n 15 bun --bun node_modules/vitest/vitest.mjs run scripts/typecheck/project-graph.test.ts server/agent/profiles/profile-turn-context-generation.test.ts --maxWorkers=1`

Expected: PASS.

**STOP GATE:** if either command fails because declarations cannot preserve symbol identity, the graph resolves Source, or resource limits trigger, do not execute Task 4-7. Record exact failure in Task 125 and revise the design.

- [ ] **Step 5: Commit Task 3**

```bash
git add tsconfig.typecheck.base.json typecheck/contracts/tsconfig.json typecheck/fixtures/profile-turn-context/tsconfig.json scripts/typecheck/non-desktop-layers.ts scripts/typecheck/project-graph.test.ts
git commit -m "build(typecheck): prove declaration project boundary"
```

### Task 4: Complete Workspace-History and Agent Projects

**Files:**
- Create: `typecheck/workspace-history/tsconfig.json`
- Create: `typecheck/agent/tsconfig.json`
- Modify: `tsconfig.typecheck.json`
- Modify: `scripts/typecheck/non-desktop-layers.ts`
- Modify: `scripts/typecheck/project-graph.test.ts`
- Modify only as graph evidence requires: contract/data-plane imports under `server/workspace-files/`, `server/workspace-history/`, `server/agent/`

**Interfaces:**
- Consumes: emitted contracts declarations from Task 3.
- Produces: emitted workspace-history declarations consumed by Agent; emitted Agent declarations consumed by Task 5-6.
- Extends test helpers with `expectDuplicateOwners(solution): string[]`, `projectDependencies(solution): Record<string, string[]>`, and `resolvedBy(project): ResolvedGraph`; `ResolvedGraph.toContainSourceOwnedBy(owner)` reports cross-owner Source resolution.

- [ ] **Step 1: Extend graph tests with owner uniqueness and forbidden dependencies**

```ts
expectDuplicateOwners(solution).toEqual([])
expect(projectDependencies(solution)).toEqual({
    contracts: [],
    'workspace-history': ['contracts'],
    agent: ['contracts', 'workspace-history'],
})
expect(resolvedBy('agent')).not.toContainSourceOwnedBy('workspace-history')
```

- [ ] **Step 2: Run graph tests and verify RED**

Run: `taskset -c 0 nice -n 15 bun --bun node_modules/vitest/vitest.mjs run scripts/typecheck/project-graph.test.ts --maxWorkers=1`

Expected: FAIL because the two project configs and solution references do not exist.

- [ ] **Step 3: Add projects incrementally and lower only proven shared contracts**

Add `workspace-history` first, run it, then add `agent`. If a cycle appears, move only the shared type or port into `contracts`; never add reciprocal references. Keep production facades as compatibility re-exports and preserve all runtime specifiers.

- [ ] **Step 4: Run each layer and focused behavior tests under the guard**

Run: `taskset -c 0 nice -n 15 bun scripts/typecheck/non-desktop-runner.ts --through agent`

Expected: exit `0`; each layer reports `MAX_SINGLE_RSS_KIB < 1048576` and `MIN_MEM_AVAILABLE_KIB >= 2097152`.

Run: `taskset -c 0 nice -n 15 bun --bun node_modules/vitest/vitest.mjs run server/workspace-files/project-session.test.ts server/workspace-history/project-history.test.ts server/agent/profiles/profile-turn-context-generation.test.ts server/agent/harness/file-change-reminder.test.ts server/agent/profiles/profile-dsl.test.ts --maxWorkers=1`

Expected: PASS; no compatibility import breaks.

- [ ] **Step 5: Commit Task 4**

```bash
git add typecheck/workspace-history/tsconfig.json typecheck/agent/tsconfig.json tsconfig.typecheck.json scripts/typecheck/non-desktop-layers.ts scripts/typecheck/project-graph.test.ts server/workspace-files server/workspace-history server/agent
git commit -m "build(typecheck): layer workspace and agent projects"
```

Before committing, replace the broad final `git add` arguments with the exact changed files reported by `git status --short`; never stage unrelated files.

### Task 5: Layer Runtime and Scripts

**Files:**
- Create: `typecheck/runtime/tsconfig.json`
- Create: `typecheck/scripts/tsconfig.json`
- Modify: `server/runtime/tsconfig.json`
- Modify: `scripts/tsconfig.json`
- Modify: `tsconfig.typecheck.json`
- Modify: `scripts/typecheck/non-desktop-layers.ts`
- Modify: `scripts/typecheck/project-graph.test.ts`

**Interfaces:**
- Consumes: contract/workspace-history/agent declarations.
- Produces: formal Runtime and Scripts typecheck layers; existing `runtime:typecheck` points to the layered Runtime target.
- Test helper `runFixtureSolution(name): Promise<TypecheckRunReport>` creates its fixture only below the test run root and removes it in `finally`.

- [ ] **Step 1: Add a real type-error fixture and stop-order assertion**

```ts
it('reports the owning layer and does not start later layers', async () => {
    const report = await runFixtureSolution('runtime-type-error')
    expect(report.layers.at(-1)?.name).toBe('runtime')
    expect(report.output).toContain("Type 'string' is not assignable to type 'number'")
    expect(report.layers.some(layer => layer.name === 'scripts')).toBe(false)
})
```

- [ ] **Step 2: Run the fixture and verify RED**

Run: `taskset -c 0 nice -n 15 bun --bun node_modules/vitest/vitest.mjs run scripts/typecheck/project-graph.test.ts -t "owning layer" --maxWorkers=1`

Expected: FAIL because Runtime/Scripts layers are not registered.

- [ ] **Step 3: Convert formal Runtime and Scripts configs to declaration consumers**

Do not replace them with diagnostic minimal includes. Preserve all production files currently owned by `server/runtime/tsconfig.json` and `scripts/tsconfig.json`, exclude their tests only when an existing formal config already excludes tests, and map upstream aliases exclusively to declaration roots.

- [ ] **Step 4: Run formal layers and their existing contract tests**

Run: `taskset -c 0 nice -n 15 bun scripts/typecheck/non-desktop-runner.ts --through scripts`

Expected: exit `0`; formal Runtime and Scripts both complete below the RSS line; the injected fixture stops at Runtime and production run reaches Scripts.

Run: `taskset -c 0 nice -n 15 bun --bun node_modules/vitest/vitest.mjs run scripts/ci/code-baseline-workflow.test.ts server/runtime --maxWorkers=1`

Expected: PASS for the files matched by these paths; record exact file/test counts.

- [ ] **Step 5: Commit Task 5**

```bash
git add typecheck/runtime/tsconfig.json typecheck/scripts/tsconfig.json server/runtime/tsconfig.json scripts/tsconfig.json tsconfig.typecheck.json scripts/typecheck/non-desktop-layers.ts scripts/typecheck/project-graph.test.ts
git commit -m "build(typecheck): layer runtime and scripts"
```

### Task 6: Separate Web Server From Nuxt/Vue Checking

**Files:**
- Create: `typecheck/web-server/tsconfig.json`
- Create: `typecheck/nuxt-vue/tsconfig.json`
- Modify: `tsconfig.typecheck.json`
- Modify: `scripts/typecheck/non-desktop-layers.ts`
- Modify: `scripts/typecheck/project-graph.test.ts`

**Interfaces:**
- Consumes: Server domain declarations from prior layers and the single Nuxt prepare output.
- Produces: `web-server` and terminal `nuxt-vue` layers; Nuxt prepare runs exactly once per aggregate invocation.
- Test helper `commandCount(report, fragment): number` counts launched commands from the runner report; `layerNames` is derived from `NON_DESKTOP_TYPECHECK_LAYERS`.

- [ ] **Step 1: Add prepare-once and Server Source exclusion tests**

```ts
expect(layerNames).toEqual([
    'contracts', 'workspace-history', 'agent', 'runtime', 'scripts',
    'nuxt-prepare', 'web-server', 'nuxt-vue',
])
expect(commandCount(report, 'nuxt prepare')).toBe(1)
expect(resolvedBy('nuxt-vue')).not.toContainSourceOwnedBy('web-server')
```

- [ ] **Step 2: Run graph tests and verify RED**

Run: `taskset -c 0 nice -n 15 bun --bun node_modules/vitest/vitest.mjs run scripts/typecheck/project-graph.test.ts --maxWorkers=1`

Expected: FAIL because web projects and Nuxt prepare layer are absent.

- [ ] **Step 3: Add Web/Nuxt ownership configs and preserve `.env.typecheck`**

`web-server` owns `server/api`, `server/plugins`, and middleware not already owned by lower projects. `nuxt-vue` owns `app/`, root Nuxt augmentations and generated `.nuxt` types. The runner invokes `nuxt prepare --dotenv .env.typecheck` once, then passes the same generated type root to both layers.

- [ ] **Step 4: Run the complete pre-CI graph under resource guard**

Run: `taskset -c 0 nice -n 15 bun scripts/typecheck/non-desktop-runner.ts`

Expected: exit `0`; all non-desktop layers ran once in topology order; every `MAX_SINGLE_RSS_KIB < 1048576`; every `MIN_MEM_AVAILABLE_KIB >= 2097152`; no `tsc`, `vue-tsc`, Nuxt child or run root remains.

- [ ] **Step 5: Commit Task 6**

```bash
git add typecheck/web-server/tsconfig.json typecheck/nuxt-vue/tsconfig.json tsconfig.typecheck.json scripts/typecheck/non-desktop-layers.ts scripts/typecheck/project-graph.test.ts
git commit -m "build(typecheck): layer web and nuxt projects"
```

### Task 7: Make the Non-Desktop Gate Official and Record Evidence

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/code-baseline.yml`
- Modify: `scripts/ci/code-baseline-workflow.test.ts`
- Modify: `docs/testing/README.md`
- Modify: `docs/tasks/125-runtime-artifact-storage-lifecycle/README.md`
- Modify: `PROJECT-STATUS.md`

**Interfaces:**
- Produces: `bun run typecheck:non-desktop` as the only local/CI aggregate non-desktop entry.
- Preserves: existing `typecheck` Desktop compatibility behavior; this task does not validate Desktop.
- Test helper `loadWorkflow(path)` parses YAML with the repository's existing YAML dependency and returns the workflow object; it does not inspect workflow text with regex.

- [ ] **Step 1: Extend workflow contract test before changing CI**

```ts
it('runs the non-desktop gate without installing electron dependencies', async () => {
    const workflow = await loadWorkflow('.github/workflows/code-baseline.yml')
    const typecheck = workflow.jobs.typecheck.steps
    expect(typecheck).toContainEqual(expect.objectContaining({ run: 'bun run typecheck:non-desktop' }))
    expect(typecheck).not.toContainEqual(expect.objectContaining({
        run: expect.stringContaining('desktop/electron'),
    }))
})
```

- [ ] **Step 2: Run workflow test and verify RED**

Run: `taskset -c 0 nice -n 15 bun --bun node_modules/vitest/vitest.mjs run scripts/ci/code-baseline-workflow.test.ts --maxWorkers=1`

Expected: FAIL because CI still installs Electron types and runs `bun run typecheck`.

- [ ] **Step 3: Register the command and switch CI**

```json
{
    "scripts": {
        "typecheck:non-desktop": "bun scripts/typecheck/non-desktop-runner.ts"
    }
}
```

Remove the Desktop dependency-install step from the baseline typecheck job and replace its command with `bun run typecheck:non-desktop`. Do not modify Desktop-specific workflows or claim they passed.

- [ ] **Step 4: Run final focused verification, formal gate, and leak checks**

Run: `taskset -c 0 nice -n 15 bun --bun node_modules/vitest/vitest.mjs run scripts/typecheck/non-desktop-runner.test.ts scripts/typecheck/project-graph.test.ts scripts/ci/code-baseline-workflow.test.ts server/workspace-files/project-session.test.ts server/workspace-history/project-history.test.ts server/agent/profiles/profile-turn-context-generation.test.ts server/agent/harness/file-change-reminder.test.ts --maxWorkers=1`

Expected: PASS; record exact files, tests, duration and resource report.

Run: `taskset -c 0 nice -n 15 bun run typecheck:non-desktop`

Expected: exit `0`; capture every layer's exact `MAX_SINGLE_RSS_KIB`, `MAX_GROUP_RSS_KIB`, `MIN_MEM_AVAILABLE_KIB` and duration.

Run: `ps -eo pid,pgid,rss,args | rg 'tsc|vue-tsc|nuxt.*typecheck|non-desktop-runner'`

Expected: no process belonging to the completed run.

Run: `find .agent/tmp/typecheck -mindepth 1 -maxdepth 1 -print 2>/dev/null`

Expected: no directory belonging to the completed run.

Run: `bun x eslint scripts/typecheck scripts/ci/code-baseline-workflow.test.ts server/workspace-files/project-session-contract.ts server/workspace-files/project-session-data-plane.ts server/workspace-history/project-history-contract.ts server/workspace-history/project-history-data-plane.ts server/agent/profiles/profile-turn-context.ts`

Expected: exit `0`.

- [ ] **Step 5: Update exact documentation evidence**

In Task 125 and `PROJECT-STATUS.md`, include the exact formal command, exit code, per-layer resource numbers, focused test counts, no-residual observation, and these explicit boundaries: Desktop not run, full Vitest not run, browser acceptance not run, deployment smoke not run. In `docs/testing/README.md`, explain `typecheck:non-desktop`, its serial resource stop behavior and CI compatibility mode.

- [ ] **Step 6: Check the complete diff and commit Task 7**

Run: `git diff --check`

Expected: exit `0`.

Run: `git status --short`

Expected: only files from this plan are modified or untracked; do not stage unrelated user changes.

```bash
git add package.json .github/workflows/code-baseline.yml scripts/ci/code-baseline-workflow.test.ts docs/testing/README.md docs/tasks/125-runtime-artifact-storage-lifecycle/README.md PROJECT-STATUS.md
git commit -m "ci(typecheck): enforce non-desktop layered gate"
```

## Completion Boundary

After Task 7, use `superpowers:verification-before-completion`, then `superpowers:requesting-code-review`. Only after review findings are resolved may the branch be pushed and PR #3 updated. Do not merge, deploy, remove the worktree, or delete the branch without separate user authorization.
