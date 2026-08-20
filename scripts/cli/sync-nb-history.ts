import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'

const execFileAsync = promisify(execFile)

const NEUROBOOK_ROOT = path.resolve(import.meta.dir, '../..')
const NB_HISTORY_SOURCE_REPO = await resolveHistorySourceRepo()
const NB_HISTORY_SOURCE_ROOT = path.join(NB_HISTORY_SOURCE_REPO, 'src')
const NB_HISTORY_TARGET_ROOT = path.resolve(NEUROBOOK_ROOT, 'server', 'vendor', 'nb-history')
const VENDOR_MANIFEST_NAME = 'VENDOR.json'

/** 目标目录里不属于镜像面的文件：由本脚本维护或 NeuroBook 侧生成，删除多余文件时跳过。 */
const NON_MIRRORED_TARGET_FILES = new Set([VENDOR_MANIFEST_NAME])

type VendorManifest = {
  package: string
  sourceCommit: string
  syncedAt: string
  note: string
}

/** 普通 checkout 使用相邻仓；Git worktree 则从 common dir 回到主 checkout 的 sibling。 */
async function resolveHistorySourceRepo(): Promise<string> {
  const adjacent = path.resolve(NEUROBOOK_ROOT, '..', 'nb-history')
  if (await fs.stat(path.join(adjacent, 'src')).then(entry => entry.isDirectory(), () => false)) {
    return adjacent
  }
  const { stdout } = await execFileAsync('git', [
    '-C',
    NEUROBOOK_ROOT,
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ])
  const primaryCheckout = path.dirname(stdout.trim())
  return path.resolve(primaryCheckout, '..', 'nb-history')
}

/**
 * 从 sibling nb-history 开发仓把 src/ 源码镜像到 NeuroBook vendored snapshot。
 * 真相源永远是 ../nb-history；vendor 目录是机器同步产物，勿手改。
 * 幂等：内容无变化且源 commit 未变时零写入（VENDOR.json 也不动）。
 */
async function main(): Promise<void> {
  await assertHistorySource()
  assertExpectedTarget(NB_HISTORY_TARGET_ROOT)

  await fs.mkdir(NB_HISTORY_TARGET_ROOT, { recursive: true })

  const sourceFiles = await listRelativeFiles(NB_HISTORY_SOURCE_ROOT)
  if (sourceFiles.length === 0) {
    throw new Error(`nb-history src 目录为空: ${NB_HISTORY_SOURCE_ROOT}`)
  }
  const targetFiles = await listRelativeFiles(NB_HISTORY_TARGET_ROOT)
  const sourceSet = new Set(sourceFiles)
  let copied = 0
  let unchanged = 0
  let removed = 0

  for (const relativePath of targetFiles) {
    if (sourceSet.has(relativePath) || NON_MIRRORED_TARGET_FILES.has(relativePath)) {
      continue
    }
    await fs.rm(path.join(NB_HISTORY_TARGET_ROOT, ...relativePath.split('/')), { force: true })
    removed += 1
  }

  for (const relativePath of sourceFiles) {
    const sourcePath = path.join(NB_HISTORY_SOURCE_ROOT, ...relativePath.split('/'))
    const targetPath = path.join(NB_HISTORY_TARGET_ROOT, ...relativePath.split('/'))
    if (await sameFile(sourcePath, targetPath)) {
      unchanged += 1
      continue
    }
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.copyFile(sourcePath, targetPath)
    copied += 1
  }

  const sourceCommit = await readSourceCommit()
  const manifestChanged = await writeVendorManifestIfChanged({
    sourceCommit,
    contentChanged: copied > 0 || removed > 0,
  })

  console.log(`synced nb-history vendor: copied=${copied}, unchanged=${unchanged}, removed=${removed}, manifest=${manifestChanged ? 'updated' : 'unchanged'}, sourceCommit=${sourceCommit}`)
}

/**
 * 验证 source 是真实 nb-history 开发仓（防误指向其它 sibling 目录整目录镜像）。
 */
async function assertHistorySource(): Promise<void> {
  const stat = await fs.stat(NB_HISTORY_SOURCE_ROOT).catch(() => null)
  if (!stat?.isDirectory()) {
    throw new Error(`nb-history src 不存在: ${NB_HISTORY_SOURCE_ROOT}`)
  }
  const packagePath = path.join(NB_HISTORY_SOURCE_REPO, 'package.json')
  const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf-8')) as { name?: string }
  if (packageJson.name !== '@notnotype/nb-history') {
    throw new Error(`nb-history package.json.name 必须是 @notnotype/nb-history: ${packagePath}`)
  }
}

/**
 * 防止同步脚本误删 NeuroBook 之外或意料之外的目录。
 */
function assertExpectedTarget(targetRoot: string): void {
  const expected = path.join(NEUROBOOK_ROOT, 'server', 'vendor', 'nb-history')
  if (path.resolve(targetRoot) !== path.resolve(expected)) {
    throw new Error(`nb-history vendor target 路径异常: ${targetRoot}`)
  }
  if (!isInside(NEUROBOOK_ROOT, targetRoot)) {
    throw new Error(`nb-history vendor target 必须位于 NeuroBook 仓库内: ${targetRoot}`)
  }
}

/**
 * 读取源仓当前 HEAD commit，用于 VENDOR.json 溯源。
 */
async function readSourceCommit(): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', NB_HISTORY_SOURCE_REPO, 'rev-parse', 'HEAD'])
  return stdout.trim()
}

/**
 * 内容或源 commit 变化时更新 VENDOR.json；否则保持不动（保证重复同步零 diff）。
 */
async function writeVendorManifestIfChanged(input: { sourceCommit: string, contentChanged: boolean }): Promise<boolean> {
  const manifestPath = path.join(NB_HISTORY_TARGET_ROOT, VENDOR_MANIFEST_NAME)
  const existing = await fs.readFile(manifestPath, 'utf-8')
    .then(text => JSON.parse(text) as VendorManifest)
    .catch(() => null)
  if (!input.contentChanged && existing?.sourceCommit === input.sourceCommit) {
    return false
  }
  const manifest: VendorManifest = {
    package: '@notnotype/nb-history',
    sourceCommit: input.sourceCommit,
    syncedAt: new Date().toISOString(),
    note: '机器同步产物,勿手改。真相源在 sibling 仓 ../nb-history;更新流程: 改源仓 -> bun run sync:nb-history -> commit。',
  }
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`, 'utf-8')
  return true
}

/**
 * 递归列出相对文件路径，统一 POSIX 分隔符。
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
    const relativePath = current ? `${current}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
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
 * 用 SHA-256 比较文件，内容一致则跳过复制。
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

async function hashFile(filePath: string): Promise<string> {
  return createHash('sha256').update(await fs.readFile(filePath)).digest('hex')
}

/**
 * 判断 child 是否位于 parent 内或等于 parent。
 */
function isInside(parent: string, child: string): boolean {
  const relativePath = path.relative(path.resolve(parent), path.resolve(child))
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

await main()
