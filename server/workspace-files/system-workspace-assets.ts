import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { absoluteFsPath, type AbsoluteFsPath } from 'nbook/server/runtime/paths/file-path'
import { runtimePathsFromEnv } from 'nbook/server/runtime/paths/runtime-paths'

const SYSTEM_ASSETS_RELATIVE_ROOT = path.join('assets', 'workspace', '.nbook')
const MODULE_APPLICATION_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 系统Workspace模板测试覆盖；生产代码不得设置。 */
export type SystemWorkspaceAssetContext = {
  /** 非空时覆盖开发Adapter发现的Application Root。 */
  applicationRoot?: string
  /** 非空时覆盖随应用发布的系统`.nbook`模板根。 */
  systemNbookRoot?: string
}

let systemWorkspaceAssetContext: SystemWorkspaceAssetContext | null = null

/** 测试专用：覆盖系统Workspace模板的真实磁盘root。 */
export function setSystemWorkspaceAssetContextForTest(context: SystemWorkspaceAssetContext | null): void {
  systemWorkspaceAssetContext = context
    ? {
        applicationRoot: context.applicationRoot ? path.resolve(context.applicationRoot) : undefined,
        systemNbookRoot: context.systemNbookRoot ? path.resolve(context.systemNbookRoot) : undefined,
      }
    : null
}

/** 测试专用：读取当前系统Workspace模板覆盖值。 */
export function getSystemWorkspaceAssetContextForTest(): SystemWorkspaceAssetContext | null {
  return systemWorkspaceAssetContext ? { ...systemWorkspaceAssetContext } : null
}

/**
 * 开发/脚本Adapter：发现Application Root。
 *
 * Manager/Product设置根环境后直接使用RuntimePaths；仅无显式环境的源码开发和
 * 测试允许向上寻找bundled system assets。
 */
export function resolveApplicationRoot(startPath = process.cwd()): AbsoluteFsPath {
  if (systemWorkspaceAssetContext?.applicationRoot) {
    return absoluteFsPath(systemWorkspaceAssetContext.applicationRoot)
  }
  if (process.env.NEURO_BOOK_APPLICATION_ROOT?.trim() || process.env.NEURO_BOOK_STATE_ROOT?.trim()) {
    return runtimePathsFromEnv(startPath).applicationRoot
  }
  let currentPath = path.resolve(startPath)
  while (true) {
    if (fs.existsSync(path.join(currentPath, SYSTEM_ASSETS_RELATIVE_ROOT))) {
      return absoluteFsPath(currentPath)
    }

    const parentPath = path.dirname(currentPath)
    if (parentPath === currentPath) {
      break
    }
    currentPath = parentPath
  }

  if (fs.existsSync(path.join(MODULE_APPLICATION_ROOT, SYSTEM_ASSETS_RELATIVE_ROOT))) {
    return absoluteFsPath(MODULE_APPLICATION_ROOT)
  }
  return absoluteFsPath(path.resolve(startPath))
}

/** 解析随Application Root发布的系统Workspace Root `.nbook`模板层。 */
export function resolveSystemNbookRoot(startPath = process.cwd()): AbsoluteFsPath {
  if (systemWorkspaceAssetContext?.systemNbookRoot) {
    return absoluteFsPath(systemWorkspaceAssetContext.systemNbookRoot)
  }
  const productImageRoot = process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT?.trim()
  if (productImageRoot) {
    return absoluteFsPath(path.resolve(productImageRoot, 'server', SYSTEM_ASSETS_RELATIVE_ROOT))
  }
  const applicationRoot = resolveApplicationRoot(startPath)
  const productAssetsRoot = path.join(applicationRoot, '.output', 'server', SYSTEM_ASSETS_RELATIVE_ROOT)
  if (!fs.existsSync(path.join(applicationRoot, 'node_modules')) && fs.existsSync(productAssetsRoot)) {
    return absoluteFsPath(productAssetsRoot)
  }
  return absoluteFsPath(path.join(applicationRoot, SYSTEM_ASSETS_RELATIVE_ROOT))
}
