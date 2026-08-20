import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('POST /api/agent/profiles/compile', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  })

  it('preview 触发 Project lifecycle error 时返回稳定 PROJECT_NOT_OPEN', async () => {
    vi.doMock('nbook/server/utils/novel-chapter', () => ({
      validateBody: vi.fn(async () => ({
        fileName: 'builtin/writer.profile.tsx',
        dryRun: false,
        preview: true,
        sessionId: '7',
      })),
    }))
    vi.doMock('nbook/server/agent/http', () => ({
      useAgentHarness: vi.fn(() => ({ profiles: {} })),
    }))
    vi.doMock('nbook/server/agent/profiles/profile-compile-worker', () => ({
      useProfileCompileWorker: vi.fn(() => ({
        compile: vi.fn(async () => ({
          ok: true,
          stale: false,
          detail: null,
          preview: null,
          issues: [],
        })),
      })),
    }))
    vi.doMock('nbook/server/agent/profiles/workbench-service', () => ({
      readProfileSource: vi.fn(async () => ({
        manifest: { key: 'writer' },
      })),
    }))
    vi.doMock('nbook/server/agent/profiles/profile-http-service', async () => {
      const { ProjectNotOpenError } = await import('nbook/server/workspace-files/project-session-service')
      return {
        previewAgentProfilePrepare: vi.fn(async () => {
          throw new ProjectNotOpenError('profile-compile-not-open')
        }),
      }
    })

    const handler = (await import('nbook/server/api/agent/profiles/compile.post')).default

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 409,
      data: {
        code: 'PROJECT_NOT_OPEN',
        projectRoot: 'profile-compile-not-open',
      },
    })
  })
})
