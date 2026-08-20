import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, env } from 'prisma/config'
import * as yaml from 'yaml'

const databaseUrl = resolveDatabaseUrl()
process.env.DATABASE_KIND = 'sqlite'
process.env.DATABASE_URL = databaseUrl

export default defineConfig({
  schema: 'prisma/schema.sqlite.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
  migrations: {
    path: 'prisma/migrations/sqlite',
  },
})

function resolveDatabaseUrl(): string {
  const envUrl = normalizeText(process.env.DATABASE_URL)
  const bootUrl = normalizeText(readBootDatabaseConfig().url)
  const url = envUrl || bootUrl || 'file:./workspace/.nbook/neuro-book.sqlite'
  if (!url.startsWith('file:')) {
    throw new Error(`Prisma App SQLite 只支持 file: URL，当前为：${url}`)
  }
  return url
}

function readBootDatabaseConfig(): { url?: unknown } {
  const configPath = path.resolve(process.cwd(), 'config.yaml')
  if (!fs.existsSync(configPath)) {
    return {}
  }

  const text = fs.readFileSync(configPath, 'utf-8')
  const expanded = text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-(.*?))?\}/g, (_match, name: string, fallback: string | undefined) => {
    const value = process.env[name]
    return value !== undefined && value !== '' ? value : fallback ?? ''
  })
  const parsed = yaml.parse(expanded) as { database?: { url?: unknown } } | null
  return parsed?.database && typeof parsed.database === 'object' ? parsed.database : {}
}

function normalizeText(input: unknown): string {
  return typeof input === 'string' ? input.trim() : ''
}
