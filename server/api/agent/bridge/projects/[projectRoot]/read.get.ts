import {createError, getQuery, getRouterParam} from "h3";
import {requireBridgeAuth} from "nbook/server/agent/bridge/bridge-auth";
import {readBridgeProjectFile} from "nbook/server/agent/bridge/bridge-service";
import {BridgeReadFileQueryDtoSchema} from "nbook/shared/dto/agent-bridge.dto";
import {ProjectRootDtoSchema} from "nbook/shared/dto/project.dto";

/**
 * 读取 Project Workspace 内的文本文件。
 *
 * 用途：product 模式（鉴权开启）下 CLI 没法走原 `/api/workspace-files/read`
 * （在 cookie session 后），桥给它一个 loopback+token 入口。
 *
 * dev 模式可直连原端点，本路由可作为统一入口。`path` 由下游 `readWorkspaceTextFile`
 * 拒绝越界与绝对路径；桥只做最小非空校验。
 */
export default defineEventHandler(async (event) => {
    requireBridgeAuth(event);
    const rawProjectRoot = getRouterParam(event, "projectRoot") ?? "";
    const projectResult = ProjectRootDtoSchema.safeParse(rawProjectRoot);
    if (!projectResult.success) {
        throw createError({
            statusCode: 400,
            message: `projectRoot 不合法：${rawProjectRoot}`,
            data: {code: "INVALID_PROJECT_ROOT"},
        });
    }
    const query = getQuery(event);
    const queryResult = BridgeReadFileQueryDtoSchema.safeParse(query);
    if (!queryResult.success) {
        throw createError({
            statusCode: 400,
            message: "path 必填且非空",
            data: {code: "INVALID_READ_QUERY", issues: queryResult.error.issues},
        });
    }
    return readBridgeProjectFile({
        projectRoot: projectResult.data,
        path: queryResult.data.path,
    });
});
