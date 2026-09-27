import {STORED_ATTACHMENT_ESTIMATED_CHARS, storedMessageForEstimate, type StoredMessageLike} from "nbook/server/agent/messages/stored-message-presentation";
import type {Message, Usage} from "nbook/server/agent/messages/types";

/**
 * stored message 的 token 估算入口（p-009 A4：CJK 分段启发式替代 pi-agent-core 的 chars/4）。
 *
 * 单独成模块的原因：估算器是 `stored-message-presentation` 依赖图中唯一的
 * 计算面；本模块保持零 npm 运行时依赖（类型导入除外），profile artifact 不会
 * 拖入 pi-ai 与全部 Provider SDK。
 *
 * 口径（2026-09-23 生产 traces 实测校准，见 p-009 决策记录）：
 * CJK 连续段约 1.5 字符/token（实测 1.69，取安全侧高估），ASCII/空白段 4 字符/token，
 * 每条消息加少量 overhead。方向刻意偏高估：压缩提前触发是安全侧，低估才是事故侧
 * （chars/4 对 CJK 重内容低估约 2.4 倍，曾把溢出风险转嫁给 provider 侧 400）。
 */

/** CJK 段字符/token 折算系数（实测 1.69 ±5%，取 1.5 保守高估）。 */
export const CJK_CHARS_PER_TOKEN = 1.5;
/** 非 CJK 段字符/token 折算系数（与 pi chars/4 一致，实测 4.1–4.75 的安全侧下沿）。 */
export const NON_CJK_CHARS_PER_TOKEN = 4;
/** 每条消息的结构开销近似（role 包装/priming），方向是略高估。 */
export const MESSAGE_OVERHEAD_TOKENS = 4;
/** 图片/附件固定成本：沿用 pi 的 4800 字符口径折算，不引入 blob 读取。 */
export const IMAGE_ESTIMATED_TOKENS = STORED_ATTACHMENT_ESTIMATED_CHARS / NON_CJK_CHARS_PER_TOKEN;

/**
 * CJK 统一表意文字及扩展区、假名、諺文、全角标点（p-009 拍板集合）。
 * 按码点判定，`for...of` 迭代天然按码点走，扩展区代理对计 1 个字符。
 */
function isCjkCodePoint(codePoint: number): boolean {
    return (
        (codePoint >= 0x1100 && codePoint <= 0x11ff) // Hangul Jamo
        || (codePoint >= 0x3000 && codePoint <= 0x303f) // CJK 符号与标点
        || (codePoint >= 0x3040 && codePoint <= 0x30ff) // 平假名 + 片假名
        || (codePoint >= 0x3130 && codePoint <= 0x318f) // Hangul Compatibility Jamo
        || (codePoint >= 0x31f0 && codePoint <= 0x31ff) // 片假名语音扩展
        || (codePoint >= 0x3400 && codePoint <= 0x4dbf) // 表意文字扩展 A
        || (codePoint >= 0x4e00 && codePoint <= 0x9fff) // 表意文字主区
        || (codePoint >= 0xac00 && codePoint <= 0xd7af) // 諺文音节
        || (codePoint >= 0xf900 && codePoint <= 0xfaff) // 兼容表意文字
        || (codePoint >= 0xff00 && codePoint <= 0xffef) // 全角/半角形式
        || (codePoint >= 0x20000 && codePoint <= 0x2ebef) // 扩展 B–F
        || (codePoint >= 0x2f800 && codePoint <= 0x2fa1f) // 兼容补充
        || (codePoint >= 0x30000 && codePoint <= 0x323af) // 扩展 G–H
    );
}

/** 纯文本 token 估算（浮点累加，调用方决定取整时机；不含消息 overhead）。 */
function estimateTextTokens(text: string): number {
    let cjkChars = 0;
    let otherChars = 0;
    for (const char of text) {
        if (isCjkCodePoint(char.codePointAt(0)!)) {
            cjkChars += 1;
        } else {
            otherChars += 1;
        }
    }
    return cjkChars / CJK_CHARS_PER_TOKEN + otherChars / NON_CJK_CHARS_PER_TOKEN;
}

