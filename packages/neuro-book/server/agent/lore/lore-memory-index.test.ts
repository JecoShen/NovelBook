import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
import {
  acquireLoreMemoryIndex,
  awaitLoreMemoryIndexIdle,
  disposeAllLoreMemoryIndexes,
  recallLorePathsWithMemory,
  setLoreMemoryIndexOptions,
  truncateLoreMemoryQuery,
} from './lore-memory-index'
import { buildLoreResolverIndex, invalidateLoreResolverIndex } from './lore-resolver-cache'
import type { ReadyProjectSessionRef } from 'nbook/server/workspace-files/project-session-types'

function makeProjectRef(root: string): ReadyProjectSessionRef {
  return {
    workspace: { root, key: { slug: 'test', root }, ref: { projectRoot: root } },
    generation: 1,
  } as unknown as ReadyProjectSessionRef
}

function writeCard(
  root: string,
  category: string,
  slug: string,
  triggers: string[],
  bodyParagraphs: string[],
): void {
  const dir = join(root, 'lorebook', category, slug)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'index.md'),
    `---\ntitle: ${slug}\ntype: ${category}\nretrieval:\n  enabled: true\n  trigger: [${triggers.join(', ')}]\n---\n\n${bodyParagraphs.join('\n\n')}\n`)
}

function memoryDir(root: string): string {
  return join(root, '.nbook', 'memory')
}

function factsLines(root: string): string[] {
  const file = join(memoryDir(root), 'facts.jsonl')
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf-8').split('\n').filter(l => l.length > 0)
}

describe('truncateLoreMemoryQuery', () => {
  it('不超过 4000 字符原样保留', () => {
    const text = 'a'.repeat(4000)
    expect(truncateLoreMemoryQuery(text)).toBe(text)
  })

  it('超过 4000 字符保头 2000 + 尾 2000', () => {
    const text = `${'h'.repeat(2000)}${'m'.repeat(3000)}${'t'.repeat(2000)}`
    const truncated = truncateLoreMemoryQuery(text)
    expect(truncated.startsWith('h'.repeat(2000))).toBe(true)
    expect(truncated.endsWith('t'.repeat(2000))).toBe(true)
    expect(truncated.length).toBeLessThanOrEqual(4005)
    expect(truncated).not.toContain('m'.repeat(2000))
  })
})

