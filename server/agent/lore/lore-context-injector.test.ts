import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildLoreResolverIndex, invalidateLoreResolverIndex } from './lore-resolver-cache'
import { renderInjectedMarkdown } from './lore-context-injector'
import type { ReadyProjectSessionRef } from 'nbook/server/workspace-files/project-session-types'

function makeProjectRef(root: string): ReadyProjectSessionRef {
  return { workspace: { root, key: { slug: 'test', root }, ref: { projectRoot: root } }, generation: 1 } as unknown as ReadyProjectSessionRef
}

function writeFullCard(
  root: string,
  category: string,
  slug: string,
  opts: { title?: string, triggers?: string[], basicInfo?: string, personality?: string } = {},
): void {
  const dir = join(root, 'lorebook', category, slug)
  mkdirSync(dir, { recursive: true })
  const fm = [
    '---',
    `title: ${opts.title ?? slug}`,
    `type: ${category}`,
    `aliases: [${slug}]`,
    `tags: [test]`,
    `summary: 这是 ${opts.title ?? slug} 的简述`,
    ...(opts.triggers ? [`retrieval:`, `  enabled: true`, `  trigger: [${opts.triggers.join(', ')}]`, `governance:`, `  source: test`] : []),
    '---',
  ].join('\n')
  const body = [
    opts.basicInfo ?? '## 基本信息\n\n| 项目 | 设定 |\n|------|------|\n| 名称 | 陆深 |\n| 年龄 | 29 |\n',
    opts.personality ?? '## 性格\n\n核心特质：高智商、外冷内热。\n- 第一个\n- 第二个\n- 第三个\n- 第四个\n',
  ].join('\n')
  writeFileSync(join(dir, 'index.md'), `${fm}\n\n${body}\n`)
}

describe('renderInjectedMarkdown', () => {
  let tmpRoot: string
  let project: ReadyProjectSessionRef

  beforeEach(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'lore-injector-'))
    project = makeProjectRef(tmpRoot)
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
    invalidateLoreResolverIndex(project)
  })

  it('renders character card with basic info + first 3 personality lines', async () => {
    writeFullCard(tmpRoot, 'character', 'lu-shen', { title: '陆深', triggers: ['陆深'] })
    await buildLoreResolverIndex(project)

    const result = await renderInjectedMarkdown({
      project,
      paths: ['character/lu-shen'],
    })
    expect(result.markdown).toContain('## 陆深 (character)')
    expect(result.markdown).toContain('## 基本信息')
    expect(result.markdown).toContain('年龄 | 29')
    expect(result.markdown).toContain('核心特质：高智商、外冷内热')
    expect(result.markdown).toContain('- 第一个')
    expect(result.markdown).toContain('- 第二个')
    expect(result.markdown).toContain('- 第三个')
    expect(result.markdown).not.toContain('- 第四个') // 第 4 行不取
  })

  it('orders entries character → location → faction', async () => {
    writeFullCard(tmpRoot, 'faction', 'corp', { title: '公司', triggers: ['公司'] })
    writeFullCard(tmpRoot, 'location', 'lake', { title: '湖', triggers: ['湖'] })
    writeFullCard(tmpRoot, 'character', 'lu-shen', { title: '陆深', triggers: ['陆深'] })
    await buildLoreResolverIndex(project)

    const result = await renderInjectedMarkdown({
      project,
      paths: ['faction/corp', 'location/lake', 'character/lu-shen'],
    })
    const charIdx = result.markdown.indexOf('## 陆深')
    const locIdx = result.markdown.indexOf('## 湖')
    const facIdx = result.markdown.indexOf('## 公司')
    expect(charIdx).toBeLessThan(locIdx)
    expect(locIdx).toBeLessThan(facIdx)
  })

  it('truncates by maxChars and reports truncatedPaths', async () => {
    // 写 3 张大 character 卡，每张约 2000 字符
    for (let i = 0; i < 3; i += 1) {
      const big = '## 基本信息\n\n' + Array.from({ length: 50 }, (_, j) => `| 项目${j} | ${'x'.repeat(40)} |`).join('\n') + '\n'
      writeFullCard(tmpRoot, 'character', `c-${i}`, { title: `c${i}`, triggers: [`c${i}`], basicInfo: big })
    }
    await buildLoreResolverIndex(project)

    const result = await renderInjectedMarkdown({
      project,
      paths: ['character/c-0', 'character/c-1', 'character/c-2'],
      maxChars: 500,
    })
    expect(result.totalChars).toBeLessThanOrEqual(500)
    expect(result.truncatedPaths.length).toBeGreaterThan(0)
    expect(result.includedPaths.length).toBeLessThan(3)
  })

  it('strips retrieval/governance/ext from frontmatter in output', async () => {
    writeFullCard(tmpRoot, 'character', 'lu-shen', { title: '陆深', triggers: ['陆深'] })
    await buildLoreResolverIndex(project)

    const result = await renderInjectedMarkdown({ project, paths: ['character/lu-shen'] })
    expect(result.markdown).not.toContain('retrieval:')
    expect(result.markdown).not.toContain('governance:')
    expect(result.markdown).not.toContain('trigger:')
  })

  it('renders only summary when character card has no ## 基本信息 section', async () => {
    // 卡里没 ## 基本信息 段——退化为只输出 summary
    const dir = join(tmpRoot, 'lorebook', 'character', 'bare')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'index.md'),
      '---\ntitle: bare\ntype: character\nsummary: 这是 bare 卡的简述\nretrieval:\n  enabled: true\n  trigger: [bare]\n---\n\n## 其他段\n随便写\n')
    await buildLoreResolverIndex(project)

    const result = await renderInjectedMarkdown({ project, paths: ['character/bare'] })
    expect(result.markdown).toContain('这是 bare 卡的简述')
  })

  // M-2: totalChars 必须 <= maxChars (header+footer 也计入 budget)
  it('respects totalChars <= maxChars including header+footer overhead (M-2)', async () => {
    // 小 body (~100 chars)。maxChars=300,header+footer ~150+21=171, body budget ~129.
    // 旧 impl 只算 body,候选 ~220 < 300 → 块入 → totalChars ~391 > 300 (FAIL).
    // 修后 bodyBudget=129,候选 ~220 > 129 → 块不进 → totalChars ~171 ≤ 300 (PASS).
    const body = Array.from({ length: 2 }, (_, j) => `| 项目${j} | ${'x'.repeat(50)} |`).join('\n')
    writeFullCard(tmpRoot, 'character', 'c-small', { title: 'c-small', triggers: ['c-small'], basicInfo: `## 基本信息\n\n${body}\n` })
    await buildLoreResolverIndex(project)

    const result = await renderInjectedMarkdown({
      project,
      paths: ['character/c-small'],
      maxChars: 300,
    })
    expect(result.totalChars).toBeLessThanOrEqual(300)
  })

  // M-3: 缺 ## 基本信息 + 有 summary 时,summary 不能在 frontmatter 又在 > summary 出现 2 次
  it('does not duplicate summary in frontmatter and quote line (M-3)', async () => {
    const dir = join(tmpRoot, 'lorebook', 'character', 'bare-dup')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'index.md'),
      '---\ntitle: bare-dup\ntype: character\nsummary: 唯一 summary 字符串\nretrieval:\n  enabled: true\n  trigger: [bare-dup]\n---\n\n## 其他段\n随便写\n')
    await buildLoreResolverIndex(project)

    const result = await renderInjectedMarkdown({ project, paths: ['character/bare-dup'] })
    const occurrences = (result.markdown.match(/唯一 summary 字符串/g) ?? []).length
    expect(occurrences).toBe(1)
  })
})
