import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

const NEUROBOOK_ROOT = path.resolve(import.meta.dir, '../..')
const LLMLINT_SKILL_SOURCE_ROOT = path.resolve(NEUROBOOK_ROOT, '..', 'llmlint', 'skill')
const LLMLINT_SKILL_TARGET_ROOT = path.resolve(NEUROBOOK_ROOT, 'assets', 'workspace', '.nbook', 'agent', 'skills', 'llmlint')

const EXCLUDED_DIRECTORY_NAMES = new Set([
  '.git',
  'node_modules',
  '.bun',
  '.agent',
  'evals',
  'tests',
  'coverage',
  'dist',
])

const EXCLUDED_FILE_NAMES = new Set([
  '.DS_Store',
  'Thumbs.db',
])

/**
 * 从 sibling llmlint 开发仓同步可安装 skill package 到 NeuroBook vendored snapshot。
 */
async function main(): Promise<void> {
  await assertSkillSource(LLMLINT_SKILL_SOURCE_ROOT)
  assertExpectedTarget(LLMLINT_SKILL_TARGET_ROOT)

  await fs.mkdir(LLMLINT_SKILL_TARGET_ROOT, { recursive: true })
  await purgeExcludedTargetDirectories()

  const sourceFiles = await listRelativeFiles(LLMLINT_SKILL_SOURCE_ROOT)
  const targetFiles = await listRelativeFiles(LLMLINT_SKILL_TARGET_ROOT)
  const sourceSet = new Set(sourceFiles)
  let copied = 0
  let unchanged = 0
  let removed = 0

  for (const relativePath of targetFiles) {
    if (sourceSet.has(relativePath)) {
      continue
    }
    await fs.rm(path.join(LLMLINT_SKILL_TARGET_ROOT, ...relativePath.split('/')), { force: true })
    removed += 1
  }

  for (const relativePath of sourceFiles) {
    const sourcePath = path.join(LLMLINT_SKILL_SOURCE_ROOT, ...relativePath.split('/'))
    const targetPath = path.join(LLMLINT_SKILL_TARGET_ROOT, ...relativePath.split('/'))
    if (await sameFile(sourcePath, targetPath)) {
      unchanged += 1
      continue
    }
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.copyFile(sourcePath, targetPath)
    copied += 1
  }

  await removeEmptyDirectories(LLMLINT_SKILL_TARGET_ROOT)
  console.log(`synced llmlint skill: copied=${copied}, unchanged=${unchanged}, removed=${removed}`)
}

/**
 * 验证 source 是真实 llmlint skill package，而不是误指向开发仓根或其它目录。
 */
async function assertSkillSource(sourceRoot: string): Promise<void> {
  const stat = await fs.stat(sourceRoot).catch(() => null)
  if (!stat?.isDirectory()) {
    throw new Error(`llmlint skill source 不存在: ${sourceRoot}`)
  }
  const skillPath = path.join(sourceRoot, 'SKILL.md')
  const packagePath = path.join(sourceRoot, 'package.json')
  await fs.access(skillPath)
  const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf-8')) as { name?: string }
  if (packageJson.name !== 'llmlint') {
    throw new Error(`llmlint skill package.json.name 必须是 llmlint: ${packagePath}`)
  }
}

/**
 * 防止同步脚本误删 NeuroBook 之外的目录。
 */
function assertExpectedTarget(targetRoot: string): void {
  const expected = path.join(NEUROBOOK_ROOT, 'assets', 'workspace', '.nbook', 'agent', 'skills', 'llmlint')
  if (path.resolve(targetRoot) !== path.resolve(expected)) {
    throw new Error(`llmlint skill target 路径异常: ${targetRoot}`)
  }
  if (!isInside(NEUROBOOK_ROOT, targetRoot)) {
    throw new Error(`llmlint skill target 必须位于 NeuroBook 仓库内: ${targetRoot}`)
  }
}

/**
 * 清理旧嵌套仓、依赖目录和评测目录；这些都不属于 NeuroBook runtime snapshot。
 */
async function purgeExcludedTargetDirectories(): Promise<void> {
  for (const directoryName of EXCLUDED_DIRECTORY_NAMES) {
    const target = path.join(LLMLINT_SKILL_TARGET_ROOT, directoryName)
    if (!isInside(LLMLINT_SKILL_TARGET_ROOT, target)) {
      throw new Error(`拒绝清理 llmlint target 外目录: ${target}`)
    }
    await fs.rm(target, { recursive: true, force: true })
  }
}

/**
 * 递归列出相对文件路径，统一使用 POSIX 分隔符，方便跨平台比较。
 */
async function listRelativeFiles(root: string, current = ''): Promise<string[]> {
  const absolute = path.join(root, ...current.split('/').filter(Boolean))
  const entries = await fs.readdir(absolute, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return []
    }
    throw error
  })
  const files: string[] = []
  for (const entry of entries) {
    if (EXCLUDED_FILE_NAMES.has(entry.name)) {
      continue
    }
    const relativePath = current ? `${current}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRECTORY_NAMES.has(entry.name)) {
        continue
      }
      files.push(...await listRelativeFiles(root, relativePath))
      continue
    }
    if (entry.isFile()) {
      files.push(relativePath)
    }
  }
  return files.sort((left, right) => left.localeCompare(right))
}

/**
 * 用 SHA-256 比较文件，避免重复复制导致 sync state 大面积无意义更新。
 */
async function sameFile(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([
    hashFile(left),
    hashFile(right).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return null
      }
      throw error
    }),
  ])
  return rightHash !== null && leftHash === rightHash
}

/**
 * 计算文件 SHA-256。
 */
async function hashFile(filePath: string): Promise<string> {
  return createHash('sha256').update(await fs.readFile(filePath)).digest('hex')
}

/**
 * 删除镜像后遗留的空目录，保持 vendored snapshot 干净。
 */
async function removeEmptyDirectories(root: string, current = ''): Promise<boolean> {
  const absolute = path.join(root, ...current.split('/').filter(Boolean))
  const entries = await fs.readdir(absolute, { withFileTypes: true })
  let empty = true
  for (const entry of entries) {
    const relativePath = current ? `${current}/${entry.name}` : entry.name
    const entryPath = path.join(root, ...relativePath.split('/'))
    if (entry.isDirectory()) {
      const childEmpty = await removeEmptyDirectories(root, relativePath)
      if (childEmpty) {
        await fs.rmdir(entryPath)
      }
      else {
        empty = false
      }
      continue
    }
    empty = false
  }
  return empty && current.length > 0
}

/**
 * 判断 child 是否位于 parent 内或等于 parent。
 */
function isInside(parent: string, child: string): boolean {
  const relativePath = path.relative(path.resolve(parent), path.resolve(child))
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

await main()
