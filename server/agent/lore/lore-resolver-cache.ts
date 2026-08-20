import fs from 'node:fs/promises'
import path from 'node:path'
import type { ReadyProjectSessionRef } from 'nbook/server/workspace-files/project-session-types'
import { parseFrontmatter } from './lore-frontmatter'

export type LoreEntryKind
  = | 'character' | 'location' | 'faction'
    | 'event' | 'item' | 'world' | 'system' | 'spec'

export interface LoreEntryMeta {
  readonly path: string
  readonly kind: LoreEntryKind
  readonly title: string
  readonly triggers: readonly string[]
  readonly enabled: boolean
}

export interface LoreResolverIndex {
  readonly triggerToPaths: ReadonlyMap<string, ReadonlySet<string>>
  readonly pathToEntry: ReadonlyMap<string, LoreEntryMeta>
  readonly builtAt: string
}

const ALLOWED_KINDS: ReadonlySet<LoreEntryKind> = new Set([
  'character', 'location', 'faction', 'event', 'item', 'world', 'system', 'spec',
])
const MIN_TRIGGER_LENGTH = 2

// M-7: cache 配置 (TTL + LRU bound)。默认 5 分钟过期,最多 100 项
interface LoreCacheOptions {
  readonly ttlMs: number
  readonly maxSize: number
}
const DEFAULT_CACHE_OPTIONS: LoreCacheOptions = {
  ttlMs: 5 * 60 * 1000,
  maxSize: 100,
}
let cacheOptions: LoreCacheOptions = DEFAULT_CACHE_OPTIONS
/** 测试 / 运维 seam:调整 cache 参数。生产用默认值。 */
export function setLoreCacheOptions(opts: Partial<LoreCacheOptions>): void {
  cacheOptions = { ...DEFAULT_CACHE_OPTIONS, ...opts }
}

interface CacheEntry {
  readonly value: LoreResolverIndex
  readonly expireAt: number
  lastAccessedAt: number
}

const indexCache = new Map<string, CacheEntry>()
// 单调访问计数器,保证 LRU 比较时 tie-breaker 落到最早插入
let accessCounter = 0

function cacheKey(project: ReadyProjectSessionRef): string {
  return `${project.workspace.root}#${String(project.generation)}`
}

/** 超出 maxSize 时,按 LRU (oldest lastAccessedAt) 淘汰。 */
function evictIfOverCapacity(): void {
  while (indexCache.size > cacheOptions.maxSize) {
    let oldestKey: string | null = null
    let oldestTime = Infinity
    for (const [k, e] of indexCache) {
      if (e.lastAccessedAt < oldestTime) {
        oldestTime = e.lastAccessedAt
        oldestKey = k
      }
    }
    if (oldestKey === null) break
    indexCache.delete(oldestKey)
  }
}

function readEntryMeta(
  projectRoot: string,
  category: string,
  slug: string,
): Promise<LoreEntryMeta | null> {
  const entryPath = `lorebook/${category}/${slug}`
  const filePath = path.join(projectRoot, entryPath, 'index.md')
  return fs.readFile(filePath, 'utf-8').then((raw) => {
    const fm = parseFrontmatter(raw)
    const retrieval = (typeof fm.retrieval === 'object' && fm.retrieval !== null)
      ? fm.retrieval as Record<string, unknown>
      : {}
    const enabled = retrieval.enabled !== false
    const triggers = Array.isArray(retrieval.trigger)
      ? (retrieval.trigger as unknown[]).filter((v): v is string => typeof v === 'string')
      : []
    return {
      path: `${category}/${slug}`,
      kind: category as LoreEntryKind,
      title: typeof fm.title === 'string' ? fm.title : slug,
      triggers,
      enabled,
    }
  }).catch(() => null)
}

export async function buildLoreResolverIndex(
  project: ReadyProjectSessionRef,
): Promise<LoreResolverIndex> {
  const key = cacheKey(project)
  const nowMs = Date.now()
  const accessSeq = ++accessCounter
  const cached = indexCache.get(key)
  if (cached && cached.expireAt > nowMs) {
    // M-7: 命中 → 更新 lastAccessedAt (LRU 维护,使用单调计数器避免同 ms tie)
    cached.lastAccessedAt = accessSeq
    return cached.value
  }
  if (cached) {
    indexCache.delete(key) // 过期清理
  }

  const projectRoot = project.workspace.root
  const triggerToPaths = new Map<string, Set<string>>()
  const pathToEntry = new Map<string, LoreEntryMeta>()

  for (const category of ALLOWED_KINDS) {
    const dir = path.join(projectRoot, 'lorebook', category)
    let entries: string[]
    try {
      entries = await fs.readdir(dir)
    }
    catch {
      continue
    }
    for (const slug of entries) {
      const meta = await readEntryMeta(projectRoot, category, slug)
      if (!meta || !meta.enabled) continue
      pathToEntry.set(meta.path, meta)
      for (const trigger of meta.triggers) {
        if (trigger.length < MIN_TRIGGER_LENGTH) continue
        let bucket = triggerToPaths.get(trigger)
        if (!bucket) {
          bucket = new Set()
          triggerToPaths.set(trigger, bucket)
        }
        bucket.add(meta.path)
      }
    }
  }

  const index: LoreResolverIndex = {
    triggerToPaths,
    pathToEntry,
    builtAt: new Date().toISOString(),
  }
  indexCache.set(key, {
    value: index,
    expireAt: nowMs + cacheOptions.ttlMs,
    lastAccessedAt: accessSeq,
  })
  evictIfOverCapacity()
  return index
}

export function invalidateLoreResolverIndex(project: ReadyProjectSessionRef): void {
  indexCache.delete(cacheKey(project))
}
