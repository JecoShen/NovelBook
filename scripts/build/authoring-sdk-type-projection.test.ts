import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  authoringSdkTsconfig,
  buildAuthoringSdkTypeProjection,
} from 'nbook/scripts/build/authoring-sdk-type-projection'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Authoring SDK type projection', () => {
  it('在不同目标根生成相同的可移植声明 inventory', async () => {
    const targetA = await mkdtemp(join(tmpdir(), 'nbook-authoring-types-a-'))
    const targetB = await mkdtemp(join(tmpdir(), 'nbook-authoring-types-b-'))
    temporaryRoots.push(targetA, targetB)

    const resultA = await buildAuthoringSdkTypeProjection({ targetRoot: targetA })
    const resultB = await buildAuthoringSdkTypeProjection({ targetRoot: targetB })

    expect(resultA).toEqual(resultB)
    await access(join(targetA, 'types/profile-sdk/index.d.ts'))
    await access(join(targetA, 'types/variable-sdk/index.d.ts'))
    await access(join(targetA, 'node_modules/@types/node/index.d.ts'))
    expect(await readFile(join(targetA, 'tsconfig.json'), 'utf8')).toBe(authoringSdkTsconfig())

    const declarationFiles = await collectDeclarations(targetA)
    const checkoutPath = process.cwd().replaceAll('\\', '/')
    for (const declarationFile of declarationFiles) {
      expect((await readFile(declarationFile, 'utf8')).replaceAll('\\', '/')).not.toContain(checkoutPath)
    }
  }, 360_000)
})

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
