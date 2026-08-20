import { createError, readBody } from 'h3'
import { useWorkflowDemoService } from 'nbook/server/agent/workflow/workflow-demo-service'

/** Workflow demo：RP 轮间用户直聊（写入真实 session 主线，origin=manual） */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ sessionId?: number, message?: string }>(event)
  if (!Number.isInteger(body?.sessionId) || !body?.message) {
    throw createError({ statusCode: 400, message: 'sessionId 与 message 必填' })
  }
  try {
    return await useWorkflowDemoService().directChat(body.sessionId as number, body.message)
  }
  catch (error) {
    throw createError({ statusCode: 400, message: error instanceof Error ? error.message : String(error) })
  }
})
