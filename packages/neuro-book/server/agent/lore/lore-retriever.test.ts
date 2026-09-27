import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveChapterLore } from './lore-retriever'
import { resolveForChapter, type ResolveForChapterResult } from './lore-resolver'
import { awaitLoreMemoryIndexIdle, disposeAllLoreMemoryIndexes } from './lore-memory-index'
import type { LoreShadowRecord } from './lore-shadow-log'
import { invalidateLoreResolverIndex } from './lore-resolver-cache'
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

function shadowLogPath(root: string): string {
  return join(root, '.nbook', 'state', 'lore-retriever-shadow.jsonl')
}

function readShadowRecords(root: string): LoreShadowRecord[] {
  const file = shadowLogPath(root)
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf-8').split('\n').filter(l => l.length > 0)
    .map(l => JSON.parse(l) as LoreShadowRecord)
}

async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('waitFor 条件超时')
}

function comparable(result: ResolveForChapterResult): unknown {
  return {
    paths: result.paths,
    hitsByPath: Object.fromEntries(result.hitsByPath),
    totalTriggersMatched: result.totalTriggersMatched,
  }
}

describe('resolveChapterLore 检索器 dispatch', () => {
  let tmpRoot: string
  let stateRoot: string
  let project: ReadyProjectSessionRef
  let prevStateRootEnv: string | undefined

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'lore-retriever-'))
    stateRoot = mkdtempSync(join(tmpdir(), 'lore-state-retriever-'))
    prevStateRootEnv = process.env.NEURO_BOOK_STATE_ROOT
    process.env.NEURO_BOOK_STATE_ROOT = stateRoot
    project = makeProjectRef(tmpRoot)
    writeCard(tmpRoot, 'character', 'lu-shen', ['陆深'], ['陆深骑车穿过旧城区。'])
    writeCard(tmpRoot, 'character', 'yin-fa-jian-shi', ['艾拉'], [
      '银发的剑士独自守在北门，风雪没过了她的靴面。',
    ])
  })

  afterEach(async () => {
    // 先等项目操作链落定（后台构建/刷新/检索），再清理——否则迟到的写会撞上已删目录。
    await awaitLoreMemoryIndexIdle(project)
    await disposeAllLoreMemoryIndexes()
    invalidateLoreResolverIndex(project)
    if (prevStateRootEnv === undefined) {
      delete process.env.NEURO_BOOK_STATE_ROOT
    }
    else {
      process.env.NEURO_BOOK_STATE_ROOT = prevStateRootEnv
    }
    rmSync(tmpRoot, { recursive: true, force: true })
    rmSync(stateRoot, { recursive: true, force: true })
  })

  it('trigger 模式与 resolveForChapter 结果逐点一致（验收 1）', async () => {
    const input = { project, chapterText: '陆深骑车路过北门', carryOverPaths: [], maxPaths: 8 }
    const direct = await resolveForChapter(input)
    const dispatched = await resolveChapterLore({ ...input, retrieverOverride: 'trigger' })
    expect(comparable(dispatched)).toEqual(comparable(direct))
  })

  it('配置闸从 global config 生效：缺省 trigger，显式 shadow 走双跑', async () => {
    // 缺省（无配置文件）→ trigger：不产生 shadow 日志
    const input = { project, chapterText: '陆深骑车路过北门', carryOverPaths: [], maxPaths: 8 }
    const defaulted = await resolveChapterLore(input)
    const direct = await resolveForChapter(input)
    expect(comparable(defaulted)).toEqual(comparable(direct))
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(existsSync(shadowLogPath(tmpRoot))).toBe(false)

    // 显式 shadow → 注入仍等于 trigger，观测日志落盘
    // global config 落点 = <STATE_ROOT>/workspace/.nbook/config.json（createRuntimePaths 布局）
    mkdirSync(join(stateRoot, 'workspace', '.nbook'), { recursive: true })
    writeFileSync(join(stateRoot, 'workspace', '.nbook', 'config.json'), JSON.stringify({
      agent: { loreContext: { retriever: 'shadow' } },
    }))
    const shadowed = await resolveChapterLore(input)
    expect(comparable(shadowed)).toEqual(comparable(direct))
    await waitFor(() => readShadowRecords(tmpRoot).length > 0)
  })

  it('shadow 双跑：注入=trigger 结果；日志含 memory 召回与两路差异（验收 2）', async () => {
    const input = { project, chapterText: '陆深骑车路过北门', carryOverPaths: [], maxPaths: 8 }
    // 第一次调用触发后台索引构建；等待就绪后再双跑
    await resolveChapterLore({ ...input, retrieverOverride: 'shadow' })
    await waitFor(() => readShadowRecords(tmpRoot).some(r => r.memory.status === 'building' || r.memory.status === 'ok'))
    await awaitLoreMemoryIndexIdle(project)

    const direct = await resolveForChapter(input)
    const shadowed = await resolveChapterLore({ ...input, retrieverOverride: 'shadow' })
    expect(comparable(shadowed)).toEqual(comparable(direct))

    await waitFor(() => readShadowRecords(tmpRoot).some(r => r.memory.status === 'ok'))
    const record = readShadowRecords(tmpRoot).find(r => r.memory.status === 'ok')!
    expect(record.mode).toBe('shadow')
    expect(record.trigger?.paths).toEqual(direct.paths)
    expect(record.memory.rawPaths).toBeDefined()
    expect(record.diff).toBeDefined()
    // 两路都应召回 lu-shen（文本含「陆深」trigger 且正文语义相关）
    expect(record.diff?.common).toContain('character/lu-shen')
    expect(record.memory.ms).toBeGreaterThanOrEqual(0)
  })

  it('memory 模式索引未建时退回 trigger 并记 fallbackToTrigger（验收 2 降级）', async () => {
    const input = { project, chapterText: '陆深骑车路过北门', carryOverPaths: [], maxPaths: 8 }
    const direct = await resolveForChapter(input)
    const memoryResult = await resolveChapterLore({ ...input, retrieverOverride: 'memory' })
    // 索引未建 → 退回 trigger，结果与 trigger 一致
    expect(comparable(memoryResult)).toEqual(comparable(direct))
    await waitFor(() => readShadowRecords(tmpRoot).some(r => r.fallbackToTrigger === true))
    const record = readShadowRecords(tmpRoot).find(r => r.fallbackToTrigger === true)!
    expect(record.mode).toBe('memory')
    expect(record.memory.status).toBe('building')
  })

  it('memory 模式就绪后用 memory 召回：描述性指代（无 trigger 命中）也能召回，carryOver 置顶', async () => {
    // 先建成索引
    await resolveChapterLore({ project, chapterText: '陆深', carryOverPaths: [], maxPaths: 8, retrieverOverride: 'shadow' })
    await awaitLoreMemoryIndexIdle(project)

    const scanText = '北门的银发剑士在风雪里站了一夜，城门上的旗帜猎猎作响，火光映在城墙砖缝里。'
    const direct = await resolveForChapter({ project, chapterText: scanText, carryOverPaths: ['character/lu-shen'], maxPaths: 8 })
    // trigger 路：无 trigger 命中，只剩 carryOver 置顶
    expect(direct.paths).toEqual(['character/lu-shen'])

    const memoryResult = await resolveChapterLore({
      project,
      chapterText: scanText,
      carryOverPaths: ['character/lu-shen'],
      maxPaths: 8,
      retrieverOverride: 'memory',
    })
    // memory 路：描述性召回银发剑士；carryOver 无条件置顶
    expect(memoryResult.paths[0]).toBe('character/lu-shen')
    expect(memoryResult.paths).toContain('character/yin-fa-jian-shi')
  })

  it('memory 模式召回为空时返回空 paths（0 命中语义与 trigger 一致）', async () => {
    await resolveChapterLore({ project, chapterText: '陆深', carryOverPaths: [], maxPaths: 8, retrieverOverride: 'shadow' })
    await awaitLoreMemoryIndexIdle(project)
    const result = await resolveChapterLore({
      project,
      chapterText: 'zzzz qqqq xxxx',
      carryOverPaths: [],
      maxPaths: 8,
      retrieverOverride: 'memory',
    })
    expect(result.paths).toEqual([])
  })
})
