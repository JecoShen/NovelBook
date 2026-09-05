import type { AgentMessage, AgentUserMessageInput, Message, TextContent, ToolResultMessage, Usage } from 'nbook/server/agent/messages/types'
import type { NeuroToolResult } from 'nbook/server/agent/tools/types'
import { attachmentMarker, storedMessageText } from 'nbook/server/agent/messages/stored-message-presentation'
import type { StoredAgentMessage, StoredContent, StoredToolResultMessage, StoredUserMessage } from 'nbook/server/agent/messages/stored-types'
import {
  EMPTY_USAGE,
  normalizeToolResultDetails,
  now,
} from 'nbook/server/agent/messages/message-constructors'

export {
  createAssistantTextMessage,
  createStoredTextToolResult,
  createStoredUserMessage,
  EMPTY_USAGE,
  normalizeToolResultDetails,
  now,
} from 'nbook/server/agent/messages/message-constructors'

/**
 * 累加多次 assistant provider usage。
 */
export function sumUsage(usages: Array<Usage | undefined>): Usage | undefined {
  const presentUsages = usages.filter((usage): usage is Usage => Boolean(usage))
  if (presentUsages.length === 0) {
    return undefined
  }

  const hasReasoning = presentUsages.some(usage => usage.reasoning !== undefined)
  const hasCacheWrite1h = presentUsages.some(usage => usage.cacheWrite1h !== undefined)
  const total = presentUsages.reduce<Usage>((sum, usage) => ({
    input: sum.input + usage.input,
    output: sum.output + usage.output,
    cacheRead: sum.cacheRead + usage.cacheRead,
    cacheWrite: sum.cacheWrite + usage.cacheWrite,
    totalTokens: sum.totalTokens + usage.totalTokens,
    cost: {
      input: sum.cost.input + usage.cost.input,
      output: sum.cost.output + usage.cost.output,
      cacheRead: sum.cost.cacheRead + usage.cost.cacheRead,
      cacheWrite: sum.cost.cacheWrite + usage.cost.cacheWrite,
      total: sum.cost.total + usage.cost.total,
    },
  }), EMPTY_USAGE)
  return {
    ...total,
    ...(hasReasoning ? { reasoning: presentUsages.reduce((sum, usage) => sum + (usage.reasoning ?? 0), 0) } : {}),
    ...(hasCacheWrite1h ? { cacheWrite1h: presentUsages.reduce((sum, usage) => sum + (usage.cacheWrite1h ?? 0), 0) } : {}),
  }
}

/**
 * 汇总 session 消息里的所有 assistant provider usage。
 */
export function sumAssistantUsage(messages: AgentMessage[]): Usage | undefined {
  return sumUsage(messages.map(message => message.role === 'assistant' ? message.usage : undefined))
}

/**
 * 当前时间戳。集中封装，测试中可以用显式 timestamp 覆盖。
 */
/**
 * 构造 Pi user message。
 */
export function createUserMessage(input: AgentUserMessageInput, timestamp = now()): Message & StoredUserMessage {
  const textBlock: TextContent = {
    type: 'text',
    text: input.text,
  }

  return {
    role: 'user',
    content: [textBlock],
    timestamp,
  }
}

/**
 * 构造纯文本 tool result。
 */
export function createTextToolResult(input: {
  toolCallId: string
  toolName: string
  text: string
  isError?: boolean
  details?: unknown
  timestamp?: number
}): ToolResultMessage & StoredToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    content: [{ type: 'text', text: input.text }],
    ...(input.details === undefined ? {} : { details: normalizeToolResultDetails(input.details) }),
    isError: input.isError ?? false,
    timestamp: input.timestamp ?? now(),
  }
}

/**
 * 从工具原始结果构造 toolResult，保留图片等非文本 content。
 */
export function createToolResultFromResult(input: {
  toolCallId: string
  toolName: string
  result: NeuroToolResult
  isError?: boolean
  timestamp?: number
}): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    // 该函数只用于 Pi AgentEvent seam。attachment 在这里显式投影为稳定 marker；
    // durable 结果必须使用 createStoredToolResultFromResult 保留引用。
    content: input.result.content.map((block: StoredContent) => block.type === 'text'
      ? block
      : { type: 'text' as const, text: attachmentMarker(block) }),
    ...(input.result.details === undefined ? {} : { details: normalizeToolResultDetails(input.result.details) }),
    isError: input.isError ?? false,
    timestamp: input.timestamp ?? now(),
  }
}

/** 构造不含 Pi image/base64 的 durable tool result。 */
export function createStoredToolResultFromResult(input: {
  toolCallId: string
  toolName: string
  result: NeuroToolResult
  isError?: boolean
  timestamp?: number
}): StoredToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    content: input.result.content,
    ...(input.result.details === undefined ? {} : { details: normalizeToolResultDetails(input.result.details) }),
    isError: input.isError ?? false,
    timestamp: input.timestamp ?? now(),
  }
}

/**
 * 从 message 中提取人类可读文本。
 */
export function messageText(message: AgentMessage | StoredAgentMessage, options?: { stripThinking?: boolean } | number): string {
  // 统一由 stored presentation policy 处理 attachment marker；number 兼容 map(messageText) 回调。
  return storedMessageText(message, options)
}

/**
 * 判断 assistant message 是否包含指定 tool call。
 */
export function hasToolCall(message: Message, toolName?: string): boolean {
  return message.role === 'assistant' && message.content.some((block) => {
    return block.type === 'toolCall' && (!toolName || block.name === toolName)
  })
}
