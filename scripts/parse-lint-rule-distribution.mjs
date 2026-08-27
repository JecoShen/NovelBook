#!/usr/bin/env bun
// 解析 ESLint JSON 输出，按 ruleId 聚合 instance 数 + 文件数
// 用法：bun scripts/parse-lint-rule-distribution.mjs /tmp/lint-current-2026-08-26.json

import { readFileSync } from 'node:fs'

const filePath = process.argv[2]
if (!filePath) {
  console.error('Usage: parse-lint-rule-distribution.mjs <eslint-json>')
  process.exit(1)
}

const raw = readFileSync(filePath, 'utf-8')
const data = JSON.parse(raw)

const byRule = new Map()
const fileCount = new Set()
let totalErrors = 0
let totalWarnings = 0

for (const file of data) {
  if (file.errorCount > 0 || file.warningCount > 0) {
    fileCount.add(file.filePath)
  }
  for (const msg of file.messages) {
    totalErrors += msg.severity === 2 ? 1 : 0
    totalWarnings += msg.severity === 1 ? 1 : 0
    const rule = msg.ruleId || 'unknown'
    if (!byRule.has(rule)) {
      byRule.set(rule, { errors: 0, warnings: 0, files: new Set() })
    }
    const r = byRule.get(rule)
    if (msg.severity === 2) r.errors += 1
    else r.warnings += 1
    r.files.add(file.filePath)
  }
}

console.log(`Total: ${totalErrors} errors, ${totalWarnings} warnings across ${fileCount.size} files\n`)

// 按 instance 数降序排
const sorted = [...byRule.entries()].sort((a, b) => {
  const d = (b[1].errors + b[1].warnings) - (a[1].errors + a[1].warnings)
  return d !== 0 ? d : a[0].localeCompare(b[0])
})

console.log('Top rules by instance count:')
console.log('rule'.padEnd(60), 'count'.padStart(7), 'files'.padStart(7), '  class-hint')
for (const [rule, info] of sorted) {
  const total = info.errors + info.warnings
  // 简单 class 提示
  let cls
  if (rule.startsWith('@stylistic/')) {
    cls = 'stylistic'
  }
  else if (rule.startsWith('@typescript-eslint/')) {
    if (/prefer-|no-var|no-with|no-debugger|init-declarations|no-empty/.test(rule)) cls = 'mechanical'
    else if (/no-unused|no-undef|no-shadow|no-redeclare|no-dupe/.test(rule)) cls = 'lint'
    else if (/no-unsafe|no-explicit-any|no-non-null-assertion|no-misused-promises/.test(rule)) cls = 'semantic'
    else cls = 'ts-other'
  }
  else if (rule.startsWith('vue/')) {
    if (/attribute-hyphenation|attribute-order|self-closing|html-self-closing/.test(rule)) cls = 'stylistic'
    else if (/no-unused-components|no-unused-vars|require-default-prop/.test(rule)) cls = 'lint'
    else if (/no-mutating-props|no-async-in-computed-setup/.test(rule)) cls = 'semantic'
    else cls = 'vue-other'
  }
  else cls = 'other'
  console.log(rule.padEnd(60), String(total).padStart(7), String(info.files.size).padStart(7), '  ' + cls)
}
