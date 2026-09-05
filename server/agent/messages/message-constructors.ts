import type { AssistantMessage, JsonValue, Usage } from 'nbook/server/agent/messages/types'
import type { StoredToolResultMessage, StoredUserMessage } from 'nbook/server/agent/messages/stored-types'

export const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
}

export function now(): number {
  return Date.now()
}

/** 构造只含文本的 durable user message；附件入口由 AgentAttachmentCodec 负责。 */
export function createStoredUserMessage(text: string, timestamp = now()): StoredUserMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    timestamp,
  }
}

/** 构造可直接进入 RunToolBatch/JSONL 的纯文本 tool result。 */
export function createStoredTextToolResult(input: {
  toolCallId: string
  toolName: string
  text: string
  isError?: boolean
  details?: unknown
  timestamp?: number
}): StoredToolResultMessage {
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
 * 把工具执行期 details 收口为 JSONL 可持久化值。
 * undefined object 字段按 JSON 语义省略，array 中的 undefined 变为 null；bigint
 * 使用十进制字符串，避免 JSON.stringify 在 durable write 时才抛错。
 */
export function normalizeToolResultDetails(value: unknown): JsonValue {
  const seen = new WeakSet<object>()
  const normalize = (current: unknown, inArray: boolean): JsonValue | undefined => {
    if (current === undefined) {
      return inArray ? null : undefined
    }
    if (current === null || typeof current === 'string' || typeof current === 'boolean') {
      return current
    }
    if (typeof current === 'number') {
      return Number.isFinite(current) ? current : null
    }
    if (typeof current === 'bigint') {
      return current.toString()
    }
    if (typeof current !== 'object') {
      throw new Error(`工具 details 包含不可持久化类型：${typeof current}`)
    }
    if (seen.has(current)) {
      throw new Error('工具 details 包含循环引用')
    }
    seen.add(current)
    try {
      if (Array.isArray(current)) {
        return current.map(item => normalize(item, true) ?? null)
      }
      const result: Record<string, JsonValue> = {}
      for (const [key, item] of Object.entries(current)) {
        const normalized = normalize(item, false)
        if (normalized !== undefined) {
          result[key] = normalized
        }
      }
      return result
    }
    finally {
      seen.delete(current)
    }
  }
  return normalize(value, true) ?? null
}

/** 构造测试或兜底用 assistant message。 */
export function createAssistantTextMessage(input: {
  text: string
  model?: string
  api?: string
  provider?: string
  stopReason?: AssistantMessage['stopReason']
  usage?: Usage
  timestamp?: number
}): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: input.text }],
    api: input.api ?? 'neuro-book',
    provider: input.provider ?? 'neuro-book',
    model: input.model ?? 'neuro-agent',
    usage: input.usage ?? EMPTY_USAGE,
    stopReason: input.stopReason ?? 'stop',
    timestamp: input.timestamp ?? now(),
  }
}
