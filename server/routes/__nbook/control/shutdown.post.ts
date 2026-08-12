import {createError, defineEventHandler, getHeader, setResponseStatus} from "h3";
import {productShutdownController} from "nbook/server/runtime/shutdown/product-shutdown";
import {PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT} from "nbook/shared/product-runtime-contract";
import {isLoopbackRequest, matchesControlToken} from "nbook/server/runtime/control/loopback-auth";

/** Manager 专用 loopback shutdown 控制面；正常用户鉴权不能访问此入口。 */
export default defineEventHandler((event): {accepted: true} => {
    const remoteAddress = event.node.req.socket.remoteAddress;
    if (!isLoopbackRequest(remoteAddress)) {
        throw createError({statusCode: 403, message: "Product shutdown 只接受 loopback 请求。"});
    }
    const expectedToken = process.env[PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT]?.trim();
    if (!expectedToken) {
        throw createError({statusCode: 503, message: "Product shutdown 控制面未启用。"});
    }
    if (!matchesControlToken(getHeader(event, "authorization"), expectedToken)) {
        throw createError({statusCode: 401, message: "Product shutdown token 无效。"});
    }
    setResponseStatus(event, 202);
    let exitRequested = false;
    const requestExit = (): void => {
        if (exitRequested) return;
        exitRequested = true;
        productShutdownController.requestProcessExit();
    };
    event.node.res.once("finish", requestExit);
    event.node.res.once("close", requestExit);
    return {accepted: true};
});
