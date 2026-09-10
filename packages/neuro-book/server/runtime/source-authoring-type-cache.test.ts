import { createHash } from 'node:crypto'
import { access, copyFile, cp, mkdir, mkdtemp, readFile, readdir, rename, symlink, truncate, rm, utimes, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { absoluteFsPath } from 'nbook/server/runtime/paths/file-path'
import {
  SOURCE_AUTHORING_TYPE_CACHE_MIN_AGE_MS,
  SOURCE_AUTHORING_TYPE_CACHE_ORPHAN_BUDGET_BYTES,
  SOURCE_AUTHORING_TYPE_CACHE_SCHEMA,
  openSourceAuthoringTypeProjection,
  setSourceAuthoringTypeCacheGcTestHook,
} from 'nbook/server/runtime/source-authoring-type-cache'

const projectionMock = vi.hoisted(() => ({
  buildCalls: 0,
  sourceVersion: 'one',
  failBuild: false,
  sourceRoots: [] as string[],
  inputSourceRoot: '',
}))
const MOCK_INPUT_PATH = '.agent/tmp/source-authoring-type-cache-input.txt'

function mockInputBytes(sourceRoot = projectionMock.inputSourceRoot || process.cwd()): Buffer {
  return readFileSync(resolve(sourceRoot, MOCK_INPUT_PATH))
}

vi.mock('nbook/scripts/build/authoring-sdk-type-projection', () => ({
  AUTHORING_SDK_TYPE_PROJECTION_SCHEMA: 'nbook.authoring-sdk-type-projection/v2',
  AUTHORING_SDK_DEPENDENCIES: [{
    name: 'mock-sdk',
    kind: 'types',
    purpose: 'test',
    smoke: 'test',
  }],
  authoringSdkTsconfig: () => `${JSON.stringify({ compilerOptions: { strict: true }, sourceVersion: projectionMock.sourceVersion })}\n`,
  authoringSdkTypeProjectionInputFiles: async ({ sourceRoot }: { sourceRoot?: string } = {}) => [{
    path: MOCK_INPUT_PATH,
    sha256: createHash('sha256').update(mockInputBytes(sourceRoot)).digest('hex'),
    bytes: mockInputBytes(sourceRoot).length,
  }],
  buildAuthoringSdkTypeProjection: async ({ targetRoot, sourceRoot }: { targetRoot: string, sourceRoot?: string }) => {
    if (projectionMock.failBuild) throw new Error('injected projection failure')
    projectionMock.buildCalls += 1
    projectionMock.sourceRoots.push(sourceRoot ?? '')
    await mkdir(join(targetRoot, 'types', 'profile-sdk'), { recursive: true })
    await mkdir(join(targetRoot, 'node_modules', '@types', 'node'), { recursive: true })
    await writeFile(join(targetRoot, 'types', 'profile-sdk', 'index.d.ts'), 'export type Profile = true\n', 'utf8')
    await writeFile(join(targetRoot, 'node_modules', '@types', 'node', 'index.d.ts'), 'export type Node = true\n', 'utf8')
    await writeFile(join(targetRoot, 'tsconfig.json'), `${JSON.stringify({ compilerOptions: { strict: true }, sourceVersion: projectionMock.sourceVersion })}\n`, 'utf8')
    return {
      declarationFiles: 1,
      declarationBytes: 27,
      dependencyFiles: 1,
      dependencyBytes: 24,
      dependencies: [{
        name: 'mock-sdk',
        kind: 'types',
        purpose: 'test',
        smoke: 'test',
        version: '1.0.0',
      }],
      dependencyInstances: [{
        name: 'mock-sdk',
        version: '1.0.0',
        kind: 'types',
        location: 'mock-sdk',
        topLevel: true,
      }],
      inputFiles: [{
        path: MOCK_INPUT_PATH,
        sha256: createHash('sha256').update(mockInputBytes(sourceRoot)).digest('hex'),
        bytes: mockInputBytes(sourceRoot).length,
      }],
    }
  },
}))

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  await rm(resolve(process.cwd(), MOCK_INPUT_PATH), { force: true })
  projectionMock.buildCalls = 0
  projectionMock.sourceVersion = 'one'
  projectionMock.failBuild = false
  projectionMock.sourceRoots = []
  projectionMock.inputSourceRoot = ''
})

async function cacheRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'nbook-source-authoring-types-'))
  roots.push(root)
  await mkdir(resolve(process.cwd(), '.agent/tmp'), { recursive: true })
  await writeFile(resolve(process.cwd(), MOCK_INPUT_PATH), projectionMock.sourceVersion, 'utf8')
  return root
}

