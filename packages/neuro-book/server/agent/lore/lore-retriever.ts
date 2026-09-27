/**
 * lore 选卡检索器 dispatch（p-008 / spec: agent.writer-lore-context）。
 *
 * - `trigger`（默认）：现状字符串匹配，原样调用 resolveForChapter——默认配置下
 *   注入结果与落地前逐字节一致；trigger 同时是永久降级兜底（三级退回：
 *   memory → trigger → 空串，空串由 profile 侧既有语义承担）。
 * - `shadow`：注入仍用 trigger 结果；memory 召回与两路差异 fire-and-forget 写
 *   观测日志，不拖慢注入、零可观察行为变化。
 * - `memory`：nb-memory 召回进注入；索引未建/构建中/检索抛错/超时任一发生
 *   自动退回 trigger 并记观测日志。
 *
 * `lore_resolver_query` 工具不经过本模块（始终 trigger 语义，p-008 非目标）。
 */
import { performance } from 'node:perf_hooks'
import {
  resolveForChapter,
  type ResolveForChapterInput,
  type ResolveForChapterResult,
} from './lore-resolver'
import { recallLorePathsWithMemory, type MemoryRecallResult } from './lore-memory-index'
import { appendLoreShadowRecord, type LoreShadowRecord } from './lore-shadow-log'
import { loadGlobalEffectiveConfigAtWorkspaceRoot } from 'nbook/server/config/config-service'
import { resolveRuntimeWorkspaceRoot } from 'nbook/server/workspace-files/workspace-runtime-root'
import type { LoreRetrieverMode } from 'nbook/server/config/types'

const DEFAULT_MAX_PATHS = 8
/** 语义路每次注入至多 1 次 query embed；超时自动降级（p-008 决策 3）。 */
const MEMORY_SEARCH_TIMEOUT_MS = 2000

export interface ResolveChapterLoreInput extends ResolveForChapterInput {
  /** 测试 seam：显式覆盖配置闸；缺省读 global config（读取失败回落 trigger）。 */
  readonly retrieverOverride?: LoreRetrieverMode
}

async function readConfiguredRetriever(): Promise<LoreRetrieverMode> {
  try {
    const config = await loadGlobalEffectiveConfigAtWorkspaceRoot({
      workspaceRoot: resolveRuntimeWorkspaceRoot(),
    })
    return config.agent.loreContext.retriever
  }
  catch (error) {
    console.warn(
      '[lore-retriever] 配置读取失败，本次按 trigger 处理:',
      error instanceof Error ? error.message : String(error),
    )
    return 'trigger'
  }
}

/** carryOver 无条件置顶，与 resolveForChapter 同序语义；memory 召回序随后去重补齐。 */
function applyCarryOver(
  rankedPaths: readonly string[],
  carryOverPaths: readonly string[] | undefined,
  maxPaths: number,
): string[] {
  const carrySet = new Set(carryOverPaths ?? [])
  const ranked = [...carrySet, ...rankedPaths.filter(p => !carrySet.has(p))]
  return ranked.slice(0, maxPaths)
}

function buildShadowRecord(
  mode: LoreShadowRecord['mode'],
  input: ResolveChapterLoreInput,
  trigger: LoreShadowRecord['trigger'],
  recall: MemoryRecallResult,
  memoryFinalPaths: readonly string[] | undefined,
  fallbackToTrigger: boolean,
): LoreShadowRecord {
  const diff = trigger && memoryFinalPaths
    ? {
      onlyTrigger: trigger.paths.filter(p => !memoryFinalPaths.includes(p)),
      onlyMemory: memoryFinalPaths.filter(p => !trigger.paths.includes(p)),
      common: trigger.paths.filter(p => memoryFinalPaths.includes(p)),
    }
    : undefined
  return {
    ts: new Date().toISOString(),
    mode,
    queryChars: input.chapterText.length,
    carryOverPaths: input.carryOverPaths ?? [],
    ...(trigger ? { trigger } : {}),
    memory: {
      status: recall.status,
      ...(memoryFinalPaths ? { paths: memoryFinalPaths } : {}),
      ...(recall.rawPaths ? { rawPaths: recall.rawPaths } : {}),
      ...(recall.ms !== undefined ? { ms: Math.round(recall.ms * 100) / 100 } : {}),
      ...(recall.pendingVectors !== undefined ? { pendingVectors: recall.pendingVectors } : {}),
      ...(recall.error ? { error: recall.error } : {}),
    },
    ...(diff ? { diff } : {}),
    ...(fallbackToTrigger ? { fallbackToTrigger: true } : {}),
  }
}

