#!/usr/bin/env node
// scan-scene-master-list.cjs — 半自动 scene-master-list 基线扫描工具
// 8 列 schema: vol / chapter / title / beat / pov / scene / value_shift / hook_type
// 6 列自动从 frontmatter 抽, 2 列手工留空
// schema 与填写规范: packages/neuro-book/assets/reference/scene-master-list.md
// 抗过度 spec 化: 失败一律 soft 降级, 退出码 0

const fs = require('node:fs')
const path = require('node:path')

const MANUSCRIPT_DIR = process.argv[2]
const OUTPUT_PATH = process.argv[3]

if (!MANUSCRIPT_DIR || !OUTPUT_PATH) {
  console.warn('[scan] usage: node scan-scene-master-list.cjs <manuscript-dir> <output-md>')
  process.exit(0)
}

if (!fs.existsSync(MANUSCRIPT_DIR)) {
  console.warn(`[scan] manuscript dir not found: ${MANUSCRIPT_DIR}`)
  process.exit(0)
}

const VOLUMES = fs.readdirSync(MANUSCRIPT_DIR)
  .filter(name => name.startsWith('第') && name.includes('卷'))
  .sort()

const rows = []
let skipped = 0

for (const volName of VOLUMES) {
  const volDir = path.join(MANUSCRIPT_DIR, volName)
  if (!fs.statSync(volDir).isDirectory()) continue

  const chapters = fs.readdirSync(volDir)
    .filter(name => /^\d{3}-/.test(name))
    .sort()

  for (const chName of chapters) {
    const chDir = path.join(volDir, chName)
    const indexPath = path.join(chDir, 'index.md')
    if (!fs.existsSync(indexPath)) {
      skipped++
      continue
    }

    const content = fs.readFileSync(indexPath, 'utf-8')
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
    if (!fmMatch) {
      skipped++
      continue
    }

    const frontmatter = fmMatch[1]
    const body = fmMatch[2]

    // 抽 6 自动列 (frontmatter 缺字段时走目录名 fallback 或留空)
    const vol = volName
    const chapterMatch = frontmatter.match(/^chapter:\s*(.+)$/m)
    const chapter = (chapterMatch ? chapterMatch[1] : '').trim().replace(/^["']|["']$/g, '')
    const titleMatch = frontmatter.match(/^title:\s*(.+)$/m)
    const title = (titleMatch ? titleMatch[1] : chName.replace(/^\d{3}-/, ''))
      .trim()
      .replace(/^["']|["']$/g, '')
    const beatMatch = frontmatter.match(/^beat:\s*(.+)$/m)
    const beat = (beatMatch ? beatMatch[1] : '').trim().replace(/^["']|["']$/g, '')
    const povMatch = frontmatter.match(/^pov:\s*(.+)$/m)
    const pov = (povMatch ? povMatch[1] : '').trim().replace(/^["']|["']$/g, '')

    // 抽 scene 段计数
    const sceneMatches = body.match(/^## 场景/gm) || []
    const scene = String(sceneMatches.length)

    // 2 手工列留空 (机器不可抽, 作者写作期自填)
    const valueShift = ''
    const hookType = ''

    rows.push({ vol, chapter, title, beat, pov, scene, valueShift, hookType })
  }
}

// 输出 Markdown table
const header = '| vol | chapter | title | beat | pov | scene | value_shift | hook_type |'
const separator = '| --- | --- | --- | --- | --- | --- | --- | --- |'
const table = [
  header,
  separator,
  ...rows.map(r => `| ${r.vol} | ${r.chapter} | ${r.title} | ${r.beat} | ${r.pov} | ${r.scene} | ${r.valueShift} | ${r.hookType} |`),
]

const volCounts = {}
for (const r of rows) volCounts[r.vol] = (volCounts[r.vol] || 0) + 1
const beatHits = rows.filter(r => r.beat).length
const povHits = rows.filter(r => r.pov).length
const sceneHits = rows.filter(r => parseInt(r.scene, 10) > 0).length
const valueShiftFills = rows.filter(r => r.valueShift).length
const hookTypeFills = rows.filter(r => r.hookType).length

const summary = [
  '# Scene Master List — Baseline Report',
  '',
  `> 生成日期: ${new Date().toISOString().split('T')[0]}`,
  `> 工具: scripts/scan-scene-master-list.cjs`,
  `> 范围: ${MANUSCRIPT_DIR}`,
  `> 8 列 schema: 6 自动 (vol/chapter/title/beat/pov/scene) + 2 手工留空 (value_shift/hook_type)`,
  '',
  '## Summary',
  '',
  `- 总章数: ${rows.length} 行`,
  ...Object.keys(volCounts).sort().map(v => `- ${v}: ${volCounts[v]} 行`),
  `- 6 自动列命中率: vol ${rows.length}/${rows.length} / chapter ${rows.filter(r => r.chapter).length}/${rows.length} / title ${rows.filter(r => r.title).length}/${rows.length} / beat ${beatHits}/${rows.length} / pov ${povHits}/${rows.length} / scene ${sceneHits}/${rows.length}`,
  `- 2 手工列留空: value_shift ${valueShiftFills}/${rows.length} / hook_type ${hookTypeFills}/${rows.length}`,
  `- 跳过: ${skipped} 章 (无 frontmatter 或无 index.md)`,
  '',
  '## Table',
  '',
  ...table,
  '',
  '## Notes',
  '',
  '- value_shift / hook_type 留空 (抗过度 spec 化, 不强制; 作者写作期手工填)',
  '- 卷目录识别: 名字以「第」开头且含「卷」字; 章节目录识别: NNN- 三位数字前缀, 内含 index.md',
  '- frontmatter 缺字段 → 对应列留空; title 缺失时 fallback 到章节目录名 (剥掉 NNN- 前缀)',
  '- schema 与填写规范: packages/neuro-book/assets/reference/scene-master-list.md',
  '',
].join('\n')

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true })
fs.writeFileSync(OUTPUT_PATH, summary, 'utf-8')
console.warn(`[scan] wrote ${rows.length} rows to ${OUTPUT_PATH}`)
