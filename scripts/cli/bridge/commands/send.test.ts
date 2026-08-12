import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {randomUUID} from "node:crypto";
import {sendCommand, type SendInput} from "nbook/scripts/cli/bridge/commands/send";
import {BridgeHttpError} from "nbook/scripts/cli/bridge/util/http";

/**
 * Regression guard for the bridge `send` CLI request body shape.
 *
 * The DTO `AgentUserMessageInputDtoSchema` (`shared/dto/agent-session.dto.ts`) is
 * `z.object({text: z.string()}).strict()`. The CLI historically sent Anthropic-style
 * `message: {content: [{type: "text", text}]}`, which 400s on the server as
 * `Invalid input: expected string, received undefined` because the strict zod
 * object has no `text` field.
 *
 * The server-side `invoke.post.test.ts` covers the happy path but mocks harness
 * directly, so it never observes the wire body the CLI sends. This test pins the
 * CLI-side contract by capturing the body the CLI writes to `fetch` and asserting
 * the shape the server expects.
 */

interface CapturedRequest {
    url: string;
    method: string;
    body: unknown;
    headers: Record<string, string>;
}

const fetchMock = vi.fn<typeof fetch>();

function readJsonBody(init: RequestInit | undefined): unknown {
    const raw = init?.body;
    if (typeof raw !== "string") {
        throw new Error("expected fetch body to be a JSON string");
    }
    return JSON.parse(raw) as unknown;
}

function captureFetchRequest(): CapturedRequest {
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
        headers[k.toLowerCase()] = v;
    }
    return {
        url: String(url),
        method: (init?.method ?? "GET").toString(),
        body: readJsonBody(init),
        headers,
    };
}

function makeInput(overrides: Partial<SendInput> = {}): SendInput {
    return {
        sessionId: 42,
        message: "hello leader",
        token: "test-bridge-token",
        baseUrl: "http://127.0.0.1:3010",
        ...overrides,
    };
}

beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("sendCommand request body", () => {
    it("sends message as {text: string} matching AgentUserMessageInputDtoSchema", async () => {
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({status: "completed", finalMessage: "ok"}), {
            status: 200,
            headers: {"Content-Type": "application/json"},
        }));

        await sendCommand(makeInput({message: "用一句话介绍你自己"}));

        const sent = captureFetchRequest();
        expect(sent.method).toBe("POST");
        expect(sent.url).toBe("http://127.0.0.1:3010/api/agent/bridge/sessions/42/invoke");
        expect(sent.headers["authorization"]).toBe("Bearer test-bridge-token");
        expect(sent.headers["content-type"]).toBe("application/json");

        const body = sent.body as Record<string, unknown>;
        expect(body).toMatchObject({
            mode: "prompt",
            message: {text: "用一句话介绍你自己"},
        });
        // 必须不存在旧的 Anthropic 风格 content 数组——DTO strict() 会拒它
        const message = body.message as Record<string, unknown>;
        expect(message).not.toHaveProperty("content");
    });

    it("generates a UUID-shaped clientMessageId and pins mode=prompt by default", async () => {
        fetchMock.mockResolvedValueOnce(new Response("{}", {status: 200}));

        await sendCommand(makeInput());

        const body = (captureFetchRequest().body) as Record<string, unknown>;
        expect(body.mode).toBe("prompt");
        expect(typeof body.clientMessageId).toBe("string");
        expect(body.clientMessageId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
        // 验证就是有效的 UUID v4
        const parsed = randomUUID.call(null);
        expect(parsed).toMatch(/^[0-9a-f-]+$/u);
    });

    it("switches to mode=followup when followup=true", async () => {
        fetchMock.mockResolvedValueOnce(new Response("{}", {status: 200}));

        await sendCommand(makeInput({followup: true, message: "继续"}));

        const body = (captureFetchRequest().body) as Record<string, unknown>;
        expect(body.mode).toBe("followup");
    });

    it("forwards title when supplied, never adds caller/signal/queueIfBusy", async () => {
        fetchMock.mockResolvedValueOnce(new Response("{}", {status: 200}));

        await sendCommand(makeInput({title: "第一章 800 字"}));

        const body = (captureFetchRequest().body) as Record<string, unknown>;
        expect(body.title).toBe("第一章 800 字");
        // 桥 DTO 拒 caller，服务端强制 external-cli；CLI 不应越权注入
        expect(body).not.toHaveProperty("caller");
        expect(body).not.toHaveProperty("block");
        expect(body).not.toHaveProperty("queueIfBusy");
    });

    it("propagates non-2xx responses as BridgeHttpError with body", async () => {
        const errorBody = JSON.stringify({
            error: true,
            message: "Invalid input: expected string, received undefined",
            statusCode: 400,
        });
        fetchMock.mockResolvedValueOnce(new Response(errorBody, {status: 400, statusText: "Bad Request"}));

        const error = await sendCommand(makeInput()).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(BridgeHttpError);
        const httpError = error as BridgeHttpError;
        expect(httpError.statusCode).toBe(400);
        expect(httpError.responseBody).toContain("Invalid input");
    });
});
