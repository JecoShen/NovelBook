import {bridgeRequest} from "../util/http";

export interface StatusInput {
    sessionId: number;
    token: string;
    baseUrl: string;
    signal?: AbortSignal;
}

/**
 * 复用现有 `/api/agent/sessions/:id?view=recovery`。返回完整 session 状态。
 */
export async function statusCommand(input: StatusInput): Promise<unknown> {
    return bridgeRequest({
        method: "GET",
        path: `/api/agent/sessions/${input.sessionId}?view=recovery`,
        token: input.token,
        baseUrl: input.baseUrl,
        signal: input.signal,
    });
}
