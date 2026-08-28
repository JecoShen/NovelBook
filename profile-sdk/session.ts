import type { ProfileJsonValue } from 'nbook/profile-sdk/contracts'

/** Session custom state 中"标题所有权"键名。所有写入方应使用该常量以避免 typo。 */
export const SESSION_TITLE_OWNER_STATE_KEY = 'session.titleOwner'

/** 标题所有权状态值类型。`user` = 用户手动改过名（summarizer 应只更新 summary，不覆盖 title）；`auto` = 仍可由 summarizer 覆盖。 */
export type SessionTitleOwnerState = { owner: 'user' | 'auto' }

/**
 * 读取 session 的 titleOwner 字段。返回 `user` / `auto`。
 *
 * 设计说明：本函数内联实现以避免 `nbook/server/...` 依赖（该路径下 `messages/types.ts`
 * 会拉入 `@earendil-works/pi-agent-core` / `@earendil-works/pi-ai` 类型，违反
 * `assertDeclaredTypeDependencies` 白名单）。本实现保持与 server 端
 * `readTitleOwner` (`server/agent/session/custom-state-keys.ts:54`) 行为一致。
 */
export function readTitleOwner(customState: { [key: string]: ProfileJsonValue }): 'user' | 'auto' {
  const value = customState[SESSION_TITLE_OWNER_STATE_KEY]
  return typeof value === 'object' && value !== null && !Array.isArray(value) && (value as { owner?: unknown }).owner === 'user' ? 'user' : 'auto'
}
