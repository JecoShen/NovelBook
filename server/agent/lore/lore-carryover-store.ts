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
  return join(
    project.workspace.ref.projectRoot,
    'workspace',
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
