/**
 * memory 检索器与索引生命周期（p-008 / spec: agent.writer-lore-context）。
 *
 * lorebook 卡片以 facts 直报摄入项目 `.nbook/memory/`（零 LLM）：header fact
 * 汇总 title/triggers/summary，正文按空行切段逐段一条 fact；meta 带
 * {lorePath, kind, cardHash}，refId 内容寻址（`lore:<path>:v<hash>:<段序|header>`）。
 * nb-memory 事实源 append-only 无删除——卡片变更以新 hash 追加新代 facts，
 * manifest 记录每张卡片的当前代，检索归并时按当前代过滤旧代。索引目录整体
 * 删除后可从 lorebook 全量重建；重建/构建期间调用方退回 trigger 路径。
 *
 * 嵌入复用项目 EmbeddingServiceConfig（resolveWorldEmbedding/embedTexts）；
 * 未启用或配置不完整时 NullEmbedPort 纯字面路运行，零网络调用。摄入恒
 * deferEmbedding：facts 落库即字面可召回，向量由后台 backfill 渐进补齐
 * （`pendingVectors > 0` 即语义降级期，检索照常）。
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  NbMemory,
  FsStorage,
  SqliteIndexStore,
  type EmbedPort,
  type SearchHit,
} from '@notnotype/nb-memory'
import { buildLoreResolverIndex } from './lore-resolver-cache'
import type { LoreEntryKind } from './lore-resolver-cache'
import { parseFrontmatter } from './lore-frontmatter'
import { resolveWorldEmbedding, embedTexts } from 'nbook/server/world-engine/world-embedding'
import { resolveRuntimeWorkspaceRoot } from 'nbook/server/workspace-files/workspace-runtime-root'
import type { ReadyProjectSessionRef } from 'nbook/server/workspace-files/project-session-types'

/** 单卡正文切段上限：段数与单段字符（超出截断）。 */
const MAX_SEGMENTS_PER_CARD = 32
const MAX_SEGMENT_CHARS = 2000
/** 检索 query（扫描文本）截断：头 2000 + 尾 2000。 */
const MAX_QUERY_CHARS = 4000
/** 一次检索抓取的命中段数（归并成路径前的原料；top-8 的 3 倍宽限）。 */
const SEARCH_HIT_LIMIT = 24
/** 增量刷新节流：距上次扫描不足该间隔直接沿用现状（trigger 路自身缓存 TTL 为 5 分钟，本口径新鲜得多）。 */
const DEFAULT_REFRESH_THROTTLE_MS = 30_000
/** 构建失败后的重试节流，避免持久失败在每次 invoke 重复全量尝试。 */
const DEFAULT_BUILD_RETRY_MS = 60_000
/** 缓存的项目索引实例上限（项目级 NbMemory + sqlite 句柄）。 */
const MAX_INDEX_ENTRIES = 8
/** 后台 backfill 单轮上限：64 × 256 条，防持久失败死循环。 */
const BACKFILL_MAX_ROUNDS = 64

interface LoreMemoryIndexOptions {
  readonly refreshThrottleMs: number
  readonly buildRetryMs: number
}
let indexOptions: LoreMemoryIndexOptions = {
  refreshThrottleMs: DEFAULT_REFRESH_THROTTLE_MS,
  buildRetryMs: DEFAULT_BUILD_RETRY_MS,
}
/** 测试 seam：调整节流参数。生产用默认值（对齐 setLoreCacheOptions 先例）。 */
export function setLoreMemoryIndexOptions(opts: Partial<LoreMemoryIndexOptions>): void {
  indexOptions = {
    refreshThrottleMs: opts.refreshThrottleMs ?? DEFAULT_REFRESH_THROTTLE_MS,
    buildRetryMs: opts.buildRetryMs ?? DEFAULT_BUILD_RETRY_MS,
  }
}

interface LoreCardContent {
  readonly path: string
  readonly kind: LoreEntryKind
  readonly title: string
  readonly triggers: readonly string[]
  readonly summary: string | null
  readonly body: string
}

interface ManifestCard {
  readonly hash: string
  readonly factIds: readonly string[]
}

/** `.nbook/memory/lore-manifest.json`：每张卡片的当前代指针；旧代 facts 靠它过滤。 */
interface LoreMemoryManifest {
  readonly version: 1
  readonly cards: Record<string, ManifestCard>
  readonly updatedAt: string
}

