import {describe, expect, it} from "vitest";
import {AgentSessionNotFoundError} from "nbook/server/agent/session/session-not-found-error";
import {projectRelatedSessions} from "nbook/server/agent/session/relation-projection";

describe("projectRelatedSessions", () => {
    it("只把关联目标自己的缺失投影为 unavailable", async () => {
        const result = await projectRelatedSessions([2, 3], async (sessionId) => {
            if (sessionId === 2) throw new AgentSessionNotFoundError(2);
            return `session-${String(sessionId)}`;
        });

        expect(result).toEqual({items: ["session-3"], unavailable: 1});
    });

    it("关联错误指向其它 ID 时不能吞掉", async () => {
        await expect(projectRelatedSessions([2], async () => {
            throw new AgentSessionNotFoundError(3);
        })).rejects.toBeInstanceOf(AgentSessionNotFoundError);
    });

    it("损坏、权限和其它错误保持原样抛出", async () => {
        const error = new Error("permission denied");
        await expect(projectRelatedSessions([2], async () => {
            throw error;
        })).rejects.toBe(error);
    });
});
