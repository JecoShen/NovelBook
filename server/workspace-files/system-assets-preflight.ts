import path from 'node:path'
import { compileProfileArtifacts, type CompileProfileArtifactsResult, type ProfileReleasePublishOptions } from 'nbook/server/agent/profiles/profile-artifact-compiler'
import { compileVariableDefinitions, type VariableDefinitionManifest } from 'nbook/server/agent/variables/definition-artifact'
import { syncSystemAssetsToUserAssets, type UserAssetsSyncResult } from 'nbook/server/workspace-files/novel-workspace'
import { resolveSystemNbookRoot } from 'nbook/server/workspace-files/system-workspace-assets'
import { runtimePathsFromEnv } from 'nbook/server/runtime/paths/runtime-paths'

export type SystemAssetsPreflightResult = {
  variableManifest: VariableDefinitionManifest
  profileResult: CompileProfileArtifactsResult
  userAssetsSync?: UserAssetsSyncResult
}

/**
 * 准备系统 assets runtime artifact，并按需同步到用户 assets。
 */
export async function prepareSystemAssets(options: {
  syncUserAssets?: boolean
  force?: boolean
  forceSyncUserAssets?: boolean
  /** 仅 Product 组装阶段允许写入 `.output/server/assets`；运行时不得设置。 */
  productBuild?: boolean
  profileRelease?: ProfileReleasePublishOptions
} = {}): Promise<SystemAssetsPreflightResult> {
  const runtimePaths = runtimePathsFromEnv()
  const systemNbookRoot = resolveSystemNbookRoot()
  const productSystemNbookRoot = path.resolve(runtimePaths.applicationRoot, '.output', 'server', 'assets', 'workspace', '.nbook')
  const writePolicy = path.resolve(systemNbookRoot) === productSystemNbookRoot && !options.productBuild
    ? 'forbid' as const
    : 'allow' as const
  const profileRoot = path.resolve(systemNbookRoot, 'agent', 'profiles')
  const variableDefinitionRoot = path.resolve(systemNbookRoot, 'agent', 'variables')
  const variableManifest = await compileVariableDefinitions({
    definitionRoot: variableDefinitionRoot,
    rootLabel: 'assets/workspace/.nbook/agent/variables',
    skipFresh: !options.force,
    writePolicy,
  })
  const profileResult = await compileProfileArtifacts({
    profileRoot,
    rootLabel: 'assets/workspace/.nbook/agent/profiles',
    skipFresh: !options.force,
    writePolicy,
    orphanBudgetPolicy: 'builtin_source',
    publish: options.profileRelease,
  })
  const userAssetsSync = options.syncUserAssets
    ? await syncSystemAssetsToUserAssets({ force: options.forceSyncUserAssets, profileRelease: options.profileRelease })
    : undefined
  return { variableManifest, profileResult, userAssetsSync }
}
