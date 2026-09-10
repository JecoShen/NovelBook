import path from 'node:path'
import fs from 'node:fs/promises'
import { consola } from 'consola'
import {
  HistoryError,
  type OperationActor,
  type UnseenGroup,
  type WorkspaceHistory,
} from '@notnotype/nb-history'
import type { ProjectHistoryHandle } from 'nbook/server/workspace-history/project-history-contract'
import { isHistoryTrackedRelativePath } from 'nbook/server/workspace-history/history-paths'

const RECONCILE_MAX_BYTES = 8 * 1024 * 1024

/** 记一次写入（create/edit 由模块按账面自动判定）。before 为 null 表示此前文件不存在。 */
export async function recordProjectWrite(handle: ProjectHistoryHandle, input: {
  relativePath: string
  actor: OperationActor
  before: Uint8Array | null
  after: Uint8Array
}): Promise<void> {
  const relativePath = normalizeRecordPath(input.relativePath)
  await recordSafely(handle, relativePath, async (history) => {
    await history.registerWrite(input.actor, relativePath, input.before, input.after)
  })
}

/** 记一次删除。before 是删除前内容（删除找回的快照来源）。 */
export async function recordProjectDelete(handle: ProjectHistoryHandle, input: {
  relativePath: string
  actor: OperationActor
  before: Uint8Array
}): Promise<void> {
  const relativePath = normalizeRecordPath(input.relativePath)
  await recordSafely(handle, relativePath, async (history) => {
    await history.registerDelete(input.actor, relativePath, input.before)
  })
}

/** 记一次改名（内容不变）。from/to 任一不在记账范围则整条跳过（罕见的跨界移动，注释于谓词）。 */
export async function recordProjectRename(handle: ProjectHistoryHandle, input: {
  fromPath: string
  toPath: string
  actor: OperationActor
}): Promise<void> {
  const fromPath = normalizeRecordPath(input.fromPath)
  const toPath = normalizeRecordPath(input.toPath)
  if (!historyConsumesPath(handle, fromPath)) {
    return
  }
  await recordSafely(handle, toPath, async (history) => {
    await history.registerRename(input.actor, fromPath, toPath)
  })
}

/** 记账公共外壳：路径归一化 + 谓词过滤 + 实例获取 + fail-open（记账失败告警降级，绝不向调用方抛出，N3）。 */
async function recordSafely(
  handle: ProjectHistoryHandle,
  relativePath: string,
  fn: (history: WorkspaceHistory) => Promise<void>,
): Promise<void> {
  if (!historyConsumesPath(handle, relativePath)) {
    return
  }
  try {
    await handle.waitForWarmup()
    const history = await handle.history
    if (!history) {
      return
    }
    await fn(history)
  }
  catch (error) {
    consola.warn({ path: relativePath, error }, 'workspace-history 记账失败（fail-open 降级，历史由对账自愈）')
  }
}

/** 归一化记账相对路径：只转换分隔符并去尾斜杠，绝对/越界输入交由Project Path Policy拒绝。 */
function normalizeRecordPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/u, '')
}

/**
 * 会话未见变更（fail-open：任何失败返回空数组）。
 * 游标懒初始化（N8）：会话首次查询时以「当下」为基线建游标并返回空——新会话不被历史淹没，
 * 也避免在 createAgent（无 ensure-open 保证）挂 initCursor。
 */
export async function readUnseenForAgent(
  handle: ProjectHistoryHandle,
  sessionId: number,
): Promise<UnseenGroup[]> {
  try {
    await handle.waitForWarmup()
    const history = await handle.history
    if (!history) {
      return []
    }
    try {
      return await history.unseenChanges(String(sessionId))
    }
    catch (error) {
      // 与 vendored 模块的错误文案耦合（VENDOR.json 锁定版本）：游标未初始化 = 会话首次接触该项目。
      if (error instanceof HistoryError && error.message.includes('游标未初始化')) {
        await history.initCursor(String(sessionId))
        return []
      }
      throw error
    }
  }
  catch (error) {
    consola.warn({ sessionId, error }, 'workspace-history 未见变更查询失败（视为无变更）')
    return []
  }
}

/** 推进会话游标（提醒成功送达后调用；fail-open）。 */
export async function advanceAgentCursor(
  handle: ProjectHistoryHandle,
  sessionId: number,
  entryId: number,
): Promise<void> {
  try {
    await handle.waitForWarmup()
    const history = await handle.history
    await history?.advanceCursor(String(sessionId), entryId)
  }
  catch (error) {
    consola.warn({ sessionId, error }, 'workspace-history 游标推进失败（下轮提醒将重复出现）')
  }
}

/** 递归收集受管文件相对路径（正斜杠）；排除段目录整树跳过。写面目录记账与 open 对账扫描共用。 */
export async function collectTrackedDiskFiles(
  root: string,
  prefix: string,
  signal?: AbortSignal,
  consumesPath: (relativePath: string) => boolean = isHistoryTrackedRelativePath,
): Promise<string[]> {
  signal?.throwIfAborted()
  const absolute = prefix ? path.join(root, ...prefix.split('/')) : root
  const entries = await fs.readdir(absolute, { withFileTypes: true }).catch(() => [])
  signal?.throwIfAborted()
  const files: string[] = []
  for (const entry of entries) {
    signal?.throwIfAborted()
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    if (!consumesPath(relativePath)) {
      continue
    }
    if (entry.isDirectory()) {
      files.push(...await collectTrackedDiskFiles(root, relativePath, signal, consumesPath))
    }
    else if (entry.isFile()) {
      files.push(relativePath)
    }
  }
  return files
}

/** 对账用读盘：文件不存在 / 读失败 / 超过大小上限按「不存在 / 跳过」处理。 */
export async function readFileForHistoryReconcile(
  root: string,
  relativePath: string,
  signal?: AbortSignal,
): Promise<Uint8Array | null> {
  signal?.throwIfAborted()
  const absolutePath = path.join(root, ...relativePath.split('/'))
  const stat = await fs.stat(absolutePath).catch(() => null)
  signal?.throwIfAborted()
  if (!stat?.isFile() || stat.size > RECONCILE_MAX_BYTES) {
    return null
  }
  try {
    const content = await fs.readFile(absolutePath, signal ? { signal } : undefined)
    signal?.throwIfAborted()
    return content
  }
  catch {
    if (signal?.aborted) {
      throw signal.reason
    }
    return null
  }
}

/** 路径策略错误按fail-open记账入口的既有语义降级为不消费。 */
function historyConsumesPath(handle: ProjectHistoryHandle, relativePath: string): boolean {
  try {
    return handle.pathPolicy(relativePath).disposition === 'consume'
      && isHistoryTrackedRelativePath(relativePath)
  }
  catch {
    return false
  }
}
