import { createHash, randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lock } from 'proper-lockfile'
import { absoluteFsPath, type AbsoluteFsPath } from 'nbook/server/runtime/paths/file-path'

export const SOURCE_AUTHORING_TYPE_CACHE_SCHEMA = 'nbook.source-authoring-types/v1'
export const SOURCE_AUTHORING_TYPE_CACHE_MIN_AGE_MS = 10 * 60 * 1_000
export const SOURCE_AUTHORING_TYPE_CACHE_ORPHAN_BUDGET_BYTES = 256 * 1024 * 1024

const AUTHORING_TYPES_DIRECTORY = 'authoring-types'
const STAGING_DIRECTORY = '.staging'
const GC_QUARANTINE_DIRECTORY = '.gc-quarantine'
const CURRENT_FILE = 'current.json'
const PUBLISH_LOCK_FILE = '.publish.lock'

type ProjectionFile = Readonly<{
  path: string
  bytes: number
  sha256: string
}>

type ProjectionManifest = Readonly<{
  schema: typeof SOURCE_AUTHORING_TYPE_CACHE_SCHEMA
  fingerprint: string
  projectionSchema: string
  tsconfig: string
  dependencies: readonly Record<string, unknown>[]
  dependencyInstances: readonly Record<string, unknown>[]
  inputFiles: readonly ProjectionFile[]
  files: readonly ProjectionFile[]
  generatedAt: string
}>

type CurrentPointer = Readonly<{
  schema: typeof SOURCE_AUTHORING_TYPE_CACHE_SCHEMA
  fingerprint: string
}>

export type SourceAuthoringTypeProjection = Readonly<{
  fingerprint: string
  root: string
  typeRoot: string
  nodeModulesRoot: string
  tsconfigPath: string
}>

type SourceAuthoringTypeCacheGcTestHook = (stage: 'after-first-scan', quarantineRoot: string) => Promise<void> | void
let sourceAuthoringTypeCacheGcTestHook: SourceAuthoringTypeCacheGcTestHook | null = null

/** 仅供缓存测试注入受控 mutation；生产调用方不应设置此 hook。 */
export function setSourceAuthoringTypeCacheGcTestHook(hook: SourceAuthoringTypeCacheGcTestHook | null): void {
  sourceAuthoringTypeCacheGcTestHook = hook
}

