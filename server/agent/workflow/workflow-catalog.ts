import { existsSync, statSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { Type } from 'typebox'
import type * as TypeScript from 'typescript'
import type { WorkflowDefinition } from 'nbook/server/vendor/nb-workflow/index'
import type { ResolvedProjectWorkspace } from 'nbook/server/workspace-files/project-identity'

// F9：typescript 包禁顶层 ESM import（Nitro dev rollup 会解析 9MB 包致 OOM），必须 require
const require = createRequire(import.meta.url)

export type WorkflowCatalogSource = 'system' | 'user' | 'project'

/**
 * workflow 目录里 workflow.ts 的导出形状：WorkflowDefinition 加目录元数据。
 * def.key 以目录名为准（目录名是稳定 key，文件内 key 不一致时被覆盖）。
 */
export type WorkflowFileDef = WorkflowDefinition & {
  title?: string
  description?: string
  /** leader 选用依据：什么场景该跑这个 workflow */
  whenToUse?: string
  /** args 表单提示（用户主动触发时前端渲染输入框用） */
  argsHint?: { name: string, label: string, defaultValue: string }[]
}

export type WorkflowCatalogItem = {
  key: string
  title: string
  description: string
  whenToUse?: string
  argsHint: { name: string, label: string, defaultValue: string }[]
  source: WorkflowCatalogSource
  rootPath: string
  entryPath: string
  def: WorkflowDefinition
}

/** 转译缓存条目：mtime 变化即失效（用户改文件立刻生效） */
type CacheEntry = { mtimeMs: number, item: WorkflowCatalogItem }

/**
 * Workflow catalog：system → Workspace Root user-assets → Project Workspace 三层覆盖。
 * 每个 workflow 一个目录，入口固定 `workflow.ts`（default export 一个 WorkflowFileDef 对象字面量）。
 *
 * 加载方式：typescript.transpileModule → CommonJS → 受限求值（不提供 require——workflow 源码
 * V1 不允许 import，任何依赖都通过 wf API 注入；这是沙盒化 V1 的最小边界，工具面另有用户审批门）。
 */
export class WorkflowCatalog {
  private readonly systemRoot: string
  private readonly userRoot: string
  private readonly cache = new Map<string, CacheEntry>()
  private ts: typeof TypeScript | null = null

  /** roots 必须由宿主显式决定（与 SkillCatalog 同约定：本模块不发现 cwd 或环境） */
  constructor(systemRoot: string, userRoot: string) {
    this.systemRoot = resolve(systemRoot)
    this.userRoot = resolve(userRoot)
  }

  /** 列出当前可见 workflow；Project层只消费调用方捕获的结构化workspace。 */
  async list(project?: ResolvedProjectWorkspace): Promise<WorkflowCatalogItem[]> {
    const items = new Map<string, WorkflowCatalogItem>()
    for (const item of await this.loadRoot(this.systemRoot, 'system')) items.set(item.key, item)
    for (const item of await this.loadRoot(this.userRoot, 'user')) items.set(item.key, item)
    if (project) {
      for (const item of await this.loadRoot(join(project.root, '.nbook', 'agent', 'workflows'), 'project')) {
        items.set(item.key, item)
      }
    }
    return [...items.values()].sort((a, b) => a.key.localeCompare(b.key))
  }

  /** 读取单个 workflow。null 表示不可见 */
  async get(workflowKey: string, project?: ResolvedProjectWorkspace): Promise<WorkflowCatalogItem | null> {
    return (await this.list(project)).find(item => item.key === workflowKey) ?? null
  }

  /**
     * 编译一段内联 workflow 源码（agent 随机应变写的脚本）。
     * 与目录加载共用同一套转译/求值边界；key 固定为 "inline"。
     */
  compileInline(source: string): WorkflowDefinition {
    const def = this.evaluate(source, 'inline.workflow.ts')
    return { ...def, key: def.key || 'inline' }
  }

  private async loadRoot(root: string, source: WorkflowCatalogSource): Promise<WorkflowCatalogItem[]> {
    if (!existsSync(root)) return []
    const entries = await readdir(root, { withFileTypes: true })
    const items: WorkflowCatalogItem[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const rootPath = join(root, entry.name)
      const entryPath = join(rootPath, 'workflow.ts')
      if (!existsSync(entryPath)) continue
      try {
        items.push(await this.loadItem(entry.name, source, rootPath, entryPath))
      }
      catch (error) {
        console.warn(`[workflow-catalog] 加载 ${entryPath} 失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return items
  }

  private async loadItem(key: string, source: WorkflowCatalogSource, rootPath: string, entryPath: string): Promise<WorkflowCatalogItem> {
    const mtimeMs = statSync(entryPath).mtimeMs
    // Project workflow属于当前ProjectSession generation，不跨generation复用Catalog缓存。
    const cached = source === 'project' ? undefined : this.cache.get(entryPath)
    if (cached && cached.mtimeMs === mtimeMs) return cached.item
    const def = this.evaluate(await readFile(entryPath, 'utf8'), entryPath)
    const item: WorkflowCatalogItem = {
      key,
      title: def.title ?? key,
      description: def.description ?? '',
      whenToUse: def.whenToUse,
      argsHint: def.argsHint ?? [],
      source,
      rootPath,
      entryPath,
      // 目录名是稳定 key：覆盖文件内 key，保证 catalog 寻址一致
      def: { ...def, key },
    }
    if (source !== 'project') {
      this.cache.set(entryPath, { mtimeMs, item })
    }
    return item
  }

  /** 转译 + 受限求值：CommonJS 模块壳，无 require、无 process/fs 注入；宿主注入 typebox Type（outputSchema/结构化定义用） */
  private evaluate(sourceText: string, fileName: string): WorkflowFileDef {
    if (!this.ts) this.ts = require('typescript') as typeof TypeScript
    const js = this.ts.transpileModule(sourceText, {
      fileName,
      compilerOptions: {
        module: this.ts.ModuleKind.CommonJS,
        target: this.ts.ScriptTarget.ES2022,
      },
    }).outputText
    const moduleShell = { exports: {} as { default?: WorkflowFileDef } }
    const restrictedRequire = () => {
      throw new Error('workflow 源码不允许 import/require：所有能力通过 wf API 提供')
    }

    const factory = new Function('exports', 'module', 'require', 'Type', js)
    factory(moduleShell.exports, moduleShell, restrictedRequire, Type)
    const def = moduleShell.exports.default
    if (!def || typeof def !== 'object' || typeof def.run !== 'function') {
      throw new Error(`${fileName} 必须 default export 一个含 run 函数的 workflow 定义对象`)
    }
    if (def.argsHint !== undefined) {
      if (!Array.isArray(def.argsHint) || def.argsHint.some(hint => !hint
        || typeof hint !== 'object'
        || typeof hint.name !== 'string'
        || !hint.name.trim()
        || typeof hint.label !== 'string'
        || typeof hint.defaultValue !== 'string')) {
        throw new Error(`${fileName} 的 argsHint 必须是 {name,label,defaultValue:string}[]`)
      }
    }
    return def
  }
}
