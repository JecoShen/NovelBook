import { readTitleOwner as readTitleOwnerHost, SESSION_TITLE_OWNER_STATE_KEY as sessionTitleOwnerStateKeyHost, type SessionTitleOwnerState as SessionTitleOwnerStateHost } from 'nbook/server/agent/session/custom-state-keys'

/** Session custom state 中"标题所有权"键名。所有写入方应使用该常量以避免 typo。 */
export const SESSION_TITLE_OWNER_STATE_KEY: string = sessionTitleOwnerStateKeyHost

/** 标题所有权状态值类型。`user` = 用户手动改过名（summarizer 应只更新 summary，不覆盖 title）；`auto` = 仍可由 summarizer 覆盖。 */
export type SessionTitleOwnerState = SessionTitleOwnerStateHost

/** 读取 session 的 titleOwner 字段。返回 `user` / `auto` / 缺省 `auto`。 */
export function readTitleOwner(customState: { [key: string]: unknown }): 'user' | 'auto' {
  return readTitleOwnerHost(customState as Parameters<typeof readTitleOwnerHost>[0])
}