/** 打开一个已经逐文件验证过的不可变声明投影。 */
export async function openSourceAuthoringTypeProjection(
  cacheRoot: AbsoluteFsPath,
  sourceRoot: AbsoluteFsPath = absoluteFsPath(process.cwd()),
): Promise<SourceAuthoringTypeProjection> {
  const absoluteSourceRoot = resolve(sourceRoot)
  const authoringRoot = resolve(cacheRoot, AUTHORING_TYPES_DIRECTORY)
  await mkdir(authoringRoot, { recursive: true })

  const current = await readCurrent(authoringRoot, absoluteSourceRoot)
  if (current) {
    const release = await acquirePublishLock(authoringRoot)
    try {
      const lockedCurrent = await readCurrent(authoringRoot, absoluteSourceRoot)
      if (lockedCurrent) {
        await garbageCollect(authoringRoot, lockedCurrent.fingerprint, absoluteSourceRoot).catch(() => undefined)
        return lockedCurrent
      }
    }
    finally {
      await release().catch(() => undefined)
    }
  }

  const stagingRoot = join(authoringRoot, STAGING_DIRECTORY, randomUUID())
  try {
    await mkdir(stagingRoot, { recursive: true })
    const projectionModule = await loadProjectionModule()
    // 构建结果只取决于内容身份（schema/tsconfig/输入清单，bun.lock 已含 TS 版本）；
    // 进程内 memo 让隔离 fixture/新 cacheRoot 免于重复 TS declaration emit（冷构建 10s+），
    // 命中时拷贝 memo 持有的完整快照并照常走验证发布，不产生未验证产物。
    // memo key 需要构建前输入清单；测试注入的投影模块可能不实现该成员，此时退化为无 memo 直建。
    const preInputs = typeof projectionModule.authoringSdkTypeProjectionInputFiles === 'function'
      ? normalizeFiles(await projectionModule.authoringSdkTypeProjectionInputFiles({ sourceRoot: absoluteSourceRoot }))
      : null
    const memoKey = preInputs ? projectionBuildMemoKey(projectionModule, preInputs) : null
    let fingerprint: string
    const memoHit = memoKey ? readProjectionBuildMemo(memoKey) : null
    if (memoHit && await memoPayloadIntoStaging(memoHit, stagingRoot, absoluteSourceRoot)) {
      fingerprint = memoHit.fingerprint
    }
    else {
      const result = await projectionModule.buildAuthoringSdkTypeProjection({ targetRoot: stagingRoot, sourceRoot: absoluteSourceRoot })
      const files = await projectionFiles(stagingRoot)
      const inputFiles = normalizeFiles(result.inputFiles)
      const tsconfig = projectionModule.authoringSdkTsconfig()
      fingerprint = projectionFingerprint({
        projectionSchema: projectionModule.AUTHORING_SDK_TYPE_PROJECTION_SCHEMA,
        tsconfig,
        dependencies: result.dependencies,
        dependencyInstances: result.dependencyInstances,
        inputFiles,
      })
      const manifest: ProjectionManifest = {
        schema: SOURCE_AUTHORING_TYPE_CACHE_SCHEMA,
        fingerprint,
        projectionSchema: projectionModule.AUTHORING_SDK_TYPE_PROJECTION_SCHEMA,
        tsconfig,
        dependencies: result.dependencies,
        dependencyInstances: result.dependencyInstances,
        inputFiles,
        files,
        generatedAt: new Date().toISOString(),
      }
      await writeFile(join(stagingRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
      if (memoKey) await rememberProjectionBuild(memoKey, fingerprint, stagingRoot)
    }

    const release = await acquirePublishLock(authoringRoot)
    try {
      const lockedCurrent = await readCurrent(authoringRoot, absoluteSourceRoot)
      if (lockedCurrent) return lockedCurrent

      const targetRoot = join(authoringRoot, fingerprint)
      const existing = await validateProjection(targetRoot, fingerprint, absoluteSourceRoot)
      if (existing) {
        await publishCurrent(authoringRoot, fingerprint)
        await garbageCollect(authoringRoot, fingerprint, absoluteSourceRoot).catch(() => undefined)
        return existing
      }
      else {
        await rm(targetRoot, { recursive: true, force: true })
        await rename(stagingRoot, targetRoot)
        await publishCurrent(authoringRoot, fingerprint)
        const projection = projectionFromRoot(targetRoot, fingerprint)
        await garbageCollect(authoringRoot, fingerprint, absoluteSourceRoot).catch(() => undefined)
        return projection
      }
    }
    finally {
      await release().catch(() => undefined)
    }
  }
  finally {
    // A candidate is private until rename; never sweep another process's staging.
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined)
  }
}

type ProjectionModuleLoader = () => Promise<AuthoringSdkTypeProjectionModule>
let projectionModuleLoaderForTest: ProjectionModuleLoader | null = null

/**
 * 仅供缓存测试注入受控投影模块；生产调用方不应设置。
 * 说明符必须保持非常量间接（见类型声明处注释），vi.mock 无法拦截非常量
 * dynamic import，测试因此需要显式接缝——与 GC hook 同一模式。
 */
export function setSourceAuthoringTypeCacheProjectionLoaderForTest(loader: ProjectionModuleLoader | null): void {
  projectionModuleLoaderForTest = loader
}

/** Worker 的 TS loader 可能不为运行时 dynamic import 应用 subpath imports；回退到同一 checkout 的源码文件。 */
async function loadProjectionModule(): Promise<AuthoringSdkTypeProjectionModule> {
  if (projectionModuleLoaderForTest) return await projectionModuleLoaderForTest()
  try {
    // 说明符经常量间接引用：tsc 不解析非常量 dynamic import，运行时解析行为不变。
    return await import(PROJECTION_SPECIFIER)
  }
  catch (error) {
    if (!isSpecifierResolutionFailure(error)) throw error
    // 本模块固定位于 <repo>/packages/neuro-book/server/runtime/，仓库根脚本在其上四级；
    // 回退路径相对模块 URL 推导，与调用方传入的 sourceRoot（应用包根）无关。
    return await import(new URL('../../../../scripts/build/authoring-sdk-type-projection.ts', import.meta.url).href)
  }
}

const PROJECTION_SPECIFIER = '#scripts/build/authoring-sdk-type-projection'

type ProjectionBuildMemoEntry = Readonly<{
  memoKey: string
  fingerprint: string
  payloadRoot: string
}>

/** memo 只按内容身份保留少量快照；源文件变更产生新 key，旧条目按插入序淘汰。 */
const PROJECTION_BUILD_MEMO_LIMIT = 4
const projectionBuildMemo = new Map<string, ProjectionBuildMemoEntry>()

function projectionBuildMemoKey(
  projectionModule: AuthoringSdkTypeProjectionModule,
  inputFiles: readonly ProjectionFile[],
): string {
  const identity = stableStringify({
    projectionSchema: projectionModule.AUTHORING_SDK_TYPE_PROJECTION_SCHEMA,
    tsconfig: projectionModule.authoringSdkTsconfig(),
    inputFiles,
  })
  return `sha256:${sha256(Buffer.from(identity, 'utf8'))}`
}

function readProjectionBuildMemo(memoKey: string): ProjectionBuildMemoEntry | null {
  const entry = projectionBuildMemo.get(memoKey)
  if (!entry) return null
  projectionBuildMemo.delete(memoKey)
  projectionBuildMemo.set(memoKey, entry)
  return entry
}

/** 把 memo 快照拷入 staging 并整树验证；任何一步失败都丢弃条目并清空 staging，由调用方回退完整构建。 */
async function memoPayloadIntoStaging(
  entry: ProjectionBuildMemoEntry,
  stagingRoot: string,
  sourceRoot: string,
): Promise<boolean> {
  try {
    await cp(entry.payloadRoot, stagingRoot, { recursive: true })
    if (await validateProjection(stagingRoot, entry.fingerprint, sourceRoot)) return true
  }
  catch {
    // fall through to rebuild
  }
  projectionBuildMemo.delete(entry.memoKey)
  await rm(entry.payloadRoot, { recursive: true, force: true }).catch(() => undefined)
  await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined)
  await mkdir(stagingRoot, { recursive: true })
  return false
}

