import { validateBody } from 'nbook/server/utils/novel-chapter'
import { useProfileCompileWorker } from 'nbook/server/agent/profiles/profile-compile-worker'
import { AgentProfileCompileAllRequestDtoSchema } from 'nbook/shared/dto/agent-profile.dto'
import { useAgentHarness } from 'nbook/server/agent/http'

/**
 * 手动编译全部用户 profile 源码。真实编译在后台 worker 中执行。
 */
export default defineEventHandler(async (event) => {
  const body = await validateBody(event, AgentProfileCompileAllRequestDtoSchema)
  const harness = useAgentHarness()
  return useProfileCompileWorker().compileAll(body, {
    mode: 'in_process',
    registry: harness.profiles,
  })
})
