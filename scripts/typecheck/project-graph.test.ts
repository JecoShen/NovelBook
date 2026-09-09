import { spawnSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * Task 3（Phase 0 声明消费可行性闸门）的图所有权与解析证据。
 *
 * 这些用例直接驱动 TypeScript compiler API，没有 mock、没有文本近似：
 * - `buildAndTraceSample` 真实 `--build` contracts 声明项目，再用样板消费者建 Program；
 * - `collectResolvedGraph` 只建 Program 收集闭包文件名，不跑语义检查（省内存）。
 *
 * 与 runner 的 per-run 配置注入保持同一套约定：
 * - 生成物一律落 `.agent/tmp/typecheck/<runId>/`，committed 配置不写持久输出目录；
 * - 生成的 per-run 配置一律用**绝对路径**注入 outDir / declarationDir / tsBuildInfoFile
 *   （相对路径会被按“声明它的那个配置文件所在目录”解析，落进嵌套的错误位置，
 *   表现为 build 退出 0 但一个 .d.ts 都没产出）；
 * - committed 样板消费者用 TypeScript 5.5 的 configDir 模板表达声明根：per-run 配置
 *   extends 它时，模板会被替换成入口配置所在目录，也就是 <runRoot>。
 */

const repoRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)))

const BASE_CONFIG = 'tsconfig.typecheck.base.json'
const CONTRACTS_CONFIG = 'typecheck/contracts/tsconfig.json'
const SAMPLE_CONSUMER_CONFIG = 'typecheck/fixtures/profile-turn-context/tsconfig.json'
const REQUIRED_LAYER_CONFIGS: readonly string[] = [CONTRACTS_CONFIG, SAMPLE_CONSUMER_CONFIG]
const LAYER_CONFIG_ROOT = 'typecheck'

/** 声明输出目录名；计划 Task 3 承诺 contracts 声明落 `<runRoot>/contracts`。 */
const DECLARATION_DIRECTORY_NAME = 'contracts'
/** TypeScript 5.5 的 configDir 模板，按入口配置所在目录替换。 */
const CONFIG_DIR_TEMPLATE = '${configDir}'
/** committed 配置不得声明这些持久输出目录。 */
const PERSISTENT_OUTPUT_OPTIONS: readonly string[] = ['outDir', 'declarationDir', 'outFile', 'tsBuildInfoFile']
/** TS6307：File '...' is not listed within the file list of project '...'。 */
const UNLISTED_FILE_DIAGNOSTIC_CODE = 6307

/**
 * contracts 声明构建的用例超时。
 *
 * 实测单核 `tsc -p` 约 22 s，且 `spawnSync` 会阻塞事件循环，vitest 默认 5 s 计时器
 * 根本来不及处理。留足余量，避免机器负载波动造成假红。
 */
const CONTRACTS_BUILD_TIMEOUT_MS = 300_000
/** 纯配置解析用例的超时；不建 Program，只防负载抖动。 */
const CONFIG_PARSE_TIMEOUT_MS = 60_000

/** contracts 闭包里不允许出现的组合根（计划 Task 3 Step 1）。 */
const FORBIDDEN_CONTRACT_PATHS: readonly string[] = [
  'server/workspace-files/project-session.ts',
  'server/workspace-history/project-history.ts',
  'server/agent/harness',
  'server/plot/index.ts',
]

type RawTsConfig = {
  readonly extends?: string | readonly string[]
  readonly references?: readonly { readonly path?: string }[]
  readonly compilerOptions?: Record<string, unknown>
}

type ResolutionTrace = {
  /** 本次 run 的输出 owner 目录。 */
  readonly runRoot: string
  /** 上游声明输出根，恒等于 `join(runRoot, 'contracts')`。 */
  readonly declarationRoot: string
  /** contracts 项目实际产出的 `.d.ts`。 */
  readonly emittedDeclarations: readonly string[]
  /** 样板消费者自己拥有的根文件（`files` / `include` 展开结果）。 */
  readonly ownedFiles: readonly string[]
  /** 消费者 Program 里非自有、非 lib、非 node_modules 的解析结果。 */
  readonly resolvedContracts: readonly string[]
  /** 消费者的真实类型检查错误（声明 identity 丢失会在这里暴露）。 */
  readonly diagnostics: readonly string[]
}

