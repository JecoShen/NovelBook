import { bridgeRequest } from '../util/http'

export interface AbortInput {
  sessionId: number
  reason?: string
  token: string
  baseUrl: string
  signal?: AbortSignal
}

/**
 * 复用现有 `/api/agent/sessions/:id/abort`（不需要桥专用 abort 端点）。
 * 路径在 `/api/agent/sessions/*` 而非 `/api/agent/bridge/*`——abort 是平台原语，
 * 不必复制一份。
 */
export async function abortCommand(input: AbortInput): Promise<unknown> {
  return bridgeRequest({
    method: 'POST',
    path: `/api/agent/sessions/${input.sessionId}/abort`,
    body: { reason: input.reason ?? 'user-abort-from-cli' },
    token: input.token,
    baseUrl: input.baseUrl,
    signal: input.signal,
  })
}
