import type {H3Event} from "h3";
import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";

const mocks = vi.hoisted(() => ({
    sessionTree: vi.fn(),
    directChat: vi.fn(),
}));

vi.mock("h3", async (importOriginal) => ({
    ...await importOriginal<typeof import("h3")>(),
    getRouterParam: () => "12",
    readBody: async () => ({sessionId: 12, message: "hello"}),
}));

vi.mock("nbook/server/agent/workflow/workflow-demo-service", () => ({
    useWorkflowDemoService: () => ({
        sessionTree: mocks.sessionTree,
        directChat: mocks.directChat,
    }),
}));

vi.mock("nbook/server/agent/http", async () => {
    return vi.importActual<typeof import("nbook/server/agent/http")>("nbook/server/agent/http");
});

let treeHandler: (event: H3Event) => Promise<unknown>;
let directChatHandler: (event: H3Event) => Promise<unknown>;
const originalDefineEventHandler = (globalThis as typeof globalThis & {defineEventHandler?: unknown}).defineEventHandler;

beforeAll(async () => {
    vi.stubGlobal("defineEventHandler", (routeHandler: typeof treeHandler) => routeHandler);
    treeHandler = (await import("nbook/server/api/agent/workflow-demo/sessions/[sessionId]/tree.get")).default;
    directChatHandler = (await import("nbook/server/api/agent/workflow-demo/direct-chat.post")).default;
});

afterAll(() => {
    vi.unstubAllGlobals();
    (globalThis as typeof globalThis & {defineEventHandler?: unknown}).defineEventHandler = originalDefineEventHandler;
});

beforeEach(() => {
    vi.clearAllMocks();
});

describe("Workflow Preview Session lifecycle", () => {
    it("tree 保留目标 Session 404", async () => {
        mocks.sessionTree.mockRejectedValue(sessionMissing(12));

        await expect(treeHandler({} as H3Event)).rejects.toMatchObject({
            statusCode: 404,
            data: {code: "SESSION_NOT_FOUND"},
        });
    });

    it("direct-chat 保留关联 Session 409", async () => {
        mocks.directChat.mockRejectedValue(sessionMissing(13));

        await expect(directChatHandler({} as H3Event)).rejects.toMatchObject({
            statusCode: 409,
            data: {code: "SESSION_DEPENDENCY_NOT_FOUND"},
        });
    });

    it("其它 tree/direct-chat 错误维持既有 404/400", async () => {
        mocks.sessionTree.mockRejectedValue(new Error("tree failed"));
        mocks.directChat.mockRejectedValue(new Error("chat failed"));

        await expect(treeHandler({} as H3Event)).rejects.toMatchObject({statusCode: 404});
        await expect(directChatHandler({} as H3Event)).rejects.toMatchObject({statusCode: 400});
    });
});

/** 构造跨 HMR 仍可识别的 Session 生命周期错误。 */
function sessionMissing(sessionId: number): Error {
    return Object.assign(new Error("missing"), {
        name: "AgentSessionNotFoundError",
        code: "SESSION_NOT_FOUND",
        sessionId,
    });
}
