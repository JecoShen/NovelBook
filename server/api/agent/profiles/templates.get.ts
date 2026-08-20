import { listProfileTemplates } from 'nbook/server/agent/profiles/workbench-service'
import { profileWorkbenchRootsFromRuntime } from 'nbook/server/agent/profiles/profile-workbench-roots'

/**
 * 列出 TSX Profile Workbench 可用的新建模板。
 */
export default defineEventHandler(async () => {
  return listProfileTemplates(profileWorkbenchRootsFromRuntime())
})