interface ProjectMemoryIndex {
  status: 'building' | 'ready' | 'error'
  readonly memory: NbMemory
  readonly storage: FsStorage
  readonly indexStore: SqliteIndexStore
  manifest: LoreMemoryManifest
  readonly semanticEnabled: boolean
  nextTick: number
  lastScanMs: number
  lastUsedMs: number
  backfillRunning: boolean
  pendingVectors: number
}

const indexByProjectKey = new Map<string, ProjectMemoryIndex>()
/** 每项目一条操作链：构建/刷新/检索/backfill 串行，避免 sqlite 写入与 pending flush 交错。 */
const chainByProjectKey = new Map<string, Promise<void>>()
const failedBuildAtByProjectKey = new Map<string, number>()

function projectKey(project: ReadyProjectSessionRef): string {
  return `${project.workspace.root}#${String(project.generation)}`
}

function memoryDirOf(project: ReadyProjectSessionRef): string {
  return path.join(project.workspace.root, '.nbook', 'memory')
}

/** 串行执行（唯一并发闸）；fn 抛错不毒化链条；尾 promise 落定后自清，map 不膨胀。 */
function runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chainByProjectKey.get(key) ?? Promise.resolve()
  const next = prev.catch(() => undefined).then(fn)
  const tail = next.then(() => undefined, () => undefined)
  chainByProjectKey.set(key, tail)
  void tail.then(() => {
    if (chainByProjectKey.get(key) === tail) chainByProjectKey.delete(key)
  })
  return next
}

/** 测试 seam：等待当前项目队列清空（后台构建/刷新/backfill 落定）。 */
export async function awaitLoreMemoryIndexIdle(project: ReadyProjectSessionRef): Promise<void> {
  const key = projectKey(project)
  for (let i = 0; i < 100; i += 1) {
    const chain = chainByProjectKey.get(key)
    if (!chain) return
    await chain
  }
}

/** 测试 seam：丢弃全部缓存实例与节流状态（关闭 sqlite 句柄）。 */
export async function disposeAllLoreMemoryIndexes(): Promise<void> {
  const entries = [...indexByProjectKey.values()]
  indexByProjectKey.clear()
  failedBuildAtByProjectKey.clear()
  for (const entry of entries) {
    await entry.indexStore.close().catch(() => undefined)
  }
}

function emptyManifest(): LoreMemoryManifest {
  return { version: 1, cards: {}, updatedAt: new Date().toISOString() }
}

async function readManifest(storage: FsStorage): Promise<LoreMemoryManifest> {
  const raw = await storage.read('lore-manifest.json').catch(() => null)
  if (!raw) return emptyManifest()
  try {
    const parsed = JSON.parse(raw) as LoreMemoryManifest
    if (parsed.version !== 1 || typeof parsed.cards !== 'object' || parsed.cards === null) {
      return emptyManifest()
    }
    return parsed
  }
  catch {
    // manifest 损坏按空处理：refresh 以已知 refId 去重重放，不会写出重复 facts。
    return emptyManifest()
  }
}

