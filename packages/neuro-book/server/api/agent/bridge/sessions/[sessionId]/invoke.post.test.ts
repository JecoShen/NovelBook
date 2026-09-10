import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BridgeConcurrencyLimitError } from 'nbook/server/agent/bridge/bridge-run-registry'

const mocks = vi.hoisted(() => ({
  requireBridgeAuth: vi.fn(),
  requireAgentSessionId: vi.fn(),
  validateBody: vi.fn(),
  getSessionRecovery: vi.fn(),
  invokeAgent: vi.fn(),
  projectPublicInvocationResult: vi.fn(),
  acquire: vi.fn(),
  release: vi.fn(),
  useAgentHarness: vi.fn(),
  useBridgeRunRegistry: vi.fn(),
}))

vi.mock('nbook/server/agent/bridge/bridge-auth', () => ({
  requireBridgeAuth: mocks.requireBridgeAuth,
}))

vi.mock('nbook/server/agent/http', () => ({
  requireAgentSessionId: mocks.requireAgentSessionId,
  useAgentHarness: mocks.useAgentHarness,
}))

vi.mock('nbook/server/utils/novel-chapter', () => ({
  validateBody: mocks.validateBody,
}))

vi.mock('nbook/server/agent/events/public-invocation-result-projection', () => ({
  projectPublicInvocationResult: mocks.projectPublicInvocationResult,
}))

vi.mock('nbook/server/agent/bridge/bridge-run-registry', async () => {
  const actual = await vi.importActual<typeof import('nbook/server/agent/bridge/bridge-run-registry')>(
    'nbook/server/agent/bridge/bridge-run-registry',
  )
  return {
    ...actual,
    useBridgeRunRegistry: mocks.useBridgeRunRegistry,
  }
})

function makeEvent() {
  const reqListeners: Record<string, Array<() => void>> = {}
  return {
    node: {
      req: {
        on: (event: string, cb: () => void) => {
          (reqListeners[event] ??= []).push(cb)
        },
        off: (event: string, cb: () => void) => {
          const list = reqListeners[event] ?? []
          const idx = list.indexOf(cb)
          if (idx >= 0) list.splice(idx, 1)
        },
      },
    },
  } as never
}

describe('POST /api/agent/bridge/sessions/:sessionId/invoke', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    mocks.requireAgentSessionId.mockReturnValue(42)
    mocks.useAgentHarness.mockReturnValue({
      getSessionRecovery: mocks.getSessionRecovery,
      invokeAgent: mocks.invokeAgent,
    })
    mocks.useBridgeRunRegistry.mockReturnValue({
      acquire: mocks.acquire,
    })
    mocks.acquire.mockReturnValue(mocks.release)
    mocks.getSessionRecovery.mockResolvedValue({ summary: { currentProjectRoot: 'novel-a' } })
  })

  it('happy path: 鉴权 → 校验 body → acquire → invoke(external-cli) → projectPublicInvocationResult → release', async () => {
    mocks.validateBody.mockResolvedValue({
      mode: 'prompt',
      clientMessageId: 'client-msg-1',
      message: { content: [{ type: 'text', text: 'hi' }] },
    })
    const harnessResult = { status: 'completed' }
    mocks.invokeAgent.mockResolvedValue(harnessResult)
    mocks.projectPublicInvocationResult.mockReturnValue({ ok: true })

    const handler = (await import('nbook/server/api/agent/bridge/sessions/[sessionId]/invoke.post')).default
    const event = makeEvent()
    const result = await handler(event)

    expect(mocks.requireBridgeAuth).toHaveBeenCalledWith(event)
    expect(mocks.requireAgentSessionId).toHaveBeenCalledWith(event)
    expect(mocks.acquire).toHaveBeenCalledWith('novel-a', 42)
    expect(mocks.invokeAgent).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 42,
      mode: 'prompt',
      clientMessageId: 'client-msg-1',
      caller: { kind: 'external-cli' },
      block: true,
      queueIfBusy: false,
    }))
    expect(mocks.projectPublicInvocationResult).toHaveBeenCalledWith(harnessResult)
    expect(mocks.release).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ ok: true })
  })

  it('并发超限：acquire 抛 BridgeConcurrencyLimitError → 路由映射 429', async () => {
    mocks.validateBody.mockResolvedValue({ mode: 'prompt', clientMessageId: 'x', message: { content: [] } })
    mocks.acquire.mockImplementation(() => {
      throw new BridgeConcurrencyLimitError(1, 2)
    })
    const handler = (await import('nbook/server/api/agent/bridge/sessions/[sessionId]/invoke.post')).default
    const event = makeEvent()

    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 429,
      data: { code: 'BRIDGE_CONCURRENCY_LIMIT', perProjectLimit: 1, globalLimit: 2 },
    })
    expect(mocks.invokeAgent).not.toHaveBeenCalled()
  })

  it('session 未绑定 projectRoot → 409 BRIDGE_PROJECT_UNBOUND，不进 registry', async () => {
    mocks.validateBody.mockResolvedValue({ mode: 'prompt', clientMessageId: 'x', message: { content: [] } })
    mocks.getSessionRecovery.mockResolvedValue({ summary: { currentProjectRoot: undefined } })
    const handler = (await import('nbook/server/api/agent/bridge/sessions/[sessionId]/invoke.post')).default
    const event = makeEvent()

    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 409,
      data: { code: 'BRIDGE_PROJECT_UNBOUND' },
    })
    expect(mocks.acquire).not.toHaveBeenCalled()
  })

  it('invoke 抛错：finally 仍然 release', async () => {
    mocks.validateBody.mockResolvedValue({ mode: 'prompt', clientMessageId: 'x', message: { content: [] } })
    mocks.invokeAgent.mockRejectedValue(new Error('harness boom'))
    const handler = (await import('nbook/server/api/agent/bridge/sessions/[sessionId]/invoke.post')).default
    const event = makeEvent()

    await expect(handler(event)).rejects.toThrow('harness boom')
    expect(mocks.release).toHaveBeenCalledTimes(1)
  })

  it('caller 永远不来自客户端 body；invokeAgent 收到的 caller 总是 external-cli', async () => {
    // 即使有人尝试在 DTO 里塞 caller（schema 拒绝）也绝不会被透传
    mocks.validateBody.mockResolvedValue({ mode: 'prompt', clientMessageId: 'x', message: { content: [] } })
    mocks.invokeAgent.mockResolvedValue({ status: 'completed' })
    const handler = (await import('nbook/server/api/agent/bridge/sessions/[sessionId]/invoke.post')).default
    const event = makeEvent()
    await handler(event)

    const invokeArg = mocks.invokeAgent.mock.calls[0]?.[0] as { caller: { kind: string } }
    expect(invokeArg.caller.kind).toBe('external-cli')
  })
})
