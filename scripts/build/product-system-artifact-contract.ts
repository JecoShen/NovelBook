import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  readProfileArtifactManifest,
  validateProfileArtifact,
  type ProfileArtifactValidation,
} from 'nbook/server/agent/profiles/profile-artifact-compiler'
import {
  readVariableDefinitionManifest,
  validateVariableDefinitionArtifact,
  type VariableDefinitionValidation,
} from 'nbook/server/agent/variables/definition-artifact'
import { containsSourceRootDescendant } from 'nbook/scripts/build/product-source-path-contract'

/**
 * 验证最终 `.output` 内置 artifact 完全依赖 Product runtime 自身。
 *
 * 该门禁只读，不重编、不修复；任何根 `node_modules` 或 Source checkout 依赖都会
 * 让 Product archive 在生成前失败。
 */
export async function assertProductSystemArtifactContract(
  applicationRoot = process.cwd(),
  imageRoot?: string,
): Promise<void> {
  const root = resolve(applicationRoot)
  const productImageRoot = resolve(imageRoot ?? resolve(root, '.output'))
  const agentRoot = resolve(productImageRoot, 'server', 'assets', 'workspace', '.nbook', 'agent')
  const previousProductBuild = process.env.NEURO_BOOK_PRODUCT_BUILD
  const previousImageRoot = process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT
  process.env.NEURO_BOOK_PRODUCT_BUILD = '1'
  process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT = productImageRoot
  try {
    const profileRoot = resolve(agentRoot, 'profiles')
    const profileManifest = await readProfileArtifactManifest(profileRoot)
    if (profileManifest.profiles.length === 0) {
      throw new Error('Product system profile manifest 为空。请重新执行完整 Product build。')
    }
    if (profileManifest.profilesRoot !== 'assets/workspace/.nbook/agent/profiles') {
      throw new Error(`Product system profile manifest root错误：${profileManifest.profilesRoot}`)
    }
    for (const profile of profileManifest.profiles) {
      assertProductDependencies(profile.fileName, profile.dependencies)
      const validation = await validateProfileArtifact(profileRoot, profile, { requireTypeArtifact: true })
      if (!validation.fresh) {
        throw new Error(`Product system profile artifact 无效：${profile.fileName}（${validationDetail(validation)}）`)
      }
    }

    const variableRoot = resolve(agentRoot, 'variables')
    const variableManifest = await readVariableDefinitionManifest(variableRoot)
    if (variableManifest.definitions.length === 0) {
      throw new Error('Product system variable definition manifest 为空。请重新执行完整 Product build。')
    }
    if (variableManifest.definitionsRoot !== 'assets/workspace/.nbook/agent/variables') {
      throw new Error(`Product system variable definition manifest root错误：${variableManifest.definitionsRoot}`)
    }
    for (const definition of variableManifest.definitions) {
      assertProductDependencies(definition.fileName, definition.dependencies)
      const validation = await validateVariableDefinitionArtifact(variableRoot, definition, { requireTypeArtifact: true })
      if (!validation.fresh) {
        throw new Error(`Product system variable definition artifact 无效：${definition.fileName}（${validationDetail(validation)}）`)
      }
    }
    await assertProductSystemArtifactModulePaths(agentRoot, [root, productImageRoot])
  }
  finally {
    if (previousProductBuild === undefined) {
      delete process.env.NEURO_BOOK_PRODUCT_BUILD
    }
    else {
      process.env.NEURO_BOOK_PRODUCT_BUILD = previousProductBuild
    }
    if (previousImageRoot === undefined) {
      delete process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT
    }
    else {
      process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT = previousImageRoot
    }
  }
}

/** 扫描系统编译 artifact，禁止把构建机或包管理器物理路径写进可执行模块。 */
export async function assertProductSystemArtifactModulePaths(
  artifactRoot: string,
  forbiddenRoots: readonly string[] = [],
): Promise<void> {
  const files = await listMjsFiles(resolve(artifactRoot))
  const physicalPathPattern = /(?:[a-z]:[\\/]|file:\/\/\/)[^"'`\r\n]*?(?:[\\/]node_modules[\\/](?:\.bun|\.pnpm)|[\\/]\.bun[\\/]|[\\/]\.pnpm[\\/])/iu
  for (const filePath of files) {
    const source = await readFile(filePath, 'utf8')
    const root = forbiddenRoots.find(value => containsSourceRootDescendant(source, value))
    if (root || physicalPathPattern.test(source) || source.includes('file:///_entry.js')) {
      throw new Error(`Product system artifact 泄漏构建机或包管理器物理路径：${filePath}`)
    }
  }
}

/** 稳定递归枚举系统 artifact 的 ESM 文件。 */
async function listMjsFiles(root: string): Promise<string[]> {
  const files: string[] = []
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filePath = resolve(directory, entry.name)
      if (entry.isDirectory()) await walk(filePath)
      else if (entry.isFile() && entry.name.endsWith('.mjs')) files.push(filePath)
    }
  }
  await walk(root)
  return files.sort()
}

/** Product artifact 不得依赖 Source archive 或安装根 node_modules。 */
function assertProductDependencies(label: string, dependencies: Array<{ path: string }>): void {
  const offender = dependencies.find(dependency => !dependency.path.startsWith('.output/server/'))
  if (offender) {
    throw new Error(`Product system artifact 依赖越过 .output/server：${label} -> ${offender.path}`)
  }
}

/** 把 freshness 结果转换为可直接定位的错误细节。 */
function validationDetail(validation: ProfileArtifactValidation | VariableDefinitionValidation): string {
  if (validation.dependency) {
    return `${validation.reason}: ${validation.dependency.path}`
  }
  return validation.reason ?? 'unknown'
}

if (import.meta.main) {
  await assertProductSystemArtifactContract()
  console.log('Product system artifact contract passed')
}
