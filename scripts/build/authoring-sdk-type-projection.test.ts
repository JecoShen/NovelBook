import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  authoringSdkTsconfig,
  authoringSdkTypeProjectionInputFiles,
  buildAuthoringSdkTypeProjection,
} from '#scripts/build/authoring-sdk-type-projection'

const temporaryRoots: string[] = []

// 拆包后 SDK 源码在应用包根，lockfile 在仓库根；两处固定输入分别归属两个根。
const CHECKOUT_REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CHECKOUT_APPLICATION_ROOT = resolve(CHECKOUT_REPOSITORY_ROOT, 'packages', 'neuro-book')

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Authoring SDK type projection', () => {
  it('将公开 Source 输入内容纳入稳定 inventory', async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), 'nbook-authoring-inputs-'))
    temporaryRoots.push(sourceRoot)
    await writeSourceInputs(sourceRoot)

    const before = await authoringSdkTypeProjectionInputFiles({ sourceRoot, repositoryRoot: sourceRoot })
    expect(before.map(file => file.path)).toContain('profile-sdk/session.ts')
    const sessionPath = join(sourceRoot, 'profile-sdk', 'session.ts')
    await writeFile(sessionPath, 'changed public re-export\n', 'utf8')
    const after = await authoringSdkTypeProjectionInputFiles({ sourceRoot, repositoryRoot: sourceRoot })

    expect(after).not.toEqual(before)
    expect(after.find(file => file.path === 'profile-sdk/session.ts')?.sha256)
      .not.toBe(before.find(file => file.path === 'profile-sdk/session.ts')?.sha256)
    expect(after.map(file => file.path)).toContain('bun.lock')

    // 当前应用包 SDK 表面：session.ts 已不从公开入口 re-export（上游 SDK 演进后的现状），
    // 与 workspace/runtime-paths/lore 一样不属于投影输入闭包。
    const checkoutInputs = await authoringSdkTypeProjectionInputFiles({ sourceRoot: CHECKOUT_APPLICATION_ROOT })
    expect(checkoutInputs.map(file => file.path)).toContain('profile-sdk/index.ts')
    expect(checkoutInputs.map(file => file.path)).toContain('profile-sdk/constructors.ts')
    expect(checkoutInputs.map(file => file.path)).toContain('bun.lock')
    expect(checkoutInputs.map(file => file.path)).not.toContain('profile-sdk/session.ts')
    expect(checkoutInputs.map(file => file.path)).not.toContain('profile-sdk/workspace.ts')
    expect(checkoutInputs.map(file => file.path)).not.toContain('profile-sdk/runtime-paths.ts')
    expect(checkoutInputs.map(file => file.path)).not.toContain('profile-sdk/lore.ts')
  })

  it('生成一次可移植的声明投影', async () => {
    const target = await mkdtemp(join(tmpdir(), 'nbook-authoring-types-'))
    temporaryRoots.push(target)
    const unrelatedCwd = await mkdtemp(join(tmpdir(), 'nbook-authoring-cwd-'))
    temporaryRoots.push(unrelatedCwd)

    const sourceRoot = CHECKOUT_APPLICATION_ROOT
    const previousCwd = process.cwd()
    process.chdir(unrelatedCwd)
    let result
    try {
      result = await buildAuthoringSdkTypeProjection({ targetRoot: target, sourceRoot })
    }
    finally {
      process.chdir(previousCwd)
    }

    expect(result.inputFiles).toEqual(await authoringSdkTypeProjectionInputFiles({ sourceRoot }))
    await access(join(target, 'types/profile-sdk/index.d.ts'))
    await access(join(target, 'types/variable-sdk/index.d.ts'))
    await access(join(target, 'node_modules/@types/node/index.d.ts'))
    expect(await readFile(join(target, 'tsconfig.json'), 'utf8')).toBe(authoringSdkTsconfig())

    const declarationFiles = await collectDeclarations(target)
    const checkoutPath = sourceRoot.replaceAll('\\', '/')
    for (const declarationFile of declarationFiles) {
      expect((await readFile(declarationFile, 'utf8')).replaceAll('\\', '/')).not.toContain(checkoutPath)
    }
  }, 360_000)
})

// fixture 同时扮演应用包根与仓库根（repositoryRoot: sourceRoot），bun.lock 因此仍需在列。
const sourceInputPaths = [
  'bun.lock',
  'proper-lockfile.d.ts',
  'profile-sdk/index.ts',
  'profile-sdk/contracts.ts',
  'profile-sdk/constructors.ts',
  'profile-sdk/writing.ts',
  'profile-sdk/jsx-runtime.ts',
  'profile-sdk/jsx-dev-runtime.ts',
  'profile-sdk/session.ts',
  'variable-sdk/index.ts',
  'variable-sdk/contracts.ts',
  'server/agent/profiles/builtin-contracts.ts',
  'server/agent/tools/web-extraction-modules.d.ts',
]

async function writeSourceInputs(sourceRoot: string): Promise<void> {
  await Promise.all(sourceInputPaths.map(async (path) => {
    const filePath = join(sourceRoot, path)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, `${path}\n`, 'utf8')
  }))
  await writeFile(
    join(sourceRoot, 'profile-sdk', 'index.ts'),
    'export { readTitleOwner } from \'nbook/profile-sdk/session\'\n',
    'utf8',
  )
}

async function collectDeclarations(root: string): Promise<string[]> {
  const declarationFiles: string[] = []
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filePath = join(directory, entry.name)
      if (entry.isDirectory()) await walk(filePath)
      else if (/\.d\.(?:ts|mts|cts)$/u.test(entry.name)) declarationFiles.push(filePath)
    }
  }
  await walk(root)
  return declarationFiles
}
