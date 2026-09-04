import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import { PRODUCT_PLATFORMS } from 'nbook/packages/neuro-book-manager/src/types'

describe('Product Runtime Image measurement contracts', () => {
  it('package 暴露独立 measurement 与正式 policy preflight', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
      scripts: { [name: string]: string }
    }

    expect(packageJson.scripts['product:measure']).toBe(
      'bun scripts/build/measure-product-runtime-image.ts',
    )
    expect(packageJson.scripts['product:policy:check']).toContain('--require-all')
    expect(packageJson.scripts['nuxt:build']).toBe('bun scripts/build/build-product-runtime-image.ts')
  })

  it('手动 workflow 覆盖全部平台且只上传 measurement report', async () => {
    const workflow = await readFile('.github/workflows/product-runtime-baselines.yml', 'utf8')

    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).not.toContain('pull_request:')
    expect(workflow).not.toContain('release:')
    for (const platform of PRODUCT_PLATFORMS) {
      expect(workflow).toContain(`platform: ${platform}`)
    }
    expect(workflow.match(/bun run product:measure --output/gu)).toHaveLength(2)
    expect(workflow).toContain('compare-product-runtime-measurements.ts')
    expect(workflow).toMatch(/name: Upload baseline measurement\r?\n\s+if: always\(\)/u)
    expect(workflow).toContain('product-runtime-measurement-${{ matrix.platform }}')
    expect(workflow).not.toContain('bun run nuxt:build\n')
    expect(workflow).not.toContain('release:product:')
  })

  it('正式 release 在构建前检查全部 policy', async () => {
    const release = await readFile('.github/workflows/release-container.yml', 'utf8')

    expect(release).toContain('Verify approved Product Runtime Image policies')
    expect(release).toContain('run: bun run product:policy:check')
  })
})
