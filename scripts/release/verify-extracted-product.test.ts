import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { buildTestRuntimeImage } from 'nbook/packages/neuro-book-manager/src/fixtures/runtime-image'
import { releaseBuildId, type ReleaseProductBuild } from 'nbook/scripts/release/release-assets'
import { openVerifiedExtractedProduct } from 'nbook/scripts/release/verify-extracted-product'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async root => await rm(root, { recursive: true, force: true })))
})

describe('openVerifiedExtractedProduct', { timeout: 30_000 }, () => {
  it('使用归档根外部身份完整打开合法Runtime Image', async () => {
    const fixture = await archiveFixture()

    const image = await openVerifiedExtractedProduct(fixture.archiveRoot)

    expect(image.path).toBe(join(fixture.archiveRoot, '.output'))
    expect(image.manifest.imageId).toBe(fixture.metadata.imageId)
    expect(image.manifest.treeDigest).toBe(fixture.metadata.treeDigest)
  })

  it('在执行命令前拒绝外部身份或非入口payload篡改', async () => {
    const identityFixture = await archiveFixture()
    await writeFile(join(identityFixture.archiveRoot, 'product-build.json'), `${JSON.stringify({
      ...identityFixture.metadata,
      imageId: `sha256:${'0'.repeat(64)}`,
    })}\n`, 'utf8')
    await expect(openVerifiedExtractedProduct(identityFixture.archiveRoot)).rejects.toThrow('身份不一致：imageId')

    const payloadFixture = await archiveFixture()
    await writeFile(
      join(payloadFixture.archiveRoot, '.output', 'server', 'commands', 'all.mjs'),
      'export const tampered = true;\n',
      'utf8',
    )
    await expect(openVerifiedExtractedProduct(payloadFixture.archiveRoot)).rejects.toThrow('payload digest 不一致')
  })
})

/** 构建正式 Builder 产物并投影归档外部身份。 */
async function archiveFixture(): Promise<{ archiveRoot: string, metadata: ReleaseProductBuild }> {
  const root = await mkdtemp(join(tmpdir(), 'nbook-extracted-product-'))
  roots.push(root)
  const sourceRoot = join(root, 'source')
  const archiveRoot = join(root, 'archive')
  await Promise.all([mkdir(sourceRoot, { recursive: true }), mkdir(archiveRoot, { recursive: true })])
  const image = await buildTestRuntimeImage({
    sourceRoot,
    version: '0.9.0',
    revision: 'a'.repeat(40),
    platform: 'windows-x64',
  })
  await cp(image.path, join(archiveRoot, '.output'), { recursive: true, dereference: false })
  const common = {
    schema: 'nbook.release-build/v1' as const,
    kind: 'product' as const,
    version: image.manifest.version,
    revision: image.manifest.revision,
    dirty: false as const,
    lockfileSha256: image.manifest.lockfileSha256,
  }
  const metadata: ReleaseProductBuild = {
    ...common,
    buildId: releaseBuildId(common),
    platform: image.manifest.platform,
    imageId: image.manifest.imageId,
    sourceDigest: image.manifest.sourceDigest,
    treeDigest: image.manifest.treeDigest,
    builderContractVersion: image.manifest.builderContractVersion,
  }
  await writeFile(join(archiveRoot, 'product-build.json'), `${JSON.stringify(metadata, null, 4)}\n`, 'utf8')
  return { archiveRoot, metadata }
}
