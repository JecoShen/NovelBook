import {restoreDeletedProject} from "nbook/server/workspace-files/project-session";
import {throwProjectHttpError} from "nbook/server/api/projects/project-http-error";
import {requireProjectRefBody} from "nbook/server/api/projects/project-control-plane";
import type {ProjectTrashRestoreResponseDto} from "nbook/shared/dto/project.dto";

/**
 * 从回收区恢复一个已删除 Project。
 *
 * 恢复是 Lifecycle 的持锁短事务：原位置已被同名 Project 占用时稳定返回 PROJECT_EXISTS，
 * 不覆盖任何现存数据。删除时归档的 Agent session 保持归档——恢复不回放历史会话，
 * 项目重新打开后新会话从干净状态开始。
 */
export default defineEventHandler(async (event): Promise<ProjectTrashRestoreResponseDto> => {
    const ref = await requireProjectRefBody(event);
    try {
        return await restoreDeletedProject(ref);
    } catch (error) {
        throwProjectHttpError(error);
    }
});
