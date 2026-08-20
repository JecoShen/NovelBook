import { join } from 'node:path'
import { resolveSystemNbookRoot } from 'nbook/server/workspace-files/system-workspace-assets'
import type { RuntimePaths } from 'nbook/server/runtime/paths/runtime-paths'
import { runtimePathsFromEnv } from 'nbook/server/runtime/paths/runtime-paths'
import type { WorkbenchRoots } from 'nbook/server/agent/profiles/workbench-service'

/**
 * HTTP/CLI Adapter：从已经确定的 RuntimePaths 与系统模板根构造 Workbench roots。
 * Workbench Module 本身不读取 cwd、State Root 或环境变量。
 */
export function profileWorkbenchRootsFromRuntime(runtimePaths: RuntimePaths = runtimePathsFromEnv()): WorkbenchRoots {
  const systemNbookRoot = resolveSystemNbookRoot()
  return {
    systemProfileRoot: join(systemNbookRoot, 'agent', 'profiles'),
    userProfileRoot: join(runtimePaths.userNbookRoot, 'agent', 'profiles'),
    templateRoot: join(systemNbookRoot, 'agent', 'profile-templates'),
  }
}
