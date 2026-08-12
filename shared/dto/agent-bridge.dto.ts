import {z} from "zod";
import {ProjectRootDtoSchema} from "nbook/shared/dto/project.dto";

/**
 * HTTP Bridge 控制面的请求 DTO。
 *
 * 这些 schema 只描述外部可见的请求形状；调用方不传 caller、signal、queueIfBusy 等
 * 内部参数，桥路由自行注入（caller=external-cli、signal=req close、queueIfBusy=false）。
 */

/** Agent Bridge 默认 Profile Key；目前只有 leader 一档，未来若加 read-only reviewer 再扩。 */
export const BRIDGE_DEFAULT_PROFILE_KEY = "leader.default" as const;

/**
 * `POST /api/agent/bridge/sessions` 的请求体。
 *
 * 路由负责把 projectRoot 通过 `openProjectControl` 打开，并创建绑定的 leader session。
 * 客户端不直接传 `currentProjectRoot`——这是桥的封装价值：open + create 一步到位。
 */
export const BridgeCreateSessionRequestDtoSchema = z.object({
    projectRoot: ProjectRootDtoSchema,
    profileKey: z.string()
        .trim()
        .min(1, "profileKey 不能为空")
        .default(BRIDGE_DEFAULT_PROFILE_KEY),
}).strict();

export type BridgeCreateSessionRequestDto = z.infer<typeof BridgeCreateSessionRequestDtoSchema>;

/**
 * `GET /api/agent/bridge/projects/:projectRoot/read` 的查询参数。
 *
 * `path` 必须是非空相对路径；越界与绝对路径由下游 `readWorkspaceTextFile` 拒绝，
 * 桥这里只做最小校验（防空字符串与前后空白）。
 */
export const BridgeReadFileQueryDtoSchema = z.object({
    path: z.string()
        .trim()
        .min(1, "path 不能为空"),
}).strict();

export type BridgeReadFileQueryDto = z.infer<typeof BridgeReadFileQueryDtoSchema>;
