import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { consola } from 'consola'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SkillCatalog } from 'nbook/server/agent/skills/skill-catalog'
import { runtimePathsFromEnv } from 'nbook/server/runtime/paths/runtime-paths'
import { resolveSystemNbookRoot } from 'nbook/server/workspace-files/system-workspace-assets'

describe('SkillCatalog', () => {
  let root: string
  let systemRoot: string
  let userRoot: string

  beforeEach(async () => {
    root = resolve('.agent', 'agent-skill-catalog-test', randomUUID())
    systemRoot = join(root, 'assets', '.nbook', 'agent', 'skills')
    userRoot = join(root, 'workspace', '.nbook', 'agent', 'skills')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('只扫描 .nbook skill root，并读取 frontmatter', async () => {
    await writeSkill(systemRoot, 'writer', `---
name: Writer Skill
description: Write prose.
when_to_use:
  - 用户需要写正文时
  - 用户显式提到写作 skill 时
---
# Body
`)
    await writePackage(systemRoot, 'writer', '1.2.3')
    const catalog = new SkillCatalog(systemRoot, userRoot)

    await expect(catalog.get('writer')).resolves.toEqual(expect.objectContaining({
      key: 'writer',
      name: 'Writer Skill',
      description: 'Write prose.',
      whenToUse: '用户需要写正文时；用户显式提到写作 skill 时',
      version: '1.2.3',
      source: 'system',
    }))
  })

  it('用户同名 skill 目录整体覆盖系统目录', async () => {
    await writeSkill(systemRoot, 'writer', `---
name: System Writer
---
`)
    await writeSkill(userRoot, 'writer', `---
name: User Writer
---
`)
    const catalog = new SkillCatalog(systemRoot, userRoot)

    await expect(catalog.list()).resolves.toEqual([
      expect.objectContaining({
        key: 'writer',
        name: 'User Writer',
        source: 'user',
      }),
    ])
  })

  it('缺少 SKILL.md 的目录不可见', async () => {
    await mkdir(join(systemRoot, 'empty'), { recursive: true })
    const catalog = new SkillCatalog(systemRoot, userRoot)

    await expect(catalog.get('empty')).resolves.toBeNull()
  })

  it('runnable Skill 拒绝非 SemVer package 版本', async () => {
    await writeSkill(systemRoot, 'broken', `---
name: Broken Skill
description: Broken version fixture.
---
`)
    await writePackage(systemRoot, 'broken', 'latest')
    const catalog = new SkillCatalog(systemRoot, userRoot)

    await expect(catalog.list()).rejects.toThrow('package.json.version 必须是 SemVer')
  })

  it('无效用户 Skill 只隔离自身并继续遮蔽同名系统 Skill', async () => {
    await writeSkill(systemRoot, 'writer', `---
name: System Writer
---
`)
    await writePackage(systemRoot, 'writer', '1.0.0')
    await writeSkill(systemRoot, 'editor', `---
name: System Editor
---
`)
    await writeSkill(userRoot, 'writer', `---
name: Broken User Writer
---
`)
    await writePackage(userRoot, 'writer', 'latest')
    const warn = vi.spyOn(consola, 'warn').mockImplementation(() => undefined)
    const catalog = new SkillCatalog(systemRoot, userRoot)

    try {
      await expect(catalog.list()).resolves.toEqual([
        expect.objectContaining({ key: 'editor', source: 'system' }),
      ])
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ skillKey: 'writer', rootPath: join(userRoot, 'writer') }),
        '用户 Skill package 无效，已隔离该 Skill',
      )
    }
    finally {
      warn.mockRestore()
    }
  })

  it('硬切下线的 legacy skill key 不再进入 catalog', async () => {
    await writeSkill(systemRoot, 'anti-ai-slop', `---
name: anti-ai-slop
---
`)
    await writeSkill(userRoot, 'anti-ai-slop', `---
name: user anti-ai-slop
---
`)
    const catalog = new SkillCatalog(systemRoot, userRoot)

    await expect(catalog.get('anti-ai-slop')).resolves.toBeNull()
  })

  it('默认 catalog 读取 novel-data runnable package 版本', async () => {
    const runtimePaths = runtimePathsFromEnv()
    const catalog = new SkillCatalog(
      join(resolveSystemNbookRoot(runtimePaths.applicationRoot), 'agent', 'skills'),
      userRoot,
    )

    await expect(catalog.get('novel-data')).resolves.toEqual(expect.objectContaining({
      key: 'novel-data',
      name: 'novel-data',
      version: '1.0.0',
    }))
  })

  it('默认系统 catalog 包含 profile-system-guide 和已迁移 v2 skills', async () => {
    const runtimePaths = runtimePathsFromEnv()
    const catalog = new SkillCatalog(
      join(resolveSystemNbookRoot(runtimePaths.applicationRoot), 'agent', 'skills'),
      userRoot,
    )

    const skills = await catalog.list()
    const keys = skills.map(skill => skill.key)
    const skill = skills.find(item => item.key === 'profile-system-guide')

    expect(skill?.source).toBe('system')
    expect(skill?.skillPath.replaceAll('\\', '/')).toContain('.nbook/agent/skills/profile-system-guide/SKILL.md')
    expect(skill?.description).toContain('harness')
    expect(keys).toEqual(expect.arrayContaining([
      'novel-import-tomato-reference',
      'novel-guide',
      'novel-setup',
      'novel-writing',
      'novel-idea-exploration',
      'novel-data',
      'novel-genre-research',
      'novel-import-silly-tavern-card',
      'novel-technique-character-card-workshop',
      'novel-writer-execution',
      'llmlint',
      'profile-system-guide',
      'RP模式',
      'skill-creator',
      'skill-creator-zh',
      'stop-slop',
      'tsx-profile-editing',
    ]))
    expect(keys).not.toContain('anti-ai-slop')
    expect(skills.find(item => item.key === 'llmlint')).toEqual(expect.objectContaining({
      name: 'llmlint',
      description: expect.stringContaining('Chinese-prose rule library'),
      version: '3.0.0',
    }))
    expect(skills.find(item => item.key === 'novel-data')).toEqual(expect.objectContaining({
      name: 'novel-data',
      version: '1.0.0',
    }))
    expect(skills.find(item => item.key === 'stop-slop')).toEqual(expect.objectContaining({
      name: 'stop-slop',
      description: 'Remove AI writing patterns from prose. Use when drafting, editing, or reviewing text to eliminate predictable AI tells.',
    }))
  })
})

async function writeSkill(root: string, key: string, source: string): Promise<void> {
  const skillRoot = join(root, key)
  await mkdir(skillRoot, { recursive: true })
  await writeFile(join(skillRoot, 'SKILL.md'), source, 'utf8')
}

async function writePackage(root: string, key: string, version: string): Promise<void> {
  await writeFile(join(root, key, 'package.json'), `${JSON.stringify({ name: key, version }, null, 4)}\n`, 'utf8')
}
