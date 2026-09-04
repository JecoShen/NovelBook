# Source Authoring Type Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Source Profile / Variable 类型检查复用有界的公开 SDK 声明投影，并用单 Vitest worker 防止高内存测试并发。

**Architecture:** 从 Product Authoring Kit 提取纯类型投影生成器，Product staging 与 Source Cache Root 共用它。Source 通过内容指纹、不可变目录和原子 current 指针复用投影；Runtime Artifact Compiler Context 明确区分声明根与 runtime bundle 源码根。

**Tech Stack:** TypeScript、Bun、TypeScript Compiler API、Vitest、proper-lockfile、Node `fs/promises`。

**Spec:** `docs/superpowers/specs/2026-09-04-source-authoring-type-projection.md`

## Global Constraints

- Source 与 Product 必须使用同一个声明投影生成核心和同一份批准依赖登记。
- 缓存固定落在 `NEURO_BOOK_CACHE_ROOT/authoring-types/`，不写 State Root、Project Workspace 或 `.output/`。
- current 投影永不删除；orphan 最小安全年龄为 10 分钟，总预算为 256 MiB。
- 缓存失败必须 fail closed，不得回退完整 Source `tsconfig` 类型图。
- `authoringTypeRoot` 只表示声明投影；`nbookRoot` 继续表示 artifact bundle 的运行时代码根。
- Profile / Variable 的语义类型检查、SDK import gate、Product 自包含合同和 artifact 发布合同不得回退。
- 根 Vitest `maxWorkers` 固定为 `1`。
- 资源验收目标：单核单 worker 下 Profile CLI 峰值 RSS 小于 768 MiB，结束后没有遗留 Bun/Vitest 子进程。
- 所有测试命令使用 `taskset -c 0 nice -n 15 timeout --signal=INT --kill-after=10s <duration>`，避免占满服务器。

---

### Task 1: 提取共享 Authoring 声明投影生成器

**Files:**
- Create: `scripts/build/authoring-sdk-type-projection.ts`
- Create: `scripts/build/authoring-sdk-type-projection.test.ts`
- Modify: `scripts/build/product-authoring-kit.ts`
- Modify: `scripts/build/product-authoring-kit.test.ts`

**Interfaces:**
- Produces: `buildAuthoringSdkTypeProjection(input: { targetRoot: string }): Promise<AuthoringSdkTypeProjectionResult>`。
- Produces: `AUTHORING_SDK_TYPE_PROJECTION_SCHEMA`、`AUTHORING_SDK_DEPENDENCIES` 和 `authoringSdkTsconfig()`，供 Source 缓存计算身份。
- `AuthoringSdkTypeProjectionResult` 包含 `declarationFiles`、`declarationBytes`、`dependencyFiles`、`dependencyBytes`、`dependencies`、`inputFiles`。

- [ ] **Step 1: 写共享投影的失败测试**

在新测试中为两个不同目标目录调用生成器，断言二者 inventory 相同、声明不含 checkout 绝对路径，并验证以下文件存在：

```ts
expect(resultA).toEqual(resultB)
await access(join(targetA, 'types/profile-sdk/index.d.ts'))
await access(join(targetA, 'types/variable-sdk/index.d.ts'))
await access(join(targetA, 'node_modules/@types/node/index.d.ts'))
expect(await readFile(join(targetA, 'tsconfig.json'), 'utf8')).toBe(authoringSdkTsconfig())
```

- [ ] **Step 2: 验证 RED**

Run: `taskset -c 0 nice -n 15 timeout --signal=INT --kill-after=10s 90s bun x vitest run scripts/build/authoring-sdk-type-projection.test.ts --maxWorkers=1`

Expected: FAIL，模块 `nbook/scripts/build/authoring-sdk-type-projection` 不存在。

- [ ] **Step 3: 提取最小生成核心**

