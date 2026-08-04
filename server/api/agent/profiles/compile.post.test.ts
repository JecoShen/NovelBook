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

describe("POST /api/agent/profiles/compile", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
    });

    it("preview 触发 Project lifecycle error 时返回稳定 PROJECT_NOT_OPEN", async () => {
        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            validateBody: vi.fn(async () => ({
                fileName: "builtin/writer.profile.tsx",
                dryRun: false,
                preview: true,
                sessionId: "7",
            })),
        }));
        vi.doMock("nbook/server/agent/http", async () => ({
            ...await vi.importActual<typeof import("nbook/server/agent/http")>("nbook/server/agent/http"),
            useAgentHarness: vi.fn(() => ({profiles: {}})),
            requireAgentSessionIdValue: parseSessionId,
        }));
        vi.doMock("nbook/server/agent/profiles/profile-compile-worker", () => ({
            useProfileCompileWorker: vi.fn(() => ({
                compile: vi.fn(async () => ({
                    ok: true,
                    stale: false,
                    detail: null,
                    preview: null,
                    issues: [],
                })),
            })),
        }));
        vi.doMock("nbook/server/agent/profiles/workbench-service", () => ({
            readProfileSource: vi.fn(async () => ({
                manifest: {key: "writer"},
            })),
        }));
        vi.doMock("nbook/server/agent/profiles/profile-http-service", async () => {
            const {ProjectNotOpenError} = await import("nbook/server/workspace-files/project-session-service");
            return {
                previewAgentProfilePrepare: vi.fn(async () => {
                    throw new ProjectNotOpenError("profile-compile-not-open");
                }),
            };
        });

        const handler = (await import("nbook/server/api/agent/profiles/compile.post")).default;

        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 409,
            data: {
                code: "PROJECT_NOT_OPEN",
                projectRoot: "profile-compile-not-open",
            },
        });
    }, 10_000);

    it("compile preview 保留关联 Session 缺失的 409", async () => {
        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            validateBody: vi.fn(async () => ({
                fileName: "builtin/writer.profile.tsx",
                dryRun: false,
                preview: true,
                sessionId: "7",
            })),
        }));
        vi.doMock("nbook/server/agent/http", async () => ({
            ...await vi.importActual<typeof import("nbook/server/agent/http")>("nbook/server/agent/http"),
            useAgentHarness: vi.fn(() => ({profiles: {}, runtimePaths: {}})),
            requireAgentSessionIdValue: parseSessionId,
        }));
        vi.doMock("nbook/server/agent/profiles/profile-compile-worker", () => ({
            useProfileCompileWorker: vi.fn(() => ({
                compile: vi.fn(async () => ({
                    ok: true,
                    stale: false,
                    detail: null,
                    preview: null,
                    issues: [],
                })),
            })),
        }));
        vi.doMock("nbook/server/agent/profiles/workbench-service", () => ({
            readProfileSource: vi.fn(async () => ({manifest: {key: "writer"}})),
        }));
        vi.doMock("nbook/server/agent/profiles/profile-workbench-roots", () => ({
            profileWorkbenchRootsFromRuntime: vi.fn(() => ({})),
        }));
        vi.doMock("nbook/server/agent/profiles/profile-http-service", () => ({
            previewAgentProfilePrepare: vi.fn(async () => {
                throw Object.assign(new Error("dependency missing"), {
                    name: "AgentSessionNotFoundError",
                    code: "SESSION_NOT_FOUND",
                    sessionId: 8,
                });
            }),
        }));

        const handler = (await import("nbook/server/api/agent/profiles/compile.post")).default;

        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 409,
            data: {code: "SESSION_DEPENDENCY_NOT_FOUND"},
        });
    });

    it.each(["abc", "NaN", "0", "-1", "9007199254740992"])("拒绝无效 Session ID %s", async (sessionId) => {
        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            validateBody: vi.fn(async () => ({
                fileName: "builtin/writer.profile.tsx",
                dryRun: false,
                preview: true,
                sessionId,
            })),
        }));
        vi.doMock("nbook/server/agent/http", async () => ({
            ...await vi.importActual<typeof import("nbook/server/agent/http")>("nbook/server/agent/http"),
            useAgentHarness: vi.fn(),
            requireAgentSessionIdValue: parseSessionId,
        }));

        const handler = (await import("nbook/server/api/agent/profiles/compile.post")).default;

        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 400,
            message: "sessionId 必须是正整数",
        });
    });
});
