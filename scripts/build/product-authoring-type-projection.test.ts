import { access, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { AUTHORING_SDK_DEPENDENCIES } from '#scripts/build/authoring-sdk-type-projection'
import { projectAuthoringDependencies } from '#scripts/build/product-authoring-type-projection'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Product Authoring dependency projection', () => {
  it('显式 sourceRoot 不会上移到含诱饵 package.json 的父目录', async () => {
    const containerRoot = await mkdtemp(join(tmpdir(), 'nbook-authoring-source-root-'))
    temporaryRoots.push(containerRoot)
    const sourceRoot = join(containerRoot, 'checkout')
    const checkoutRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
    const targetNodeModulesRoot = join(containerRoot, 'projected-node-modules')
    await mkdir(join(sourceRoot, 'profile-sdk'), { recursive: true })
    await mkdir(targetNodeModulesRoot, { recursive: true })
    await mkdir(join(sourceRoot, 'node_modules', '@types'), { recursive: true })
    await writeFile(join(containerRoot, 'package.json'), JSON.stringify({ name: 'bait-parent', version: '0.0.0' }), 'utf8')
    await writeFile(join(sourceRoot, 'package.json'), JSON.stringify({ name: 'explicit-checkout', version: '0.0.0' }), 'utf8')
    await writeFile(join(sourceRoot, 'profile-sdk', 'index.ts'), 'export {}\n', 'utf8')
    await symlink(resolve(checkoutRoot, 'node_modules', 'typebox'), join(sourceRoot, 'node_modules', 'typebox'))
    await symlink(resolve(checkoutRoot, 'node_modules', '@types', 'node'), join(sourceRoot, 'node_modules', '@types', 'node'))
    await symlink(resolve(checkoutRoot, 'node_modules', 'undici-types'), join(sourceRoot, 'node_modules', 'undici-types'))

    const projection = await projectAuthoringDependencies({
      seedSpecifiers: new Set(['typebox', '@types/node']),
      targetNodeModulesRoot,
      registrations: AUTHORING_SDK_DEPENDENCIES,
      importerPath: join(sourceRoot, 'profile-sdk', 'index.ts'),
      sourceRoot,
    })

    expect(projection.dependencies.map(dependency => dependency.name).sort())
      .toEqual(['@types/node', 'typebox', 'undici-types'])
    await access(join(targetNodeModulesRoot, 'typebox', 'package.json'))
  }, 120_000)

  it('在 package exports 隐藏 package.json 时仍定位批准依赖的包根', async () => {
    const targetNodeModulesRoot = await mkdtemp(join(tmpdir(), 'nbook-authoring-dependencies-'))
    temporaryRoots.push(targetNodeModulesRoot)

    const projection = await projectAuthoringDependencies({
      seedSpecifiers: new Set(['typebox', '@types/node']),
      targetNodeModulesRoot,
      registrations: AUTHORING_SDK_DEPENDENCIES,
      importerPath: resolve('profile-sdk', 'index.ts'),
      sourceRoot: resolve('.'),
    })

    expect(projection.dependencies.map(dependency => dependency.name).sort())
      .toEqual(['@types/node', 'typebox', 'undici-types'])
    await access(join(targetNodeModulesRoot, 'typebox', 'package.json'))
  }, 120_000)
})
