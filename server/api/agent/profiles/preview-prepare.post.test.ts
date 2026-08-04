import {beforeEach, describe, expect, it, vi} from "vitest";

function parseSessionId(raw: string | undefined): number | undefined {
    if (raw === undefined) {
        return undefined;
    }
    const parsed = Number(raw);
    if (!/^\d+$/u.test(raw) || !Number.isSafeInteger(parsed) || parsed <= 0) {
        throw Object.assign(new Error("sessionId 必须是正整数"), {statusCode: 400});
    }
    return parsed;
}

async function withAgentHttpError<T>(sessionId: number | undefined, operation: () => Promise<T>): Promise<T> {
    try {
        return await operation();
    } catch (error) {
        if (error instanceof Error && error.name === "AgentSessionNotFoundError" && "sessionId" in error) {
            const primary = sessionId !== undefined && error.sessionId === sessionId;
            throw Object.assign(new Error(primary ? "Session 不存在或已不可用" : "关联对话不存在或已不可用"), {
                statusCode: primary ? 404 : 409,
                data: {code: primary ? "SESSION_NOT_FOUND" : "SESSION_DEPENDENCY_NOT_FOUND"},
            });
        }
        throw error;
    }
}

describe("POST /api/agent/profiles/preview-prepare", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
    });

    it("sourceOverride worker preview 触发 Project lifecycle error 时返回稳定 PROJECT_NOT_OPEN", async () => {
        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            validateBody: vi.fn(async () => ({
                profileKey: "writer",
                sessionId: "7",
                sourceOverride: {
                    fileName: "builtin/writer.profile.tsx",
                    source: "export default {};",
                },
            })),
        }));
        vi.doMock("nbook/server/agent/http", () => ({
            useAgentHarness: vi.fn(() => ({profiles: {}})),
            requireAgentSessionIdValue: parseSessionId,
            withAgentHttpError,
        }));
        vi.doMock("nbook/server/agent/profiles/profile-http-service", () => ({
            previewAgentProfilePrepare: vi.fn(),
        }));
        vi.doMock("nbook/server/agent/profiles/profile-compile-worker", async () => {
            const {ProjectNotOpenError} = await import("nbook/server/workspace-files/project-session-service");
            return {
                useProfileCompileWorker: vi.fn(() => ({
                compile: vi.fn(async () => {
                        throw new ProjectNotOpenError("profile-preview-not-open");
                    }),
                })),
            };
        });

        const handler = (await import("nbook/server/api/agent/profiles/preview-prepare.post")).default;

        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 409,
            data: {
                code: "PROJECT_NOT_OPEN",
                projectRoot: "profile-preview-not-open",
            },
        });
    });

    it.each([
        [7, 404, "SESSION_NOT_FOUND"],
        [8, 409, "SESSION_DEPENDENCY_NOT_FOUND"],
    ] as const)("in-process preview 将缺失 Session %i 映射为稳定生命周期错误", async (missingSessionId, statusCode, code) => {
        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            validateBody: vi.fn(async () => ({
                profileKey: "writer",
                sessionId: "7",
            })),
        }));
        vi.doMock("nbook/server/agent/http", () => ({
            useAgentHarness: vi.fn(() => ({profiles: {}})),
            requireAgentSessionIdValue: parseSessionId,
            withAgentHttpError,
        }));
        vi.doMock("nbook/server/agent/profiles/profile-http-service", () => ({
            previewAgentProfilePrepare: vi.fn(async () => {
                throw Object.assign(new Error("missing"), {
                    name: "AgentSessionNotFoundError",
                    code: "SESSION_NOT_FOUND",
                    sessionId: missingSessionId,
                });
            }),
        }));
        vi.doMock("nbook/server/agent/profiles/profile-compile-worker", () => ({
            useProfileCompileWorker: vi.fn(),
        }));

        const handler = (await import("nbook/server/api/agent/profiles/preview-prepare.post")).default;

        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode,
            data: {code},
        });
    });

    it("未提供 Session ID 仍映射关联 Session 缺失为 409", async () => {
        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            validateBody: vi.fn(async () => ({
                profileKey: "writer",
            })),
        }));
        vi.doMock("nbook/server/agent/http", () => ({
            useAgentHarness: vi.fn(() => ({profiles: {}})),
            requireAgentSessionIdValue: parseSessionId,
            withAgentHttpError,
        }));
        vi.doMock("nbook/server/agent/profiles/profile-http-service", () => ({
            previewAgentProfilePrepare: vi.fn(async () => {
                throw Object.assign(new Error("missing dependency"), {
                    name: "AgentSessionNotFoundError",
                    code: "SESSION_NOT_FOUND",
                    sessionId: 8,
                });
            }),
        }));

        const handler = (await import("nbook/server/api/agent/profiles/preview-prepare.post")).default;

        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 409,
            data: {code: "SESSION_DEPENDENCY_NOT_FOUND"},
        });
    });

    it.each(["abc", "NaN", "0", "-1", "9007199254740992"])("拒绝无效 Session ID %s", async (sessionId) => {
        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            validateBody: vi.fn(async () => ({
                profileKey: "writer",
                sessionId,
            })),
        }));
        vi.doMock("nbook/server/agent/http", () => ({
            useAgentHarness: vi.fn(),
            requireAgentSessionIdValue: parseSessionId,
            withAgentHttpError,
        }));

        const handler = (await import("nbook/server/api/agent/profiles/preview-prepare.post")).default;

        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 400,
            message: "sessionId 必须是正整数",
        });
    });
});
