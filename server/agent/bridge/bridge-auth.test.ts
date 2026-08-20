import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'
import { PRODUCT_BRIDGE_TOKEN_ENVIRONMENT } from 'nbook/shared/product-runtime-contract'

const mocks = vi.hoisted(() => ({
  isLoopbackRequest: vi.fn(),
  matchesControlToken: vi.fn(),
}))

vi.mock('nbook/server/runtime/control/loopback-auth', () => ({
  isLoopbackRequest: mocks.isLoopbackRequest,
  matchesControlToken: mocks.matchesControlToken,
}))

const validToken = 'test-bridge-token-xyz'
const event = { node: { req: { socket: { remoteAddress: '127.0.0.1' } } } } as never

async function loadRequireBridgeAuth(): Promise<(event: H3Event) => void> {
  const mod = await import('nbook/server/agent/bridge/bridge-auth')
  return mod.requireBridgeAuth
}

describe('requireBridgeAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isLoopbackRequest.mockReturnValue(true)
    mocks.matchesControlToken.mockReturnValue(true)
  })

  afterEach(() => {
    delete process.env[PRODUCT_BRIDGE_TOKEN_ENVIRONMENT]
  })

  it('loopback + 正确 token → 静默通过', async () => {
    process.env[PRODUCT_BRIDGE_TOKEN_ENVIRONMENT] = validToken
    const requireBridgeAuth = await loadRequireBridgeAuth()
    expect(() => requireBridgeAuth(event)).not.toThrow()
    expect(mocks.matchesControlToken).toHaveBeenCalledWith(undefined, validToken)
  })

  it('非 loopback → 403 BRIDGE_NOT_LOOPBACK', async () => {
    process.env[PRODUCT_BRIDGE_TOKEN_ENVIRONMENT] = validToken
    mocks.isLoopbackRequest.mockReturnValue(false)
    const requireBridgeAuth = await loadRequireBridgeAuth()
    await expect((async () => requireBridgeAuth(event))()).rejects.toMatchObject({ statusCode: 403 })
  })

  it('env 未设 → 503 BRIDGE_DISABLED（默认关闭）', async () => {
    delete process.env[PRODUCT_BRIDGE_TOKEN_ENVIRONMENT]
    const requireBridgeAuth = await loadRequireBridgeAuth()
    await expect((async () => requireBridgeAuth(event))()).rejects.toMatchObject({
      statusCode: 503,
      data: { code: 'BRIDGE_DISABLED' },
    })
    expect(mocks.matchesControlToken).not.toHaveBeenCalled()
  })

  it('env 设空字符串视同未设（trim 后空）→ 503', async () => {
    process.env[PRODUCT_BRIDGE_TOKEN_ENVIRONMENT] = '   '
    const requireBridgeAuth = await loadRequireBridgeAuth()
    await expect((async () => requireBridgeAuth(event))()).rejects.toMatchObject({
      statusCode: 503,
      data: { code: 'BRIDGE_DISABLED' },
    })
  })

  it('token 错误 → 401 BRIDGE_INVALID_TOKEN', async () => {
    process.env[PRODUCT_BRIDGE_TOKEN_ENVIRONMENT] = validToken
    mocks.matchesControlToken.mockReturnValue(false)
    const requireBridgeAuth = await loadRequireBridgeAuth()
    await expect((async () => requireBridgeAuth(event))()).rejects.toMatchObject({
      statusCode: 401,
      data: { code: 'BRIDGE_INVALID_TOKEN' },
    })
  })

  it('env trim 后再比较，匹配调用方期望的 trim 后值', async () => {
    process.env[PRODUCT_BRIDGE_TOKEN_ENVIRONMENT] = `  ${validToken}  `
    const requireBridgeAuth = await loadRequireBridgeAuth()
    expect(() => requireBridgeAuth(event)).not.toThrow()
    expect(mocks.matchesControlToken).toHaveBeenCalledWith(undefined, validToken)
  })

  it('远端检查在 token 检查之前（防 token 暴露给攻击者）', async () => {
    process.env[PRODUCT_BRIDGE_TOKEN_ENVIRONMENT] = validToken
    mocks.isLoopbackRequest.mockReturnValue(false)
    const requireBridgeAuth = await loadRequireBridgeAuth()
    await expect((async () => requireBridgeAuth(event))()).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.matchesControlToken).not.toHaveBeenCalled()
  })
})

describe('BRIDGE_API_PREFIX', () => {
  it('等于 /api/agent/bridge', async () => {
    const mod = await import('nbook/server/agent/bridge/bridge-auth')
    expect(mod.BRIDGE_API_PREFIX).toBe('/api/agent/bridge')
  })
})
