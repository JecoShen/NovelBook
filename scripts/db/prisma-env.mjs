import 'dotenv/config'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import * as yaml from 'yaml'
import { resolveAppSqliteLocation, selectAppSqliteUrl } from 'nbook/server/runtime/app-sqlite-location'
import { resolveBootConfigPath, resolveStateRoot } from 'nbook/server/runtime/installation-paths'

export function resolveDatabaseKind() {
  const rawKind = process.env.DATABASE_KIND?.trim().toLowerCase()
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? ''
  const bootDatabase = readBootDatabaseConfig()
  const bootKind = normalizeKind(bootDatabase.kind)
  const bootUrl = normalizeText(bootDatabase.url)

  if (rawKind) {
    return normalizeKind(rawKind)
  }
  if (databaseUrl.startsWith('file:')) {
    return 'sqlite'
  }
  if (databaseUrl) {
    throw new Error(`DATABASE_URL 只支持 SQLite file: URL，当前为：${databaseUrl}`)
  }
  if (bootKind) {
    return bootKind
  }
  if (bootUrl.startsWith('file:')) {
    return 'sqlite'
  }
  if (bootUrl) {
    throw new Error(`config.yaml database.url 只支持 SQLite file: URL，当前为：${bootUrl}`)
  }
  return 'sqlite'
}

export function preparePrismaEnv() {
  const kind = resolveDatabaseKind()
  const bootDatabase = readBootDatabaseConfig()
  const bootUrl = normalizeText(bootDatabase.url)
  process.env.DATABASE_KIND = kind
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = selectAppSqliteUrl(undefined, bootUrl)
  }

  const configuredUrl = process.env.DATABASE_URL?.trim() ?? ''
  if (!configuredUrl.startsWith('file:')) {
    throw new Error(`DATABASE_URL 只支持 SQLite file: URL，当前为：${configuredUrl || '<empty>'}`)
  }
  const location = resolveAppSqliteLocation(configuredUrl, resolveStateRoot())
  process.env.DATABASE_URL = location.connectionUrl
  mkdirSync(dirname(location.hostPath), { recursive: true })
  return { kind, databaseUrl: location.connectionUrl }
}

function readBootDatabaseConfig() {
  const bootConfigPath = resolveBootConfigPath()
  if (!existsSync(bootConfigPath)) {
    return {}
  }

  const text = readFileSync(bootConfigPath, 'utf-8')
  const expanded = expandEnvTemplates(text)
  const parsed = yaml.parse(expanded)
  return parsed?.database && typeof parsed.database === 'object' ? parsed.database : {}
}

function expandEnvTemplates(input) {
  return input.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-(.*?))?\}/g, (_match, name, fallback) => {
    const value = process.env[name]
    return value !== undefined && value !== '' ? value : fallback ?? ''
  })
}

function normalizeKind(input) {
  const value = normalizeText(input).toLowerCase()
  if (!value) {
    return null
  }
  if (value === 'sqlite') {
    return value
  }
  throw new Error(`DATABASE_KIND 只支持 sqlite，当前为：${String(input)}`)
}

function normalizeText(input) {
  return typeof input === 'string' ? input.trim() : ''
}
