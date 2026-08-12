import {createError} from "h3";
import {requireAgentSessionId, useAgentHarness} from "nbook/server/agent/http";
import {requireBridgeAuth} from "nbook/server/agent/bridge/bridge-auth";
import {BridgeConcurrencyLimitError, useBridgeRunRegistry} from "nbook/server/agent/bridge/bridge-run-registry";
import {projectPublicInvocationResult} from "nbook/server/agent/events/public-invocation-result-projection";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {AGENT_IMAGE_POLICY} from "nbook/shared/agent/agent-image-policy";
import {AgentInvokeRequestDtoSchema} from "nbook/shared/dto/agent-session.dto";

/**
 * 阻塞式调用 leader session。caller 强制为 `external-cli`，signal 接 req close。
 *
 * 客户端不传 `caller`（`AgentInvokeRequestDtoSchema.caller: z.never()` 拒绝），
 * 不传 `block`（固定 true），不传 `queueIfBusy`（固定 false——bridge 不排队，
 * 桥并发限流由 `useBridgeRunRegistry()` 承担，超限返 429）。
 *
 * 资源保证：finally 三件套——`req.off("close")` + `controller.abort()` + `release()`，
 * 异常 / abort / 客户端断开三条路径都会执行释放。
 */
export default defineEventHandler(async (event) => {
    requireBridgeAuth(event);
    const sessionId = requireAgentSessionId(event);
    const body = await validateBody(event, AgentInvokeRequestDtoSchema, {
        maxBytes: AGENT_IMAGE_POLICY.maxRequestBytes,
    });

    const harness = useAgentHarness();
    const recovery = await harness.getSessionRecovery(sessionId);
    const projectRoot = recovery.summary?.currentProjectRoot;
    if (!projectRoot) {
        throw createError({
            statusCode: 409,
            message: "Session 未绑定 projectRoot，无法走桥并发限流。",
            data: {code: "BRIDGE_PROJECT_UNBOUND"},
        });
    }

    const registry = useBridgeRunRegistry();
    let release: () => void;
    try {
        release = registry.acquire(projectRoot, sessionId);
    } catch (error) {
        if (error instanceof BridgeConcurrencyLimitError) {
            throw createError({
                statusCode: 429,
                message: error.message,
                data: {
                    code: error.code,
                    perProjectLimit: error.perProjectLimit,
                    globalLimit: error.globalLimit,
                },
            });
        }
        throw error;
    }

    const controller = new AbortController();
    const onClose = (): void => {
        controller.abort();
    };
    event.node.req.on("close", onClose);

    try {
        const result = await harness.invokeAgent({
            sessionId,
            mode: body.mode,
            clientMessageId: body.clientMessageId,
            message: body.message,
            payload: body.input,
            title: body.title,
            resolution: body.resolution,
            resolutions: body.resolutions,
            clientState: body.clientState,
            caller: {kind: "external-cli"},
            block: true,
            queueIfBusy: false,
            signal: controller.signal,
        });
        return projectPublicInvocationResult(result);
    } finally {
        event.node.req.off("close", onClose);
        controller.abort();
        release();
    }
});
