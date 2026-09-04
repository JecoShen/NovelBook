import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { lock } from 'proper-lockfile'
import type { AbsoluteFsPath } from 'nbook/server/runtime/paths/file-path'

export const SOURCE_AUTHORING_TYPE_CACHE_SCHEMA = 'nbook.source-authoring-types/v1'
export const SOURCE_AUTHORING_TYPE_CACHE_MIN_AGE_MS = 10 * 60 * 1_000
export const SOURCE_AUTHORING_TYPE_CACHE_ORPHAN_BUDGET_BYTES = 256 * 1024 * 1024

const AUTHORING_TYPES_DIRECTORY = 'authoring-types'
const STAGING_DIRECTORY = '.staging'
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

/** 打开一个已经逐文件验证过的不可变声明投影。 */
export async function openSourceAuthoringTypeProjection(
  cacheRoot: AbsoluteFsPath,
): Promise<SourceAuthoringTypeProjection> {
  const authoringRoot = resolve(cacheRoot, AUTHORING_TYPES_DIRECTORY)
  await mkdir(authoringRoot, { recursive: true })

  const current = await readCurrent(authoringRoot)
  if (current) {
    const release = await acquirePublishLock(authoringRoot)
    try {
      const lockedCurrent = await readCurrent(authoringRoot)
      if (lockedCurrent) {
        await garbageCollect(authoringRoot, lockedCurrent.fingerprint).catch(() => undefined)
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
    const projectionModule = await import('nbook/scripts/build/authoring-sdk-type-projection')
    const result = await projectionModule.buildAuthoringSdkTypeProjection({ targetRoot: stagingRoot })
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
      const lockedCurrent = await readCurrent(authoringRoot)
      if (lockedCurrent) return lockedCurrent

      const targetRoot = join(authoringRoot, fingerprint)
      const existing = await validateProjection(targetRoot, fingerprint)
      if (existing) {
        await publishCurrent(authoringRoot, fingerprint)
        await garbageCollect(authoringRoot, fingerprint).catch(() => undefined)
        return existing
      }
      else {
        await rm(targetRoot, { recursive: true, force: true })
        await rename(stagingRoot, targetRoot)
        await publishCurrent(authoringRoot, fingerprint)
        const projection = projectionFromRoot(targetRoot, fingerprint)
        await garbageCollect(authoringRoot, fingerprint).catch(() => undefined)
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

async function readCurrent(authoringRoot: string): Promise<SourceAuthoringTypeProjection | null> {
  let pointer: CurrentPointer
  try {
    pointer = parseCurrent(await readFile(join(authoringRoot, CURRENT_FILE), 'utf8'))
  }
  catch (error) {
    if (isMissing(error)) return null
    return null
  }
  const root = join(authoringRoot, pointer.fingerprint)
  return validateProjection(root, pointer.fingerprint)
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

async function validateProjection(root: string, fingerprint: string): Promise<SourceAuthoringTypeProjection | null> {
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
    const sourcePath = resolve(process.cwd(), input.path)
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

async function garbageCollect(authoringRoot: string, currentFingerprint: string): Promise<void> {
  const now = Date.now()
  const candidates: Array<{ root: string, mtimeMs: number, bytes: number }> = []
  let orphanBytes = 0
  for (const entry of await readdir(authoringRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === STAGING_DIRECTORY || entry.name === currentFingerprint) continue
    if (!isFingerprint(entry.name)) continue
    const root = join(authoringRoot, entry.name)
    let manifest: ProjectionManifest
    try {
      manifest = parseManifest(await readFile(join(root, 'manifest.json'), 'utf8'))
    }
    catch {
      continue
    }
    if (manifest.fingerprint !== entry.name) continue
    const metadata = await stat(root).catch(() => null)
    if (!metadata || now - metadata.mtimeMs < SOURCE_AUTHORING_TYPE_CACHE_MIN_AGE_MS) continue
    const bytes = await directoryBytes(root)
    orphanBytes += bytes
    candidates.push({ root, mtimeMs: metadata.mtimeMs, bytes })
  }
  candidates.sort((left, right) => left.mtimeMs - right.mtimeMs)
  for (const candidate of candidates) {
    if (orphanBytes <= SOURCE_AUTHORING_TYPE_CACHE_ORPHAN_BUDGET_BYTES) break
    await rm(candidate.root, { recursive: true, force: true })
    orphanBytes -= candidate.bytes
  }
}

async function directoryBytes(root: string): Promise<number> {
  let bytes = 0
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile()) bytes += (await stat(path)).size
    }
  }
  await walk(root)
  return bytes
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
