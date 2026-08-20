import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { recordLoreInjection, readRecentLoreInjections } from './lore-carryover-store'
import type { ReadyProjectSessionRef } from 'nbook/server/workspace-files/project-session-types'

function makeProjectRef(root: string): ReadyProjectSessionRef {
  return {
    workspace: { root, key: { slug: 'test', root }, ref: { projectRoot: root } },
    generation: 1,
  } as unknown as ReadyProjectSessionRef
}

describe('lore-carryover-store', () => {
  let tmpRoot: string
  let project: ReadyProjectSessionRef

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'lore-carryover-'))
    project = makeProjectRef(tmpRoot)
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('record 1 chapter then read returns that chapter\'s paths', async () => {
    await recordLoreInjection(project, {
      chapterId: 'ch-001',
      paths: ['character/lu-shen', 'location/mei-lake'],
      ts: '2026-08-19T10:00:00Z',
    })
    const result = await readRecentLoreInjections(project, { limit: 3 })
    expect(result).toEqual(['character/lu-shen', 'location/mei-lake'])
  })

  it('record 5 chapters, read limit=3 returns latest 3 union deduped', async () => {
    for (let i = 1; i <= 5; i += 1) {
      await recordLoreInjection(project, {
        chapterId: `ch-${String(i).padStart(3, '0')}`,
        paths: [`character/c-${i}`, `location/l-${i}`],
        ts: `2026-08-19T10:0${i}:00Z`,
      })
    }
    const result = await readRecentLoreInjections(project, { limit: 3 })
    expect(result).toEqual([
      'character/c-5', 'location/l-5',
      'character/c-4', 'location/l-4',
      'character/c-3', 'location/l-3',
    ])
  })

  it('same chapterId recorded multiple times: path dedup, record entries kept', async () => {
    await recordLoreInjection(project, {
      chapterId: 'ch-001', paths: ['character/lu-shen'], ts: '2026-08-19T10:00:00Z',
    })
    await recordLoreInjection(project, {
      chapterId: 'ch-001', paths: ['character/lu-shen', 'location/mei-lake'], ts: '2026-08-19T10:01:00Z',
    })
    const result = await readRecentLoreInjections(project, { limit: 3 })
    expect(result).toEqual(['character/lu-shen', 'location/mei-lake'])
  })

  it('read with missing file returns empty array', async () => {
    const result = await readRecentLoreInjections(project, { limit: 3 })
    expect(result).toEqual([])
  })

  it('read skips malformed trailing line, returns valid prior lines in order', async () => {
    const jsonlPath = join(tmpRoot, 'workspace', '.nbook', 'state', 'lore-carryover.jsonl')
    mkdirSync(dirname(jsonlPath), { recursive: true })
    writeFileSync(jsonlPath, '')
    appendFileSync(jsonlPath, JSON.stringify({
      chapterId: 'ch-001', paths: ['character/lu-shen'], ts: '2026-08-19T10:00:00Z',
    }) + '\n')
    appendFileSync(jsonlPath, JSON.stringify({
      chapterId: 'ch-002', paths: ['location/mei-lake'], ts: '2026-08-19T10:01:00Z',
    }) + '\n')
    appendFileSync(jsonlPath, '{this is not valid json\n')
    const result = await readRecentLoreInjections(project, { limit: 3 })
    expect(result).toEqual(['location/mei-lake', 'character/lu-shen'])
  })
})
