import type { AbsoluteFsPath } from 'nbook/server/runtime/paths/file-path'
import type { ProjectWorkspaceRef } from 'nbook/server/workspace-files/project-identity'
import type {
  ProjectCandidateSnapshot,
  ProjectCoverUpdateInput,
  ProjectCoverUpdateResult,
  ProjectCreateInput,
  ProjectCreateResult,
  ProjectDeleteResult,
  ProjectListSnapshot,
  ProjectMetadataUpdateInput,
  ProjectMetadataUpdateResult,
} from 'nbook/server/workspace-files/project-lifecycle'
import { ProjectLifecycle } from 'nbook/server/workspace-files/project-lifecycle'
import {
  isProjectNotOpenError,
  ProjectNotOpenError,
  ProjectSessionService,
  type ProjectControlOpenResult,
} from 'nbook/server/workspace-files/project-session-service'
import type { ProjectOpener, ReadyProjectSessionRef } from 'nbook/server/workspace-files/project-session-contract'
import { resolveRuntimeWorkspaceRoot } from 'nbook/server/workspace-files/workspace-runtime-root'

// Production composition root：required与lazy descriptor在任何Project open前完成注册。
import 'nbook/server/workspace-files/project-database-module'
import 'nbook/server/workspace-history/project-history'
import 'nbook/server/workspace-files/project-file-index'
import 'nbook/server/plot/index'
import 'nbook/server/agent/tools/agent-sql-project-module'

import {
  ensureProjectSessionMaintenanceTimer,
  projectSessionAgentPresenceProbe,
  projectSessionServiceFor,
  setProjectSessionNotOpenErrorFactoryForComposition,
} from 'nbook/server/workspace-files/project-session-data-plane'

export { isProjectNotOpenError, ProjectNotOpenError }
export type { ProjectOpener, ReadyProjectSessionRef } from 'nbook/server/workspace-files/project-session-contract'
export {
  PROJECT_GRACE_MS,
  acquireUserPresence,
  activateReadyProjectModule,
  assertProjectOpen,
  closeAllProjects,
  closeProject,
  isProjectOpen,
  listOpenProjects,
  markProjectActivity,
  projectOccupancy,
  registerAgentPresenceProbe,
  requireActiveReadyProject,
  requireReadyModuleHandle,
  requireReadyProject,
  resetProjectSessionsForTest,
  runReadyProjectOperation,
  startReadyProjectOperation,
  sweepProjectSessions,
  type ProjectOperationStart,
  type ProjectSessionCloseReason,
} from 'nbook/server/workspace-files/project-session-data-plane'

setProjectSessionNotOpenErrorFactoryForComposition(projectRoot => new ProjectNotOpenError(projectRoot))

/**
 * 打开结构化 Project ref。
 *
 * Facade 只接受 `ProjectWorkspaceRef`：字符串身份在 HTTP / CLI 入口一次性收窄，
 * 之后的调用链没有任何再次「从路径求根」的口子。
 */
export async function openProject(
  ref: ProjectWorkspaceRef,
  opener: ProjectOpener,
  workspaceRoot?: AbsoluteFsPath,
): Promise<ReadyProjectSessionRef> {
  const service = projectSessionServiceFor(
    workspaceRoot ?? resolveRuntimeWorkspaceRoot(),
    () => createProjectSessionService(workspaceRoot ?? resolveRuntimeWorkspaceRoot()),
  )
  const ready = await service.openProject(ref, opener)
  ensureProjectSessionMaintenanceTimer()
  return ready
}

/** 产品控制面结构化open，同时返回最终Project publication与ready generation。 */
export async function openProjectControl(
  ref: ProjectWorkspaceRef,
  opener: ProjectOpener,
): Promise<ProjectControlOpenResult> {
  const service = projectSessionServiceFor(
    resolveRuntimeWorkspaceRoot(),
    () => createProjectSessionService(resolveRuntimeWorkspaceRoot()),
  )
  const result = await service.openProjectControl(ref, opener)
  ensureProjectSessionMaintenanceTimer()
  return result
}

/** 读取唯一Lifecycle的轻量Project列表snapshot；测试与独立 Harness 可显式指定 Workspace Root。 */
export function listProjects(workspaceRoot?: AbsoluteFsPath): Promise<ProjectListSnapshot> {
  return projectSessionServiceFor(
    workspaceRoot ?? resolveRuntimeWorkspaceRoot(),
    () => createProjectSessionService(workspaceRoot ?? resolveRuntimeWorkspaceRoot()),
  ).listProjects()
}

/** 读取与Project列表同revision的一级候选目录。 */
export function listProjectCandidates(): Promise<ProjectCandidateSnapshot> {
  return projectSessionServiceFor(
    resolveRuntimeWorkspaceRoot(),
    () => createProjectSessionService(resolveRuntimeWorkspaceRoot()),
  ).listCandidates()
}

/** 通过唯一Lifecycle创建Project；创建不隐式打开Session。 */
export function createProject(input: ProjectCreateInput): Promise<ProjectCreateResult> {
  return projectSessionServiceFor(
    resolveRuntimeWorkspaceRoot(),
    () => createProjectSessionService(resolveRuntimeWorkspaceRoot()),
  ).createProject(input)
}

/** 通过唯一Service更新Project metadata，并自动选择borrowed或owned Occupancy。 */
export function updateProjectMetadata(input: ProjectMetadataUpdateInput): Promise<ProjectMetadataUpdateResult> {
  return projectSessionServiceFor(
    resolveRuntimeWorkspaceRoot(),
    () => createProjectSessionService(resolveRuntimeWorkspaceRoot()),
  ).updateProjectMetadata(input)
}

/** 通过唯一 Service 更新 Project 封面，并自动选择 borrowed 或 owned Occupancy。 */
export function updateProjectCover(input: ProjectCoverUpdateInput): Promise<ProjectCoverUpdateResult> {
  return projectSessionServiceFor(
    resolveRuntimeWorkspaceRoot(),
    () => createProjectSessionService(resolveRuntimeWorkspaceRoot()),
  ).updateProjectCover(input)
}

/** 删除已经显式关闭的Project；本入口绝不隐式close。 */
export function deleteProject(ref: ProjectWorkspaceRef): Promise<ProjectDeleteResult> {
  return projectSessionServiceFor(
    resolveRuntimeWorkspaceRoot(),
    () => createProjectSessionService(resolveRuntimeWorkspaceRoot()),
  ).deleteProject(ref)
}

/** Production composition root 创建唯一 ProjectSessionService，并在任何 Project open 前继承已登记探针。 */
function createProjectSessionService(workspaceRoot: AbsoluteFsPath): ProjectSessionService {
  const lifecycle = new ProjectLifecycle(workspaceRoot)
  const service = new ProjectSessionService(workspaceRoot, { lifecycle })
  service.registerAgentPresenceProbe(projectSessionAgentPresenceProbe())
  return service
}