/** memo 是优化不是正确性依赖：快照拷贝失败只意味着下次重建，不影响本次发布。 */
async function rememberProjectionBuild(memoKey: string, fingerprint: string, stagingRoot: string): Promise<void> {
  try {
    const payloadRoot = await mkdtemp(join(tmpdir(), 'nbook-authoring-projection-'))
    await cp(stagingRoot, payloadRoot, { recursive: true })
    projectionBuildMemo.set(memoKey, { memoKey, fingerprint, payloadRoot })
    while (projectionBuildMemo.size > PROJECTION_BUILD_MEMO_LIMIT) {
      const oldestKey = projectionBuildMemo.keys().next().value
      if (oldestKey === undefined) break
      const evicted = projectionBuildMemo.get(oldestKey)
      projectionBuildMemo.delete(oldestKey)
      if (evicted) await rm(evicted.payloadRoot, { recursive: true, force: true }).catch(() => undefined)
    }
  }
  catch {
    // 见函数注释
  }
}

/**
 * 投影生成器按治理合同登记豁免跨根引用，但编译期不静态链接它：任何把本模块纳入
 * 类型闭包的 tsc 程序（如 Product Authoring Kit 的声明 emitter）都没有 #scripts
 * 路径映射，静态 typeof import 或字面量 dynamic import 会让那些程序报 TS2307。
 * 这里只描述缓存实际消费的成员。
 */
