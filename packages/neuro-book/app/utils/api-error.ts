const DEFAULT_API_ERROR_MESSAGE = "请求失败";

type I18nRuntime = {
    t: (key: string) => string;
};

/**
 * 读取当前前端 locale 下的默认 API 错误文案；测试或非 Nuxt 上下文回退中文。
 */
function resolveDefaultApiErrorMessage(): string {
    try {
        const nuxtApp = useNuxtApp() as {$i18n?: I18nRuntime};
        return nuxtApp.$i18n?.t("api.requestFailed") ?? DEFAULT_API_ERROR_MESSAGE;
    } catch {
        return DEFAULT_API_ERROR_MESSAGE;
    }
}

/**
 * 不含业务信息的通用 HTTP/网络状态短语（大小写不敏感）。
 * h3/fetch 默认错误只有这类短语，直接上屏就是裸英文「Server Error」；
 * 判中时让位给调用方带上下文的 fallback（「绑定 Inline AI Session 失败」）。
 */
const GENERIC_STATUS_MESSAGES = new Set([
    "server error",
    "internal server error",
    "bad request",
    "unauthorized",
    "forbidden",
    "not found",
    "method not allowed",
    "not acceptable",
    "conflict",
    "unprocessable entity",
    "too many requests",
    "bad gateway",
    "service unavailable",
    "gateway timeout",
    "fetch error",
    "network error",
    "failed to fetch",
    "load failed",
    "timeout",
    "request failed",
    "unknown error",
]);

function isInformativeMessage(message: string): boolean {
    return !GENERIC_STATUS_MESSAGES.has(message.trim().toLowerCase());
}

/**
 * 消息里的服务器绝对路径（POSIX）。要求路径 token 前是空白/引号/括号或行首，
 * 因此 `https://host/a/b` 这类 URL 不会被误伤——路径段前面是 `//host` 而非边界字符。
 * 绝对路径对作者没有行动价值，且会把部署目录结构泄露到任何能打开页面的人。
 */
const SERVER_ABSOLUTE_PATH_PATTERN = /(^|[\s"'`(])\/(?:[\w.@%+-]+\/)+[\w.@%+-]*/g;

function stripServerAbsolutePaths(message: string): string {
    return message.replace(SERVER_ABSOLUTE_PATH_PATTERN, "$1…");
}

/** 候选消息只有携带业务信息时才胜出；通用短语穿透到下一个候选或 fallback。服务器绝对路径一律抹除。 */
function pickInformative(message: unknown): string | null {
    return typeof message === "string" && message && isInformativeMessage(message)
        ? stripServerAbsolutePaths(message)
        : null;
}

export function resolveApiErrorMessage(error: unknown, fallback?: string): string {
    if (typeof error === "object" && error !== null) {
        if ("data" in error && typeof error.data === "object" && error.data !== null) {
            const data = error.data as Record<string, unknown>;

            const dataMessage = pickInformative(data.message) ?? pickInformative(data.statusMessage);
            if (dataMessage) {
                return dataMessage;
            }
        }

        if ("response" in error && typeof error.response === "object" && error.response !== null) {
            const response = error.response as {_data?: unknown};
            if (typeof response._data === "object" && response._data !== null) {
                const data = response._data as Record<string, unknown>;
                const responseMessage = pickInformative(data.message) ?? pickInformative(data.statusMessage);
                if (responseMessage) {
                    return responseMessage;
                }
            }
        }

        if ("statusMessage" in error) {
            const statusMessage = pickInformative(error.statusMessage);
            if (statusMessage) {
                return statusMessage;
            }
        }
        if ("message" in error) {
            const message = pickInformative(error.message);
            if (message) {
                return message;
            }
        }
    }

    return fallback ?? resolveDefaultApiErrorMessage();
}

/** 提取 `$fetch` / h3 错误中的稳定业务码；外部响应结构在此边界逐层收窄。 */
export function resolveApiErrorCode(error: unknown): string | null {
    if (typeof error !== "object" || error === null) {
        return null;
    }
    const direct = "data" in error ? nestedApiErrorCode(error.data) : null;
    if (direct !== null) {
        return direct;
    }
    if (!("response" in error) || typeof error.response !== "object" || error.response === null || !("_data" in error.response)) {
        return null;
    }
    return nestedApiErrorCode(error.response._data);
}

/** H3 可能把业务 data 再包一层，最多读取两层稳定 code。 */
function nestedApiErrorCode(value: unknown): string | null {
    if (typeof value !== "object" || value === null) {
        return null;
    }
    if ("code" in value && typeof value.code === "string") {
        return value.code;
    }
    return "data" in value && typeof value.data === "object" && value.data !== null && "code" in value.data && typeof value.data.code === "string"
        ? value.data.code
        : null;
}

/**
 * 提取 `$fetch` / h3 错误中的 HTTP 状态码；无法识别时返回 null。
 */
export function resolveApiErrorStatus(error: unknown): number | null {
    if (typeof error !== "object" || error === null) {
        return null;
    }
    if ("status" in error && typeof error.status === "number") {
        return error.status;
    }
    if ("statusCode" in error && typeof error.statusCode === "number") {
        return error.statusCode;
    }
    if ("response" in error && typeof error.response === "object" && error.response !== null && "status" in error.response && typeof error.response.status === "number") {
        return error.response.status;
    }
    return null;
}
