import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildLoreResolverIndex, invalidateLoreResolverIndex } from './lore-resolver-cache'
import { resolveForChapter } from './lore-resolver'
import { renderInjectedMarkdown } from './lore-context-injector'
import type { ReadyProjectSessionRef } from 'nbook/server/workspace-files/project-session-types'

function makeProjectRef(root: string): ReadyProjectSessionRef {
  return { workspace: { root, key: { slug: 'test', root }, ref: { projectRoot: root } }, generation: 1 } as unknown as ReadyProjectSessionRef
}

function writeCard(root: string, category: string, slug: string, opts: { title?: string, triggers?: string[] } = {}): void {
  const dir = join(root, 'lorebook', category, slug)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'index.md'),
    `---\ntitle: ${opts.title ?? slug}\ntype: ${category}\nsummary: ${slug} 简述\nretrieval:\n  enabled: true\n  trigger: [${(opts.triggers ?? [slug]).join(', ')}]\n---\n\n## 基本信息\n\n| 项目 | 设定 |\n|------|------|\n| 名称 | ${opts.title ?? slug} |\n\n## 性格\n\n核心特质：分析型。\n- 一\n- 二\n- 三\n`)
}

describe('lore-resolver integration', () => {
  let tmpRoot: string
  let project: ReadyProjectSessionRef

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'lore-int-'))
    project = makeProjectRef(tmpRoot)
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
    invalidateLoreResolverIndex(project)
  })

  it('end-to-end: build → resolve → render', async () => {
    writeCard(tmpRoot, 'character', 'lu-shen', { title: '陆深', triggers: ['陆深'] })
    writeCard(tmpRoot, 'location', 'mei-lake', { title: '梅澜湖', triggers: ['梅澜湖'] })
    writeCard(tmpRoot, 'character', 'lao-wang', { title: '老王', triggers: ['老王'] })

    await buildLoreResolverIndex(project)

    const resolved = await resolveForChapter({
      project,
      chapterText: '陆深在梅澜湖遇到老王',
    })
    expect(resolved.paths.length).toBe(3)
    expect(resolved.paths).toContain('character/lu-shen')
    expect(resolved.paths).toContain('location/mei-lake')
    expect(resolved.paths).toContain('character/lao-wang')

    const rendered = await renderInjectedMarkdown({
      project,
      paths: resolved.paths,
    })
    expect(rendered.markdown).toContain('<chapter_lore_context')
    expect(rendered.markdown).toContain('## 陆深 (character)')
    expect(rendered.markdown).toContain('## 梅澜湖 (location)')
    expect(rendered.markdown).toContain('## 老王 (character)')
    expect(rendered.markdown).toContain('</chapter_lore_context>')
    expect(rendered.includedPaths.length).toBe(3)
  })

  it('lorebook/ 不存在时降级为空 paths（harness 流程不报错）', async () => {
    // tmpRoot 没有 lorebook/ 子目录
    await expect(resolveForChapter({ project, chapterText: '陆深' })).resolves.toEqual({
      paths: [],
      hitsByPath: new Map(),
      totalTriggersMatched: 0,
    })
    await expect(renderInjectedMarkdown({ project, paths: [] })).resolves.toMatchObject({
      includedPaths: [],
      truncatedPaths: [],
    })
  })
})
