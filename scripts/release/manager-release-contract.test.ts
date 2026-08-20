import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..')

type RootPackage = {
  scripts: Record<string, string>
  devDependencies: Record<string, string>
}

type ReleaseWorkflow = string

type GeneratedTsConfig = {
  extends?: string
  include?: string[]
  compilerOptions: {
    module: string
    moduleResolution: string
  }
}

describe('Manager release clean-checkout contract', () => {
  it('Runtime typecheck self-prepares Prisma and directly owns imported mdast types', async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(ROOT, 'package.json'), 'utf8'),
    ) as RootPackage
    const releaseWorkflow = await readFile(
      resolve(ROOT, '.github', 'workflows', 'release-manager.yml'),
      'utf8',
    ) as ReleaseWorkflow
    const generatedTsConfig = JSON.parse(
      (await readFile(resolve(ROOT, 'server', 'generated', 'tsconfig.json'), 'utf8'))
        .replace(/^\s*\/\/.*$/gmu, ''),
    ) as GeneratedTsConfig
    const managerSourceTsConfigs = await Promise.all(
      ['scripts', 'shared'].map(async directory => JSON.parse(
        await readFile(resolve(ROOT, directory, 'tsconfig.json'), 'utf8'),
      ) as GeneratedTsConfig),
    )

    expect(packageJson.scripts['runtime:typecheck']).toMatch(/^bun run generate && /u)
    expect(packageJson.scripts['manager:test']).toContain('scripts/release/manager-release-contract.test.ts')
    expect(packageJson.scripts['manager:test']).toContain('--config scripts/release/manager-release-vitest.config.ts')
    expect(releaseWorkflow.indexOf('bun run nuxt:prepare')).toBeGreaterThan(-1)
    expect(releaseWorkflow.indexOf('bun run nuxt:prepare')).toBeLessThan(
      releaseWorkflow.indexOf('bun run manager:test'),
    )
    expect(packageJson.devDependencies['@types/mdast']).toBeTruthy()
    expect(generatedTsConfig.extends).toBeUndefined()
    expect(generatedTsConfig.compilerOptions).toMatchObject({
      module: 'ESNext',
      moduleResolution: 'Bundler',
    })
    for (const tsConfig of managerSourceTsConfigs) {
      expect(tsConfig.extends).toBeUndefined()
      expect(tsConfig.compilerOptions).toMatchObject({
        module: 'ESNext',
        moduleResolution: 'Bundler',
      })
    }
    expect(managerSourceTsConfigs[0]?.include).toContain('build/product-runtime-image-builder.ts')
    expect(managerSourceTsConfigs[0]?.include).toContain('release/manager-release-contract.test.ts')
    expect(managerSourceTsConfigs[0]?.include).toContain('release/manager-release-vitest.config.ts')
    expect(managerSourceTsConfigs[1]?.include).toEqual(expect.arrayContaining([
      'product-runtime-contract.ts',
      'product-runtime-environment.ts',
      'product-runtime-image-verifier.ts',
      'product-runtime-shutdown.ts',
    ]))
  })
})
