import path from 'node:path'
import type { AbsoluteFsPath } from 'nbook/server/runtime/paths/file-path'
import type { ProjectWorkspaceRef } from 'nbook/server/workspace-files/project-identity'
import type {
  ProjectCandidateSnapshot,
  ProjectCoverUpdateInput,
  ProjectCoverUpdateResult,
  ProjectCreateInput,
  ProjectCreateResult,
  ProjectDeleteResult,
  ProjectEnsureResult,
  ProjectListSnapshot,
  ProjectMetadataUpdateInput,
  ProjectMetadataUpdateResult,
} from 'nbook/server/workspace-files/project-lifecycle'
import type {
  ProjectModuleHandle,
  ProjectModuleToken,
} from 'nbook/server/workspace-files/project-module'
import type { ProjectOpener } from 'nbook/server/workspace-files/project-session-contract'
import type {
  ProjectOperationStart,
  ProjectSessionCloseReason,
  ReadyProjectSessionRef,
} from 'nbook/server/workspace-files/project-session-runtime'
import { collectReleasedSqliteHandles } from 'nbook/server/workspace-files/sqlite-handle-release'

export {
  PROJECT_GRACE_MS,
} from 'nbook/server/workspace-files/project-session-runtime'
export type {
  ProjectOperationStart,
  ProjectSessionCloseReason,
  ReadyProjectSessionRef,
} from 'nbook/server/workspace-files/project-session-runtime'
export type { ProjectOpener } from 'nbook/server/workspace-files/project-session-contract'

const MAINTENANCE_INTERVAL_MS = 300_000 // 5min project session maintenance interval

type ProjectSessionGlobalState = {
  service: ProjectSessionDataPlaneService | null
  workspaceRoot: AbsoluteFsPath | null
  agentProbe: ((session: ReadyProjectSessionRef) => boolean) | null
  notOpenErrorFactory: ((projectRoot: string) => Error) | null
  maintenanceTimer: ReturnType<typeof setInterval> | null
  sweepInFlight: boolean
}

type ProjectOccupancySnapshot = {
  readonly state: 'open' | 'grace'
  readonly userConnections: number
  readonly agentActive: boolean
}

type OpenProjectSnapshot = ProjectOccupancySnapshot & {
  readonly projectRoot: string
  readonly openedAt: string
  readonly lastActivityAt: string
}

export type ProjectSessionDataPlaneService = {
  openProject(ref: ProjectWorkspaceRef, opener: ProjectOpener): Promise<ReadyProjectSessionRef>
  openProjectControl(ref: ProjectWorkspaceRef, opener: ProjectOpener): Promise<{
    readonly ready: ReadyProjectSessionRef
    readonly publication: ProjectEnsureResult
  }>
  listProjects(): Promise<ProjectListSnapshot>
  listCandidates(): Promise<ProjectCandidateSnapshot>
  createProject(input: ProjectCreateInput): Promise<ProjectCreateResult>
  updateProjectMetadata(input: ProjectMetadataUpdateInput): Promise<ProjectMetadataUpdateResult>
  updateProjectCover(input: ProjectCoverUpdateInput): Promise<ProjectCoverUpdateResult>
  deleteProject(ref: ProjectWorkspaceRef): Promise<ProjectDeleteResult>
  requireReadyProject(ref: ProjectWorkspaceRef): ReadyProjectSessionRef
  requireReadyModuleHandle<THandle extends ProjectModuleHandle>(
    ready: ReadyProjectSessionRef,
    token: ProjectModuleToken<THandle>,
  ): THandle
  activateReadyProjectModule<THandle extends ProjectModuleHandle>(
    ready: ReadyProjectSessionRef,
    token: ProjectModuleToken<THandle>,
  ): Promise<THandle>
  runReadyProjectOperation<TResult>(
    ready: ReadyProjectSessionRef,
    operation: (signal: AbortSignal) => Promise<TResult>,
  ): Promise<TResult>
  startReadyProjectOperation<TResult>(
    ready: ReadyProjectSessionRef,
    start: (signal: AbortSignal) => ProjectOperationStart<TResult>,
  ): TResult
  listOpenProjects(): ReadonlyArray<{
    readonly ref: ProjectWorkspaceRef
    readonly state: 'open' | 'grace'
    readonly userConnections: number
    readonly agentActive: boolean
    readonly openedAt: string
    readonly lastActivityAt: string
  }>
  projectOccupancy(ref: ProjectWorkspaceRef): ProjectOccupancySnapshot | null
  acquireUserPresence(ref: ProjectWorkspaceRef): () => void
  registerAgentPresenceProbe(probe: ((session: ReadyProjectSessionRef) => boolean) | null): void
  markProjectActivity(ref: ProjectWorkspaceRef): void
  closeProject(ref: ProjectWorkspaceRef, reason: ProjectSessionCloseReason): Promise<void>
  sweepProjectSessions(now?: number): Promise<ProjectWorkspaceRef[]>
  closeAll(): Promise<void>
}

