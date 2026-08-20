import { validateBody } from 'nbook/server/utils/novel-chapter'
import { useProfileCompileWorker } from 'nbook/server/agent/profiles/profile-compile-worker'
import { AgentProfileCompileRequestDtoSchema } from 'nbook/shared/dto/agent-profile.dto'
import { useAgentHarness } from 'nbook/server/agent/http'
import { previewAgentProfilePrepare } from 'nbook/server/agent/profiles/profile-http-service'
import { readProfileSource } from 'nbook/server/agent/profiles/workbench-service'
import { withProjectHttpError } from 'nbook/server/api/projects/project-http-error'
import { profileWorkbenchRootsFromRuntime } from 'nbook/server/agent/profiles/profile-workbench-roots'

/**
 * 手动编译用户 profile 源码。真实 TSX loader 在后台 worker 中执行。
 */
export default defineEventHandler(event => withProjectHttpError(async () => {
  const body = await validateBody(event, AgentProfileCompileRequestDtoSchema)
  const harness = useAgentHarness()
  const result = await useProfileCompileWorker().compile(body, {
    mode: 'in_process',
    registry: harness.profiles,
  })
  const detail = await readProfileSource(harness.profiles, { fileName: body.fileName }, profileWorkbenchRootsFromRuntime(harness.runtimePaths)).catch(() => result.detail)
  const preview = body.preview && detail?.manifest?.key
    ? await previewAgentProfilePrepare(harness, {
        profileKey: detail.manifest.key,
        sessionId: body.sessionId,
        initial: body.initial,
        initialOverrides: body.initialOverrides,
      })
    : result.preview ?? null
  return {
    ...result,
    ok: result.ok && (!preview || preview.ok),
    detail,
    preview,
    issues: preview ? [...result.issues, ...preview.issues] : result.issues,
  }
}))
