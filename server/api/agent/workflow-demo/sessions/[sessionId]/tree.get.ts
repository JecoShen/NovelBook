import { createError, getRouterParam } from 'h3'
import { useWorkflowDemoService } from 'nbook/server/agent/workflow/workflow-demo-service'

/** Workflow demo：参与者 session 的真实树投影（直接读 JSONL 仓库） */
export default defineEventHandler(async (event) => {
  const raw = getRouterParam(event, 'sessionId')
  const sessionId = Number(raw)
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    throw createError({ statusCode: 400, message: 'sessionId 必须是正整数' })
  }
  try {
    return await useWorkflowDemoService().sessionTree(sessionId)
  }
  catch (error) {
    throw createError({ statusCode: 404, message: error instanceof Error ? error.message : String(error) })
  }
})
