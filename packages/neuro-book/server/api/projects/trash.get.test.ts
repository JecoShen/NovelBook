import {beforeEach, describe, expect, it, vi} from "vitest";

const mocks = vi.hoisted(() => ({
    listTrashedProjects: vi.fn(async () => [
        {
            projectRoot: "book-b",
            deletedAt: "2026-09-20T02:00:00.000Z",
            deletedAtMs: 2000,
            expiresAtMs: 2000 + 30 * 24 * 60 * 60 * 1000,
        },
        {
            projectRoot: "book-a",
            deletedAt: "2026-09-19T02:00:00.000Z",
            deletedAtMs: 1000,
            expiresAtMs: 1000 + 30 * 24 * 60 * 60 * 1000,
        },
    ]),
}));

vi.mock("nbook/server/workspace-files/project-session", () => ({
    listTrashedProjects: mocks.listTrashedProjects,
}));
vi.mock("nbook/server/api/projects/project-http-error", () => ({
    throwProjectHttpError: (error: unknown): never => {
        throw error;
    },
}));

describe("GET /api/projects/trash", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
    });

    it("返回回收区条目的公开投影", async () => {
        const handler = (await import("nbook/server/api/projects/trash.get")).default;

        await expect(handler({} as never)).resolves.toEqual({
            entries: [
                {
                    projectRoot: "book-b",
                    deletedAt: "2026-09-20T02:00:00.000Z",
                    deletedAtMs: 2000,
                    expiresAtMs: 2000 + 30 * 24 * 60 * 60 * 1000,
                },
                {
                    projectRoot: "book-a",
                    deletedAt: "2026-09-19T02:00:00.000Z",
                    deletedAtMs: 1000,
                    expiresAtMs: 1000 + 30 * 24 * 60 * 60 * 1000,
                },
            ],
        });
    });

    it("空回收区返回空列表", async () => {
        mocks.listTrashedProjects.mockResolvedValueOnce([]);
        const handler = (await import("nbook/server/api/projects/trash.get")).default;

        await expect(handler({} as never)).resolves.toEqual({entries: []});
    });

    it("领域错误交给 throwProjectHttpError 映射", async () => {
        const failure = new Error("lifecycle closed");
        mocks.listTrashedProjects.mockRejectedValueOnce(failure);
        const handler = (await import("nbook/server/api/projects/trash.get")).default;

        await expect(handler({} as never)).rejects.toBe(failure);
    });
});
