import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { consola } from 'consola'

export type SkillCatalogSource = 'system' | 'user'

export type SkillCatalogItem = {
  key: string
  name: string
  description?: string
  whenToUse?: string
  /** 仅 runnable Skill 存在，来自 package.json.version。 */
  version?: string
  source: SkillCatalogSource
  rootPath: string
  skillPath: string
}

const DISABLED_LEGACY_SKILL_KEYS = new Set(['anti-ai-slop'])
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u

type LoadedSkillRoot = {
  skills: SkillCatalogItem[]
  /** 含 SKILL.md 的目录都会占用 key；无效用户覆盖不能悄悄回退到同名系统 Skill。 */
  declaredKeys: Set<string>
}

/**
 * v3 skill catalog。用户同名目录整体覆盖系统目录。
 */
export class SkillCatalog {
  private readonly systemRoot: string
  private readonly userRoot: string

  /**
     * 创建只绑定指定物理 roots 的 Skill Catalog。
     * system/user root 必须由进程、CLI、构建或测试 Adapter 显式决定；本 Module 不发现 cwd 或环境。
     */
  constructor(systemRoot: string, userRoot: string) {
    this.systemRoot = resolve(systemRoot)
    this.userRoot = resolve(userRoot)
  }

  /**
     * 列出当前可见 skill。目录名是第一版稳定 key。
     */
  async list(): Promise<SkillCatalogItem[]> {
    const skills = new Map<string, SkillCatalogItem>()
    const systemCatalog = await this.loadRoot(this.systemRoot, 'system')
    for (const skill of systemCatalog.skills) {
      skills.set(skill.key, skill)
    }
    const userCatalog = await this.loadRoot(this.userRoot, 'user')
    for (const skillKey of userCatalog.declaredKeys) {
      skills.delete(skillKey)
    }
    for (const skill of userCatalog.skills) {
      skills.set(skill.key, skill)
    }
    return [...skills.values()].sort((left, right) => left.key.localeCompare(right.key))
  }

  /**
     * 读取单个 skill。返回 null 表示该 skill 对当前 v3 catalog 不可见。
     */
  async get(skillKey: string): Promise<SkillCatalogItem | null> {
    return (await this.list()).find(skill => skill.key === skillKey) ?? null
  }

  private async loadRoot(root: string, source: SkillCatalogSource): Promise<LoadedSkillRoot> {
    if (!existsSync(root)) {
      return { skills: [], declaredKeys: new Set() }
    }
    const entries = await readdir(root, { withFileTypes: true })
    const skills: SkillCatalogItem[] = []
    const declaredKeys = new Set<string>()
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }
      if (DISABLED_LEGACY_SKILL_KEYS.has(entry.name)) {
        continue
      }
      const rootPath = join(root, entry.name)
      const skillPath = await this.findSkillFile(rootPath)
      if (!skillPath) {
        continue
      }
      declaredKeys.add(entry.name)
      try {
        const metadata = this.readMetadata(await readFile(skillPath, 'utf8'))
        const version = await this.readVersion(rootPath)
        skills.push({
          key: entry.name,
          name: metadata.name ?? entry.name,
          description: metadata.description,
          whenToUse: metadata.whenToUse,
          version,
          source,
          rootPath,
          skillPath,
        })
      }
      catch (error) {
        if (source === 'system') {
          throw error
        }
        consola.warn({ skillKey: entry.name, rootPath, error }, '用户 Skill package 无效，已隔离该 Skill')
      }
    }
    return { skills, declaredKeys }
  }

  private async findSkillFile(rootPath: string): Promise<string | null> {
    for (const name of ['SKILL.md', 'skill.md']) {
      const skillPath = join(rootPath, name)
      if (existsSync(skillPath)) {
        return skillPath
      }
    }
    return null
  }

  /**
     * 读取 runnable Skill 的 SemVer 真相源；纯提示词 Skill 没有 package.json 时返回 undefined。
     */
  private async readVersion(rootPath: string): Promise<string | undefined> {
    const packagePath = join(rootPath, 'package.json')
    if (!existsSync(packagePath)) {
      return undefined
    }
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as { version?: string | null }
    if (typeof packageJson.version !== 'string' || !packageJson.version.trim()) {
      throw new Error(`runnable Skill package.json.version 不能为空: ${packagePath}`)
    }
    const version = packageJson.version.trim()
    if (!SEMVER_PATTERN.test(version)) {
      throw new Error(`runnable Skill package.json.version 必须是 SemVer: ${packagePath}`)
    }
    return version
  }

  private readMetadata(source: string): { name?: string, description?: string, whenToUse?: string } {
    const frontmatter = source.match(/^---\r?\n(?<body>[\s\S]*?)\r?\n---/u)?.groups?.body
    if (!frontmatter) {
      const heading = source.split(/\r?\n/).find(line => line.trim().startsWith('# '))?.replace(/^#\s+/, '').trim()
      return {
        name: heading || undefined,
      }
    }
    const metadata: { name?: string, description?: string, whenToUse?: string } = {}
    let currentListKey: 'when_to_use' | null = null
    const whenToUseItems: string[] = []
    for (const line of frontmatter.split(/\r?\n/)) {
      const listMatch = line.match(/^\s*-\s*(?<value>.+)$/u)
      if (currentListKey === 'when_to_use' && listMatch?.groups?.value) {
        whenToUseItems.push(cleanYamlScalar(listMatch.groups.value))
        continue
      }
      currentListKey = null
      const match = line.match(/^(name|description|when_to_use):\s*(?<value>.*)$/u)
      if (!match?.groups || !match[1]) {
        continue
      }
      const value = cleanYamlScalar(match.groups.value ?? '')
      if (match[1] === 'when_to_use') {
        if (value) {
          metadata.whenToUse = value
        }
        else {
          currentListKey = 'when_to_use'
        }
        continue
      }
      metadata[match[1] as 'name' | 'description'] = value
    }
    if (!metadata.whenToUse && whenToUseItems.length > 0) {
      metadata.whenToUse = whenToUseItems.join('；')
    }
    return metadata
  }
}

function cleanYamlScalar(value: string): string {
  return value.replace(/^["']|["']$/g, '').trim()
}
