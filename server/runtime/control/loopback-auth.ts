import {timingSafeEqual} from "node:crypto";

/**
 * 控制面（shutdown / agent-bridge）共用的 loopback 判定 + token 比对。
 *
 * 所有从该文件 export 的 helper 必须保持纯函数；任何依赖运行时状态、env
 * 或进程生命周期的副作用都应留在调用方（例如 shutdown / bridge 各自的 handler）。
 *
 * 原 shutdown 路径的实现是这套逻辑的唯一起点；保持行为兼容是硬要求。
 */

/** 判断单个远端地址是否为 loopback（IPv4 / IPv6，含 IPv4-mapped IPv6）。 */
export function isLoopbackAddress(address: string | undefined): boolean {
    return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

/**
 * Nuxt dev 的 Node adapter 可能不暴露 socket.remoteAddress。
 * 只有进程明确绑定 loopback 时才能使用该 fallback；0.0.0.0、:: 或缺省监听仍拒绝。
 */
export function isLoopbackRequest(address: string | undefined): boolean {
    if (isLoopbackAddress(address)) return true;
    if (address !== undefined) return false;
    const configuredHost = (process.env.NITRO_HOST?.trim() || process.env.HOST?.trim() || "")
        .toLowerCase()
        .replace(/^\[|\]$/gu, "");
    return configuredHost === "127.0.0.1" || configuredHost === "localhost" || configuredHost === "::1";
}

/**
 * 解析 `Authorization: Bearer <token>` 头并以恒定时间与期望 token 比对。
 *
 * 比对失败、缺失或长度不匹配一律返回 false；调用方根据该布尔决定是否放行。
 */
export function matchesControlToken(authorization: string | undefined, expectedToken: string): boolean {
    if (!authorization) return false;
    const parts = authorization.trim().split(/\s+/u);
    if (parts.length !== 2 || parts[0]?.toLowerCase() !== "bearer") return false;
    const actual = Buffer.from(parts[1] ?? "", "utf8");
    const expected = Buffer.from(expectedToken, "utf8");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}
