/**
 * Agent invocation 调用方身份的纯数据合同。
 *
 * 从 `server/agent/harness/invocation-caller.ts` 下沉到 Agent 根：这些类型不依赖
 * Harness、HTTP DTO 或任何运行时实现，而 `server/agent/messages/stored-types.ts`
 * 需要它们，会把整个 `server/agent/harness/` 前缀拖进 contracts 声明项目的闭包。
 * 按 spec §4「把共同需要的最小类型下沉到 contracts」处置。
 *
 * 原路径保留 re-export，现有调用方不需要改。
 */

/** Agent invocation 的调用方类别。 */
export type AgentInvokeCallerKind = 'user' | 'agent' | 'system' | 'external-cli'

/** Durable message 的投影身份；与调用来源 caller.kind 分离。 */
export type AgentMessageIdentity = 'user' | 'system'

/** Agent invocation 的稳定调用方身份。 */
export type AgentInvokeCaller = {
  kind: AgentInvokeCallerKind
  sessionId?: number
  profileKey?: string
  toolCallId?: string
}
