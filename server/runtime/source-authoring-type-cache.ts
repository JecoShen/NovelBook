import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
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
    const projectionModule = await loadProjectionModule(absoluteSourceRoot)
    const result = await projectionModule.buildAuthoringSdkTypeProjection({ targetRoot: stagingRoot, sourceRoot: absoluteSourceRoot })
    const files = await projectionFiles(stagingRoot)
    const inputFiles = normalizeFiles(result.inputFiles)
    const tsconfig = projectionModule.authoringSdkTsconfig()
    const fingerprint = projectionFingerprint({
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

/** Worker 的 TS loader 可能不为运行时 dynamic import 应用 tsconfig alias；回退到同一 checkout 的源码文件。 */
async function loadProjectionModule(sourceRoot: string): Promise<typeof import('nbook/scripts/build/authoring-sdk-type-projection')> {
  try {
    return await import('nbook/scripts/build/authoring-sdk-type-projection')
  }
  catch (error) {
    if (!(error instanceof Error) || !error.message.includes('Cannot find package \'nbook\'')) throw error
    return await import(pathToFileURL(resolve(sourceRoot, 'scripts/build/authoring-sdk-type-projection.ts')).href)
  }
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
    const sourcePath = resolve(sourceRoot, input.path)
    try {
      const bytes = await readFile(sourcePath)
      if (bytes.length !== input.bytes || sha256(bytes) !== input.sha256) return null
    }
    catch {
      return null
    }
  }
  return projectionFromRoot(root, fingerprint)
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