把 `emitAuthoringTypes()`、可达声明复制、批准依赖投影和最小 tsconfig 生成移动到新模块。接口必须返回规范化 inventory，不生成 `profile-compile-worker.mjs`、SDK runtime `.mjs` 或 World Engine runtime 小岛：

```ts
export type AuthoringSdkTypeProjectionResult = Readonly<{
  declarationFiles: number
  declarationBytes: number
  dependencyFiles: number
  dependencyBytes: number
  dependencies: readonly ProjectedAuthoringDependency[]
  inputFiles: readonly { path: string, sha256: string, bytes: number }[]
}>

export async function buildAuthoringSdkTypeProjection(
  input: { targetRoot: string },
): Promise<AuthoringSdkTypeProjectionResult>
```

- [ ] **Step 4: 让 Product Authoring Kit 消费共享生成器**

`buildProductAuthoringKit()` 保留 runtime bundle 部分，类型部分改为：

```ts
const typeProjection = await buildAuthoringSdkTypeProjection({ targetRoot: kitRoot })
return {
  compilerBytes: (await stat(compilerPath)).size,
  sdkBytes: runtimeInventory.bytes,
  typeBytes: typeProjection.declarationBytes + typeProjection.dependencyBytes,
  typeFiles: typeProjection.declarationFiles + typeProjection.dependencyFiles,
  dependencies: [...typeProjection.dependencies],
}
```

- [ ] **Step 5: 验证 GREEN 与 Product 合同**

Run: `taskset -c 0 nice -n 15 timeout --signal=INT --kill-after=10s 8m bun x vitest run scripts/build/authoring-sdk-type-projection.test.ts scripts/build/product-authoring-kit.test.ts --maxWorkers=1`

Expected: 两个文件全部 PASS；Product smoke 继续能 typecheck、bundle 并 import Profile。

- [ ] **Step 6: 提交**

```bash
git add scripts/build/authoring-sdk-type-projection.ts scripts/build/authoring-sdk-type-projection.test.ts scripts/build/product-authoring-kit.ts scripts/build/product-authoring-kit.test.ts
git commit -m "refactor(build): share authoring type projection"
```

### Task 2: 实现 Source 内容寻址投影缓存

**Files:**
- Create: `server/runtime/source-authoring-type-cache.ts`
- Create: `server/runtime/source-authoring-type-cache.test.ts`

**Interfaces:**
- Consumes: `buildAuthoringSdkTypeProjection()`、`authoringSdkTsconfig()` 和投影输入 inventory。
- Produces: `openSourceAuthoringTypeProjection(cacheRoot: AbsoluteFsPath): Promise<SourceAuthoringTypeProjection>`。
- `SourceAuthoringTypeProjection` 包含 `fingerprint`、`root`、`typeRoot`、`nodeModulesRoot`、`tsconfigPath`。

- [ ] **Step 1: 写缓存失败测试**

覆盖四个行为：首次生成并发布、相同输入复用同一路径、损坏 manifest 后重建、两个并发 miss 最终只产生一个 current fingerprint：

```ts
const [left, right] = await Promise.all([
  openSourceAuthoringTypeProjection(absoluteFsPath(cacheRoot)),
  openSourceAuthoringTypeProjection(absoluteFsPath(cacheRoot)),
])
expect(left.fingerprint).toBe(right.fingerprint)
expect(left.root).toBe(right.root)
expect(await readProjectionDirectories(cacheRoot)).toEqual([left.fingerprint])
```

另覆盖 GC：current 与 10 分钟内 orphan 保留；超过 256 MiB 时删除已过 10 分钟的最旧 owned orphan；未知目录不删除。

- [ ] **Step 2: 验证 RED**

Run: `taskset -c 0 nice -n 15 timeout --signal=INT --kill-after=10s 90s bun x vitest run server/runtime/source-authoring-type-cache.test.ts --maxWorkers=1`

Expected: FAIL，缓存模块不存在。

- [ ] **Step 3: 实现 manifest、fingerprint 与验证**

