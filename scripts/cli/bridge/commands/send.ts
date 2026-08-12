import {randomUUID} from "node:crypto";
import {bridgeRequest} from "../util/http";

export interface SendInput {
    sessionId: number;
    message: string;
    followup?: boolean;
    title?: string;
    token: string;
    baseUrl: string;
    signal?: AbortSignal;
}

export interface InvokeResult {
    status: "completed" | "waiting" | "error";
    finalMessage?: unknown;
    reportResult?: {result: unknown; data: unknown} | unknown;
    error?: {message: string; phase?: string};
    aborted?: boolean;
    elapsedMs?: number;
}

/**
 * 阻塞式 invoke。自动生成 clientMessageId（prompt/followup 模式必传）。
 *
 * 桥 DTO 不允许 caller 字段——caller 由服务端强制为 external-cli。CLI 不传 caller。
 */
export async function sendCommand(input: SendInput): Promise<InvokeResult> {
    const mode = input.followup ? "followup" : "prompt";
    const body = {
        mode,
        clientMessageId: randomUUID(),
        message: {content: [{type: "text", text: input.message}]},
        ...(input.title ? {title: input.title} : {}),
    };
    return bridgeRequest<InvokeResult>({
        method: "POST",
        path: `/api/agent/bridge/sessions/${input.sessionId}/invoke`,
        body,
        token: input.token,
        baseUrl: input.baseUrl,
        signal: input.signal,
    });
}
