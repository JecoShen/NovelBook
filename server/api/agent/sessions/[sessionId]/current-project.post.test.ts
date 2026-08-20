import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createError } from 'h3'
import { ProjectLifecycleError } from 'nbook/server/workspace-files/project-lifecycle'

const mocks = vi.hoisted(() => ({
  requireAgentSessionId: vi.fn(() => 12),
  updateAgentSessionCurrentProject: vi.fn(),
  validateBody: vi.fn(),
}))

vi.mock('nbook/server/agent/http', () => ({
  requireAgentSessionId: mocks.requireAgentSessionId,
  updateAgentSessionCurrentProject: mocks.updateAgentSessionCurrentProject,
}))

vi.mock('nbook/server/utils/novel-chapter', () => ({
  validateBody: mocks.validateBody,
}))

describe('POST /api/agent/sessions/:sessionId/current-project', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  })

  it('把 Picker 选择的 Project 交给 Session recovery 重绑', async () => {
    mocks.validateBody.mockResolvedValue({ projectRoot: 'novel-a' })
    mocks.updateAgentSessionCurrentProject.mockResolvedValue({
      sessionId: 12,
      currentProjectRoot: 'novel-a',
    })
    const handler = (await import('nbook/server/api/agent/sessions/[sessionId]/current-project.post')).default

    await expect(handler({} as never)).resolves.toMatchObject({
      sessionId: 12,
      currentProjectRoot: 'novel-a',
    })
    expect(mocks.updateAgentSessionCurrentProject).toHaveBeenCalledWith(12, { projectRoot: 'novel-a' })
  })

  it('通过统一 Project HTTP mapper 返回不存在 Project 的稳定 404', async () => {
    mocks.validateBody.mockResolvedValue({ projectRoot: 'missing-project' })
    mocks.updateAgentSessionCurrentProject.mockRejectedValue(new ProjectLifecycleError(
      'PROJECT_NOT_FOUND',
      'C:\\private\\workspace\\missing-project 不存在',
    ))
    const handler = (await import('nbook/server/api/agent/sessions/[sessionId]/current-project.post')).default

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 404,
      data: { code: 'PROJECT_NOT_FOUND' },
    })
  })

  it('保留 Session HTTP helper 已映射的运行中禁止重绑合同', async () => {
    mocks.validateBody.mockResolvedValue({ projectRoot: 'novel-a' })
    mocks.updateAgentSessionCurrentProject.mockRejectedValue(createError({
      statusCode: 409,
      message: '运行中或等待中的 Session 不能重新绑定 Current Project。',
      data: { code: 'current_project_rebind_forbidden', projectRoot: 'novel-a' },
    }))
    const handler = (await import('nbook/server/api/agent/sessions/[sessionId]/current-project.post')).default

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 409,
      data: { code: 'current_project_rebind_forbidden', projectRoot: 'novel-a' },
    })
  })
})
