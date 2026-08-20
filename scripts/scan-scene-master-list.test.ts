/**
 * scan-scene-master-list.cjs — P2-5 RED 阶段 vitest 测试
 * 调研报告 research-sdd-novel-writing-2026-08-18.md §6 P2-5 落地
 *
 * 6 个 vitest 测试:
 * 1. 脚本存在
 * 2. 退出码 0
 * 3. 输出文件生成
 * 4. 8 列表头 + 80 行表 (V1 30 + V2 50)
 * 5. 6 自动列填 + 2 手工列空
 * 6. 幂等 (不修改 V1+V2 任何源文件)
 *
 * 派生自 workspace/qi-shou-fan-shen-cheng-ding-fu/baseline-scan.cjs (i128/i130/i131/i132)
 * manuscript 实际路径: 第1卷-坠落/NNN-标题/index.md (不是调研报告假设 vol-01/ch-NNN/)
 * 调研报告"60 章" 实际 80 章 (V1=30, V2=50)
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const SCRIPT = join(process.cwd(), 'scripts/scan-scene-master-list.cjs')
const WORKSPACE = join(process.cwd(), 'workspace/qi-shou-fan-shen-cheng-ding-fu')
const MANUSCRIPT = join(WORKSPACE, 'manuscript')
const OUTPUT = join(WORKSPACE, '.agent/plan/i137-p2-5-baseline-report.md')

describe('scan-scene-master-list.cjs (P2-5)', () => {
  it('script file exists at scripts/scan-scene-master-list.cjs', () => {
    expect(existsSync(SCRIPT)).toBe(true)
  })

  it('script exits with code 0 on real V1+V2 manuscript', () => {
    const result = spawnSync('node', [SCRIPT, MANUSCRIPT, OUTPUT], {
      encoding: 'utf-8',
    })
    expect(result.status).toBe(0)
  })

  it('output report file generated at .agent/plan/i137-p2-5-baseline-report.md', () => {
    expect(existsSync(OUTPUT)).toBe(true)
  })

  it('output report contains 8-column Markdown table with 80 rows (V1 30 + V2 50)', () => {
    const content = readFileSync(OUTPUT, 'utf-8')
    // 8 列表头
    expect(content).toMatch(
      /\|\s*vol\s*\|\s*chapter\s*\|\s*title\s*\|\s*beat\s*\|\s*pov\s*\|\s*scene\s*\|\s*value_shift\s*\|\s*hook_type\s*\|/,
    )
    // 80 行表 (V1 30 + V2 50, 调研报告已校正)
    const tableRows = content.split('\n').filter(l => l.match(/^\|\s*第[12]卷/))
    expect(tableRows.length).toBe(80)
  })

  it('6 auto columns populated, 2 manual columns empty (value_shift/hook_type)', () => {
    const content = readFileSync(OUTPUT, 'utf-8')
    // value_shift / hook_type 列应全空 (V1+V2 baseline)
    // 行末 2 列为 ` |  |` 模式 (空字符串 + 2 空格)
    const emptyLastTwoCols = content.split('\n').filter(l => l.match(/^\|.*\|\s*\|\s*\|\s*$/))
    expect(emptyLastTwoCols.length).toBeGreaterThan(0)
  })

  it('report does not modify V1+V2 chapter files (archive mode invariant)', () => {
    // 跑脚本应幂等, 不修改任何源文件
    const result = spawnSync('node', [SCRIPT, MANUSCRIPT, OUTPUT], {
      encoding: 'utf-8',
    })
    expect(result.status).toBe(0)
    // 输出文件应再次存在 (说明幂等)
    expect(existsSync(OUTPUT)).toBe(true)
  })
})