type AuthoringSdkTypeProjectionModule = Readonly<{
  AUTHORING_SDK_TYPE_PROJECTION_SCHEMA: string
  authoringSdkTsconfig: () => string
  /** 构建前输入清单，仅供进程内 memo；测试注入的最小投影模块可不实现（退化为无 memo）。 */
  authoringSdkTypeProjectionInputFiles?: (input?: {
    sourceRoot?: string
    repositoryRoot?: string
  }) => Promise<{ path: string, sha256: string, bytes: number }[]>
  buildAuthoringSdkTypeProjection: (input: {
    targetRoot: string
    sourceRoot: string
    repositoryRoot?: string
  }) => Promise<Readonly<{
    dependencies: readonly Record<string, unknown>[]
    dependencyInstances: readonly Record<string, unknown>[]
    inputFiles: readonly { path: string, sha256: string, bytes: number }[]
  }>>
}>

/**
 * 只吞说明符解析失败；模块自身的执行错误必须冒泡，否则回退会把真实缺陷伪装成路径问题。
 * Bun 的 ResolveMessage 带 ERR_MODULE_NOT_FOUND code 但 instanceof Error 为 false（1.3.14
 * 实测），不能用 Error 窄化当先决；其 "Cannot find module" 消息精确包含未能解析的说明符，
 * 模块内部传递依赖解析失败时消息里是内层说明符，不会误吞。
 */
function isSpecifierResolutionFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'ERR_MODULE_NOT_FOUND' || code === 'ERR_PACKAGE_IMPORT_NOT_DEFINED') return true
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' && message.includes(`Cannot find module '${PROJECTION_SPECIFIER}'`)
}

async function acquirePublishLock(authoringRoot: string): Promise<() => Promise<void>> {
  const lockPath = join(authoringRoot, PUBLISH_LOCK_FILE)
  await writeFile(lockPath, '', { flag: 'a' })
  return lock(lockPath, {
    realpath: false,
    stale: SOURCE_AUTHORING_TYPE_CACHE_MIN_AGE_MS,
    update: 10_000,
    retries: { retries: 20, minTimeout: 50, maxTimeout: 250 },
  })
}

function projectionFromRoot(root: string, fingerprint: string): SourceAuthoringTypeProjection {
  return {
    fingerprint,
    root,
    typeRoot: join(root, 'types'),
    nodeModulesRoot: join(root, 'node_modules'),
    tsconfigPath: join(root, 'tsconfig.json'),
  }
}

async function readCurrent(authoringRoot: string, sourceRoot: string): Promise<SourceAuthoringTypeProjection | null> {
  let pointer: CurrentPointer
  try {
    pointer = parseCurrent(await readFile(join(authoringRoot, CURRENT_FILE), 'utf8'))
  }
  catch (error) {
    if (isMissing(error)) return null
    return null
  }
  const root = join(authoringRoot, pointer.fingerprint)
  try {
    return await validateProjection(root, pointer.fingerprint, sourceRoot)
  }
  catch {
    return null
  }
}

function parseCurrent(raw: string): CurrentPointer {
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid current pointer')
  const pointer = value as Partial<CurrentPointer>
  if (pointer.schema !== SOURCE_AUTHORING_TYPE_CACHE_SCHEMA || !isFingerprint(pointer.fingerprint)) {
    throw new Error('invalid current pointer')
  }
  return pointer as CurrentPointer
}

async function validateProjection(root: string, fingerprint: string, sourceRoot: string): Promise<SourceAuthoringTypeProjection | null> {
  let manifest: ProjectionManifest
  try {
    manifest = parseManifest(await readFile(join(root, 'manifest.json'), 'utf8'))
  }
  catch {
    return null
  }
  if (manifest.fingerprint !== fingerprint || projectionFingerprint(manifest) !== fingerprint) return null
  const actualFiles = await projectionFiles(root)
  if (JSON.stringify(actualFiles.filter(file => file.path !== 'manifest.json')) !== JSON.stringify(manifest.files)) return null
  for (const file of manifest.files) {
    if (!isSafeRelativePath(file.path)) return null
    const actualPath = resolve(root, file.path)
    try {
      const bytes = await readFile(actualPath)
      if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) return null
    }
    catch {
      return null
    }
  }
  for (const input of manifest.inputFiles) {
    if (!isSafeRelativePath(input.path)) return null
    const bytes = await readProjectionInput(sourceRoot, input.path)
    if (!bytes || bytes.length !== input.bytes || sha256(bytes) !== input.sha256) return null
  }
  return projectionFromRoot(root, fingerprint)
}