type ResolvedGraph = {
  readonly configPath: string
  readonly files: readonly string[]
  readonly relativeFiles: readonly string[]
  toContainPath(expectedPath: string): boolean
  matchingPaths(expectedPath: string): readonly string[]
}

const formatHost: ts.FormatDiagnosticsHost = {
  getCurrentDirectory: () => repoRoot,
  getCanonicalFileName: fileName => fileName,
  getNewLine: () => '\n',
}

expect.extend({
  toContainPath(received: ResolvedGraph, expectedPath: string) {
    const matches = received.matchingPaths(expectedPath)
    const pass = matches.length > 0

    return {
      pass,
      message: () => pass
        ? `expected ${received.configPath} not to resolve ${this.utils.printExpected(expectedPath)}, but its closure contains:\n${matches.join('\n')}`
        : `expected ${received.configPath} to resolve ${this.utils.printExpected(expectedPath)}; its closure has ${received.files.length} files`,
    }
  },
})

declare module 'vitest' {
  // Vitest declares this generic with `any`; module augmentation must match it exactly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Assertion<T = any> {
    toContainPath(expectedPath: string): T
  }
  interface AsymmetricMatchersContaining {
    toContainPath(expectedPath: string): unknown
  }
}

// 配置层的结构断言不建 Program，放在前面先出结论：图用例一旦被资源线打断，
// 这两条证据已经落地。
describe('layered typecheck project configs', () => {
  it('inherits skipLibCheck from the shared base and never redeclares it', async () => {
    await assertConfigsExist([BASE_CONFIG, ...REQUIRED_LAYER_CONFIGS])

    const baseRaw = await readRawConfig(resolveRepoPath(BASE_CONFIG))
    expect(baseRaw.compilerOptions?.skipLibCheck).toBe(true)

    const layerConfigs = await collectLayerConfigs()
    const facts = await Promise.all(layerConfigs.map(async layerConfig => ({
      config: layerConfig,
      extendsBase: (await resolveExtendsChain(resolveRepoPath(layerConfig)))
        .includes(resolveRepoPath(BASE_CONFIG)),
      // 原始 JSON 文本才能区分“自己声明”与“继承而来”；parseJsonConfigFileContent
      // 的最终结果合并过 extends，看不出是谁声明的。
      declaresSkipLibCheck: declaresCompilerOption(await readRawConfig(resolveRepoPath(layerConfig)), 'skipLibCheck'),
      effectiveSkipLibCheck: parseConfigFile(resolveRepoPath(layerConfig)).options.skipLibCheck,
    })))

    // toStrictEqual：toEqual 会剥掉 undefined 属性，未设置的 skipLibCheck 不能被吞掉。
    expect(facts).toStrictEqual(layerConfigs.map(layerConfig => ({
      config: layerConfig,
      extendsBase: true,
      declaresSkipLibCheck: false,
      effectiveSkipLibCheck: true,
    })))
  })

  it('never points committed configs at a persistent output directory', async () => {
    await assertConfigsExist([BASE_CONFIG, ...REQUIRED_LAYER_CONFIGS])

    const configs = [BASE_CONFIG, ...await collectLayerConfigs()]
    const facts = await Promise.all(configs.map(async config => ({
      config,
      persistentOutputs: persistentOutputOptions(await readRawConfig(resolveRepoPath(config))),
    })))

    expect(facts).toEqual(configs.map(config => ({ config, persistentOutputs: [] })))
  })
})