async function setSourceVersion(version: string): Promise<void> {
  projectionMock.sourceVersion = version
  await writeFile(resolve(process.cwd(), MOCK_INPUT_PATH), version, 'utf8')
}

async function projectionDirectories(root: string): Promise<string[]> {
  return (await readdir(join(root, 'authoring-types'), { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && !['.staging', '.gc-quarantine'].includes(entry.name))
    .map(entry => entry.name)
    .sort()
}

describe('Source authoring type projection cache', () => {
  it('显式 sourceRoot 使投影生成和输入校验不依赖 process.cwd', async () => {
    const root = await cacheRoot()
    const sourceRoot = await mkdtemp(join(tmpdir(), 'nbook-source-authoring-source-'))
    const unrelatedCwd = await mkdtemp(join(tmpdir(), 'nbook-source-authoring-cwd-'))
    roots.push(sourceRoot, unrelatedCwd)
    await mkdir(join(sourceRoot, '.agent', 'tmp'), { recursive: true })
    await writeFile(join(sourceRoot, MOCK_INPUT_PATH), projectionMock.sourceVersion, 'utf8')
    projectionMock.inputSourceRoot = sourceRoot

    const previousCwd = process.cwd()
    process.chdir(unrelatedCwd)
    try {
      const projection = await openSourceAuthoringTypeProjection(absoluteFsPath(root), absoluteFsPath(sourceRoot))
      expect(projection.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u)
      expect(projectionMock.sourceRoots).toEqual([absoluteFsPath(sourceRoot)])
    }
    finally {
      process.chdir(previousCwd)
    }
  })

  it('首次生成并发布，随后复用相同 fingerprint 路径', async () => {
    const root = await cacheRoot()

    const first = await openSourceAuthoringTypeProjection(absoluteFsPath(root))
    const second = await openSourceAuthoringTypeProjection(absoluteFsPath(root))

    expect(first.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u)
    expect(second).toEqual(first)
    expect(projectionMock.buildCalls).toBe(1)
    await expect(readFile(join(first.root, 'manifest.json'), 'utf8')).resolves.toContain(SOURCE_AUTHORING_TYPE_CACHE_SCHEMA)
    await expect(access(join(first.typeRoot, 'profile-sdk', 'index.d.ts'))).resolves.toBeUndefined()
    await expect(access(join(first.nodeModulesRoot, '@types', 'node', 'index.d.ts'))).resolves.toBeUndefined()
  })

  it('损坏 manifest 后重建并重新发布', async () => {
    const root = await cacheRoot()
    const first = await openSourceAuthoringTypeProjection(absoluteFsPath(root))
    await writeFile(join(first.root, 'manifest.json'), '{"schema":"corrupt"}\n', 'utf8')

    const rebuilt = await openSourceAuthoringTypeProjection(absoluteFsPath(root))

    expect(rebuilt.fingerprint).toBe(first.fingerprint)
    expect(rebuilt.root).toBe(first.root)
    expect(projectionMock.buildCalls).toBe(2)
    await expect(readFile(join(rebuilt.root, 'manifest.json'), 'utf8')).resolves.toContain(SOURCE_AUTHORING_TYPE_CACHE_SCHEMA)
  })

  it('两个并发 miss 最终只产生一个 current fingerprint 目录', async () => {
    const root = await cacheRoot()

    const [left, right] = await Promise.all([
      openSourceAuthoringTypeProjection(absoluteFsPath(root)),
      openSourceAuthoringTypeProjection(absoluteFsPath(root)),
    ])

    expect(left.fingerprint).toBe(right.fingerprint)
    expect(left.root).toBe(right.root)
    expect(await projectionDirectories(root)).toEqual([left.fingerprint])
    expect(projectionMock.buildCalls).toBe(2)
  })

  it('GC 保留 current、年轻 owned orphan 和未知目录，超预算时删除最旧 owned orphan', async () => {
    const root = await cacheRoot()
    const first = await openSourceAuthoringTypeProjection(absoluteFsPath(root))
    await setSourceVersion('two')
    const young = await openSourceAuthoringTypeProjection(absoluteFsPath(root))
    await setSourceVersion('three')
    const current = await openSourceAuthoringTypeProjection(absoluteFsPath(root))
    const authoringRoot = join(root, 'authoring-types')
    const unknownFingerprint = 'unknown-directory'
    const now = Date.now()

    await truncate(join(first.root, 'types', 'profile-sdk', 'index.d.ts'), SOURCE_AUTHORING_TYPE_CACHE_ORPHAN_BUDGET_BYTES)
    await utimes(first.root, new Date(now - SOURCE_AUTHORING_TYPE_CACHE_MIN_AGE_MS - 2_000), new Date(now - SOURCE_AUTHORING_TYPE_CACHE_MIN_AGE_MS - 2_000))
    await mkdir(join(authoringRoot, unknownFingerprint))
    await utimes(join(authoringRoot, unknownFingerprint), new Date(now - SOURCE_AUTHORING_TYPE_CACHE_MIN_AGE_MS - 3_000), new Date(now - SOURCE_AUTHORING_TYPE_CACHE_MIN_AGE_MS - 3_000))

    await openSourceAuthoringTypeProjection(absoluteFsPath(root))

    await expect(access(first.root)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(young.root)).resolves.toBeUndefined()
    await expect(access(join(authoringRoot, unknownFingerprint))).resolves.toBeUndefined()
    await expect(access(current.root)).resolves.toBeUndefined()
  })

  it('GC 保留目录名匹配但内容 fingerprint 不一致的伪造 manifest', async () => {
    const root = await cacheRoot()
    const current = await openSourceAuthoringTypeProjection(absoluteFsPath(root))
    const authoringRoot = join(root, 'authoring-types')
    const forgedFingerprint = `sha256:${'c'.repeat(64)}`
    const forgedRoot = join(authoringRoot, forgedFingerprint)
    const manifest = JSON.parse(await readFile(join(current.root, 'manifest.json'), 'utf8')) as Record<string, unknown>

    await mkdir(join(forgedRoot, 'types'), { recursive: true })
    await writeFile(join(forgedRoot, 'manifest.json'), `${JSON.stringify({ ...manifest, fingerprint: forgedFingerprint })}\n`, 'utf8')
    await writeFile(join(forgedRoot, 'types', 'payload.bin'), '', 'utf8')
    await truncate(join(forgedRoot, 'types', 'payload.bin'), SOURCE_AUTHORING_TYPE_CACHE_ORPHAN_BUDGET_BYTES)
    await utimes(forgedRoot, new Date(Date.now() - SOURCE_AUTHORING_TYPE_CACHE_MIN_AGE_MS - 1_000), new Date(Date.now() - SOURCE_AUTHORING_TYPE_CACHE_MIN_AGE_MS - 1_000))

    await openSourceAuthoringTypeProjection(absoluteFsPath(root))

    await expect(access(forgedRoot)).resolves.toBeUndefined()
  })

  it('GC 遇到 owned candidate 内的 symlink 时保留整个 candidate，包括 symlink manifest', async () => {
    const root = await cacheRoot()
    const first = await openSourceAuthoringTypeProjection(absoluteFsPath(root))
    await setSourceVersion('two')
    const second = await openSourceAuthoringTypeProjection(absoluteFsPath(root))
    const authoringRoot = join(root, 'authoring-types')
    const externalManifest = join(authoringRoot, 'manifest-target.json')
    const firstManifest = join(first.root, 'manifest.json')
    await copyFile(firstManifest, externalManifest)
    await rm(firstManifest)
    await symlink(externalManifest, firstManifest)
    await truncate(join(first.root, 'types', 'profile-sdk', 'index.d.ts'), SOURCE_AUTHORING_TYPE_CACHE_ORPHAN_BUDGET_BYTES)
    const old = new Date(Date.now() - SOURCE_AUTHORING_TYPE_CACHE_MIN_AGE_MS - 1_000)
    await utimes(first.root, old, old)

    await setSourceVersion('three')
    await openSourceAuthoringTypeProjection(absoluteFsPath(root))

    await expect(access(first.root)).resolves.toBeUndefined()
    await expect(access(second.root)).resolves.toBeUndefined()
  })

  it('GC 在 quarantine 首次扫描后发生 mutation 时拒绝删除并恢复 candidate', async () => {
    const root = await cacheRoot()
    const first = await openSourceAuthoringTypeProjection(absoluteFsPath(root))
    await setSourceVersion('two')
    const current = await openSourceAuthoringTypeProjection(absoluteFsPath(root))
    const mutationTarget = join(current.root, 'manifest.json')
    await truncate(join(first.root, 'types', 'profile-sdk', 'index.d.ts'), SOURCE_AUTHORING_TYPE_CACHE_ORPHAN_BUDGET_BYTES)
    const old = new Date(Date.now() - SOURCE_AUTHORING_TYPE_CACHE_MIN_AGE_MS - 1_000)
    await utimes(first.root, old, old)

    let injected = false
    setSourceAuthoringTypeCacheGcTestHook(async (stage, quarantineRoot) => {
      if (stage !== 'after-first-scan' || injected) return
      injected = true
      await symlink(mutationTarget, join(quarantineRoot, 'mutation-link'))
    })
    try {
      await openSourceAuthoringTypeProjection(absoluteFsPath(root))
    }
    finally {
      setSourceAuthoringTypeCacheGcTestHook(null)
    }

    await expect(access(first.root)).resolves.toBeUndefined()
    await expect(access(current.root)).resolves.toBeUndefined()
    expect(injected).toBe(true)
  })

  it('后续 GC 会恢复合法的 crash quarantine candidate', async () => {
    const root = await cacheRoot()
    const first = await openSourceAuthoringTypeProjection(absoluteFsPath(root))
    await setSourceVersion('two')
    const current = await openSourceAuthoringTypeProjection(absoluteFsPath(root))
    const authoringRoot = join(root, 'authoring-types')
    const quarantineRoot = join(authoringRoot, '.gc-quarantine', `${first.fingerprint}-crash`)
    const old = new Date(Date.now() - SOURCE_AUTHORING_TYPE_CACHE_MIN_AGE_MS - 1_000)
    await rename(first.root, quarantineRoot)
    await utimes(quarantineRoot, old, old)

    await openSourceAuthoringTypeProjection(absoluteFsPath(root))

    await expect(access(first.root)).resolves.toBeUndefined()
    await expect(access(quarantineRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(current.root)).resolves.toBeUndefined()
  })

  it('原 fingerprint 路径已有有效 current 时回收重复 quarantine candidate', async () => {
    const root = await cacheRoot()
    const current = await openSourceAuthoringTypeProjection(absoluteFsPath(root))
    const authoringRoot = join(root, 'authoring-types')
    const quarantineRoot = join(authoringRoot, '.gc-quarantine', `${current.fingerprint}-duplicate`)
    const old = new Date(Date.now() - SOURCE_AUTHORING_TYPE_CACHE_MIN_AGE_MS - 1_000)
    await cp(current.root, quarantineRoot, { recursive: true })
    await utimes(quarantineRoot, old, old)

    await openSourceAuthoringTypeProjection(absoluteFsPath(root))

    await expect(access(current.root)).resolves.toBeUndefined()
    await expect(access(quarantineRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('未知或 unsafe quarantine candidate 永久保留且不参与递归删除', async () => {
    const root = await cacheRoot()
    const current = await openSourceAuthoringTypeProjection(absoluteFsPath(root))
    const authoringRoot = join(root, 'authoring-types')
    const quarantineRoot = join(authoringRoot, '.gc-quarantine')
    const unknownRoot = join(quarantineRoot, 'unknown-quarantine')
    const unsafeRoot = join(quarantineRoot, `${current.fingerprint}-unsafe`)
    const externalManifest = join(authoringRoot, 'quarantine-manifest-target.json')
    const old = new Date(Date.now() - SOURCE_AUTHORING_TYPE_CACHE_MIN_AGE_MS - 1_000)

    await mkdir(unknownRoot, { recursive: true })
    await writeFile(join(unknownRoot, 'payload.bin'), 'retain\n', 'utf8')
    await cp(current.root, unsafeRoot, { recursive: true })
    await copyFile(join(current.root, 'manifest.json'), externalManifest)
    await rm(join(unsafeRoot, 'manifest.json'))
    await symlink(externalManifest, join(unsafeRoot, 'manifest.json'))
    await utimes(unknownRoot, old, old)
    await utimes(unsafeRoot, old, old)

    await openSourceAuthoringTypeProjection(absoluteFsPath(root))

    await expect(access(unknownRoot)).resolves.toBeUndefined()
    await expect(access(unsafeRoot)).resolves.toBeUndefined()
  })

  it('生成失败时只清理本次 staging，不留下 staging 目录', async () => {
    const root = await cacheRoot()
    const authoringRoot = join(root, 'authoring-types')
    projectionMock.failBuild = true
    await expect(openSourceAuthoringTypeProjection(absoluteFsPath(root))).rejects.toThrow('injected projection failure')

    const after = await readdir(join(authoringRoot, '.staging')).catch(() => [])
    expect(after).toEqual([])
  })
})