/** 本模块固定位于 <repo>/packages/neuro-book/server/runtime/，仓库根在其上四级。 */
const MODULE_REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')

/**
 * 输入清单按稳定逻辑路径记录，但拆包后 bun.lock 只在仓库根、SDK 源码在应用包根；
 * 先按应用包根读，ENOENT 再按仓库根读（两根源文件不重叠，无歧义）。
 */
async function readProjectionInput(sourceRoot: string, inputPath: string): Promise<Buffer | null> {
  try {
    return await readFile(resolve(sourceRoot, inputPath))
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') return null
    try {
      return await readFile(resolve(MODULE_REPOSITORY_ROOT, inputPath))
    }
    catch {
      return null
    }
  }
}

function parseManifest(raw: string): ProjectionManifest {
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid projection manifest')
  const manifest = value as Partial<ProjectionManifest>
  if (manifest.schema !== SOURCE_AUTHORING_TYPE_CACHE_SCHEMA
    || !isFingerprint(manifest.fingerprint)
    || typeof manifest.projectionSchema !== 'string'
    || typeof manifest.tsconfig !== 'string'
    || !Array.isArray(manifest.dependencies)
    || !Array.isArray(manifest.dependencyInstances)
    || !Array.isArray(manifest.inputFiles)
    || !Array.isArray(manifest.files)) {
    throw new Error('invalid projection manifest')
  }
  const inputFiles = normalizeFiles(manifest.inputFiles)
  const files = normalizeFiles(manifest.files)
  if (!sameFiles(inputFiles, manifest.inputFiles) || !sameFiles(files, manifest.files)) {
    throw new Error('non-canonical projection manifest inventory')
  }
  return { ...manifest, inputFiles, files } as ProjectionManifest
}

function projectionFingerprint(input: Pick<ProjectionManifest, 'projectionSchema' | 'tsconfig' | 'dependencies' | 'dependencyInstances' | 'inputFiles'>): string {
  const identity = stableStringify({
    schema: SOURCE_AUTHORING_TYPE_CACHE_SCHEMA,
    projectionSchema: input.projectionSchema,
    tsconfig: input.tsconfig,
    dependencies: input.dependencies,
    dependencyInstances: input.dependencyInstances,
    inputFiles: normalizeFiles(input.inputFiles),
  })
  return `sha256:${sha256(Buffer.from(identity, 'utf8'))}`
}

function normalizeFiles(files: readonly ProjectionFile[]): ProjectionFile[] {
  return [...files]
    .map(file => ({ path: file.path.replaceAll('\\', '/'), bytes: file.bytes, sha256: file.sha256 }))
    .sort((left, right) => left.path.localeCompare(right.path))
}

function sameFiles(left: readonly ProjectionFile[], right: readonly ProjectionFile[]): boolean {
  return JSON.stringify(left) === JSON.stringify(normalizeFiles(right))
}

function isSafeRelativePath(path: string): boolean {
  return path.length > 0 && !isAbsolute(path) && path !== '.' && !path.split('/').some(segment => segment === '..' || segment === '')
}

function isFingerprint(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value)
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

async function projectionFiles(root: string): Promise<ProjectionFile[]> {
  const files: ProjectionFile[] = []
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile()) {
        const bytes = await readFile(path)
        files.push({ path: relative(root, path).split(/[\\/]+/u).join('/'), bytes: bytes.length, sha256: sha256(bytes) })
      }
      else throw new Error(`Source authoring type projection 含特殊文件：${path}`)
    }
  }
  await walk(root)
  return normalizeFiles(files)
}