describe('layered typecheck project graph', () => {
  it('resolves the sample consumer to emitted declarations only', async () => {
    const runRoot = await createRunRoot()

    try {
      const trace = await buildAndTraceSample(runRoot)

      // 声明 identity 丢失 / paths 打偏时，这条给出确切的 TS 错误，
      // 比后面的空数组断言可诊断得多，所以放最前。
      expect(trace.diagnostics).toEqual([])
      expect(trace.declarationRoot).toBe(join(runRoot, DECLARATION_DIRECTORY_NAME))

      // 违规项列表形式：失败信息直接点名越界文件。
      expect(trace.resolvedContracts.filter(file => !file.startsWith(trace.declarationRoot))).toEqual([])
      expect(trace.resolvedContracts.filter(file => isNonDeclarationSource(file))).toEqual([])

      // 计划 Task 3 Step 1 的布尔契约形式，保持逐字可核对。
      expect(trace.resolvedContracts).not.toHaveLength(0)
      expect(trace.resolvedContracts.every(file => file.startsWith(join(runRoot, DECLARATION_DIRECTORY_NAME)))).toBe(true)
      expect(trace.resolvedContracts.some(file => file.endsWith('.ts') && !file.endsWith('.d.ts'))).toBe(false)
    }
    finally {
      await rm(runRoot, { recursive: true, force: true })
    }
  }, CONTRACTS_BUILD_TIMEOUT_MS)

  it('keeps contract closure free of composition roots', async () => {
    const graph = await collectResolvedGraph(resolveRepoPath(CONTRACTS_CONFIG))

    // 闭包为空会让下面四条 not.toContainPath 全部空转通过。
    expect(graph.files).not.toHaveLength(0)

    expect(graph).not.toContainPath('server/workspace-files/project-session.ts')
    expect(graph).not.toContainPath('server/workspace-history/project-history.ts')
    expect(graph).not.toContainPath('server/agent/harness')
    expect(graph).not.toContainPath('server/plot/index.ts')

    expect(FORBIDDEN_CONTRACT_PATHS.flatMap(forbidden => graph.matchingPaths(forbidden))).toEqual([])
  }, CONFIG_PARSE_TIMEOUT_MS)
})

/**
 * 真实构建 contracts 声明，再用样板消费者建 Program 并追踪它解析到了什么。
 *
 * 只返回字符串：Program 在本函数返回后即可被回收，避免把上游闭包留在测试内存里。
 */
async function buildAndTraceSample(runRoot: string): Promise<ResolutionTrace> {
  await assertConfigsExist([BASE_CONFIG, CONTRACTS_CONFIG, SAMPLE_CONSUMER_CONFIG])

  const declarationRoot = join(runRoot, DECLARATION_DIRECTORY_NAME)
  const contractsConfig = await writePerRunConfig(runRoot, 'tsconfig.contracts.json', {
    extends: resolveRepoPath(CONTRACTS_CONFIG),
    compilerOptions: {
      outDir: declarationRoot,
      declarationDir: declarationRoot,
      tsBuildInfoFile: join(runRoot, 'contracts.tsbuildinfo'),
    },
  })
  buildDeclarations(contractsConfig.path, contractsConfig.text)

  const emittedDeclarations = await listEmittedDeclarations(declarationRoot)
  if (emittedDeclarations.length === 0) {
    throw new Error([
      `contracts 构建返回成功，但 ${declarationRoot} 下没有任何 .d.ts。`,
      '典型根因：per-run 配置用了相对路径，outDir / declarationDir 落到了嵌套目录；',
      '或 committed contracts 配置的 include / files 没有覆盖任何输入。',
      '生成的 per-run 配置：',
      contractsConfig.text.trimEnd(),
    ].join('\n'))
  }

  const consumerRaw = await readRawConfig(resolveRepoPath(SAMPLE_CONSUMER_CONFIG))
  assertDeclarationRootPaths(consumerRaw, SAMPLE_CONSUMER_CONFIG)

  const consumerOutput = join(runRoot, 'consumer')
  const consumerConfig = await writePerRunConfig(runRoot, 'tsconfig.consumer.json', {
    extends: resolveRepoPath(SAMPLE_CONSUMER_CONFIG),
    // committed 配置里的 reference 指向 committed contracts（没有输出目录）；
    // per-run 里改指本次生成的 contracts 配置，才能让引用解析到本 run 的声明输出。
    ...(hasProjectReferences(consumerRaw) ? { references: [{ path: contractsConfig.path }] } : {}),
    compilerOptions: {
      outDir: consumerOutput,
      declarationDir: consumerOutput,
      tsBuildInfoFile: join(runRoot, 'consumer.tsbuildinfo'),
      // TypeScript 默认让 project reference 重定向回上游源码；本项目要证明的恰好
      // 是“只消费声明输出”，所以显式关掉源码重定向。
      disableSourceOfProjectReferenceRedirect: true,
    },
  })

  const parsedConsumer = parseConfigFile(consumerConfig.path)
  assertNoConfigErrors(parsedConsumer, consumerConfig.path, consumerConfig.text)

  const program = ts.createProgram({
    rootNames: parsedConsumer.fileNames,
    options: parsedConsumer.options,
    projectReferences: parsedConsumer.projectReferences,
  })

  return {
    runRoot,
    declarationRoot,
    emittedDeclarations,
    ownedFiles: parsedConsumer.fileNames.map(fileName => resolve(fileName)).sort(),
    resolvedContracts: collectExternalFiles(program, parsedConsumer),
    diagnostics: formatEachDiagnostic(ts.getPreEmitDiagnostics(program)),
  }
}

