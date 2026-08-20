import { absoluteFsPath } from 'nbook/server/runtime/paths/file-path'
import {
  inspectStateRootIntegrity,
  stateRootIntegrityFailed,
  type StateRootIntegrityFailure,
  type StateRootIntegrityResult,
} from 'nbook/server/runtime/state-root-integrity'

/**
 * Manager Adapter：把安装字符串root转换为共享Runtime完整性Interface。
 */
export function inspectInstallationStateIntegrity(root: string, stateRoot: string): Promise<StateRootIntegrityResult> {
  return inspectStateRootIntegrity({
    installationRoot: absoluteFsPath(root),
    stateRoot: absoluteFsPath(stateRoot),
  })
}

/** 输出不会自动处理用户数据的明确警告。 */
export function formatStateRootIntegrityWarning(result: StateRootIntegrityFailure): string {
  if (result.kind === 'inspection-error') {
    return [
      '无法完整验证Installation Root与State Root的Workspace Root关系。',
      `检查路径：${result.errorPath}`,
      `检查操作：${result.operation}`,
      `文件系统错误：${result.errorCode ?? 'UNKNOWN'} ${result.errorMessage}`,
      `真实目录：${result.expectedWorkspaceRoot}`,
      '请先检查链接目标和目录权限；Manager不会自动复制、合并、删除或重命名用户数据。',
    ].join('\n')
  }
  return [
    '检测到Installation Root下存在错误的影子Workspace Root。',
    `错误目录：${result.checkedWorkspaceRoot}`,
    `真实目录：${result.expectedWorkspaceRoot}`,
    '请先备份并人工比较两个目录；Manager不会自动复制、合并、删除或重命名用户数据。',
  ].join('\n')
}

export { stateRootIntegrityFailed }
export type { StateRootIntegrityFailure, StateRootIntegrityResult }
