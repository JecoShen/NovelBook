import type { SnapshotRawEventBatch } from '@notnotype/file-snapshot-cache'
import {
  projectModuleToken,
  type ProjectModuleHandle,
} from 'nbook/server/workspace-files/project-module'
import type { ProjectWorkspacePathPolicyResult } from 'nbook/server/workspace-files/project-workspace-path-policy'
import type { WorkspaceHistory } from '@notnotype/nb-history'
import type { WorkspaceFileChangeEventDto } from 'nbook/shared/dto/workspace-file-events.dto'

/** History generation warm-up当前所处的重工作阶段。 */
export type ProjectHistoryWarmupPhase = 'reconcile' | 'maintenance'

/** 最近一次History warm-up失败的有界诊断。 */
export type ProjectHistoryWarmupFailure = {
  readonly phase: ProjectHistoryWarmupPhase
  readonly failedAt: string
  readonly message: string
}

/** 单个History generation的只读warm-up诊断快照。 */
export type ProjectHistoryWarmupDiagnostics = {
  readonly state: 'idle' | 'running' | 'ready' | 'failed' | 'cancelled' | 'disabled'
  /** 仅running/failed/cancelled时表示对应尝试所处阶段，其余状态为null。 */
  readonly phase: ProjectHistoryWarmupPhase | null
  readonly attemptCount: number
  /** 尚未开始任何尝试时为null。 */
  readonly startedAt: string | null
  /** 当前generation尚未成功完成warm-up时为null。 */
  readonly succeededAt: string | null
  /** 没有失败过时为null；成功重试后仍保留最近一次失败供诊断。 */
  readonly lastFailure: ProjectHistoryWarmupFailure | null
}

/** History generation公开的有界资源与后台任务诊断。 */
export type ProjectHistoryDiagnostics = {
  readonly warmup: ProjectHistoryWarmupDiagnostics
}

/** History在单个ProjectSession generation中拥有的精确资源句柄。 */
export interface ProjectHistoryHandle extends ProjectModuleHandle {
  /** 当前generation完成最低ready后打开的History；功能关闭时为null。 */
  readonly history: Promise<WorkspaceHistory | null>
  /** 等待或启动当前generation的共享warm-up；失败后下一批消费者会共享一次新尝试。 */
  waitForWarmup(): Promise<void>
  /** 返回当前generation的有界只读诊断快照。 */
  diagnostics(): ProjectHistoryDiagnostics
  /** 消费File Index在rebuild前投递的原始事件批。 */
  reconcileRawEvents(batch: SnapshotRawEventBatch<WorkspaceFileChangeEventDto>): Promise<void>
  /** 当前generation统一判断一条Project-relative路径是否由History消费。 */
  readonly pathPolicy: (relativePath: string) => ProjectWorkspacePathPolicyResult
}

/** ReadyProjectSession数据面取得History generation handle使用的稳定token。 */
export const PROJECT_HISTORY_MODULE_TOKEN = projectModuleToken<ProjectHistoryHandle>('history', 'required')