async function publishCurrent(authoringRoot: string, fingerprint: string): Promise<void> {
  const tempPath = join(authoringRoot, `.${CURRENT_FILE}.${randomUUID()}.tmp`)
  try {
    await writeFile(tempPath, `${JSON.stringify({ schema: SOURCE_AUTHORING_TYPE_CACHE_SCHEMA, fingerprint }, null, 2)}\n`, 'utf8')
    await rename(tempPath, join(authoringRoot, CURRENT_FILE))
  }
  finally {
    await rm(tempPath, { force: true }).catch(() => undefined)
  }
}

type GcCandidate = {
  originalRoot: string
  quarantineRoot: string
  mtimeMs: number
  bytes: number
}

type GcTreeFile = {
  path: string
  bytes: number
  mtimeMs: number
  dev: number
  ino: number
}

type GcTreeScan = {
  safe: boolean
  bytes: number
  files: GcTreeFile[]
  manifest?: ProjectionManifest
}

async function garbageCollect(authoringRoot: string, currentFingerprint: string, sourceRoot: string): Promise<void> {
  const now = Date.now()
  const quarantineRoot = join(authoringRoot, GC_QUARANTINE_DIRECTORY)
  const safeCandidates = await recoverGcQuarantine(authoringRoot, quarantineRoot, now, sourceRoot)
  const candidates: GcCandidate[] = []
  for (const entry of await readdir(authoringRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === STAGING_DIRECTORY || entry.name === GC_QUARANTINE_DIRECTORY || entry.name === currentFingerprint) continue
    if (!isFingerprint(entry.name)) continue
    const root = join(authoringRoot, entry.name)
    const metadata = await stat(root).catch(() => null)
    if (!metadata || now - metadata.mtimeMs < SOURCE_AUTHORING_TYPE_CACHE_MIN_AGE_MS) continue
    candidates.push({ originalRoot: root, quarantineRoot: '', mtimeMs: metadata.mtimeMs, bytes: 0 })
  }
  candidates.sort((left, right) => left.mtimeMs - right.mtimeMs)
  await mkdir(quarantineRoot, { recursive: true })
  for (const candidate of candidates) {
    const candidateName = candidate.originalRoot.slice(authoringRoot.length + 1)
    const candidateQuarantineRoot = join(quarantineRoot, `${candidateName}-${randomUUID()}`)
    try {
      await rename(candidate.originalRoot, candidateQuarantineRoot)
    }
    catch {
      continue
    }
    const firstScan = await scanGcTree(candidateQuarantineRoot, candidateName)
    if (!firstScan.safe) {
      await restoreGcCandidate(candidate.originalRoot, candidateQuarantineRoot)
      continue
    }
    await sourceAuthoringTypeCacheGcTestHook?.('after-first-scan', candidateQuarantineRoot)
    const secondScan = await scanGcTree(candidateQuarantineRoot, candidateName)
    if (!secondScan.safe || !sameGcTree(firstScan, secondScan)) {
      await restoreGcCandidate(candidate.originalRoot, candidateQuarantineRoot)
      continue
    }
    safeCandidates.push({
      ...candidate,
      quarantineRoot: candidateQuarantineRoot,
      bytes: secondScan.bytes,
    })
  }

  safeCandidates.sort((left, right) => left.mtimeMs - right.mtimeMs)
  let orphanBytes = safeCandidates.reduce((total, candidate) => total + candidate.bytes, 0)
  for (const candidate of safeCandidates) {
    if (orphanBytes <= SOURCE_AUTHORING_TYPE_CACHE_ORPHAN_BUDGET_BYTES) {
      if (candidate.originalRoot) await restoreGcCandidate(candidate.originalRoot, candidate.quarantineRoot)
      continue
    }
    await rm(candidate.quarantineRoot, { recursive: true, force: true })
    orphanBytes -= candidate.bytes
  }
}