/**
 * 收集一个项目的解析闭包。
 *
 * 用 `parsed.fileNames` 而不是建 Program：composite 项目的 `files` 必须穷举整个闭包，
 * 少列任何一个都会 TS6307，而上一条用例的真实子进程构建已经证明 `files` 完整，
 * 所以 `fileNames` 就是闭包本身。建 Program 会把 ~850 MB 留在本测试进程，
 * 与 MemAvailable 底线冲突（所有权断言本来也不需要类型信息）。
 */
async function collectResolvedGraph(configPath: string): Promise<ResolvedGraph> {
  if (!await pathExists(configPath)) {
    throw new Error([
      `tsconfig 不存在，无法收集解析闭包：${configPath}`,
      '（计划：docs/superpowers/plans/2026-09-05-layered-typecheck-projects.md Task 3 Step 3）',
    ].join('\n'))
  }

  const parsed = parseConfigFile(configPath)
  assertNoConfigErrors(parsed, configPath)

  const files = parsed.fileNames
    .map(fileName => resolve(fileName))
    .filter(file => !isDependencyFile(file))
    .sort()
  const relativeFiles = files.map(file => toRepoRelative(file))

  return {
    configPath,
    files,
    relativeFiles,
    toContainPath: expectedPath => matchRepoPaths(relativeFiles, expectedPath).length > 0,
    matchingPaths: expectedPath => matchRepoPaths(relativeFiles, expectedPath),
  }
}

function buildDeclarations(configPath: string, generatedConfigText: string): void {
  // 子进程构建，而不是 ts.createSolutionBuilder。
  //
  // solution builder 会把 contracts 的完整 Program（实测单进程 ~870 MB）留在本测试
  // 进程里，叠加后面的消费者 Program 后越过 MemAvailable 底线（实测 group 1683704 KiB、
  // MemAvailable 掉到 2093316 KiB，被资源守卫止损）。生产 runner 也是每层一个子进程，
  // 这里保持同一条边界，测试才真正在被门禁的资源约束下运行。
  const result = spawnSync('bun', ['x', 'tsc', '-p', configPath], { encoding: 'utf8' })
  if (result.status === 0) return

  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trimEnd()
  throw new Error([
    `contracts 声明构建失败（${configPath}，退出码 ${result.status ?? 'signal ' + String(result.signal)}）。`,
    output,
    output.includes(`TS${UNLISTED_FILE_DIAGNOSTIC_CODE}`)
      ? 'TS6307：composite 项目必须用 files 穷举、或用 include 覆盖整个闭包；\n闭包里任何一个未列入的源码文件都会报这条。'
      : '',
    '生成的 per-run 配置：',
    generatedConfigText.trimEnd(),
  ].filter(Boolean).join('\n'))
}

function collectExternalFiles(program: ts.Program, parsed: ts.ParsedCommandLine): readonly string[] {
  const owned = new Set(parsed.fileNames.map(fileName => resolve(fileName)))

  return program.getSourceFiles()
    .filter(file => !program.isSourceFileDefaultLibrary(file))
    .map(file => resolve(file.fileName))
    .filter(file => !isDependencyFile(file))
    .filter(file => !owned.has(file))
    .sort()
}

function parseConfigFile(configPath: string): ts.ParsedCommandLine {
  const unrecoverable: ts.Diagnostic[] = []
  const host: ts.ParseConfigFileHost = {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      unrecoverable.push(diagnostic)
    },
  }
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, host)
  if (!parsed) {
    throw new Error(describeConfigFailure(`无法解析 tsconfig：${configPath}`, unrecoverable))
  }
  return parsed
}

function assertNoConfigErrors(
  parsed: ts.ParsedCommandLine,
  configPath: string,
  generatedConfigText?: string,
): void {
  const errors = parsed.errors.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
  if (errors.length === 0) return

  throw new Error(describeConfigFailure(`tsconfig 解析报错：${configPath}`, errors, generatedConfigText))
}

