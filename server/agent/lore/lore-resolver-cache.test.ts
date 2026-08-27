import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildLoreResolverIndex,
  invalidateLoreResolverIndex,
  setLoreCacheOptions,
} from './lore-resolver-cache'
import type { ReadyProjectSessionRef } from 'nbook/server/workspace-files/project-session-types'

/** 构造一个指向临时目录的 mock ReadyProjectSessionRef。 */
function makeProjectRef(root: string): ReadyProjectSessionRef {
  return {
    workspace: { root, key: { slug: 'test', root }, ref: { projectRoot: root } },
    generation: 1,
  } as unknown as ReadyProjectSessionRef
}

/** 写入最小 frontmatter + 段落到 index.md。 */
function writeLoreCard(
  rootDir: string,
  category: string,
  slug: string,
  opts: { title?: string, triggers?: string[], enabled?: boolean, content?: string } = {},
): void {
  const dir = join(rootDir, 'lorebook', category, slug)
  mkdirSync(dir, { recursive: true })
  const frontmatter = [
    '---',
    `title: ${opts.title ?? slug}`,
    `type: ${category}`,
    ...(opts.triggers ? [`retrieval:`, `  enabled: ${opts.enabled ?? true}`, `  trigger: [${opts.triggers.join(', ')}]`] : []),
    '---',
  ].join('\n')
  writeFileSync(join(dir, 'index.md'), `${frontmatter}\n\n${opts.content ?? `## 基本信息\n\n| 项目 | 设定 |\n|------|------|\n| 名称 | ${slug} |\n`}\n`)
}

describe('lore-resolver-cache', () => {
  let tmpRoot: string
  let project: ReadyProjectSessionRef

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'lore-cache-'))
    project = makeProjectRef(tmpRoot)
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
    invalidateLoreResolverIndex(project)
  })

  it('scans character directory and builds trigger index', async () => {
    writeLoreCard(tmpRoot, 'character', 'lu-shen', { title: '陆深', triggers: ['陆深', '男主'] })
    writeLoreCard(tmpRoot, 'character', 'su-nian', { triggers: ['苏念'] })

    const index = await buildLoreResolverIndex(project)

    expect(index.triggerToPaths.get('陆深')?.has('character/lu-shen')).toBe(true)
    expect(index.triggerToPaths.get('男主')?.has('character/lu-shen')).toBe(true)
    expect(index.triggerToPaths.get('苏念')?.has('character/su-nian')).toBe(true)
    expect(index.pathToEntry.get('character/lu-shen')?.title).toBe('陆深')
  })

  it('skips entries with enabled: false', async () => {
    writeLoreCard(tmpRoot, 'character', 'lu-shen', { triggers: ['陆深'], enabled: true })
    writeLoreCard(tmpRoot, 'character', 'ghost', { triggers: ['幽灵'], enabled: false })

    const index = await buildLoreResolverIndex(project)

    expect(index.pathToEntry.has('character/lu-shen')).toBe(true)
    expect(index.pathToEntry.has('character/ghost')).toBe(false)
    expect(index.triggerToPaths.has('幽灵')).toBe(false)
  })

  it('ignores note/, story-spec/, instruction/ directories', async () => {
    writeLoreCard(tmpRoot, 'note', 'wip', { triggers: ['作者笔记'] })
    writeLoreCard(tmpRoot, 'story-spec', 'draft', { triggers: ['设定草稿'] })
    writeLoreCard(tmpRoot, 'instruction', 'system', { triggers: ['系统指令'] })
    writeLoreCard(tmpRoot, 'character', 'lu-shen', { triggers: ['陆深'] })

    const index = await buildLoreResolverIndex(project)

    expect(index.pathToEntry.has('note/wip')).toBe(false)
    expect(index.pathToEntry.has('story-spec/draft')).toBe(false)
    expect(index.pathToEntry.has('instruction/system')).toBe(false)
    expect(index.pathToEntry.has('character/lu-shen')).toBe(true)
  })

  it('filters triggers shorter than 2 characters', async () => {
    writeLoreCard(tmpRoot, 'character', 'lu-shen', { triggers: ['陆深', '我', 'A', '陆'] })

    const index = await buildLoreResolverIndex(project)

    expect(index.triggerToPaths.has('陆深')).toBe(true)
    expect(index.triggerToPaths.has('我')).toBe(false) // 1 字符
    expect(index.triggerToPaths.has('A')).toBe(false) // 1 字符
    expect(index.triggerToPaths.has('陆')).toBe(false) // 1 字符
  })

  it('caches result by project key and invalidates correctly', async () => {
    writeLoreCard(tmpRoot, 'character', 'lu-shen', { triggers: ['陆深'] })

    const first = await buildLoreResolverIndex(project)
    const second = await buildLoreResolverIndex(project)

    expect(first).toBe(second) // 同一对象引用

    invalidateLoreResolverIndex(project)
    const third = await buildLoreResolverIndex(project)

    expect(third).not.toBe(first) // invalidate 后新对象
  })

  // M-7: TTL expiry — 过期后自动 rebuild
  it('rebuilds index after TTL expiry (M-7 TTL)', async () => {
    writeLoreCard(tmpRoot, 'character', 'lu-shen', { triggers: ['陆深'] })
    setLoreCacheOptions({ ttlMs: 50, maxSize: 100 })
    try {
      const first = await buildLoreResolverIndex(project)
      // 缓存命中,同一对象
      const sameTime = await buildLoreResolverIndex(project)
      expect(sameTime).toBe(first)

      // 实际等待 ttl + 缓冲,缓存应失效 → 重建 (避免 setSystemTime 污染)
      await new Promise<void>(resolve => setTimeout(resolve, 100))

      const rebuilt = await buildLoreResolverIndex(project)
      expect(rebuilt).not.toBe(first)
    }
    finally {
      setLoreCacheOptions({ ttlMs: 5 * 60 * 1000, maxSize: 100 })
    }
  })

  // M-7: LRU eviction — 超出 maxSize 时,最久未访问的先被淘汰
  it('evicts least-recently-used entry when maxSize exceeded (M-7 LRU)', async () => {
    writeLoreCard(tmpRoot, 'character', 'lu-shen', { triggers: ['陆深'] })
    setLoreCacheOptions({ ttlMs: 60_000, maxSize: 2 })
    try {
      // 用不同 workspace root 模拟 3 个 project
      const tmp2 = mkdtempSync(join(tmpdir(), 'lore-cache-2-'))
      const tmp3 = mkdtempSync(join(tmpdir(), 'lore-cache-3-'))
      const project2 = makeProjectRef(tmp2)
      const project3 = makeProjectRef(tmp3)
      writeLoreCard(tmp2, 'character', 'c2', { triggers: ['c2'] })
      writeLoreCard(tmp3, 'character', 'c3', { triggers: ['c3'] })

      try {
        // 填满 2 槽:a1 + a2
        const a1 = await buildLoreResolverIndex(project)
        const a2 = await buildLoreResolverIndex(project2)
        expect(a1).toBeDefined()
        expect(a2).toBeDefined()

        // 访问 a1 刷新其 lastAccessedAt → a2 现在是 LRU
        const a1Again = await buildLoreResolverIndex(project)
        expect(a1Again).toBe(a1)

        // 插入第 3 个 → 触发 eviction,a2 (LRU) 被淘汰
        const a3 = await buildLoreResolverIndex(project3)
        expect(a3).toBeDefined()

        // a1 和 a3 仍命中缓存 (a1 因 a1Again 刷新,a3 是最新)
        const a1StillCached = await buildLoreResolverIndex(project)
        const a3StillCached = await buildLoreResolverIndex(project3)
        expect(a1StillCached).toBe(a1)
        expect(a3StillCached).toBe(a3)

        // a2 被淘汰,重建应得新对象
        const a2Rebuilt = await buildLoreResolverIndex(project2)
        expect(a2Rebuilt).not.toBe(a2)
      }
      finally {
        rmSync(tmp2, { recursive: true, force: true })
        rmSync(tmp3, { recursive: true, force: true })
        invalidateLoreResolverIndex(project2)
        invalidateLoreResolverIndex(project3)
      }
    }
    finally {
      setLoreCacheOptions({ ttlMs: 5 * 60 * 1000, maxSize: 100 })
    }
  })
})