/** 处理进程崩溃遗留的本模块 quarantine；未知和不安全内容永远留在原处。 */
async function recoverGcQuarantine(authoringRoot: string, quarantineRoot: string, now: number, sourceRoot: string): Promise<GcCandidate[]> {
  const safeCandidates: GcCandidate[] = []
  const entries = await readdir(quarantineRoot, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const fingerprint = quarantineFingerprint(entry.name)
    if (!fingerprint) continue
    const quarantinePath = join(quarantineRoot, entry.name)
    const metadata = await stat(quarantinePath).catch(() => null)
    if (!metadata || now - metadata.mtimeMs < SOURCE_AUTHORING_TYPE_CACHE_MIN_AGE_MS) continue
    const firstScan = await scanGcTree(quarantinePath, fingerprint)
    if (!firstScan.safe) continue
    const secondScan = await scanGcTree(quarantinePath, fingerprint)
    if (!secondScan.safe || !sameGcTree(firstScan, secondScan)) continue

    const originalPath = join(authoringRoot, fingerprint)
    const existing = await validateProjection(originalPath, fingerprint, sourceRoot).catch(() => null)
    if (existing) {
      await rm(quarantinePath, { recursive: true, force: true })
      continue
    }
    if (await pathExists(originalPath)) {
      safeCandidates.push({ originalRoot: '', quarantineRoot: quarantinePath, mtimeMs: metadata.mtimeMs, bytes: secondScan.bytes })
      continue
    }
    try {
      await rename(quarantinePath, originalPath)
      await utimes(originalPath, new Date(), new Date()).catch(() => undefined)
    }
    catch {
      // Restore failure retains the private quarantine for a later GC attempt.
    }
  }
  return safeCandidates
}

function quarantineFingerprint(name: string): string | null {
  const fingerprint = /^(sha256:[0-9a-f]{64})-.+$/u.exec(name)?.[1]
  return fingerprint && isFingerprint(fingerprint) ? fingerprint : null
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  }
  catch {
    return false
  }
}

async function scanGcTree(root: string, expectedFingerprint: string): Promise<GcTreeScan> {
  const files: GcTreeFile[] = []
  let safe = true
  const walk = async (directory: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    }
    catch {
      safe = false
      return
    }
    for (const entry of entries) {
      const path = join(directory, entry.name)
      let metadata
      try {
        metadata = await lstat(path)
      }
      catch {
        safe = false
        continue
      }
      if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) {
        safe = false
        continue
      }
      if (metadata.isDirectory()) {
        await walk(path)
        continue
      }
      files.push({
        path: relative(root, path).split(/[\\/]+/u).join('/'),
        bytes: metadata.size,
        mtimeMs: metadata.mtimeMs,
        dev: metadata.dev,
        ino: metadata.ino,
      })
    }
  }
  await walk(root)
  if (!safe) return { safe: false, bytes: 0, files }

  const manifestFile = files.find(file => file.path === 'manifest.json')
  if (!manifestFile) return { safe: false, bytes: 0, files }
  let manifest: ProjectionManifest
  try {
    manifest = parseManifest(await readFile(join(root, 'manifest.json'), 'utf8'))
  }
  catch {
    return { safe: false, bytes: 0, files }
  }
  if (manifest.fingerprint !== expectedFingerprint || projectionFingerprint(manifest) !== expectedFingerprint) {
    return { safe: false, bytes: 0, files }
  }
  return {
    safe: true,
    bytes: files.reduce((total, file) => total + file.bytes, 0),
    files,
    manifest,
  }
}

function sameGcTree(left: GcTreeScan, right: GcTreeScan): boolean {
  return JSON.stringify(left.files) === JSON.stringify(right.files)
    && left.manifest?.fingerprint === right.manifest?.fingerprint
}

/** 恢复时只 rename 到空缺原路径，绝不覆盖并发发布的新目录。 */
async function restoreGcCandidate(originalRoot: string, quarantineRoot: string): Promise<void> {
  try {
    await rename(quarantineRoot, originalRoot)
  }
  catch {
    // 原路径若已被新发布占用，保留 quarantine 内容，宁可泄漏也不覆盖新 owner。
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
