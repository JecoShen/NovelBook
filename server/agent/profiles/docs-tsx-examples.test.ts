/**
 * 文档站 Profile TSX 示例的防回归门。
 *
 * 背景：文档站曾长期展示一个使用 `VariableSchema` 节点的「最小 profile」示例，
 * 而该节点从未存在于 DSL 中——读者复制粘贴后必然抛「未知 Profile DSL JSX 节点」。
 * 人肉同步文档与 DSL 不可靠，所以这里把它变成测试：
 *
 * 1. 文档里 tsx 代码块用到的每个 JSX 标签，必须在 jsx-runtime 的组件表里真实存在；
 * 2. 文档里从 profile-dsl 具名导入的每个符号，必须真的被 profile-dsl 导出。
 *
 * DSL 增删节点后如果忘了同步文档，这个测试会直接失败并指出是哪个文件的哪个名字。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as dsl from 'nbook/server/agent/profiles/profile-dsl'
import { Fragment, jsx } from 'nbook/server/agent/profiles/profile-dsl/jsx-runtime'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))

/**
 * 扫描范围必须同时覆盖文档站和 reference 真相源。
 *
 * 第一版只扫 docs/profile-tsx，结果漏掉了 reference/agent/profile-guide.md 里同一类的
 * `WorkdirReminder` / `ProjectWorkspaceReminder` 幽灵节点——而文档站正是链到那份 guide
 * 让读者「看完整合同」的。真相源过时比文档过时更糟，所以两边一起守。
 *
 * 文档站出英文版后，docs/en/profile-tsx 也必须进扫描范围：翻译同样会抄错节点名，
 * 而英文读者一样会复制粘贴。
 */
const scanDirs = [
  path.join(repoRoot, 'docs', 'profile-tsx'),
  path.join(repoRoot, 'docs', 'en', 'profile-tsx'),
  path.join(repoRoot, 'reference', 'agent'),
]

/** 读取扫描范围内全部 Markdown，返回 [仓库相对路径, 正文]。 */
function readDocPages(): Array<[string, string]> {
  const pages: Array<[string, string]> = []
  for (const dir of scanDirs) {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.md')) {
        continue
      }
      // 中英两份 profile-tsx 的 basename 相同，标识必须用仓库相对路径才能指认到具体文件。
      const label = path.relative(repoRoot, path.join(dir, name)).replaceAll('\\', '/')
      pages.push([label, readFileSync(path.join(dir, name), 'utf8')])
    }
  }
  return pages
}

/** 抽出 ```tsx 代码块正文。 */
function extractTsxBlocks(markdown: string): string[] {
  const blocks: string[] = []
  const pattern = /```tsx\r?\n([\s\S]*?)```/g
  let match = pattern.exec(markdown)
  while (match) {
    blocks.push(match[1] ?? '')
    match = pattern.exec(markdown)
  }
  return blocks
}

/** 抽出代码块里出现的 JSX 标签名（只取大写开头的组件，忽略原生小写标签）。 */
function extractJsxTagNames(code: string): string[] {
  const names = new Set<string>()
  const pattern = /<([A-Z][A-Za-z0-9]*)/g
  let match = pattern.exec(code)
  while (match) {
    names.add(match[1] as string)
    match = pattern.exec(code)
  }
  return [...names]
}

/** 抽出从 profile-dsl 具名导入的符号。 */
function extractDslImports(code: string): string[] {
  const names = new Set<string>()
  // 捕获组禁止跨越 `}`，否则会从更早的 import 起始处开始贪婪匹配到本条 profile-dsl import。
  const pattern = /import\s*\{([^}]*)\}\s*from\s*"[^"]*profile-dsl"/g
  let match = pattern.exec(code)
  while (match) {
    for (const raw of (match[1] ?? '').split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0]?.trim()
      if (name) {
        names.add(name)
      }
    }
    match = pattern.exec(code)
  }
  return [...names]
}

/**
 * 组件表是 jsx-runtime 内部常量，没有直接导出。
 * 这里用「渲染一次就知道认不认识」的方式探测：未知节点会抛错。
 */
function isKnownJsxComponent(name: string): boolean {
  try {
    jsx(name as never, {})
    return true
  }
  catch (error) {
    // 未知节点抛的是「未知 Profile DSL JSX 节点」；其他错误（例如缺必填 prop）说明节点是认识的。
    return !(error instanceof Error && error.message.includes('未知'))
  }
}

describe('文档站 Profile TSX 示例', () => {
  const pages = readDocPages()

  it('能找到文档页', () => {
    expect(pages.length).toBeGreaterThan(0)
  })

  it('示例里的 JSX 节点都真实存在于 DSL 组件表', () => {
    const unknown: string[] = []
    for (const [fileName, markdown] of pages) {
      for (const block of extractTsxBlocks(markdown)) {
        for (const tag of extractJsxTagNames(block)) {
          if (tag === 'Fragment' || tag === (Fragment as unknown as string)) {
            continue
          }
          if (!isKnownJsxComponent(tag)) {
            unknown.push(`${fileName}: <${tag}>`)
          }
        }
      }
    }
    expect(unknown, `文档使用了不存在的 DSL 节点：${unknown.join(', ')}`).toEqual([])
  })

  it('示例里从 profile-dsl 具名导入的符号都真的被导出', () => {
    const missing: string[] = []
    for (const [fileName, markdown] of pages) {
      for (const block of extractTsxBlocks(markdown)) {
        for (const name of extractDslImports(block)) {
          if (!(name in dsl)) {
            missing.push(`${fileName}: ${name}`)
          }
        }
      }
    }
    expect(missing, `文档导入了 profile-dsl 未导出的符号：${missing.join(', ')}`).toEqual([])
  })
})
