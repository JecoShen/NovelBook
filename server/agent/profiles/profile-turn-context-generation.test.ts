import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadyProjectSessionRef } from 'nbook/server/workspace-files/project-session-contract'

const mocks = vi.hoisted(() => ({
  requireReadyModuleHandle: vi.fn(),
  readUnseenForAgent: vi.fn(async () => [] as Array<{
    path: string
    baseHash: string | null
    endHash: string | null
    maxEntryId: number
    entries: Array<{
      actor: { kind: 'user', userId: string }
      operation: { type: 'file.create' }
    }>
  }>),
  advanceAgentCursor: vi.fn(async () => undefined),
}))

vi.mock('nbook/server/workspace-files/project-session-data-plane', () => ({
  requireReadyModuleHandle: mocks.requireReadyModuleHandle,
}))

vi.mock('nbook/server/workspace-history/project-history-contract', () => ({
  PROJECT_HISTORY_MODULE_TOKEN: { name: 'history', kind: 'required' },
}))

vi.mock('nbook/server/workspace-history/project-history-data-plane', () => ({
  readUnseenForAgent: mocks.readUnseenForAgent,
  advanceAgentCursor: mocks.advanceAgentCursor,
}))

describe('Profile turn context generation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('只查询 invocation 捕获的 ready generation，不在 close/reopen 后改查新 generation', async () => {
    const oldReady = { generation: 1 } as ReadyProjectSessionRef
    const newReady = { generation: 2 } as ReadyProjectSessionRef
    const oldHistory = { generation: 1 }
    const newHistory = { generation: 2 }
    let current = oldReady
    mocks.requireReadyModuleHandle.mockImplementation((ready: ReadyProjectSessionRef) => (
      ready === oldReady ? oldHistory : newHistory
    ))
    const { materializeProfileTurnContexts } = await import('nbook/server/agent/profiles/profile-turn-context')
    const captured = current
    current = newReady

    await materializeProfileTurnContexts({
      plans: [{ kind: 'file-change-notice', mode: 'minimal', appendingIndex: 0 }],
      project: captured,
      sessionId: 7,
      diffMaxChars: 512,
    })

    expect(current).toBe(newReady)
    expect(mocks.requireReadyModuleHandle).toHaveBeenCalledOnce()
    expect(mocks.requireReadyModuleHandle).toHaveBeenCalledWith(oldReady, expect.objectContaining({ name: 'history' }))
    expect(mocks.readUnseenForAgent).toHaveBeenCalledWith(oldHistory, 7)
    expect(mocks.readUnseenForAgent).not.toHaveBeenCalledWith(newHistory, 7)
  })

  it('通过 data-plane ports materialize 并在交付后结算游标', async () => {
    const ready = { generation: 1 } as ReadyProjectSessionRef
    const history = {
      generation: 1,
      history: Promise.resolve(null),
      waitForWarmup: vi.fn(async () => undefined),
    }
    const unseen = [{
      path: 'manuscript/ch1.md',
      baseHash: null,
      endHash: 'hash-after',
      maxEntryId: 42,
      entries: [{
        actor: { kind: 'user', userId: 'local' },
        operation: { type: 'file.create' },
      }],
    }]
    mocks.requireReadyModuleHandle.mockReturnValue(history)
    mocks.readUnseenForAgent.mockResolvedValue(unseen)
    const {
      materializeProfileTurnContexts,
      settleProfileTurnContexts,
    } = await import('nbook/server/agent/profiles/profile-turn-context')

    const result = await materializeProfileTurnContexts({
      plans: [{ kind: 'file-change-notice', mode: 'minimal', appendingIndex: 0 }],
      project: ready,
      sessionId: 7,
      diffMaxChars: 512,
    })
    await settleProfileTurnContexts(result.settlements)

    expect(result.insertions).toHaveLength(1)
    expect(result.settlements).toHaveLength(1)
    expect(mocks.requireReadyModuleHandle).toHaveBeenCalledWith(ready, expect.objectContaining({ name: 'history' }))
    expect(mocks.readUnseenForAgent).toHaveBeenCalledWith(history, 7)
    expect(mocks.advanceAgentCursor).toHaveBeenCalledWith(history, 7, 42)
  })
})
