import { stat } from 'node:fs/promises'
import {
  resolveArtifactPath,
  validateProfileArtifact,
  type ProfileArtifactManifest,
  type ProfileArtifactManifestItem,
} from 'nbook/server/agent/profiles/profile-artifact-compiler'

export type ProfileArtifactFreshness = Awaited<ReturnType<typeof validateProfileArtifact>>

export type ProfileDependencySignature = {
  path: string
  mtimeMs?: number
  size?: number
  missing?: true
}

/**
 * profile freshness 判定组件。热路径不调用它；它只服务 catalog refresh、
 * CLI 校验和启动/发布后的内存视图构建。
 */
export class ProfileFreshnessChecker {
  /**
     * 验证 manifest item 指向的源码、artifact 和依赖是否仍新鲜。
     */
  async validate(profileRoot: string, item: ProfileArtifactManifestItem, options: { requireTypeArtifact?: boolean, checkDependencies?: boolean } = {}): Promise<ProfileArtifactFreshness> {
    return validateProfileArtifact(profileRoot, item, options)
  }

  /**
     * 生成 catalog dirty cache 的依赖文件签名；仅非 runtime registry 路径使用。
     */
  async dependencySignatures(manifest: ProfileArtifactManifest): Promise<ProfileDependencySignature[]> {
    const dependencyPaths = [...new Set(manifest.profiles.flatMap(profile => profile.dependencies.map(dependency => dependency.path)))].sort()
    return Promise.all(dependencyPaths.map(async (filePath) => {
      try {
        const fileStat = await stat(resolveArtifactPath(filePath))
        return {
          path: filePath,
          mtimeMs: fileStat.mtimeMs,
          size: fileStat.size,
        }
      }
      catch {
        return {
          path: filePath,
          missing: true,
        }
      }
    }))
  }
}
