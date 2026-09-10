import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  resolveRuntimeArtifactCompilerContext,
  resolveRuntimeArtifactNbookPath,
} from 'nbook/server/utils/runtime-artifact-compiler-context'
import { resolveApplicationRoot } from 'nbook/server/workspace-files/system-workspace-assets'

const verifier = {
  openSelfVerified: vi.fn(async (path: string) => ({
    path,
    manifest: {
      imageId: 'sha256:verified',
      version: '0.9.0',
      revision: 'fixture-revision',
      platform: 'windows-x64' as const,
      sourceDigest: 'sha256:source',
      lockfileSha256: 'sha256:lockfile',
    },
  })),
}

const sourceProjectionMock = vi.hoisted(() => ({
  open: vi.fn(),
}))

vi.mock('nbook/shared/product-runtime-image-verifier', () => ({
  ProductRuntimeImageVerifier: class {
    openSelfVerified = verifier.openSelfVerified
  },
}))

vi.mock('nbook/server/runtime/source-authoring-type-cache', () => ({
  openSourceAuthoringTypeProjection: sourceProjectionMock.open,
}))

describe('runtime artifact compiler context', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
    sourceProjectionMock.open.mockReset()
  })

  it('Product build只使用Authoring Kit编译上下文，artifact require继续指向Product runtime', async () => {
    const root = resolve('.agent', 'tmp', 'artifact-context-test', randomUUID())
    roots.push(root)
    const outputRoot = join(root, '.output', 'server')
    const authoringRoot = join(outputRoot, 'authoring')
    const outputNbookFile = join(authoringRoot, 'nbook', 'server', 'marker.ts')
    await mkdir(join(root, 'node_modules'), { recursive: true })
    await mkdir(join(authoringRoot, 'nbook', 'server'), { recursive: true })
    await mkdir(join(authoringRoot, 'nbook', 'world-engine', 'schema'), { recursive: true })
    await writeFile(join(root, 'package.json'), '{"name":"neuro-book"}\n', 'utf8')
    await writeFile(join(root, 'tsconfig.json'), '{}\n', 'utf8')
    await writeFile(join(outputRoot, 'package.json'), '{"name":"neuro-book-output"}\n', 'utf8')
    await writeFile(join(outputRoot, 'index.mjs'), '', 'utf8')
    await mkdir(join(authoringRoot, 'node_modules', 'typebox'), { recursive: true })
    await mkdir(join(authoringRoot, 'types'), { recursive: true })
    await writeFile(join(authoringRoot, 'tsconfig.json'), '{}\n', 'utf8')
    await writeFile(join(authoringRoot, 'package.json'), '{"name":"@notnotype/neuro-book-profile-authoring-kit"}\n', 'utf8')
    await writeFile(join(authoringRoot, 'profile-compile-worker.mjs'), 'export {};\n', 'utf8')
    await writeFile(outputNbookFile, 'export const marker = true;\n', 'utf8')
    await writeFile(join(authoringRoot, 'nbook', 'world-engine', 'schema', 'index.mjs'), 'export {};\n', 'utf8')
    await writeFile(join(authoringRoot, 'nbook', 'world-engine', 'zod.mjs'), 'export {};\n', 'utf8')

    const context = await resolveRuntimeArtifactCompilerContext(root, { NEURO_BOOK_PRODUCT_IMAGE_ROOT: join(root, '.output') })

    expect(context).toEqual(expect.objectContaining({
      kind: 'product',
      productRuntime: true,
      nbookRoot: join(authoringRoot, 'nbook'),
      compilerPackageRoot: join(authoringRoot, 'package.json'),
      compilerNodeModulesRoot: join(authoringRoot, 'node_modules'),
      authoringTypeRoot: join(authoringRoot, 'types'),
      artifactRuntimeRequireRoot: join(outputRoot, 'index.mjs'),
      tsconfigPath: join(authoringRoot, 'tsconfig.json'),
    }))
    expect(context.kind === 'product' ? context.imageIdentity.imageId : null).toBe('sha256:verified')
    expect(verifier.openSelfVerified).toHaveBeenCalledWith(join(root, '.output'))
    expect(resolveRuntimeArtifactNbookPath(context, 'server/marker')).toBe(outputNbookFile)
  })

  it('Product缺少自包含tsconfig时拒绝回退Source根', async () => {
    const root = resolve('.agent', 'tmp', 'artifact-context-missing-test', randomUUID())
    roots.push(root)
    const outputRoot = join(root, '.output', 'server')
    await mkdir(outputRoot, { recursive: true })
    await writeFile(join(root, 'package.json'), '{"name":"neuro-book-product"}\n', 'utf8')
    await writeFile(join(root, 'tsconfig.json'), '{}\n', 'utf8')
    await writeFile(join(outputRoot, 'package.json'), '{"name":"neuro-book-output"}\n', 'utf8')
    await writeFile(join(outputRoot, 'index.mjs'), '', 'utf8')

    await expect(resolveRuntimeArtifactCompilerContext(root, {
      NEURO_BOOK_PRODUCT_IMAGE_ROOT: join(root, '.output'),
    })).rejects.toThrow('Product runtime 缺少自包含 Authoring Kit')
  })

  it('Product identity验证失败时拒绝回退完整Source checkout', async () => {
    const root = resolve('.agent', 'tmp', 'artifact-context-unverified-test', randomUUID())
    roots.push(root)
    const outputRoot = join(root, '.output', 'server')
    const authoringRoot = join(outputRoot, 'authoring')
    await mkdir(join(root, 'node_modules'), { recursive: true })
    await mkdir(authoringRoot, { recursive: true })
    await writeFile(join(root, 'package.json'), '{"name":"neuro-book"}\n', 'utf8')
    await writeFile(join(root, 'tsconfig.json'), '{}\n', 'utf8')
    await writeFile(join(outputRoot, 'package.json'), '{"name":"neuro-book-output"}\n', 'utf8')
    await writeFile(join(outputRoot, 'index.mjs'), '', 'utf8')
    await writeFile(join(authoringRoot, 'package.json'), '{"name":"authoring-kit"}\n', 'utf8')
    await writeFile(join(authoringRoot, 'tsconfig.json'), '{}\n', 'utf8')
    await writeFile(join(authoringRoot, 'profile-compile-worker.mjs'), 'export {};\n', 'utf8')
    await mkdir(join(authoringRoot, 'nbook', 'world-engine', 'schema'), { recursive: true })
    await writeFile(join(authoringRoot, 'nbook', 'world-engine', 'schema', 'index.mjs'), 'export {};\n', 'utf8')
    await writeFile(join(authoringRoot, 'nbook', 'world-engine', 'zod.mjs'), 'export {};\n', 'utf8')
    verifier.openSelfVerified.mockRejectedValueOnce(new Error('tampered image'))

    await expect(resolveRuntimeArtifactCompilerContext(root, {
      NEURO_BOOK_PRODUCT_IMAGE_ROOT: join(root, '.output'),
    })).rejects.toThrow('必须来自 verified image identity')
  })

  it('没有显式 Product identity 时始终使用 Source Dev', async () => {
    const root = resolve('.agent', 'tmp', 'artifact-context-source-test', randomUUID())
    roots.push(root)
    const outputRoot = join(root, '.output', 'server')
    await mkdir(outputRoot, { recursive: true })
    await writeFile(join(root, 'package.json'), '{"name":"neuro-book-product"}\n', 'utf8')
    await writeFile(join(outputRoot, 'package.json'), '{"name":"neuro-book-output"}\n', 'utf8')
    await writeFile(join(outputRoot, 'index.mjs'), '', 'utf8')
    sourceProjectionMock.open.mockResolvedValueOnce({
      fingerprint: 'sha256:source-default',
      root: join(root, 'cache', 'authoring-types', 'sha256:source-default'),
      typeRoot: join(root, 'cache', 'authoring-types', 'sha256:source-default', 'types'),
      nodeModulesRoot: join(root, 'cache', 'authoring-types', 'sha256:source-default', 'node_modules'),
      tsconfigPath: join(root, 'cache', 'authoring-types', 'sha256:source-default', 'tsconfig.json'),
    })

    await expect(resolveRuntimeArtifactCompilerContext(root)).resolves.toMatchObject({
      kind: 'source',
      productRuntime: false,
    })
  })

  it('Source使用Cache Root中的声明投影，但runtime bundle根仍指向checkout', async () => {
    const root = resolve('.agent', 'tmp', 'artifact-context-source-projection-test', randomUUID())
    roots.push(root)
    const cacheRoot = join(root, 'isolated-cache')
    const projectionRoot = join(cacheRoot, 'authoring-types', 'sha256:source-context')
    const projection = {
      fingerprint: 'sha256:source-context',
      root: projectionRoot,
      typeRoot: join(projectionRoot, 'types'),
      nodeModulesRoot: join(projectionRoot, 'node_modules'),
      tsconfigPath: join(projectionRoot, 'tsconfig.json'),
    }
    sourceProjectionMock.open.mockResolvedValueOnce(projection)
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'package.json'), '{"name":"neuro-book-source"}\n', 'utf8')
    await writeFile(join(root, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}\n', 'utf8')

    const context = await resolveRuntimeArtifactCompilerContext(root, {
      NEURO_BOOK_CACHE_ROOT: cacheRoot,
    })

    expect(context).toMatchObject({
      kind: 'source',
      nbookRoot: root,
      compilerPackageRoot: join(root, 'package.json'),
      artifactRuntimeRequireRoot: join(root, 'package.json'),
      authoringTypeRoot: join(cacheRoot, 'authoring-types', 'sha256:source-context', 'types'),
      compilerNodeModulesRoot: join(cacheRoot, 'authoring-types', 'sha256:source-context', 'node_modules'),
      tsconfigPath: join(cacheRoot, 'authoring-types', 'sha256:source-context', 'tsconfig.json'),
    })
    expect(sourceProjectionMock.open).toHaveBeenCalledWith(cacheRoot, resolveApplicationRoot(root))
  })

  it('Source声明投影生成失败时拒绝回退仓库tsconfig', async () => {
    const root = resolve('.agent', 'tmp', 'artifact-context-source-failure-test', randomUUID())
    roots.push(root)
    const cacheRoot = join(root, 'isolated-cache')
    sourceProjectionMock.open.mockRejectedValueOnce(new Error('injected projection failure'))
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'package.json'), '{"name":"neuro-book-source"}\n', 'utf8')
    await writeFile(join(root, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}\n', 'utf8')

    await expect(resolveRuntimeArtifactCompilerContext(root, {
      NEURO_BOOK_CACHE_ROOT: cacheRoot,
    })).rejects.toThrow('injected projection failure')
    expect(sourceProjectionMock.open).toHaveBeenCalledWith(cacheRoot, resolveApplicationRoot(root))
  })
})
