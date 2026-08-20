#!/usr/bin/env node
// scan-scene-master-list.cjs — P2-5 半自动 scene-master-list 工具
// 派生自 workspace/qi-shou-fan-shen-cheng-ding-fu/baseline-scan.cjs (i128/i130/i131/i132) 90% 代码
// 8 列 schema: vol / chapter / title / beat / pov / scene / value_shift / hook_type
// 6 列自动从 frontmatter 抽, 2 列手工留空
// 严守调研报告 §7.4 抗过度 spec 化: 失败一律 soft 降级, 退出码 0

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

    // 抽 6 自动列 (V1+V2 frontmatter 实际只有 chapter + beat 字段, 其他 fallback)
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

    // 2 手工列留空 (V1+V2 baseline 留空, V3 写作期填)
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

const v1Rows = rows.filter(r => r.vol.includes('第1卷'))
const v2Rows = rows.filter(r => r.vol.includes('第2卷'))
const beatHits = rows.filter(r => r.beat).length
const povHits = rows.filter(r => r.pov).length
const sceneHits = rows.filter(r => parseInt(r.scene, 10) > 0).length
const valueShiftFills = rows.filter(r => r.valueShift).length
const hookTypeFills = rows.filter(r => r.hookType).length

const summary = [
  '# P2-5 Scene Master List — V1+V2 Baseline Report',
  '',
  `> 生成日期: ${new Date().toISOString().split('T')[0]}`,
  `> 工具: scripts/scan-scene-master-list.cjs (派生自 workspace/.../baseline-scan.cjs i130)`,
  `> 范围: V1+V2 80 章 (调研报告 §2.1 "60 章" 已校正 80 章, V1=30 V2=50)`,
  `> 8 列 schema: 6 自动 (vol/chapter/title/beat/pov/scene) + 2 手工留空 (value_shift/hook_type)`,
  '',
  '## Summary',
  '',
  `- 总章数: ${rows.length} 行 (期望 80, 调研报告校正)`,
  `- V1 30 章: ${v1Rows.length} 行`,
  `- V2 50 章: ${v2Rows.length} 行`,
  `- 6 自动列命中率: vol ${v1Rows.length + v2Rows.length}/${rows.length} / chapter ${rows.filter(r => r.chapter).length}/${rows.length} / title ${rows.filter(r => r.title).length}/${rows.length} / beat ${beatHits}/${rows.length} / pov ${povHits}/${rows.length} / scene ${sceneHits}/${rows.length}`,
  `- 2 手工列留空: value_shift ${valueShiftFills}/${rows.length} / hook_type ${hookTypeFills}/${rows.length}`,
  `- 跳过: ${skipped} 章 (无 frontmatter 或无 index.md)`,
  '',
  '## Table',
  '',
  ...table,
  '',
  '## Notes',
  '',
  '- value_shift / hook_type 留空 (调研报告 §7.4 抗过度 spec 化, P2-5 决策不强制)',
  '- V1 30 / V2 50 是项目实际章数, 调研报告 §2.1 "60 章" 是项目初期估算已过期',
  '- manuscript 实际路径: 第1卷-坠落/NNN-标题/index.md (不是调研报告假设 vol-01/ch-NNN/)',
  '- 跟 P1-3 lore pov 字段 + i128 beat 字段 + i129 chapter-hook 5 模式 同源',
  '- V3 写作期手工填 value_shift / hook_type 列, 不强制 (严守 §7.4)',
  '- V1+V2 frontmatter 实际只有 chapter + beat 字段, title 走目录名 fallback, pov 留空',
  '',
].join('\n')

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true })
fs.writeFileSync(OUTPUT_PATH, summary, 'utf-8')
console.warn(`[scan] wrote ${rows.length} rows to ${OUTPUT_PATH}`)