describe('lore memory 索引生命周期（字面路）', () => {
  let tmpRoot: string
  let stateRoot: string
  let project: ReadyProjectSessionRef
  let prevStateRootEnv: string | undefined

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'lore-memory-'))
    stateRoot = mkdtempSync(join(tmpdir(), 'lore-state-'))
    prevStateRootEnv = process.env.NEURO_BOOK_STATE_ROOT
    // 隔离真实 state root：空 state root → embedding 未启用 → 纯字面路零网络。
    process.env.NEURO_BOOK_STATE_ROOT = stateRoot
    project = makeProjectRef(tmpRoot)
    writeCard(tmpRoot, 'character', 'yin-fa-jian-shi', ['艾拉'], [
      '银发的剑士独自守在北门，风雪没过了她的靴面。',
      '她从不谈论自己的过去。',
    ])
    writeCard(tmpRoot, 'location', 'mei-lake', ['梅澜湖'], [
      '梅澜湖在城南，冬天结冰。',
    ])
  })

  afterEach(async () => {
    // 先等项目操作链落定（后台构建/刷新/backfill），再清理——否则迟到的写会撞上已删目录。
    await awaitLoreMemoryIndexIdle(project)
    await disposeAllLoreMemoryIndexes()
    invalidateLoreResolverIndex(project)
    setLoreMemoryIndexOptions({})
    if (prevStateRootEnv === undefined) {
      delete process.env.NEURO_BOOK_STATE_ROOT
    }
    else {
      process.env.NEURO_BOOK_STATE_ROOT = prevStateRootEnv
    }
    rmSync(tmpRoot, { recursive: true, force: true })
    rmSync(stateRoot, { recursive: true, force: true })
  })

  it('首次获取返回 building 并后台构建；就绪后按正文语义召回（无 trigger 命中也能召回）', async () => {
    const first = await acquireLoreMemoryIndex(project)
    expect(first.ready).toBe(false)

    await awaitLoreMemoryIndexIdle(project)
    const ready = await acquireLoreMemoryIndex(project)
    expect(ready.ready).toBe(true)

    // 索引文件落盘：jsonl 事实源 + sqlite 派生索引 + manifest
    expect(existsSync(join(memoryDir(tmpRoot), 'facts.jsonl'))).toBe(true)
    expect(existsSync(join(memoryDir(tmpRoot), 'index.sqlite'))).toBe(true)
    expect(existsSync(join(memoryDir(tmpRoot), 'lore-manifest.json'))).toBe(true)

    // trigger 路对这段描述性文本零命中（trigger 表只有「艾拉」）
    const resolverIndex = await buildLoreResolverIndex(project)
    expect([...resolverIndex.triggerToPaths.keys()]).toContain('艾拉')
    const scanText = '北门的银发剑士在风雪里站了一夜'
    expect(scanText.includes('艾拉')).toBe(false)

    const recall = await recallLorePathsWithMemory(project, scanText, 2000)
    expect(recall.status).toBe('ok')
    expect(recall.rawPaths).toContain('character/yin-fa-jian-shi')
    expect(recall.pendingVectors).toBeGreaterThan(0) // 字面路：facts 已落库、向量未补
  })

  it('卡片编辑后增量重嵌：只为变化卡片追加新代 facts，旧代被过滤', async () => {
    await acquireLoreMemoryIndex(project)
    await awaitLoreMemoryIndexIdle(project)
    const beforeCount = factsLines(tmpRoot).length
    expect(beforeCount).toBeGreaterThan(0)

    // 编辑卡片正文（换掉独特词 风雪→黄沙）；trigger 索引缓存需显式失效
    writeCard(tmpRoot, 'character', 'yin-fa-jian-shi', ['艾拉'], [
      '银发的剑士独自守在北门，黄沙没过了她的靴面。',
      '她从不谈论自己的过去。',
    ])
    invalidateLoreResolverIndex(project)

    setLoreMemoryIndexOptions({ refreshThrottleMs: -1 })
    await acquireLoreMemoryIndex(project) // 触发后台增量刷新
    await awaitLoreMemoryIndexIdle(project)

    const after = factsLines(tmpRoot)
    // 新代 = 该卡 header + 2 段 = 3 条新 facts；另一张卡零新增（未变化不重嵌）
    expect(after.length).toBe(beforeCount + 3)

    // 新内容可召回；旧代（风雪版）被 manifest 当前代过滤
    const newRecall = await recallLorePathsWithMemory(project, '北门的银发剑士在黄沙里站了一夜', 2000)
    expect(newRecall.status).toBe('ok')
    expect(newRecall.rawPaths).toContain('character/yin-fa-jian-shi')
    const hits = newRecall.hitsByPath?.get('character/yin-fa-jian-shi') ?? []
    expect(hits.some(id => id.includes(':s0') || id.includes(':header'))).toBe(true)
    // 所有命中 refId 都属当前代（hash 一致），不存在两代并存
    const manifest = JSON.parse(readFileSync(join(memoryDir(tmpRoot), 'lore-manifest.json'), 'utf-8')) as {
      cards: Record<string, { hash: string }>
    }
    const currentHash = manifest.cards['character/yin-fa-jian-shi']!.hash
    for (const id of hits) {
      expect(id).toContain(`:v${currentHash}:`)
    }
  })

  it('删除 .nbook/memory/ 后可重建且召回正常', async () => {
    await acquireLoreMemoryIndex(project)
    await awaitLoreMemoryIndexIdle(project)
    expect((await acquireLoreMemoryIndex(project)).ready).toBe(true)

    await disposeAllLoreMemoryIndexes()
    rmSync(memoryDir(tmpRoot), { recursive: true, force: true })

    const rebuild = await acquireLoreMemoryIndex(project)
    expect(rebuild.ready).toBe(false)
    await awaitLoreMemoryIndexIdle(project)

    const recall = await recallLorePathsWithMemory(project, '北门的银发剑士', 2000)
    expect(recall.status).toBe('ok')
    expect(recall.rawPaths).toContain('character/yin-fa-jian-shi')
  })

  it('卡片删除后其 facts 不再被召回', async () => {
    await acquireLoreMemoryIndex(project)
    await awaitLoreMemoryIndexIdle(project)

    rmSync(join(tmpRoot, 'lorebook', 'character', 'yin-fa-jian-shi'), { recursive: true, force: true })
    invalidateLoreResolverIndex(project)

    setLoreMemoryIndexOptions({ refreshThrottleMs: -1 })
    await acquireLoreMemoryIndex(project)
    await awaitLoreMemoryIndexIdle(project)

    const recall = await recallLorePathsWithMemory(project, '北门的银发剑士在风雪里站了一夜', 2000)
    expect(recall.status).toBe('ok')
    expect(recall.rawPaths ?? []).not.toContain('character/yin-fa-jian-shi')
  })
})

