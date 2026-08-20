import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveSystemNbookRoot } from 'nbook/server/workspace-files/system-workspace-assets'

const roots: string[] = []

afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

describe('System Workspace assets', () => {
  it('无根node_modules时使用Product内已修补的系统模板', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nbook-product-assets-'))
    roots.push(root)
    await mkdir(join(root, 'assets', 'workspace', '.nbook'), { recursive: true })
    const productRoot = join(root, '.output', 'server', 'assets', 'workspace', '.nbook')
    await mkdir(productRoot, { recursive: true })

    expect(resolveSystemNbookRoot(root)).toBe(productRoot)
  })

  it('源码Application Root存在node_modules时使用bundled系统模板', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nbook-source-assets-'))
    roots.push(root)
    const sourceRoot = join(root, 'assets', 'workspace', '.nbook')
    await mkdir(sourceRoot, { recursive: true })
    await mkdir(join(root, 'node_modules'), { recursive: true })
    await mkdir(join(root, '.output', 'server', 'assets', 'workspace', '.nbook'), { recursive: true })

    expect(resolveSystemNbookRoot(root)).toBe(sourceRoot)
  })
})
