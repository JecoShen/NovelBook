import {beforeEach, describe, expect, it, vi} from "vitest";

const mocks = vi.hoisted(() => ({
    requireProjectRefBody: vi.fn(async () => ({projectRoot: "book"})),
    restoreDeletedProject: vi.fn(async () => ({revision: 9, projectRoot: "book"})),
}));

vi.mock("nbook/server/api/projects/project-control-plane", () => ({
    requireProjectRefBody: mocks.requireProjectRefBody,
}));
vi.mock("nbook/server/workspace-files/project-session", () => ({
    restoreDeletedProject: mocks.restoreDeletedProject,
}));
vi.mock("nbook/server/api/projects/project-http-error", () => ({
    throwProjectHttpError: (error: unknown): never => {
        throw error;
    },
}));

describe("POST /api/projects/trash/restore", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
    });

    it("按请求体 identity 恢复并返回重新发布的 revision", async () => {
        const handler = (await import("nbook/server/api/projects/trash/restore.post")).default;

        await expect(handler({} as never)).resolves.toEqual({revision: 9, projectRoot: "book"});
        expect(mocks.restoreDeletedProject).toHaveBeenCalledWith({projectRoot: "book"});
    });

    it("identity 校验失败时不触达恢复", async () => {
        const failure = new Error("projectRoot 不合法");
        mocks.requireProjectRefBody.mockRejectedValueOnce(failure);
        const handler = (await import("nbook/server/api/projects/trash/restore.post")).default;

        await expect(handler({} as never)).rejects.toBe(failure);
        expect(mocks.restoreDeletedProject).not.toHaveBeenCalled();
    });

    it("回收区缺条目与占用冲突都交给 throwProjectHttpError 映射", async () => {
        const failure = new Error("PROJECT_EXISTS");
        mocks.restoreDeletedProject.mockRejectedValueOnce(failure);
        const handler = (await import("nbook/server/api/projects/trash/restore.post")).default;

        await expect(handler({} as never)).rejects.toBe(failure);
    });
});