/**
 * 非消息负载（system prompt、tools JSON 等）的纯文本估算入口。
 * 与消息估算同口径但无消息 overhead；trace 分区等消费方统一走这里，避免两套估算漂移。
 */
export function estimatePlainTextTokens(text: string): number {
    return Math.ceil(estimateTextTokens(text));
}

function safeJsonStringify(value: unknown): string {
    try {
        return JSON.stringify(value) ?? "undefined";
    } catch {
        return "[unserializable]";
    }
}

function estimateContentTokens(content: string | readonly unknown[]): number {
    if (typeof content === "string") {
        return estimateTextTokens(content);
    }
    let tokens = 0;
    for (const block of content as Array<{type: string; text?: string}>) {
        if (block.type === "text" && block.text) {
            tokens += estimateTextTokens(block.text);
        } else if (block.type === "image") {
            tokens += IMAGE_ESTIMATED_TOKENS;
        }
    }
    return tokens;
}

/**
 * 消息体估算（不含 overhead），计数字段镜像 pi estimateTokens。
 * 本地 StoredMessageLike 只有 user/assistant/toolResult 三种 role：pi 估算器的
 * custom/bashExecution/branchSummary/compactionSummary 分支在本地调用路径不可达
 * （那些内容以 session entry 而非 message 形态存在），不再保留对应分支。
 */
function estimateMessageBodyTokens(message: Message): number {
    switch (message.role) {
        case "user":
            return estimateContentTokens(message.content);
        case "assistant": {
            let tokens = 0;
            for (const block of message.content) {
                if (block.type === "text") {
                    tokens += estimateTextTokens(block.text);
                } else if (block.type === "thinking") {
                    tokens += estimateTextTokens(block.thinking);
                } else if (block.type === "toolCall") {
                    tokens += estimateTextTokens(block.name) + estimateTextTokens(safeJsonStringify(block.arguments));
                }
            }
            return tokens;
        }
        case "toolResult":
            return estimateContentTokens(message.content);
    }
}

/** 不读取 blob 的单消息 token 估算。 */
export function estimateStoredMessageTokens(message: StoredMessageLike): number {
    return Math.ceil(estimateMessageBodyTokens(storedMessageForEstimate(message))) + MESSAGE_OVERHEAD_TOKENS;
}

export type StoredContextTokenEstimate = {
    tokens: number;
    usageTokens: number;
    trailingTokens: number;
    lastUsageIndex: number | null;
};

function calculateContextTokens(usage: Usage): number {
    return usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

/** 与 pi getAssistantUsage 同语义：aborted/error 与零值 usage 都不作数。 */
function validAssistantUsage(message: Message): Usage | undefined {
    if (message.role !== "assistant" || message.stopReason === "aborted" || message.stopReason === "error") {
        return undefined;
    }
    return message.usage && calculateContextTokens(message.usage) > 0 ? message.usage : undefined;
}

/**
 * 不读取 blob 的上下文 token 估算。
 * 保留「最近一条有效 assistant usage 为准、仅估算 trailing」语义——usage 是
 * provider 真实值不可覆盖，CJK 修正只作用于 trailing 段与无 usage 路径。
 */
export function estimateStoredContextTokens(messages: readonly StoredMessageLike[]): StoredContextTokenEstimate {
    const prepared = messages.map(storedMessageForEstimate);
    for (let i = prepared.length - 1; i >= 0; i--) {
        const usage = validAssistantUsage(prepared[i]!);
        if (usage) {
            const usageTokens = calculateContextTokens(usage);
            let trailingTokens = 0;
            for (let j = i + 1; j < prepared.length; j++) {
                trailingTokens += estimateStoredMessageTokens(prepared[j]!);
            }
            return {tokens: usageTokens + trailingTokens, usageTokens, trailingTokens, lastUsageIndex: i};
        }
    }
    let estimated = 0;
    for (const message of prepared) {
        estimated += estimateStoredMessageTokens(message);
    }
    return {tokens: estimated, usageTokens: 0, trailingTokens: estimated, lastUsageIndex: null};
}
