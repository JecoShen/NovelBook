import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, readdir, truncate, rm, utimes, writeFile } from 'node:fs/promises'
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
} from 'nbook/server/runtime/source-authoring-type-cache'

const projectionMock = vi.hoisted(() => ({
  buildCalls: 0,
  failBuild: false,
}))

vi.mock('nbook/scripts/build/authoring-sdk-type-projection', () => ({
  AUTHORING_SDK_TYPE_PROJECTION_SCHEMA: 'nbook.authoring-sdk-type-projection/v2',
  AUTHORING_SDK_DEPENDENCIES: [{
    name: 'mock-sdk',
    kind: 'types',
    purpose: 'test',
    smoke: 'test',
  }],
  authoringSdkTsconfig: () => '{"compilerOptions":{"strict":true}}\n',
  authoringSdkTypeProjectionInputFiles: async () => [{
    path: 'package.json',
    sha256: createHash('sha256').update(readFileSync(resolve(process.cwd(), 'package.json'))).digest('hex'),
    bytes: readFileSync(resolve(process.cwd(), 'package.json')).length,
  }],
  buildAuthoringSdkTypeProjection: async ({ targetRoot }: { targetRoot: string }) => {
    if (projectionMock.failBuild) throw new Error('injected projection failure')
    projectionMock.buildCalls += 1
    await mkdir(join(targetRoot, 'types', 'profile-sdk'), { recursive: true })
    await mkdir(join(targetRoot, 'node_modules', '@types', 'node'), { recursive: true })
    await writeFile(join(targetRoot, 'types', 'profile-sdk', 'index.d.ts'), 'export type Profile = true\n', 'utf8')
    await writeFile(join(targetRoot, 'node_modules', '@types', 'node', 'index.d.ts'), 'export type Node = true\n', 'utf8')
    await writeFile(join(targetRoot, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}\n', 'utf8')
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
        path: 'package.json',
        sha256: createHash('sha256').update(readFileSync(resolve(process.cwd(), 'package.json'))).digest('hex'),
        bytes: readFileSync(resolve(process.cwd(), 'package.json')).length,
      }],
    }
  },
}))

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  projectionMock.buildCalls = 0
  projectionMock.failBuild = false
})

async function cacheRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'nbook-source-authoring-types-'))
  roots.push(root)
  return root
}

async function projectionDirectories(root: string): Promise<string[]> {
  return (await readdir(join(root, 'authoring-types'), { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && entry.name !== '.staging')
    .map(entry => entry.name)
    .sort()
}

describe('Source authoring type projection cache', () => {
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
    const current = await openSourceAuthoringTypeProjection(absoluteFsPath(root))
    const authoringRoot = join(root, 'authoring-types')
    const oldFingerprint = `sha256:${'a'.repeat(64)}`
    const youngFingerprint = `sha256:${'b'.repeat(64)}`
    const unknownFingerprint = 'unknown-directory'
    const now = Date.now()

    const currentManifest = JSON.parse(await readFile(join(current.root, 'manifest.json'), 'utf8')) as Record<string, unknown>
    for (const fingerprint of [oldFingerprint, youngFingerprint, unknownFingerprint]) {
      const directory = join(authoringRoot, fingerprint)
      await mkdir(join(directory, 'types'), { recursive: true })
      await writeFile(join(directory, 'types', 'payload.bin'), '', 'utf8')
      if (fingerprint !== unknownFingerprint) {
        await writeFile(join(directory, 'manifest.json'), `${JSON.stringify({
          ...currentManifest,
          fingerprint,
          generatedAt: new Date(now - SOURCE_AUTHORING_TYPE_CACHE_MIN_AGE_MS - 1_000).toISOString(),
        })}\n`, 'utf8')
        await truncate(join(directory, 'types', 'payload.bin'), SOURCE_AUTHORING_TYPE_CACHE_ORPHAN_BUDGET_BYTES)
      }
    }
    await utimes(join(authoringRoot, oldFingerprint), new Date(now - SOURCE_AUTHORING_TYPE_CACHE_MIN_AGE_MS - 2_000), new Date(now - SOURCE_AUTHORING_TYPE_CACHE_MIN_AGE_MS - 2_000))
    await utimes(join(authoringRoot, youngFingerprint), new Date(now), new Date(now))
    await utimes(join(authoringRoot, unknownFingerprint), new Date(now - SOURCE_AUTHORING_TYPE_CACHE_MIN_AGE_MS - 3_000), new Date(now - SOURCE_AUTHORING_TYPE_CACHE_MIN_AGE_MS - 3_000))

    await openSourceAuthoringTypeProjection(absoluteFsPath(root))

    await expect(access(join(authoringRoot, oldFingerprint))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(join(authoringRoot, youngFingerprint))).resolves.toBeUndefined()
    await expect(access(join(authoringRoot, unknownFingerprint))).resolves.toBeUndefined()
    await expect(access(current.root)).resolves.toBeUndefined()
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
