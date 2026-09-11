import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  authoringSdkTsconfig,
  authoringSdkTypeProjectionInputFiles,
  buildAuthoringSdkTypeProjection,
} from '#scripts/build/authoring-sdk-type-projection'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Authoring SDK type projection', () => {
  it('将公开 Source 输入内容纳入稳定 inventory', async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), 'nbook-authoring-inputs-'))
    temporaryRoots.push(sourceRoot)
    await writeSourceInputs(sourceRoot)

    const before = await authoringSdkTypeProjectionInputFiles({ sourceRoot })
    expect(before.map(file => file.path)).toContain('profile-sdk/session.ts')
    const sessionPath = join(sourceRoot, 'profile-sdk', 'session.ts')
    await writeFile(sessionPath, 'changed public re-export\n', 'utf8')
    const after = await authoringSdkTypeProjectionInputFiles({ sourceRoot })

    expect(after).not.toEqual(before)
    expect(after.find(file => file.path === 'profile-sdk/session.ts')?.sha256)
      .not.toBe(before.find(file => file.path === 'profile-sdk/session.ts')?.sha256)
    expect(after.map(file => file.path)).toContain('bun.lock')

    const checkoutInputs = await authoringSdkTypeProjectionInputFiles()
    expect(checkoutInputs.map(file => file.path)).toContain('profile-sdk/session.ts')
    expect(checkoutInputs.map(file => file.path)).not.toContain('profile-sdk/workspace.ts')
    expect(checkoutInputs.map(file => file.path)).not.toContain('profile-sdk/runtime-paths.ts')
    expect(checkoutInputs.map(file => file.path)).not.toContain('profile-sdk/lore.ts')
  })

  it('生成一次可移植的声明投影', async () => {
    const target = await mkdtemp(join(tmpdir(), 'nbook-authoring-types-'))
    temporaryRoots.push(target)
    const unrelatedCwd = await mkdtemp(join(tmpdir(), 'nbook-authoring-cwd-'))
    temporaryRoots.push(unrelatedCwd)

    const sourceRoot = process.cwd()
    process.chdir(unrelatedCwd)
    let result
    try {
      result = await buildAuthoringSdkTypeProjection({ targetRoot: target, sourceRoot })
    }
    finally {
      process.chdir(sourceRoot)
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