function describeConfigFailure(
  headline: string,
  diagnostics: readonly ts.Diagnostic[],
  generatedConfigText?: string,
): string {
  const lines = [headline, ts.formatDiagnostics(diagnostics, formatHost).trimEnd()]
  if (diagnostics.some(diagnostic => diagnostic.code === UNLISTED_FILE_DIAGNOSTIC_CODE)) {
    lines.push(
      'TS6307：composite 项目必须用 files 穷举、或用 include 覆盖整个闭包；',
      '闭包里任何一个未列入的源码文件都会报这条。',
    )
  }
  if (generatedConfigText !== undefined) {
    lines.push('生成的 per-run 配置：', generatedConfigText.trimEnd())
  }
  return lines.join('\n')
}

function formatEachDiagnostic(diagnostics: readonly ts.Diagnostic[]): readonly string[] {
  return diagnostics
    .filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
    .map(diagnostic => ts.formatDiagnostics([diagnostic], formatHost).trimEnd())
}

/**
 * 样板消费者必须用 configDir 模板表达声明根：
 * committed 配置里因此不出现任何持久输出目录，而 per-run 配置 extends 它之后，
 * 模板会被替换成入口配置所在目录（也就是 runRoot），paths 精确落在本 run 的声明根。
 */
function assertDeclarationRootPaths(raw: RawTsConfig, relativeConfigPath: string): void {
  const paths = raw.compilerOptions?.paths
  const targets = isPathsMap(paths) ? Object.values(paths).flat() : []
  if (targets.some(target => target.startsWith(CONFIG_DIR_TEMPLATE))) return

  throw new Error([
    `${relativeConfigPath} 的 compilerOptions.paths 必须用 ${CONFIG_DIR_TEMPLATE} 模板指向 per-run 声明根。`,
    'project reference 只排构建序、不建立模块别名：没有 paths，nbook/* 这类 specifier',
    '连解析都做不到（TS2307），更谈不上"只消费声明输出"。',
    `contracts 侧把 nbook/* 映射到仓库根，base 的 rootDir 又是仓库根，所以声明输出镜像仓库结构，`,
    `样板消费者对应写：{ "nbook/*": ["${CONFIG_DIR_TEMPLATE}/${DECLARATION_DIRECTORY_NAME}/*"] }`,
    `TypeScript 5.5+ 会把 ${CONFIG_DIR_TEMPLATE} 替换成入口配置所在目录；runner 生成的`,
    `per-run 配置就放在 <runRoot>/，于是 paths 落在 <runRoot>/${DECLARATION_DIRECTORY_NAME}/，`,
    'committed 配置里不出现持久输出目录。',
    `当前 paths targets：${JSON.stringify(targets)}`,
  ].join('\n'))
}

function persistentOutputOptions(raw: RawTsConfig): readonly string[] {
  const compilerOptions = raw.compilerOptions ?? {}
  return PERSISTENT_OUTPUT_OPTIONS.filter((option) => {
    if (!declaresCompilerOption(raw, option)) return false
    const value = compilerOptions[option]
    return !(typeof value === 'string' && value.startsWith(CONFIG_DIR_TEMPLATE))
  })
}

async function collectLayerConfigs(): Promise<readonly string[]> {
  const discovered = await discoverLayerConfigs()
  return [...new Set([...REQUIRED_LAYER_CONFIGS, ...discovered])].sort()
}

async function discoverLayerConfigs(): Promise<readonly string[]> {
  try {
    const entries = await readdir(resolveRepoPath(LAYER_CONFIG_ROOT), { recursive: true })
    return entries
      .map(entry => entry.split(sep).join('/'))
      .filter(entry => entry === 'tsconfig.json' || entry.endsWith('/tsconfig.json'))
      .map(entry => `${LAYER_CONFIG_ROOT}/${entry}`)
  }
  catch {
    return []
  }
}

/** 展开 extends 链；相对 specifier 按“声明它的那个配置文件所在目录”解析。 */
async function resolveExtendsChain(configPath: string, seen = new Set<string>()): Promise<readonly string[]> {
  if (seen.has(configPath)) return []
  seen.add(configPath)

  const raw = await readRawConfig(configPath)
  const parents = await Promise.all(toExtendsList(raw.extends)
    // 包 specifier（如 @nuxt/tsconfig）不参与本仓的 base 继承判定。
    .filter(specifier => specifier.startsWith('.') || isAbsolute(specifier))
    .map(specifier => resolveExtendsTarget(dirname(configPath), specifier)))
  const nested = await Promise.all(parents.map(parent => resolveExtendsChain(parent, seen)))
  return [...parents, ...nested.flat()]
}

