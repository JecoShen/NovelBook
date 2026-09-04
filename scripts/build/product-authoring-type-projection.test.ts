import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AUTHORING_SDK_DEPENDENCIES } from 'nbook/scripts/build/authoring-sdk-type-projection'
import { projectAuthoringDependencies } from 'nbook/scripts/build/product-authoring-type-projection'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Product Authoring dependency projection', () => {
  it('在 package exports 隐藏 package.json 时仍定位批准依赖的包根', async () => {
    const targetNodeModulesRoot = await mkdtemp(join(tmpdir(), 'nbook-authoring-dependencies-'))
    temporaryRoots.push(targetNodeModulesRoot)

    const projection = await projectAuthoringDependencies({
      seedSpecifiers: new Set(['typebox', '@types/node']),
      targetNodeModulesRoot,
      registrations: AUTHORING_SDK_DEPENDENCIES,
      importerPath: resolve('profile-sdk', 'index.ts'),
    })

    expect(projection.dependencies.map(dependency => dependency.name).sort())
      .toEqual(['@types/node', 'typebox', 'undici-types'])
    await access(join(targetNodeModulesRoot, 'typebox', 'package.json'))
  }, 120_000)
})
