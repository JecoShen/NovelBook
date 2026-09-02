import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ReadyProjectSessionRef } from 'nbook/server/workspace-files/project-session-types'

export interface LoreInjectionRecord {
  readonly chapterId: string
  readonly paths: readonly string[]
  readonly ts: string
}

export interface ReadOptions {
  readonly limit: number
}

function getJsonlPath(project: ReadyProjectSessionRef): string {
  // 项目级状态路径约定对齐 profile-context-access（`workspace.root/.nbook/...`）。
  // workspace.root 是 openProject 已 realpath 校验的绝对路径；ref.projectRoot 只是
  // Workspace Root 下单段相对 slug——旧实现 join 裸名得到相对路径，被进程 cwd 锚定：
  // 测试每次全量跑在仓库根泄漏 <slug>/ 目录，生产则随启动目录漂移（feature 静默失效）。
  return join(
    project.workspace.root,
    '.nbook',
    'state',
    'lore-carryover.jsonl',
  )
}

export async function recordLoreInjection(
  project: ReadyProjectSessionRef,
  record: LoreInjectionRecord,
): Promise<void> {
  const path = getJsonlPath(project)
  try {
    await mkdir(dirname(path), { recursive: true })
    await appendFile(path, JSON.stringify(record) + '\n', 'utf8')
  }
  catch (err) {
    console.warn(`[lore-carryover] record failed for ${record.chapterId}:`, err)
  }
}

export async function readRecentLoreInjections(
  project: ReadyProjectSessionRef,
  options: ReadOptions,
): Promise<readonly string[]> {
  const path = getJsonlPath(project)
  let content: string
  try {
    content = await readFile(path, 'utf8')
  }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    console.warn(`[lore-carryover] read failed, returning []:`, err)
    return []
  }
  const lines = content.split('\n').filter(l => l.length > 0)
  const recent = lines.slice(-options.limit)
  const seen = new Set<string>()
  const result: string[] = []
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    let parsed: LoreInjectionRecord
    try {
      parsed = JSON.parse(recent[i]!) as LoreInjectionRecord
    }
    catch {
      console.warn(`[lore-carryover] skip malformed line at index ${i}`)
      continue
    }
    for (const p of parsed.paths) {
      if (!seen.has(p)) {
        seen.add(p)
        result.push(p)
      }
    }
  }
  return result
}
