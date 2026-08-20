import { bridgeRequest } from '../util/http'

export interface OpenInput {
  projectRoot: string
  profileKey?: string
  token: string
  baseUrl: string
  signal?: AbortSignal
}

export interface OpenResult {
  sessionId: number
  projectRoot: string
  profileKey: string
}

export async function openCommand(input: OpenInput): Promise<OpenResult> {
  return bridgeRequest<OpenResult>({
    method: 'POST',
    path: '/api/agent/bridge/sessions',
    body: {
      projectRoot: input.projectRoot,
      profileKey: input.profileKey,
    },
    token: input.token,
    baseUrl: input.baseUrl,
    signal: input.signal,
  })
}
