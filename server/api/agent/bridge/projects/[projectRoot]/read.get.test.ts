import {beforeEach, describe, expect, it, vi} from "vitest";

const mocks = vi.hoisted(() => ({
    requireBridgeAuth: vi.fn(),
    readBridgeProjectFile: vi.fn(),
    getQuery: vi.fn(),
}));

vi.mock("nbook/server/agent/bridge/bridge-auth", () => ({
    requireBridgeAuth: mocks.requireBridgeAuth,
}));

vi.mock("nbook/server/agent/bridge/bridge-service", () => ({
    readBridgeProjectFile: mocks.readBridgeProjectFile,
}));

vi.mock("h3", async () => {
    const actual = await vi.importActual<typeof import("h3")>("h3");
    return {
        ...actual,
        getRouterParam: (event: {params: Record<string, string>}, key: string) => event.params[key],
        getQuery: mocks.getQuery,
    };
});

function makeEvent(params: Record<string, string>, query: Record<string, string> = {}) {
    return {
        node: {req: {}},
        context: {params},
        params,
        query,
    } as never;
}

describe("GET /api/agent/bridge/projects/:projectRoot/read", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
    });

    it("合法 projectRoot + path → 调 readBridgeProjectFile 并透传", async () => {
        mocks.getQuery.mockReturnValue({path: "manuscript/001-chapter/index.md"});
        mocks.readBridgeProjectFile.mockResolvedValue({
            path: "manuscript/001-chapter/index.md",
            absolutePath: "/abs/path",
            entryType: "file",
            editable: true,
            mtimeMs: 123,
            content: "# Chapter 1",
        });
        const handler = (await import("nbook/server/api/agent/bridge/projects/[projectRoot]/read.get")).default;
        const event = makeEvent({projectRoot: "novel-a"});

        const result = await handler(event);

        expect(mocks.requireBridgeAuth).toHaveBeenCalledWith(event);
        expect(mocks.readBridgeProjectFile).toHaveBeenCalledWith({
            projectRoot: "novel-a",
            path: "manuscript/001-chapter/index.md",
        });
        expect(result).toMatchObject({content: "# Chapter 1"});
    });

    it("projectRoot 含 / → 400 INVALID_PROJECT_ROOT（单段校验）", async () => {
        mocks.getQuery.mockReturnValue({path: "x"});
        const handler = (await import("nbook/server/api/agent/bridge/projects/[projectRoot]/read.get")).default;
        const event = makeEvent({projectRoot: "workspace/../escape"});

        await expect(handler(event)).rejects.toMatchObject({
            statusCode: 400,
            data: {code: "INVALID_PROJECT_ROOT"},
        });
        expect(mocks.readBridgeProjectFile).not.toHaveBeenCalled();
    });

    it("projectRoot 缺失 → 400 INVALID_PROJECT_ROOT", async () => {
        mocks.getQuery.mockReturnValue({path: "x"});
        const handler = (await import("nbook/server/api/agent/bridge/projects/[projectRoot]/read.get")).default;
        const event = makeEvent({});

        await expect(handler(event)).rejects.toMatchObject({
            statusCode: 400,
            data: {code: "INVALID_PROJECT_ROOT"},
        });
    });

    it("path 缺失 → 400 INVALID_READ_QUERY", async () => {
        mocks.getQuery.mockReturnValue({});
        const handler = (await import("nbook/server/api/agent/bridge/projects/[projectRoot]/read.get")).default;
        const event = makeEvent({projectRoot: "novel-a"});

        await expect(handler(event)).rejects.toMatchObject({
            statusCode: 400,
            data: {code: "INVALID_READ_QUERY"},
        });
        expect(mocks.readBridgeProjectFile).not.toHaveBeenCalled();
    });

    it("鉴权失败立即抛错，不进 service", async () => {
        mocks.requireBridgeAuth.mockImplementation(() => {
            throw new Error("BRIDGE_DISABLED");
        });
        mocks.getQuery.mockReturnValue({path: "x"});
        const handler = (await import("nbook/server/api/agent/bridge/projects/[projectRoot]/read.get")).default;
        const event = makeEvent({projectRoot: "novel-a"});

        await expect(handler(event)).rejects.toThrow("BRIDGE_DISABLED");
        expect(mocks.readBridgeProjectFile).not.toHaveBeenCalled();
    });
});