async function resolveExtendsTarget(baseDirectory: string, specifier: string): Promise<string> {
  const target = resolve(baseDirectory, specifier)
  if (target.endsWith('.json')) return target
  if (await pathExists(`${target}.json`)) return `${target}.json`
  return join(target, 'tsconfig.json')
}

function toExtendsList(value: RawTsConfig['extends']): readonly string[] {
  if (typeof value === 'string') return [value]
  return value ?? []
}

async function readRawConfig(configPath: string): Promise<RawTsConfig> {
  const text = await readFile(configPath, 'utf8')
  const parsed = ts.parseConfigFileTextToJson(configPath, text)
  if (parsed.error) {
    throw new Error(describeConfigFailure(`tsconfig JSON 解析失败：${configPath}`, [parsed.error]))
  }
  return (parsed.config ?? {}) as RawTsConfig
}

function declaresCompilerOption(raw: RawTsConfig, option: string): boolean {
  return Object.prototype.hasOwnProperty.call(raw.compilerOptions ?? {}, option)
}

function hasProjectReferences(raw: RawTsConfig): boolean {
  return Array.isArray(raw.references) && raw.references.length > 0
}

function isPathsMap(value: unknown): value is Record<string, string[]> {
  if (typeof value !== 'object' || value === null) return false
  return Object.values(value).every(entry => Array.isArray(entry) && entry.every(item => typeof item === 'string'))
}

/**
 * 写一份 per-run 配置。注入值全部是绝对路径：tsconfig 的相对路径按“声明它的那个
 * 配置文件所在目录”解析，用相对路径会把输出落进嵌套目录。
 */
async function writePerRunConfig(
  runRoot: string,
  fileName: string,
  config: unknown,
): Promise<{ readonly path: string, readonly text: string }> {
  const path = join(runRoot, fileName)
  const text = `${JSON.stringify(config, null, 2)}\n`
  await writeFile(path, text, 'utf8')
  return { path, text }
}

async function createRunRoot(): Promise<string> {
  const typecheckTemporaryRoot = resolveRepoPath('.agent/tmp/typecheck')
  await mkdir(typecheckTemporaryRoot, { recursive: true })
  // realpath：Program 里的文件名是 realpath 化的，前缀断言必须比较同一形态。
  return realpath(await mkdtemp(join(typecheckTemporaryRoot, 'project-graph-')))
}

async function listEmittedDeclarations(directory: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(directory, { recursive: true })
    return entries
      .map(entry => entry.split(sep).join('/'))
      .filter(entry => entry.endsWith('.d.ts'))
      .map(entry => join(directory, entry))
      .sort()
  }
  catch {
    return []
  }
}

async function assertConfigsExist(relativePaths: readonly string[]): Promise<void> {
  const checked = await Promise.all(relativePaths.map(async relativePath => ({
    relativePath,
    exists: await pathExists(resolveRepoPath(relativePath)),
  })))
  const missing = checked.filter(entry => !entry.exists).map(entry => entry.relativePath)
  if (missing.length === 0) return

  throw new Error([
    'Task 3 的分层 typecheck 配置缺失，无法证明声明消费边界：',
    ...missing.map(entry => `  - ${entry}`),
    '（计划：docs/superpowers/plans/2026-09-05-layered-typecheck-projects.md Task 3 Step 3）',
  ].join('\n'))
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  }
  catch {
    return false
  }
}

function matchRepoPaths(relativeFiles: readonly string[], expectedPath: string): readonly string[] {
  const needle = expectedPath.replace(/^\.\//u, '').replace(/\/+$/u, '')
  return relativeFiles.filter(file => file === needle || file.startsWith(`${needle}/`))
}

function isNonDeclarationSource(file: string): boolean {
  return file.endsWith('.ts') && !file.endsWith('.d.ts')
}

function isDependencyFile(file: string): boolean {
  return file.split(sep).includes('node_modules')
}

function resolveRepoPath(relativePath: string): string {
  return resolve(repoRoot, relativePath)
}

function toRepoRelative(absolutePath: string): string {
  return relative(repoRoot, absolutePath).split(sep).join('/')
}
