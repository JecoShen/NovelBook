import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('POST /api/agent/profiles/preview-prepare', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  })

  it('sourceOverride worker preview 触发 Project lifecycle error 时返回稳定 PROJECT_NOT_OPEN', async () => {
    vi.doMock('nbook/server/utils/novel-chapter', () => ({
      validateBody: vi.fn(async () => ({
        profileKey: 'writer',
        sessionId: '7',
        sourceOverride: {
          fileName: 'builtin/writer.profile.tsx',
          source: 'export default {};',
        },
      })),
    }))
    vi.doMock('nbook/server/agent/http', () => ({
      useAgentHarness: vi.fn(() => ({ profiles: {} })),
    }))
    vi.doMock('nbook/server/agent/profiles/profile-http-service', () => ({
      previewAgentProfilePrepare: vi.fn(),
    }))
    vi.doMock('nbook/server/agent/profiles/profile-compile-worker', async () => {
      const { ProjectNotOpenError } = await import('nbook/server/workspace-files/project-session-service')
      return {
        useProfileCompileWorker: vi.fn(() => ({
          compile: vi.fn(async () => {
            throw new ProjectNotOpenError('profile-preview-not-open')
          }),
        })),
      }
    })

    const handler = (await import('nbook/server/api/agent/profiles/preview-prepare.post')).default

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 409,
      data: {
        code: 'PROJECT_NOT_OPEN',
        projectRoot: 'profile-preview-not-open',
      },
    })
  })
})