```ts
export const SOURCE_AUTHORING_TYPE_CACHE_SCHEMA = 'nbook.source-authoring-types/v1'
export const SOURCE_AUTHORING_TYPE_CACHE_MIN_AGE_MS = 10 * 60 * 1_000
export const SOURCE_AUTHORING_TYPE_CACHE_ORPHAN_BUDGET_BYTES = 256 * 1024 * 1024

export type SourceAuthoringTypeProjection = Readonly<{
  fingerprint: string
  root: string
  typeRoot: string
  nodeModulesRoot: string
  tsconfigPath: string
}>
```

fingerprint 使用 schema、规范化 tsconfig、依赖登记、lockfile 身份和投影 `inputFiles` 的稳定 JSON 计算 SHA-256。验证逐项核对 manifest inventory 的相对路径、bytes 和 SHA-256。

- [ ] **Step 4: 实现 staging、双重检查与原子发布**

缓存模块不能顶层 import TypeScript 或共享投影生成器；current 验证命中时不得加载生成器依赖。只有 miss 才执行动态 import：

```ts
const { buildAuthoringSdkTypeProjection } = await import(
  'nbook/scripts/build/authoring-sdk-type-projection'
)
```

候选写到 `authoring-types/.staging/<uuid>`；生成完成后获取 `.publish.lock`，锁内重读 current，相同 fingerprint 直接复用，否则 rename 候选目录并原子替换 `current.json`。finally 只删除本进程 staging。

- [ ] **Step 5: 实现保守 GC**

只识别合法 owner manifest。锁内保护 current，按 mtime 从旧到新删除超过 10 分钟的 owned orphan，直到 orphan bytes 不超过 256 MiB；未知目录、年轻目录和 current 均保留。

- [ ] **Step 6: 验证 GREEN**

Run: `taskset -c 0 nice -n 15 timeout --signal=INT --kill-after=10s 4m bun x vitest run server/runtime/source-authoring-type-cache.test.ts --maxWorkers=1`

Expected: 全部 PASS，测试结束 `pgrep -af 'vitest|authoring-type'` 无测试进程。

- [ ] **Step 7: 提交**

```bash
git add server/runtime/source-authoring-type-cache.ts server/runtime/source-authoring-type-cache.test.ts
git commit -m "feat(runtime): cache source authoring type projection"
```

### Task 3: 将 Source Compiler Context 接入投影缓存

**Files:**
- Modify: `server/utils/runtime-artifact-compiler-context.ts`
- Modify: `server/utils/runtime-artifact-compiler-context.test.ts`

**Interfaces:**
- Consumes: `openSourceAuthoringTypeProjection()`。
- Changes: `RuntimeArtifactCompilerPaths` 新增 `authoringTypeRoot: string`。
- Source `nbookRoot`、`compilerPackageRoot` 和 `artifactRuntimeRequireRoot` 仍指向 checkout；`tsconfigPath`、`authoringTypeRoot` 和 `compilerNodeModulesRoot` 指向 Cache Root 投影。

- [ ] **Step 1: 写 Source context 失败测试**

在隔离 Cache Root 打开 Source context，断言：

```ts
expect(context).toMatchObject({
  kind: 'source',
  nbookRoot: sourceRoot,
  authoringTypeRoot: join(cacheRoot, 'authoring-types', contextFingerprint, 'types'),
  compilerNodeModulesRoot: join(cacheRoot, 'authoring-types', contextFingerprint, 'node_modules'),
  tsconfigPath: join(cacheRoot, 'authoring-types', contextFingerprint, 'tsconfig.json'),
})
```

并断言生成失败时拒绝返回仓库根 `tsconfig.json`。

- [ ] **Step 2: 验证 RED**

Run: `taskset -c 0 nice -n 15 timeout --signal=INT --kill-after=10s 90s bun x vitest run server/utils/runtime-artifact-compiler-context.test.ts --maxWorkers=1`

Expected: FAIL，Source context 尚无 `authoringTypeRoot` 且仍指向仓库根 tsconfig。

