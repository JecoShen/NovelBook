import {isAgentSessionNotFoundError} from "nbook/server/agent/session/session-not-found-error";

export type RelatedSessionProjection<T> = Readonly<{
    items: T[];
    unavailable: number;
}>;

/**
 * 读取关联 Session 并只把关联目标自身的缺失投影为局部不可用。
 * 读取损坏、权限错误或其它路径的 ENOENT 必须继续抛出。
 */
export async function projectRelatedSessions<T>(
    sessionIds: readonly number[],
    read: (sessionId: number) => Promise<T>,
): Promise<RelatedSessionProjection<T>> {
    const items: T[] = [];
    let unavailable = 0;
    for (const sessionId of sessionIds) {
        try {
            items.push(await read(sessionId));
        } catch (error) {
            if (isAgentSessionNotFoundError(error) && error.sessionId === sessionId) {
                unavailable += 1;
                continue;
            }
            throw error;
        }
    }
    return {items, unavailable};
}
