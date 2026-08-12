import {requireBridgeAuth} from "nbook/server/agent/bridge/bridge-auth";
import {openProjectAndCreateLeaderSession} from "nbook/server/agent/bridge/bridge-service";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {BridgeCreateSessionRequestDtoSchema} from "nbook/shared/dto/agent-bridge.dto";

/**
 * 打开指定 project 并创建绑定的 leader session。
 *
 * 客户端不直接传 currentProjectRoot——open + create 在一次请求内完成。
 * `createAgent` 内部要求 project 已 open（`neuro-agent-harness.ts:794`），
 * 所以这一步是硬性顺序，不是糖。
 */
export default defineEventHandler(async (event) => {
    requireBridgeAuth(event);
    const body = await validateBody(event, BridgeCreateSessionRequestDtoSchema);
    return openProjectAndCreateLeaderSession(body);
});
