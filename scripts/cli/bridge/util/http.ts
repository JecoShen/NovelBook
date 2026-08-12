/**
 * Bridge CLI 共享的 HTTP 客户端。
 *
 * 故意只依赖 `fetch`（Node 18+ / Bun 内置），不引入第三方 HTTP 库；
 * 命令体本身 thin，错误以非零退出码 + stderr 文本形式透传给 caller。
 */

export interface BridgeRequestInput {
    method: "GET" | "POST";
    path: string;
    body?: unknown;
    token: string;
    baseUrl: string;
    /** AbortSignal for read timeout. CLI 默认 10 分钟。 */
    signal?: AbortSignal;
}

/** 非 2xx 响应：状态码 + 响应正文，便于 caller 直接显示给用户。 */
export class BridgeHttpError extends Error {
    readonly statusCode: number;
    readonly statusText: string;
    readonly responseBody: string;
    constructor(statusCode: number, statusText: string, responseBody: string) {
        super(`Bridge ${statusCode} ${statusText}\n${responseBody}`);
        this.name = "BridgeHttpError";
        this.statusCode = statusCode;
        this.statusText = statusText;
        this.responseBody = responseBody;
    }
}

export async function bridgeRequest<T>(input: BridgeRequestInput): Promise<T> {
    const url = new URL(input.path, input.baseUrl);
    const headers: Record<string, string> = {
        "Authorization": `Bearer ${input.token}`,
    };
    if (input.body !== undefined) {
        headers["Content-Type"] = "application/json";
    }
    const init: RequestInit = {
        method: input.method,
        headers,
    };
    if (input.body !== undefined) {
        init.body = JSON.stringify(input.body);
    }
    if (input.signal) {
        init.signal = input.signal;
    }
    const response = await fetch(url, init);
    if (!response.ok) {
        const text = await response.text();
        throw new BridgeHttpError(response.status, response.statusText, text);
    }
    // 204 No Content 时不尝试 JSON.parse
    if (response.status === 204) {
        return undefined as T;
    }
    return await response.json() as T;
}
