import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const originalStateRoot = process.env.NEURO_BOOK_STATE_ROOT
const originalDatabaseKind = process.env.DATABASE_KIND
const originalDatabaseUrl = process.env.DATABASE_URL
let root: string | null = null

afterEach(async () => {
  restoreEnv('NEURO_BOOK_STATE_ROOT', originalStateRoot)
  restoreEnv('DATABASE_KIND', originalDatabaseKind)
  restoreEnv('DATABASE_URL', originalDatabaseUrl)
  vi.resetModules()
  if (root) await rm(root, { recursive: true, force: true })
  root = null
})

describe('Prisma CLI State Root', () => {
  it('将相对 SQLite URL 规范化为 State Root 下的绝对 URL', async () => {
    root = await mkdtemp(join(tmpdir(), 'nbook-prisma-env-'))
    const stateRoot = join(root, 'data')
    process.env.NEURO_BOOK_STATE_ROOT = stateRoot
    process.env.DATABASE_KIND = 'sqlite'
    process.env.DATABASE_URL = 'file:./workspace/.nbook/neuro-book.sqlite'

    const { preparePrismaEnv } = await import('../db/prisma-env.mjs')
    const result = preparePrismaEnv()
    const expectedPath = join(stateRoot, 'workspace', '.nbook', 'neuro-book.sqlite').replaceAll('\\', '/')

    expect(result.databaseUrl).toBe(`file:${expectedPath}`)
    expect(process.env.DATABASE_URL).toBe(`file:${expectedPath}`)
  })
})

function restoreEnv(name: 'NEURO_BOOK_STATE_ROOT' | 'DATABASE_KIND' | 'DATABASE_URL', value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