const globalForProjectSession = globalThis as typeof globalThis & {
  __nbookProjectSessionV2?: ProjectSessionGlobalState
}
const globalState = globalForProjectSession.__nbookProjectSessionV2 ??= {
  service: null,
  workspaceRoot: null,
  agentProbe: null,
  notOpenErrorFactory: null,
  maintenanceTimer: null,
  sweepInFlight: false,
}

/** 返回已绑定的HMR稳定Service；production composition root负责首次创建真实Service。 */
export function projectSessionServiceFor(
  workspaceRoot: AbsoluteFsPath,
  createService?: () => ProjectSessionDataPlaneService,
): ProjectSessionDataPlaneService {
  if (globalState.service) {
    if (workspaceRootIdentity(globalState.workspaceRoot!) !== workspaceRootIdentity(workspaceRoot)) {
      throw new Error('ProjectSession Service已经绑定到另一个Workspace Root')
    }
    return globalState.service
  }
  if (!createService) {
    throw projectNotOpenError(String(workspaceRoot))
  }
  const service = createService()
  globalState.service = service
  globalState.workspaceRoot = workspaceRoot
  return service
}

/** production composition root 创建真实Service时同步继承已登记的Agent presence probe。 */
export function projectSessionAgentPresenceProbe(): ((session: ReadyProjectSessionRef) => boolean) | null {
  return globalState.agentProbe
}

/** production composition root 注入旧 facade 使用的稳定错误类，data-plane 自身不加载 service。 */
export function setProjectSessionNotOpenErrorFactoryForComposition(factory: (projectRoot: string) => Error): void {
  globalState.notOpenErrorFactory = factory
}

/** 数据面取得 ready Project，不刷新活动时间。 */
export function requireReadyProject(ref: ProjectWorkspaceRef): ReadyProjectSessionRef {
  const service = globalState.service
  if (!service) {
    throw projectNotOpenError(ref.projectRoot)
  }
  return service.requireReadyProject(ref)
}

/**
 * 数据面入口：取得 ready Project 并顺带刷新活动时间。
 * 返回值之后必须沿调用链传播，业务 Module 不得再次求根。
 */
export function requireActiveReadyProject(ref: ProjectWorkspaceRef): ReadyProjectSessionRef {
  const ready = requireReadyProject(ref)
  markProjectActivity(ready.workspace.ref)
  return ready
}

/** 使用入口已经捕获的精确 ready generation 取得 Module handle。 */
export function requireReadyModuleHandle<THandle extends ProjectModuleHandle>(
  ready: ReadyProjectSessionRef,
  token: ProjectModuleToken<THandle>,
): THandle {
  const service = globalState.service
  if (!service) {
    throw projectNotOpenError(ready.workspace.ref.projectRoot)
  }
  return service.requireReadyModuleHandle(ready, token)
}

/** 使用入口捕获的精确 ready generation 激活 lazy Module，拒绝 close/reopen 后串代。 */
export function activateReadyProjectModule<THandle extends ProjectModuleHandle>(
  ready: ReadyProjectSessionRef,
  token: ProjectModuleToken<THandle>,
): Promise<THandle> {
  const service = globalState.service
  if (!service) {
    return Promise.reject(projectNotOpenError(ready.workspace.ref.projectRoot))
  }
  return service.activateReadyProjectModule(ready, token)
}

/**
 * 在精确ready generation同步登记一次异步数据面操作。
 * terminal close会先封住后续登记，再等待本入口已经接纳的操作settle。
 */
export function runReadyProjectOperation<TResult>(
  ready: ReadyProjectSessionRef,
  operation: (signal: AbortSignal) => Promise<TResult>,
): Promise<TResult> {
  const service = globalState.service
  if (!service) {
    return Promise.reject(projectNotOpenError(ready.workspace.ref.projectRoot))
  }
  return service.runReadyProjectOperation(ready, operation)
}

/**
 * 同步启动长生命周期数据面操作：start同步返回result，completion到最终terminal才允许close继续。
 * 适用于Workflow这类先返回runId、随后跨waiting状态继续运行的后台任务。
 */
export function startReadyProjectOperation<TResult>(
  ready: ReadyProjectSessionRef,
  start: (signal: AbortSignal) => ProjectOperationStart<TResult>,
): TResult {
  const service = globalState.service
  if (!service) {
    throw projectNotOpenError(ready.workspace.ref.projectRoot)
  }
  return service.startReadyProjectOperation(ready, start)
}

/** 数据面守卫；grace仍属于ready。 */
export function assertProjectOpen(ref: ProjectWorkspaceRef): void {
  requireReadyProject(ref)
}

