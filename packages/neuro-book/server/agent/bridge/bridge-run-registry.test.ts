import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  BridgeConcurrencyLimitError,
  BridgeRunRegistry,
  resetBridgeRunRegistryForTests,
} from 'nbook/server/agent/bridge/bridge-run-registry'

describe('BridgeRunRegistry', () => {
  let registry: BridgeRunRegistry

  beforeEach(() => {
    registry = new BridgeRunRegistry()
    resetBridgeRunRegistryForTests()
  })

  afterEach(() => {
    resetBridgeRunRegistryForTests()
  })

  it('acquire 后 activeCount 加一，release 后归零', () => {
    const release = registry.acquire('novel-a', 1)
    expect(registry.activeCount()).toBe(1)
    release()
    expect(registry.activeCount()).toBe(0)
  })

  it('同 project 二次 acquire 抛 BridgeConcurrencyLimitError（per-project cap=1）', () => {
    const releaseA = registry.acquire('novel-a', 1)
    expect(() => registry.acquire('novel-a', 2)).toThrow(BridgeConcurrencyLimitError)
    releaseA()
  })

  it('不同 project 可以并行占槽；达到 global cap 后再 acquire 抛错', () => {
    const releaseA = registry.acquire('novel-a', 1)
    const releaseB = registry.acquire('novel-b', 2)
    expect(registry.activeCount()).toBe(2)
    // 第三个不同 project 仍然命中 global cap=2
    expect(() => registry.acquire('novel-c', 3)).toThrow(BridgeConcurrencyLimitError)
    releaseA()
    releaseB()
  })

  it('release 幂等：多次调用只释放一次', () => {
    const release = registry.acquire('novel-a', 1)
    release()
    release()
    release()
    expect(registry.activeCount()).toBe(0)
  })

  it('release 只释放自己的 sessionId 槽位；不误释放后续 acquire', () => {
    const releaseA = registry.acquire('novel-a', 1)
    releaseA()
    const releaseB = registry.acquire('novel-a', 2)
    expect(registry.isProjectActive('novel-a')).toBe(true)
    // 即便 releaseA 又被调用一次，也不能把 releaseB 的槽位清掉
    releaseA()
    expect(registry.isProjectActive('novel-a')).toBe(true)
    releaseB()
    expect(registry.isProjectActive('novel-a')).toBe(false)
  })

  it('isProjectActive 反映 acquire/release 状态', () => {
    expect(registry.isProjectActive('novel-a')).toBe(false)
    const release = registry.acquire('novel-a', 1)
    expect(registry.isProjectActive('novel-a')).toBe(true)
    release()
    expect(registry.isProjectActive('novel-a')).toBe(false)
  })

  it('useBridgeRunRegistry 返回 process 级单例', async () => {
    const { useBridgeRunRegistry } = await import('nbook/server/agent/bridge/bridge-run-registry')
    const a = useBridgeRunRegistry()
    const b = useBridgeRunRegistry()
    expect(a).toBe(b)
  })
})
