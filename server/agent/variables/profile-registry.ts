import { resolve } from 'node:path'
import type { AgentProfile } from 'nbook/server/agent/profiles/types'
import { VariableRegistry, builtinVariableDefinitions } from 'nbook/server/agent/variables/registry'
import { loadCompiledVariableDefinitions } from 'nbook/server/agent/variables/definition-artifact'
import type { VariableAccessorIssue } from 'nbook/server/agent/variables/types'
import type { AbsoluteFsPath } from 'nbook/server/runtime/paths/file-path'
import type { ReadyProjectSessionRef } from 'nbook/server/workspace-files/project-session-types'

/**
 * 创建 profile 运行时变量 registry。内建变量由 VariableRegistry 自带，
 * profile 第一版只能额外注册 session.* 变量。
 */
export function createVariableRegistryForProfile(profile: AgentProfile): VariableRegistry {
  const registry = new VariableRegistry()
  for (const definition of profile.variableDefinitions ?? []) {
    if (definition.namespace !== 'session') {
      throw new Error(`profile ${profile.manifest.key} 只能注册 session.* 变量定义：${definition.namespace}.${definition.key}`)
    }
    registry.register(definition)
  }
  return registry
}

/**
 * 创建真实 session 运行时变量 registry，包含 Workspace Root / Project Workspace 编译后的变量定义。
 */
export async function createVariableRegistryForSession(input: {
  profile: AgentProfile
  globalWorkspaceRoot: AbsoluteFsPath
  currentProject: ReadyProjectSessionRef | null
}): Promise<VariableRegistry> {
  const definitions = [...builtinVariableDefinitions()]
  const issues: VariableAccessorIssue[] = []
  const globalLoaded = await loadCompiledVariableDefinitions({
    definitionRoot: resolve(input.globalWorkspaceRoot, '.nbook', 'agent', 'variables'),
    namespace: 'global',
  })
  definitions.push(...globalLoaded.definitions)
  issues.push(...globalLoaded.issues)
  if (input.currentProject) {
    const projectLoaded = await loadCompiledVariableDefinitions({
      definitionRoot: resolve(input.currentProject.workspace.root, '.nbook', 'agent', 'variables'),
      namespace: 'project',
    })
    definitions.push(...projectLoaded.definitions)
    issues.push(...projectLoaded.issues)
  }
  const registry = new VariableRegistry(definitions, issues)
  for (const definition of input.profile.variableDefinitions ?? []) {
    if (definition.namespace !== 'session') {
      throw new Error(`profile ${input.profile.manifest.key} 只能注册 session.* 变量定义：${definition.namespace}.${definition.key}`)
    }
    registry.register(definition)
  }
  return registry
}
