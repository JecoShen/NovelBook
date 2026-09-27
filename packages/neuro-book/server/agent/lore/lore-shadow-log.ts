import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ReadyProjectSessionRef } from 'nbook/server/workspace-files/project-session-types'

/**
 * shadow/primary 双跑观测记录（p-008 / spec: agent.writer-lore-context）。
 * memory 召回集合与两路差异只进本日志，不影响注入；切换评审（≥20 次真实
 * invoke 对照）以本日志为数据源。
 */
export interface LoreShadowRecord {
  readonly ts: string
  readonly mode: 'shadow' | 'memory'
  readonly queryChars: number
  readonly carryOverPaths: readonly string[]
  /** trigger 路结果；memory 模式成功时未跑 trigger，缺省。 */
  readonly trigger?: {
    readonly paths: readonly string[]
    readonly ms: number
  }
  readonly memory: {
    readonly status: 'ok' | 'building' | 'timeout' | 'error'
    /** memory 路套 carryOver 后的最终路径（status=ok 时存在）。 */
    readonly paths?: readonly string[]
    /** 归并后、未套 carryOver 的原始召回序（对照分析用）。 */
    readonly rawPaths?: readonly string[]
    readonly ms?: number
    /** >0 表示语义路处于降级（这些条目当前只能被字面路召回）。 */
    readonly pendingVectors?: number
    readonly error?: string
  }
  /** 两路最终路径集合差异；任一未产出时缺省。 */
  readonly diff?: {
    readonly onlyTrigger: readonly string[]
    readonly onlyMemory: readonly string[]
    readonly common: readonly string[]
  }
  /** memory 模式退回 trigger 的标记（三级退回第一级）。 */
  readonly fallbackToTrigger?: boolean
}

function getShadowLogPath(project: ReadyProjectSessionRef): string {
  // 与 lore-carryover.jsonl 同目录：项目级观测 jsonl 先例；workspace.root 是
  // openProject 已 realpath 校验的绝对路径（相对路径锚定进程 cwd 的教训见 carryover-store）。
  return join(project.workspace.root, '.nbook', 'state', 'lore-retriever-shadow.jsonl')
}

/** 追加一条观测记录；写失败只 console.warn，绝不影响注入（对齐 lore-carryover-store）。 */
export async function appendLoreShadowRecord(
  project: ReadyProjectSessionRef,
  record: LoreShadowRecord,
): Promise<void> {
  const path = getShadowLogPath(project)
  try {
    await mkdir(dirname(path), { recursive: true })
    await appendFile(path, JSON.stringify(record) + '\n', 'utf8')
  }
  catch (err) {
    console.warn('[lore-shadow] record failed:', err)
  }
}
