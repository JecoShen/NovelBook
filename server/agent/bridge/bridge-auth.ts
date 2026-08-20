import { createError, getHeader, type H3Event } from 'h3'
import { PRODUCT_BRIDGE_TOKEN_ENVIRONMENT } from 'nbook/shared/product-runtime-contract'
import { isLoopbackRequest, matchesControlToken } from 'nbook/server/runtime/control/loopback-auth'

/**
 * Agent Bridge 控制面的 URL 前缀。Auth 中间件用此豁免用户 session 鉴权
 * （桥路由自己用 loopback + token 鉴权），路由文件用此构建路径。
 */
export const BRIDGE_API_PREFIX = '/api/agent/bridge'

/**
 * 鉴权 Agent Bridge 路由。
 *
 * 错误合同（与 AGENTS.md「报告与提问」一致，让调用方不读源码能区分）：
 * - 503 BRIDGE_DISABLED: `NEURO_BOOK_BRIDGE_TOKEN` 未设置，桥功能视为关闭
 * - 403 BRIDGE_NOT_LOOPBACK: 远端地址非 loopback
 * - 401 BRIDGE_INVALID_TOKEN: bearer token 缺失或与 env 不匹配
 *
 * token 缺失即默认关闭：调用方必须在启动时显式注入 token；这是与 shutdown 模式
 * 一致的「功能开关」语义。
 */
export function requireBridgeAuth(event: H3Event): void {
  if (!isLoopbackRequest(event.node.req.socket.remoteAddress)) {
    throw createError({ statusCode: 403, message: 'Agent Bridge 只接受 loopback 请求。' })
  }
  const expected = process.env[PRODUCT_BRIDGE_TOKEN_ENVIRONMENT]?.trim()
  if (!expected) {
    throw createError({
      statusCode: 503,
      message: 'Agent Bridge 控制面未启用。',
      data: { code: 'BRIDGE_DISABLED' },
    })
  }
  if (!matchesControlToken(getHeader(event, 'authorization'), expected)) {
    throw createError({
      statusCode: 401,
      message: 'Agent Bridge token 无效。',
      data: { code: 'BRIDGE_INVALID_TOKEN' },
    })
  }
}
