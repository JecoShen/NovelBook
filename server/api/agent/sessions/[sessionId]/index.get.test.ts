import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('GET /api/agent/sessions/:sessionId', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  })

  it('Project 未 open 时返回稳定 PROJECT_NOT_OPEN', async () => {
    const projectRoot = 'session-route-not-open'
    const { ProjectNotOpenError } = await import('nbook/server/workspace-files/project-session-service')
    vi.doMock('h3', async importOriginal => ({
      ...(await importOriginal<typeof import('h3')>()),
      getQuery: vi.fn(() => ({})),
    }))
    vi.doMock('nbook/server/agent/http', () => ({
      requireAgentSessionId: vi.fn(() => 12),
      getAgentSessionQuery: vi.fn(async () => {
        throw new ProjectNotOpenError(projectRoot)
      }),
    }))
    vi.doMock('nbook/server/utils/server-timing', () => ({
      createServerTiming: vi.fn(() => ({
        mark: vi.fn(),
      })),
    }))

    const handler = (await import('nbook/server/api/agent/sessions/[sessionId]/index.get')).default

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 409,
      data: {
        code: 'PROJECT_NOT_OPEN',
        projectRoot,
      },
    })
  })

  it('把严格判别 query 交给统一 session query Interface', async () => {
    const getAgentSessionQuery = vi.fn(async () => ({
      kind: 'history',
      sessionId: 12,
      activePathRevision: null,
      history: { entries: [], previousCursor: null },
    }))
    vi.doMock('h3', async importOriginal => ({
      ...(await importOriginal<typeof import('h3')>()),
      getQuery: vi.fn(() => ({ view: 'history', cursor: 'cursor-1' })),
    }))
    vi.doMock('nbook/server/agent/http', () => ({
      requireAgentSessionId: vi.fn(() => 12),
      getAgentSessionQuery,
    }))
    vi.doMock('nbook/server/utils/server-timing', () => ({
      createServerTiming: vi.fn(() => ({ mark: vi.fn() })),
    }))

    const handler = (await import('nbook/server/api/agent/sessions/[sessionId]/index.get')).default
    await expect(handler({} as never)).resolves.toEqual(expect.objectContaining({ kind: 'history' }))
    expect(getAgentSessionQuery).toHaveBeenCalledWith(12, {
      view: 'history',
      cursor: 'cursor-1',
    }, undefined, expect.anything())
  })

  it('拒绝跨 view 的非法 query 组合', async () => {
    vi.doMock('h3', async importOriginal => ({
      ...(await importOriginal<typeof import('h3')>()),
      getQuery: vi.fn(() => ({ view: 'systemPrompt', cursor: 'cursor-1' })),
    }))
    vi.doMock('nbook/server/agent/http', () => ({
      requireAgentSessionId: vi.fn(() => 12),
      getAgentSessionQuery: vi.fn(),
    }))
    vi.doMock('nbook/server/utils/server-timing', () => ({
      createServerTiming: vi.fn(() => ({ mark: vi.fn() })),
    }))

    const handler = (await import('nbook/server/api/agent/sessions/[sessionId]/index.get')).default
    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 400,
      data: { code: 'INVALID_SESSION_QUERY' },
    })
  })
})