function cardContentHash(card: LoreCardContent): string {
  const text = [card.title, card.triggers.join(','), card.summary ?? '', card.body].join('\n')
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

/** 扫描启用卡片的完整内容。卡片清单复用 trigger 索引（enabled/title/triggers 单一事实源）。 */
async function scanLoreCards(project: ReadyProjectSessionRef): Promise<Map<string, LoreCardContent>> {
  const resolverIndex = await buildLoreResolverIndex(project)
  const cards = new Map<string, LoreCardContent>()
  for (const [entryPath, meta] of resolverIndex.pathToEntry) {
    const filePath = path.join(project.workspace.root, 'lorebook', entryPath, 'index.md')
    let raw: string
    try {
      raw = await readFile(filePath, 'utf-8')
    }
    catch {
      continue
    }
    const bodyMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
    if (!bodyMatch) continue
    const fm = parseFrontmatter(raw)
    cards.set(entryPath, {
      path: entryPath,
      kind: meta.kind,
      title: meta.title,
      triggers: meta.triggers,
      summary: typeof fm.summary === 'string' ? fm.summary : null,
      body: bodyMatch[2] ?? '',
    })
  }
  return cards
}

interface CardFactDraft {
  readonly id: string
  readonly text: string
}

function buildCardFactDrafts(card: LoreCardContent, hash: string): readonly CardFactDraft[] {
  const headerText = [
    card.title,
    card.triggers.length > 0 ? `别名: ${card.triggers.join('、')}` : '',
    card.summary ?? '',
  ].filter(line => line.length > 0).join('\n')
  const segments = card.body
    .split(/\n\s*\n/u)
    .map(segment => segment.trim())
    .filter(segment => segment.length > 0)
    .slice(0, MAX_SEGMENTS_PER_CARD)
    .map(segment => segment.slice(0, MAX_SEGMENT_CHARS))
  return [
    { id: `lore:${card.path}:v${hash}:header`, text: headerText },
    ...segments.map((segment, i) => ({
      id: `lore:${card.path}:v${hash}:s${String(i)}`,
      text: segment,
    })),
  ]
}

/** 嵌入解析：启用则用项目配置的真实端口；未启用/配置不完整则 NullEmbedPort 纯字面路。 */
async function resolveLoreEmbedder(
  project: ReadyProjectSessionRef,
): Promise<{ port: EmbedPort, modelKey: string, semantic: boolean }> {
  try {
    const model = await resolveWorldEmbedding({
      workspaceRoot: resolveRuntimeWorkspaceRoot(),
      projectWorkspace: project.workspace,
    })
    return {
      port: {
        dims: model.dimensions,
        embed: (texts: string[]) => embedTexts(model, texts),
      },
      modelKey: `${model.key}/${String(model.dimensions)}`,
      semantic: true,
    }
  }
  catch (error) {
    console.warn(
      '[lore-memory] embedding 不可用，本索引按纯字面路运行（零网络调用）:',
      error instanceof Error ? error.message : String(error),
    )
    return {
      port: {
        dims: 0,
        // 语义路对 vector=null 的条目一律跳过，该向量永不参与点积；
        // deferEmbedding 恒真且字面路不 backfill，它只被 embedQuery 调到。
        embed: (texts: string[]) => Promise.resolve(texts.map(() => [])),
      },
      modelKey: 'literal-only',
      semantic: false,
    }
  }
}

function computeNextTick(memory: NbMemory): number {
  let max = 0
  for (const fact of memory.facts.all) max = Math.max(max, fact.tick)
  return max + 1
}

async function backfillInBackground(
  key: string,
  entry: ProjectMemoryIndex,
): Promise<void> {
  if (entry.backfillRunning || !entry.semanticEnabled) return
  entry.backfillRunning = true
  try {
    await runExclusive(key, async () => {
      for (let round = 0; round < BACKFILL_MAX_ROUNDS; round += 1) {
        const filled = await entry.memory.backfillVectors(256)
        entry.pendingVectors = (await entry.memory.stats()).pendingVectors
        if (filled === 0) break
      }
    })
  }
  catch (error) {
    // 嵌入失败不致命：pendingVectors 保持降级读数，下次刷新重试。
    console.warn(
      '[lore-memory] backfill 失败，语义路维持降级（字面路照常）:',
      error instanceof Error ? error.message : String(error),
    )
  }
  finally {
    entry.backfillRunning = false
  }
}

/**
 * 增量刷新：内容 hash 比对，仅变化卡片追加新代 facts（未变卡片零重嵌）。
 * 已在索引里的 refId 直接跳过——manifest 丢失/损坏时只重建 manifest，
 * 不往 append-only 事实源写重复行。
 */
async function refreshProjectIndex(
  project: ReadyProjectSessionRef,
  entry: ProjectMemoryIndex,
): Promise<void> {
  const cards = await scanLoreCards(project)
  const knownRefIds = new Set((await entry.indexStore.texts()).map(row => row.refId))
  const nextCards: Record<string, ManifestCard> = {}
  for (const [entryPath, card] of cards) {
    const hash = cardContentHash(card)
    const prev = entry.manifest.cards[entryPath]
    if (prev && prev.hash === hash) {
      nextCards[entryPath] = prev
      continue
    }
    const drafts = buildCardFactDrafts(card, hash)
    for (const draft of drafts) {
      if (knownRefIds.has(draft.id)) continue
      await entry.memory.addFact({
        id: draft.id,
        tick: entry.nextTick,
        text: draft.text,
        subjectIds: [],
        meta: { lorePath: entryPath, kind: card.kind, cardHash: hash },
      })
      entry.nextTick += 1
    }
    nextCards[entryPath] = { hash, factIds: drafts.map(draft => draft.id) }
  }
  // deferEmbedding：落库即字面可召回；向量由后台 backfill 补齐。
  await entry.memory.flush()
  entry.manifest = { version: 1, cards: nextCards, updatedAt: new Date().toISOString() }
  await entry.storage.write('lore-manifest.json', JSON.stringify(entry.manifest))
  entry.pendingVectors = (await entry.memory.stats()).pendingVectors
  entry.lastScanMs = Date.now()
  void backfillInBackground(projectKey(project), entry)
}

async function buildProjectIndex(
  key: string,
  project: ReadyProjectSessionRef,
): Promise<void> {
  const embedder = await resolveLoreEmbedder(project)
  const storage = await FsStorage.open(memoryDirOf(project))
  const indexStore = await SqliteIndexStore.open({
    file: path.join(memoryDirOf(project), 'index.sqlite'),
    modelKey: embedder.modelKey,
    filterableMeta: { lorePath: 'text', kind: 'text', cardHash: 'text' },
  })
  const memory = await NbMemory.open({
    storage,
    embedder: embedder.port,
    indexStore,
    deferEmbedding: true,
  })
  const entry: ProjectMemoryIndex = {
    status: 'building',
    memory,
    storage,
    indexStore,
    manifest: await readManifest(storage),
    semanticEnabled: embedder.semantic,
    nextTick: computeNextTick(memory),
    lastScanMs: 0,
    lastUsedMs: Date.now(),
    backfillRunning: false,
    pendingVectors: 0,
  }
  indexByProjectKey.set(key, entry)
  evictOverflowEntries(key)
  try {
    await refreshProjectIndex(project, entry)
    entry.status = 'ready'
  }
  catch (error) {
    // 构建失败：关句柄、不缓存半成品，下次 invoke 按 buildRetryMs 节流重试。
    indexByProjectKey.delete(key)
    await entry.indexStore.close().catch(() => undefined)
    throw error
  }
}

function evictOverflowEntries(keepKey: string): void {
  while (indexByProjectKey.size > MAX_INDEX_ENTRIES) {
    let oldestKey: string | null = null
    let oldestMs = Infinity
    for (const [key, entry] of indexByProjectKey) {
      if (key === keepKey) continue
      if (entry.lastUsedMs < oldestMs) {
        oldestMs = entry.lastUsedMs
        oldestKey = key
      }
    }
    if (oldestKey === null) return
    const evicted = indexByProjectKey.get(oldestKey)
    indexByProjectKey.delete(oldestKey)
    if (evicted) void evicted.indexStore.close().catch(() => undefined)
  }
}

function kickBuild(key: string, project: ReadyProjectSessionRef): void {
  failedBuildAtByProjectKey.delete(key)
  void runExclusive(key, () => buildProjectIndex(key, project)).catch((error: unknown) => {
    failedBuildAtByProjectKey.set(key, Date.now())
    console.warn(
      '[lore-memory] 索引构建失败，检索退回 trigger 路径:',
      error instanceof Error ? error.message : String(error),
    )
  })
}

export interface LoreMemoryIndexHandle {
  readonly ready: boolean
  readonly status: 'building' | 'ready' | 'error'
  readonly entry?: ProjectMemoryIndex
}

/**
 * 获取项目 memory 索引：未建/构建中立即返回 not-ready（后台单飞构建，不阻塞写作）；
 * 就绪且距上次扫描超过节流窗口时后台触发增量刷新（不阻塞本次检索）。
 */
export async function acquireLoreMemoryIndex(project: ReadyProjectSessionRef): Promise<LoreMemoryIndexHandle> {
  const key = projectKey(project)
  const entry = indexByProjectKey.get(key)
  if (entry) {
    entry.lastUsedMs = Date.now()
    if (entry.status === 'ready') {
      if (Date.now() - entry.lastScanMs > indexOptions.refreshThrottleMs) {
        entry.lastScanMs = Date.now()
        void runExclusive(key, () => refreshProjectIndex(project, entry)).catch((error: unknown) => {
          // 刷新失败沿用现状索引；lastScanMs 已推进，下一窗口重试。
          console.warn(
            '[lore-memory] 增量刷新失败，沿用现状索引:',
            error instanceof Error ? error.message : String(error),
          )
        })
      }
      return { ready: true, status: 'ready', entry }
    }
    return { ready: false, status: entry.status, entry }
  }
  const failedAt = failedBuildAtByProjectKey.get(key) ?? 0
  if (Date.now() - failedAt >= indexOptions.buildRetryMs) {
    kickBuild(key, project)
  }
  return { ready: false, status: failedAt > 0 ? 'error' : 'building' }
}

export interface MemoryRecallResult {
  readonly status: 'ok' | 'building' | 'timeout' | 'error'
  /** 归并后按召回序的路径（未套 carryOver/maxPaths）。 */
  readonly rawPaths?: readonly string[]
  /** 每个 path 命中的 fact refId 列表（debug 用，对齐 trigger 路 hitsByPath 形状）。 */
  readonly hitsByPath?: ReadonlyMap<string, readonly string[]>
  readonly ms?: number
  readonly pendingVectors?: number
  readonly error?: string
}

/** 扫描文本截断为检索 query：保头 2000 字符 + 尾 2000 字符（brief 在前、最新正文在后）。 */
export function truncateLoreMemoryQuery(text: string): string {
  if (text.length <= MAX_QUERY_CHARS) return text
  const headChars = MAX_QUERY_CHARS / 2
  return `${text.slice(0, headChars)}\n…\n${text.slice(text.length - (MAX_QUERY_CHARS - headChars))}`
}

function mergeHitsByLorePath(
  hits: readonly SearchHit[],
  manifest: LoreMemoryManifest,
): { rawPaths: string[], hitsByPath: Map<string, string[]> } {
  const hitsByPath = new Map<string, string[]>()
  for (const hit of hits) {
    const meta = hit.meta as { lorePath?: unknown, cardHash?: unknown } | undefined
    const lorePath = typeof meta?.lorePath === 'string' ? meta.lorePath : null
    const cardHash = typeof meta?.cardHash === 'string' ? meta.cardHash : null
    if (!lorePath || !cardHash) continue
    // 旧代过滤：manifest 当前代之外的 facts（含已删卡片）一律不召回。
    if (manifest.cards[lorePath]?.hash !== cardHash) continue
    if (!hitsByPath.has(lorePath)) hitsByPath.set(lorePath, [])
    hitsByPath.get(lorePath)?.push(hit.refId)
  }
  return { rawPaths: [...hitsByPath.keys()], hitsByPath }
}

/**
 * 以扫描文本为 query 走 nb-memory 检索并归并路径。任何失败/超时返回非 ok
 * 状态而不抛出——退回 trigger 是调用方的标准动作（三级退回第一级）。
 */
export async function recallLorePathsWithMemory(
  project: ReadyProjectSessionRef,
  scanText: string,
  timeoutMs: number,
): Promise<MemoryRecallResult> {
  const key = projectKey(project)
  let handle: LoreMemoryIndexHandle
  try {
    handle = await acquireLoreMemoryIndex(project)
  }
  catch (error) {
    return { status: 'error', error: error instanceof Error ? error.message : String(error) }
  }
  if (!handle.ready || !handle.entry) {
    return { status: handle.status === 'error' ? 'error' : 'building' }
  }
  const entry = handle.entry
  const query = truncateLoreMemoryQuery(scanText)
  const startedAt = performance.now()
  // 检索在串行链上跑到底（timeout 只放弃等待，不取消检索——悬挂的 embed 调用
  // 受其自身 timeoutMs 收敛；链条保证并发检索不交错）。
  const searchPromise = runExclusive(key, async () => {
    const hits = await entry.memory.search(query, { limit: SEARCH_HIT_LIMIT, sources: ['fact'] })
    entry.pendingVectors = (await entry.memory.stats()).pendingVectors
    return mergeHitsByLorePath(hits, entry.manifest)
  })
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    const merged = await Promise.race([
      searchPromise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { reject(new Error(`lore memory search timeout after ${String(timeoutMs)}ms`)) }, timeoutMs)
        if (typeof timer.unref === 'function') timer.unref()
      }),
    ])
    return {
      status: 'ok',
      rawPaths: merged.rawPaths,
      hitsByPath: merged.hitsByPath,
      ms: performance.now() - startedAt,
      pendingVectors: entry.pendingVectors,
    }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      status: message.includes('timeout') ? 'timeout' : 'error',
      ms: performance.now() - startedAt,
      error: message,
    }
  }
  finally {
    if (timer) clearTimeout(timer)
  }
}
