import {listTrashedProjects} from "nbook/server/workspace-files/project-session";
import {throwProjectHttpError} from "nbook/server/api/projects/project-http-error";
import type {ProjectTrashListResponseDto} from "nbook/shared/dto/project.dto";

/**
 * 列出回收区中仍可恢复的 Project 条目。
 *
 * 只读 Lifecycle 的回收区投影：不打开 Project SQLite、不读取条目正文；
 * 无 payload 的残壳与 marker 损坏的条目不可恢复，不在响应中出现。
 */
export default defineEventHandler(async (): Promise<ProjectTrashListResponseDto> => {
    try {
        const entries = await listTrashedProjects();
        return {
            entries: entries.map((entry) => ({
                projectRoot: entry.projectRoot,
                deletedAt: entry.deletedAt,
                deletedAtMs: entry.deletedAtMs,
                expiresAtMs: entry.expiresAtMs,
            })),
        };
    } catch (error) {
        throwProjectHttpError(error);
    }
});
