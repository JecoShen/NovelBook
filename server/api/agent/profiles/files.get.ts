import { listProfileFiles } from 'nbook/server/agent/profiles/workbench-service'
import { profileWorkbenchRootsFromRuntime } from 'nbook/server/agent/profiles/profile-workbench-roots'

/**
 * 列出用户 profile root 下的源码文件，包含坏文件。
 */
export default defineEventHandler(async () => {
  return listProfileFiles(profileWorkbenchRootsFromRuntime())
})