- [ ] **Step 3: 实现 Source context 接入**

`resolveRuntimeArtifactCompilerContext()` 使用 `runtimePathsFromEnv(env).cacheRoot` 打开投影。Product / candidate 返回其 Authoring Kit `types` 目录作为 `authoringTypeRoot`。不修改 `resolveRuntimeArtifactNbookPath()` 的 runtime bundle 行为。

- [ ] **Step 4: 验证 GREEN**

Run: `taskset -c 0 nice -n 15 timeout --signal=INT --kill-after=10s 4m bun x vitest run server/utils/runtime-artifact-compiler-context.test.ts server/runtime/source-authoring-type-cache.test.ts --maxWorkers=1`

Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add server/utils/runtime-artifact-compiler-context.ts server/utils/runtime-artifact-compiler-context.test.ts
git commit -m "fix(runtime): use projected types for source authoring"
```

### Task 4: 验证 Profile / Variable CLI 真实接入与资源边界

**Files:**
- Modify: `scripts/build/authoring-cli-blackbox.test.ts`

**Interfaces:**
- Consumes: `RuntimeArtifactCompilerContext.tsconfigPath` 指向的投影配置。
- Profile / Variable CLI 保持现有 context 入口，不另建缓存路径或投影选择逻辑。

- [ ] **Step 1: 运行现有真实 CLI 回归**

Run: `taskset -c 0 nice -n 15 timeout --signal=INT --kill-after=10s 8m bun x vitest run scripts/build/authoring-cli-blackbox.test.ts --maxWorkers=1`

Expected: 现有 `3` 个测试 PASS；这是 Task 3 已完成后的集成基线，不充当新生产行为的 RED。

- [ ] **Step 2: 扩充真实 CLI 缓存合同测试**

在现有 blackbox 中保留 Profile 和 Variable 的故意类型错误断言，并新增：fixture Cache Root 下存在已发布 `authoring-types/current.json`，不存在 `.staging` 残留。该测试锁定 Task 3 已实现的用户可见集成结果，不引入新的生产行为。

- [ ] **Step 3: 确认 CLI 无需重复实现投影选择**

检查 Profile / Variable CLI 都只从 compiler context 读取 `tsconfigPath`。TypeScript Program 继续使用该最小配置解析出的声明文件和目标/生成声明：

```ts
const program = ts.createProgram({
  rootNames: [...checkedFilePaths, ...config.fileNames, ...variableTypes.typeFiles],
  options: compilerOptions,
})
```

不新增 CLI 生产代码；如果测试暴露 CLI 绕过 context，再回到 Task 3 修正 compiler context 接口，而不是在两个命令里复制缓存逻辑。诊断仍只向用户报告目标源码和本轮生成声明中的问题。

- [ ] **Step 4: 验证真实 CLI 合同**

Run: `taskset -c 0 nice -n 15 timeout --signal=INT --kill-after=10s 8m bun x vitest run scripts/build/authoring-cli-blackbox.test.ts --maxWorkers=1`

Expected: `1` file / `3` tests PASS；`pgrep -af 'profile-command|variable-command|vitest'` 无遗留测试进程。

- [ ] **Step 5: 验证相关 Profile / Variable 合同**

Run: `taskset -c 0 nice -n 15 timeout --signal=INT --kill-after=10s 8m bun x vitest run server/agent/profiles/profile-sdk-contract.test.ts server/agent/profiles/profile-compile-worker-lifecycle.test.ts server/agent/variables/definition-artifact.test.ts scripts/build/product-authoring-kit.test.ts --maxWorkers=1`

Expected: 全部 PASS。

- [ ] **Step 6: 提交测试合同**

```bash
git add scripts/build/authoring-cli-blackbox.test.ts
git commit -m "test(agent): verify projected source authoring"
```

### Task 5: 单 Worker 防线、资源验收和文档收口

**Files:**
- Modify: `vitest.config.ts`
- Modify: `docs/tasks/125-runtime-artifact-storage-lifecycle/README.md`
- Modify: `reference/agent/profile-compiled-artifacts.md`
- Modify: `PROJECT-STATUS.md`

**Interfaces:**
- Changes: Vitest `maxWorkers: 1`。
- Documents: Source authoring type cache owner、256 MiB orphan budget、10 分钟安全年龄和资源实测。

- [ ] **Step 1: 写配置合同失败测试**

在 `scripts/ci/code-baseline-workflow.test.ts` 的本地测试门禁合同中解析根 Vitest config，断言运行配置导出的 `test.maxWorkers` 为 `1`，而不是 grep 源码文本。

- [ ] **Step 2: 验证 RED**

Run: `taskset -c 0 nice -n 15 timeout --signal=INT --kill-after=10s 60s bun x vitest run scripts/ci/code-baseline-workflow.test.ts --maxWorkers=1`

Expected: FAIL，实际值为 `2`。

- [ ] **Step 3: 修改单 worker 配置**

```ts
test: {
  maxWorkers: 1,
}
```

注释说明这是服务器与 CI 的内存并发防线，投影缓存负责降低单进程峰值。

- [ ] **Step 4: 测量冷缓存与热缓存资源**

先使用新的隔离 Cache Root 测冷缓存生成，再在同一 Cache Root 重跑测热缓存复用；两次都每 2 秒采样子进程 RSS，记录最大值、测试退出码、总时长和结束后的 `pgrep`。采样报告写入 Task 125 walkthrough；不得把本机采样脚本提交为产品代码。

Expected: 冷、热两次 Profile CLI 最大 RSS 都 `< 786432 KiB`，测试退出码 `0`，结束无遗留进程。冷缓存生成若超过阈值，继续缩小共享投影生成器的 TypeScript 输入闭包，不允许只记录为一次性成本。

- [ ] **Step 5: 类型检查与聚焦回归**

Run: `taskset -c 0 nice -n 15 timeout --signal=INT --kill-after=10s 12m bun run typecheck`

Run: `taskset -c 0 nice -n 15 timeout --signal=INT --kill-after=10s 12m bun x vitest run scripts/build/authoring-sdk-type-projection.test.ts server/runtime/source-authoring-type-cache.test.ts server/utils/runtime-artifact-compiler-context.test.ts scripts/build/authoring-cli-blackbox.test.ts scripts/build/product-authoring-kit.test.ts scripts/ci/code-baseline-workflow.test.ts --maxWorkers=1`

Expected: typecheck 退出码 `0`；所有聚焦测试 PASS。

- [ ] **Step 6: 受控全量测试**

先确认 `free -h` 至少有 3 GiB available，再运行：

Run: `taskset -c 0 nice -n 15 timeout --signal=INT --kill-after=10s 20m bun run test -- --maxWorkers=1`

每 30 秒检查一次 available memory 和最大 RSS；available 小于 2 GiB 或单进程 RSS 超过 1 GiB 时立即发送 SIGINT，并如实记录未完成。

- [ ] **Step 7: 更新稳定合同和状态**

在 Task 125 记录根因、实现、确切命令与数字；在 Reference 记录 Source projection cache 的 owner、失效、发布和 GC；只有资源验收与聚焦测试通过后才在 `PROJECT-STATUS.md` 标记收口。未完成的全量测试必须写“未完成”，不能由 CI 或聚焦测试替代。

- [ ] **Step 8: 提交**

```bash
git add vitest.config.ts scripts/ci/code-baseline-workflow.test.ts docs/tasks/125-runtime-artifact-storage-lifecycle/README.md reference/agent/profile-compiled-artifacts.md PROJECT-STATUS.md
git commit -m "test(ci): bound authoring test resources"
```

- [ ] **Step 9: 推送并复核 PR**

```bash
git push origin fix/i2-test-baseline
gh pr checks 3 --repo JecoShen/NovelBook
```

Expected: 推送成功；报告新 CI 状态，不等待未完成 workflow，也不合并 PR。