async function observeShadowRecall(
  input: ResolveChapterLoreInput,
  triggerResult: ResolveForChapterResult,
  triggerMs: number,
): Promise<void> {
  const maxPaths = input.maxPaths ?? DEFAULT_MAX_PATHS
  const recall = await recallLorePathsWithMemory(input.project, input.chapterText, MEMORY_SEARCH_TIMEOUT_MS)
  const memoryFinalPaths = recall.status === 'ok' && recall.rawPaths
    ? applyCarryOver(recall.rawPaths, input.carryOverPaths, maxPaths)
    : undefined
  await appendLoreShadowRecord(
    input.project,
    buildShadowRecord(
      'shadow',
      input,
      { paths: triggerResult.paths, ms: Math.round(triggerMs * 100) / 100 },
      recall,
      memoryFinalPaths,
      false,
    ),
  )
}

async function resolveWithShadow(input: ResolveChapterLoreInput): Promise<ResolveForChapterResult> {
  const startedAt = performance.now()
  const triggerResult = await resolveForChapter(input)
  const triggerMs = performance.now() - startedAt
  // fire-and-forget：观测不拖慢注入（spec：shadow 期用户可观察行为零变化）。
  void observeShadowRecall(input, triggerResult, triggerMs).catch((error: unknown) => {
    console.warn(
      '[lore-retriever] shadow 观测失败（注入不受影响）:',
      error instanceof Error ? error.message : String(error),
    )
  })
  return triggerResult
}

async function resolveWithMemoryPrimary(input: ResolveChapterLoreInput): Promise<ResolveForChapterResult> {
  const maxPaths = input.maxPaths ?? DEFAULT_MAX_PATHS
  const recall = await recallLorePathsWithMemory(input.project, input.chapterText, MEMORY_SEARCH_TIMEOUT_MS)
  if (recall.status === 'ok' && recall.rawPaths) {
    const paths = applyCarryOver(recall.rawPaths, input.carryOverPaths, maxPaths)
    // primary 模式的观测记录确定性要求高（切换评审数据源）：检索成本已付，
    // 本地追加开销可忽略，await 落定再返回。写失败仍只 warn 不影响注入。
    await appendLoreShadowRecord(
      input.project,
      buildShadowRecord('memory', input, undefined, recall, paths, false),
    )
    return {
      paths,
      hitsByPath: recall.hitsByPath ?? new Map(),
      totalTriggersMatched: 0,
    }
  }
  // 三级退回第一级：memory → trigger（索引未建/构建中/抛错/超时）。
  const startedAt = performance.now()
  const triggerResult = await resolveForChapter(input)
  const triggerMs = performance.now() - startedAt
  await appendLoreShadowRecord(
    input.project,
    buildShadowRecord(
      'memory',
      input,
      { paths: triggerResult.paths, ms: Math.round(triggerMs * 100) / 100 },
      recall,
      undefined,
      true,
    ),
  )
  return triggerResult
}

/**
 * writer 主链 lore 选卡入口（profile 经 profile-sdk 调用）：按配置闸分发
 * trigger/shadow/memory 检索器。输入输出与 resolveForChapter 同形。
 */
export async function resolveChapterLore(input: ResolveChapterLoreInput): Promise<ResolveForChapterResult> {
  const mode = input.retrieverOverride ?? await readConfiguredRetriever()
  if (mode === 'shadow') return resolveWithShadow(input)
  if (mode === 'memory') return resolveWithMemoryPrimary(input)
  return resolveForChapter(input)
}
