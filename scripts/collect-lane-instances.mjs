#!/usr/bin/env bun
// 3-lane collector: 从 ESLint JSON 提取 3 rule 的 instance 列表
// 用法：bun scripts/collect-lane-instances.mjs <eslint-json> <out-dir>

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const [, , filePath, outDir] = process.argv
if (!filePath || !outDir) {
  console.error('Usage: collect-lane-instances.mjs <eslint-json> <out-dir>')
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })

const LANES = [
  { id: 'A', rule: '@typescript-eslint/no-dynamic-delete', label: 'no-dynamic-delete' },
  { id: 'B', rule: '@stylistic/no-mixed-operators', label: 'no-mixed-operators' },
  { id: 'C', rule: 'vue/no-mutating-props', label: 'vue/no-mutating-props' },
]

const raw = readFileSync(filePath, 'utf-8')
const data = JSON.parse(raw)

for (const lane of LANES) {
  // 按文件分组
  const fileMap = new Map()
  let total = 0
  for (const file of data) {
    const hits = file.messages.filter(m => m.ruleId === lane.rule)
    if (hits.length === 0) continue
    total += hits.length
    const relPath = file.filePath.replace(process.cwd() + '/', '')
    if (!fileMap.has(relPath)) {
      fileMap.set(relPath, [])
    }
    for (const h of hits) {
      fileMap.get(relPath).push({
        line: h.line,
        column: h.column,
        message: h.message,
      })
    }
  }

  // 按文件排序，每个文件内按行号排
  const sorted = [...fileMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, instances]) => ({
      file,
      instances: instances.sort((a, b) => a.line - b.line || a.column - b.column),
    }))

  const summary = {
    lane: lane.id,
    rule: lane.rule,
    label: lane.label,
    total_instances: total,
    file_count: sorted.length,
    files: sorted,
  }

  const outPath = join(outDir, `lane-${lane.id}-${lane.rule.replace(/\//g, '-')}.json`)
  writeFileSync(outPath, JSON.stringify(summary, null, 2) + '\n')
  console.log(`Lane ${lane.id} (${lane.label}): ${total} instances / ${sorted.length} files → ${outPath}`)
}