/** Project当前是否发布ready generation。 */
export function isProjectOpen(ref: ProjectWorkspaceRef): boolean {
  try {
    assertProjectOpen(ref)
    return true
  }
  catch {
    return false
  }
}

/** 返回全部ready generation的轻量presence投影。 */
export function listOpenProjects(): OpenProjectSnapshot[] {
  return globalState.service?.listOpenProjects().map(({ ref, ...presence }) => ({
    projectRoot: ref.projectRoot,
    ...presence,
  })) ?? []
}

/** 删除控制面读取当前ready generation占用；opening/closing返回null。 */
export function projectOccupancy(ref: ProjectWorkspaceRef): ProjectOccupancySnapshot | null {
  const occupancy = globalState.service?.projectOccupancy(ref)
  if (!occupancy) {
    return null
  }
  return {
    state: occupancy.state,
    userConnections: occupancy.userConnections,
    agentActive: occupancy.agentActive,
  }
}

/** 为当前ready generation取得一路用户presence。 */
export function acquireUserPresence(ref: ProjectWorkspaceRef): () => void {
  const service = globalState.service
  if (!service) {
    throw projectNotOpenError(ref.projectRoot)
  }
  return service.acquireUserPresence(ref)
}

/** 注册 Agent 在场探针；ready 对象身份确保旧 invocation 不会占用重开的 generation。 */
export function registerAgentPresenceProbe(probe: ((session: ReadyProjectSessionRef) => boolean) | null): void {
  globalState.agentProbe = probe
  globalState.service?.registerAgentPresenceProbe(probe)
}

/** 仅刷新结构化 Project ref 对应 ready generation 的活动时间；未打开保持no-op。 */
export function markProjectActivity(ref: ProjectWorkspaceRef): void {
  globalState.service?.markProjectActivity(ref)
}

/**
 * 关闭结构化 Project ref 绑定的精确generation。
 * Module或Occupancy关闭失败时Service保留entry，调用方必须处理拒绝，delete不得继续。
 */
export async function closeProject(ref: ProjectWorkspaceRef, reason: ProjectSessionCloseReason): Promise<void> {
  const service = globalState.service
  if (!service) {
    return
  }
  await service.closeProject(ref, reason)
  collectReleasedSqliteHandles({ force: reason === 'delete' || reason === 'shutdown' })
}

/** 执行Agent/presence/grace维护，返回本轮完整关闭的 Project roots。 */
export async function sweepProjectSessions(now = Date.now()): Promise<string[]> {
  const service = globalState.service
  if (!service) {
    return []
  }
  const closed = await service.sweepProjectSessions(now)
  if (closed.length > 0) {
    collectReleasedSqliteHandles()
  }
  return closed.map(ref => ref.projectRoot)
}

/** Nitro shutdown/HMR最终关闭唯一Service及其Lifecycle、Module与plain adapter资源。 */
export async function closeAllProjects(): Promise<void> {
  stopProjectSessionMaintenanceTimer()
  const service = globalState.service
  if (!service) {
    return
  }
  await service.closeAll()
  if (globalState.service === service) {
    globalState.service = null
    globalState.workspaceRoot = null
  }
  collectReleasedSqliteHandles({ force: true })
}

/**
 * 测试专用：仅在测试已经显式close后清空HMR容器与探针。
 * 不执行隐藏async cleanup，避免同步reset制造无人观察的关闭失败。
 */
export function resetProjectSessionsForTest(): void {
  stopProjectSessionMaintenanceTimer()
  globalState.service = null
  globalState.workspaceRoot = null
  globalState.agentProbe = null
  globalState.sweepInFlight = false
}

/** 首个ready generation建立后启动唯一维护定时器。 */
export function ensureProjectSessionMaintenanceTimer(): void {
  if (globalState.maintenanceTimer) {
    return
  }
  globalState.maintenanceTimer = setInterval(() => {
    if (globalState.sweepInFlight) {
      return
    }
    globalState.sweepInFlight = true
    void sweepProjectSessions()
      .catch(() => undefined)
      .finally(() => {
        globalState.sweepInFlight = false
      })
  }, MAINTENANCE_INTERVAL_MS)
  globalState.maintenanceTimer.unref?.()
}

/** 停止维护定时器；Service close失败时仍保持shutdown gate，不再执行grace sweep。 */
function stopProjectSessionMaintenanceTimer(): void {
  if (globalState.maintenanceTimer) {
    clearInterval(globalState.maintenanceTimer)
    globalState.maintenanceTimer = null
  }
}

/** 比较单进程Service的Workspace Root绑定，Windows按文件系统大小写语义处理。 */
function workspaceRootIdentity(workspaceRoot: AbsoluteFsPath): string {
  const resolved = path.resolve(workspaceRoot)
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved
}

function projectNotOpenError(projectRoot: string): Error {
  return globalState.notOpenErrorFactory?.(projectRoot)
    ?? new Error(`Project未打开：${projectRoot}`)
}
