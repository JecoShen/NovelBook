import {beforeEach, describe, expect, it, vi} from "vitest";

const mocks = vi.hoisted(() => ({
    requireBridgeAuth: vi.fn(),
    openProjectAndCreateLeaderSession: vi.fn(),
    validateBody: vi.fn(),
}));

vi.mock("nbook/server/agent/bridge/bridge-auth", () => ({
    requireBridgeAuth: mocks.requireBridgeAuth,
}));

vi.mock("nbook/server/agent/bridge/bridge-service", () => ({
    openProjectAndCreateLeaderSession: mocks.openProjectAndCreateLeaderSession,
}));

vi.mock("nbook/server/utils/novel-chapter", () => ({
    validateBody: mocks.validateBody,
}));

describe("POST /api/agent/bridge/sessions", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
    });

    it("通过鉴权 + 校验 body → 调 openProjectAndCreateLeaderSession 并返回结果", async () => {
        mocks.validateBody.mockResolvedValue({projectRoot: "novel-a", profileKey: "leader.default"});
        mocks.openProjectAndCreateLeaderSession.mockResolvedValue({
            sessionId: 7,
            projectRoot: "novel-a",
            profileKey: "leader.default",
        });
        const handler = (await import("nbook/server/api/agent/bridge/sessions.post")).default;

        const result = await handler({} as never);

        expect(mocks.requireBridgeAuth).toHaveBeenCalledTimes(1);
        expect(mocks.openProjectAndCreateLeaderSession).toHaveBeenCalledWith({
            projectRoot: "novel-a",
            profileKey: "leader.default",
        });
        expect(result).toEqual({
            sessionId: 7,
            projectRoot: "novel-a",
            profileKey: "leader.default",
        });
    });

    it("鉴权失败立即抛错，不进入 service 调用", async () => {
        mocks.requireBridgeAuth.mockImplementation(() => {
            throw new Error("BRIDGE_DISABLED");
        });
        const handler = (await import("nbook/server/api/agent/bridge/sessions.post")).default;

        await expect(handler({} as never)).rejects.toThrow("BRIDGE_DISABLED");
        expect(mocks.validateBody).not.toHaveBeenCalled();
        expect(mocks.openProjectAndCreateLeaderSession).not.toHaveBeenCalled();
    });

    it("projectRoot 不存在 → 404 PROJECT_NOT_FOUND 透传", async () => {
        const projectNotFound = Object.assign(new Error("Project 不存在"), {
            statusCode: 404,
            data: {code: "PROJECT_NOT_FOUND", projectRoot: "missing"},
        });
        mocks.validateBody.mockResolvedValue({projectRoot: "missing"});
        mocks.openProjectAndCreateLeaderSession.mockRejectedValue(projectNotFound);
        const handler = (await import("nbook/server/api/agent/bridge/sessions.post")).default;

        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 404,
            data: {code: "PROJECT_NOT_FOUND", projectRoot: "missing"},
        });
    });
});