describe('lore memory 语义路超时降级', () => {
  let tmpRoot: string
  let stateRoot: string
  let project: ReadyProjectSessionRef
  let prevStateRootEnv: string | undefined
  let hangingServer: Server

  beforeEach(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'lore-memory-timeout-'))
    stateRoot = mkdtempSync(join(tmpdir(), 'lore-state-timeout-'))
    prevStateRootEnv = process.env.NEURO_BOOK_STATE_ROOT
    process.env.NEURO_BOOK_STATE_ROOT = stateRoot
    project = makeProjectRef(tmpRoot)
    writeCard(tmpRoot, 'character', 'yin-fa-jian-shi', ['艾拉'], ['银发的剑士独自守在北门。'])

    // 黑洞 embedding 端点：接受连接但永不响应；仅本机回环 stub，非真实 provider。
    hangingServer = createServer(() => { /* 永不响应 */ })
    await new Promise<void>(resolve => hangingServer.listen(0, '127.0.0.1', resolve))
    const port = (hangingServer.address() as { port: number }).port
    // global config 落点 = <STATE_ROOT>/workspace/.nbook/config.json（createRuntimePaths 布局）
    mkdirSync(join(stateRoot, 'workspace', '.nbook'), { recursive: true })
    writeFileSync(join(stateRoot, 'workspace', '.nbook', 'config.json'), JSON.stringify({
      embedding: {
        enabled: true,
        provider: 'openai-compatible',
        model: 'stub-embed',
        dimensions: 8,
        apiKey: 'test-key-not-real',
        baseURL: `http://127.0.0.1:${String(port)}`,
        timeoutMs: 1500,
      },
    }))
  })

  afterEach(async () => {
    await awaitLoreMemoryIndexIdle(project)
    await disposeAllLoreMemoryIndexes()
    invalidateLoreResolverIndex(project)
    if (prevStateRootEnv === undefined) {
      delete process.env.NEURO_BOOK_STATE_ROOT
    }
    else {
      process.env.NEURO_BOOK_STATE_ROOT = prevStateRootEnv
    }
    hangingServer.closeAllConnections()
    await new Promise<void>(resolve => hangingServer.close(() => { resolve() }))
    rmSync(tmpRoot, { recursive: true, force: true })
    rmSync(stateRoot, { recursive: true, force: true })
  })

  it('query embed 挂起超过 timeoutMs 时检索返回 timeout（退回 trigger 由调用方执行）', async () => {
    await acquireLoreMemoryIndex(project)
    await awaitLoreMemoryIndexIdle(project)
    // 构建本身不依赖嵌入（deferEmbedding），backfill 失败后语义降级但索引就绪
    expect((await acquireLoreMemoryIndex(project)).ready).toBe(true)

    const startedAt = performance.now()
    const recall = await recallLorePathsWithMemory(project, '北门的银发剑士', 200)
    const elapsed = performance.now() - startedAt
    expect(recall.status).toBe('timeout')
    expect(elapsed).toBeLessThan(1500) // 远早于 embed 自身 1500ms 超时即已放弃等待
    expect(recall.error ?? '').not.toContain('test-key-not-real')
  }, 15000)
})
