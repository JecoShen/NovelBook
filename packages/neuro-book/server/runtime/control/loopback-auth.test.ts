import { afterEach, describe, expect, it } from 'vitest'
import { isLoopbackAddress, isLoopbackRequest, matchesControlToken } from 'nbook/server/runtime/control/loopback-auth'

describe('isLoopbackAddress', () => {
  it('接受 IPv4 127.0.0.1', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true)
  })

  it('接受 IPv6 ::1', () => {
    expect(isLoopbackAddress('::1')).toBe(true)
  })

  it('接受 IPv4-mapped IPv6 ::ffff:127.0.0.1', () => {
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true)
  })

  it('拒绝公网地址', () => {
    expect(isLoopbackAddress('8.8.8.8')).toBe(false)
    expect(isLoopbackAddress('2001:db8::1')).toBe(false)
  })

  it('接受 undefined（让调用方走 fallback）', () => {
    expect(isLoopbackAddress(undefined)).toBe(false)
  })
})

describe('isLoopbackRequest', () => {
  const originalNitroHost = process.env.NITRO_HOST
  const originalHost = process.env.HOST

  afterEach(() => {
    if (originalNitroHost === undefined) {
      delete process.env.NITRO_HOST
    }
    else {
      process.env.NITRO_HOST = originalNitroHost
    }
    if (originalHost === undefined) {
      delete process.env.HOST
    }
    else {
      process.env.HOST = originalHost
    }
  })

  it('已知 loopback 地址直接放行，不读 env', () => {
    process.env.NITRO_HOST = '0.0.0.0'
    expect(isLoopbackRequest('127.0.0.1')).toBe(true)
  })

  it('已知非 loopback 直接拒绝', () => {
    process.env.NITRO_HOST = '127.0.0.1'
    expect(isLoopbackRequest('8.8.8.8')).toBe(false)
  })

  it('undefined + NITRO_HOST=127.0.0.1 → fallback 放行', () => {
    process.env.NITRO_HOST = '127.0.0.1'
    delete process.env.HOST
    expect(isLoopbackRequest(undefined)).toBe(true)
  })

  it('undefined + HOST=localhost → fallback 放行', () => {
    delete process.env.NITRO_HOST
    process.env.HOST = 'localhost'
    expect(isLoopbackRequest(undefined)).toBe(true)
  })

  it('undefined + NITRO_HOST=0.0.0.0 → fallback 拒绝（不能被公网访问）', () => {
    process.env.NITRO_HOST = '0.0.0.0'
    delete process.env.HOST
    expect(isLoopbackRequest(undefined)).toBe(false)
  })

  it('undefined + 无 env 配置 → 拒绝（保守默认）', () => {
    delete process.env.NITRO_HOST
    delete process.env.HOST
    expect(isLoopbackRequest(undefined)).toBe(false)
  })
})

describe('matchesControlToken', () => {
  const expected = 'test-token-abc'

  it('接受正确 Bearer token', () => {
    expect(matchesControlToken(`Bearer ${expected}`, expected)).toBe(true)
  })

  it('接受带大小写混合 scheme 的 Bearer', () => {
    expect(matchesControlToken(`bearer ${expected}`, expected)).toBe(true)
    expect(matchesControlToken(`BEARER ${expected}`, expected)).toBe(true)
  })

  it('拒绝错误 token（即使长度相同）', () => {
    expect(matchesControlToken('Bearer wrong-token', expected)).toBe(false)
  })

  it('拒绝长度不同的 token（timingSafeEqual 前置检查）', () => {
    expect(matchesControlToken('Bearer short', expected)).toBe(false)
  })

  it('拒绝缺失 Authorization 头', () => {
    expect(matchesControlToken(undefined, expected)).toBe(false)
  })

  it('拒绝空字符串头', () => {
    expect(matchesControlToken('', expected)).toBe(false)
  })

  it('拒绝非 Bearer scheme', () => {
    expect(matchesControlToken(`Basic ${expected}`, expected)).toBe(false)
  })

  it('拒绝多段 token', () => {
    expect(matchesControlToken(`Bearer ${expected} extra`, expected)).toBe(false)
  })
})
