import path from 'node:path'
import { absoluteFsPath, type AbsoluteFsPath } from 'nbook/server/runtime/paths/file-path'

/** 一次NeuroBook进程使用的不可变物理根集合。 */
export type RuntimePaths = Readonly<{
  applicationRoot: AbsoluteFsPath
  stateRoot: AbsoluteFsPath
  cacheRoot: AbsoluteFsPath
  workspaceRoot: AbsoluteFsPath
  userNbookRoot: AbsoluteFsPath
  bootConfigPath: AbsoluteFsPath
  stateEnvPath: AbsoluteFsPath
  logRoot: AbsoluteFsPath
  imageVariantRoot: AbsoluteFsPath
  llmlintStateRoot: AbsoluteFsPath
  llmlintCacheRoot: AbsoluteFsPath
  bunInstallCacheRoot: AbsoluteFsPath
  bashOutputRoot: AbsoluteFsPath
  secretsRoot: AbsoluteFsPath
  backupKeyringPath: AbsoluteFsPath
}>

/**
 * 从已确定的Application Root与State Root建立Runtime Paths。
 *
 * 本函数不读取cwd或环境变量；生产、开发和测试Adapter必须在调用前决定两个根。
 */
export function createRuntimePaths(input: {
  applicationRoot: AbsoluteFsPath
  stateRoot: AbsoluteFsPath
  /** 未提供时使用State Root下的cache，供源码开发与隔离测试使用。 */
  cacheRoot?: AbsoluteFsPath
}): RuntimePaths {
  const cacheRoot = input.cacheRoot ?? absoluteFsPath(path.join(input.stateRoot, 'cache'))
  return Object.freeze({
    applicationRoot: input.applicationRoot,
    stateRoot: input.stateRoot,
    cacheRoot,
    workspaceRoot: absoluteFsPath(path.join(input.stateRoot, 'workspace')),
    userNbookRoot: absoluteFsPath(path.join(input.stateRoot, 'workspace', '.nbook')),
    bootConfigPath: absoluteFsPath(path.join(input.stateRoot, 'config.yaml')),
    stateEnvPath: absoluteFsPath(path.join(input.stateRoot, '.env')),
    logRoot: absoluteFsPath(path.join(input.stateRoot, 'logs')),
    imageVariantRoot: absoluteFsPath(path.join(cacheRoot, 'image-variants')),
    llmlintStateRoot: absoluteFsPath(path.join(input.stateRoot, 'tool-state', 'llmlint')),
    llmlintCacheRoot: absoluteFsPath(path.join(cacheRoot, 'llmlint')),
    bunInstallCacheRoot: absoluteFsPath(path.join(cacheRoot, 'bun', 'install')),
    bashOutputRoot: absoluteFsPath(path.join(cacheRoot, 'agent', 'bash-output')),
    secretsRoot: absoluteFsPath(path.join(input.stateRoot, 'secrets')),
    backupKeyringPath: absoluteFsPath(path.join(input.stateRoot, 'secrets', 'backup-keyring.json')),
  })
}

/**
 * 进程环境Adapter：按Manager传入的环境变量或开发startPath建立Runtime Paths。
 *
 * State/Cache环境变量均相对Application Root解析。未设置Cache Root时使用
 * State Root下的cache；只有本Adapter保留开发cwd默认值。
 */
export function runtimePathsFromEnv(
  startPath = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): RuntimePaths {
  const startRoot = path.resolve(startPath)
  const applicationInput = env.NEURO_BOOK_APPLICATION_ROOT?.trim()
  const applicationRoot = absoluteFsPath(applicationInput
    ? path.isAbsolute(applicationInput)
      ? applicationInput
      : path.resolve(startRoot, applicationInput)
    : startRoot)
  const stateInput = env.NEURO_BOOK_STATE_ROOT?.trim()
  const stateRoot = absoluteFsPath(stateInput
    ? path.isAbsolute(stateInput)
      ? stateInput
      : path.resolve(applicationRoot, stateInput)
    : applicationRoot)
  const cacheInput = env.NEURO_BOOK_CACHE_ROOT?.trim()
  const cacheRoot = absoluteFsPath(cacheInput
    ? path.isAbsolute(cacheInput)
      ? cacheInput
      : path.resolve(applicationRoot, cacheInput)
    : path.join(stateRoot, 'cache'))
  return createRuntimePaths({ applicationRoot, stateRoot, cacheRoot })
}
