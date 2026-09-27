import {describe, expect, it} from "vitest";
import type {StoredAgentMessage} from "nbook/server/agent/messages/stored-types";
import {
    CJK_CHARS_PER_TOKEN,
    estimatePlainTextTokens,
    estimateStoredContextTokens,
    estimateStoredMessageTokens,
    MESSAGE_OVERHEAD_TOKENS,
    NON_CJK_CHARS_PER_TOKEN,
} from "nbook/server/agent/messages/stored-message-tokens";

function userText(text: string, timestamp = 1): StoredAgentMessage {
    return {role: "user", content: [{type: "text", text}], timestamp};
}

function assistantWithUsage(text: string, totalTokens: number, stopReason = "stop"): StoredAgentMessage {
    return {
        role: "assistant",
        content: [{type: "text", text}],
        api: "test",
        provider: "test",
        model: "test",
        usage: {
            input: totalTokens,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens,
            cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
        },
        stopReason,
        timestamp: 2,
    } as StoredAgentMessage;
}

// 真实小说风格 CJK 长文 fixture（约 210 字），用于基准带验收。
const CJK_FIXTURE = "陆深提着灯走进雨里的时候，整条老街已经看不清屋檐。他记得师父说过，夜里行路最忌回头，可身后那串脚印始终不远不近，像有人踩着他的影子走路。灯笼的火苗被风压得极低，青石板上的水光一层叠着一层。他数着自己的呼吸，一步，两步，三步，直到巷口那棵老槐树的轮廓从雨幕里慢慢浮出来，像一只蹲了多年的兽。他停住脚，把灯笼举高了些。树下站着一个人，斗笠压得很低，手里牵着一匹没有鞍的马。那马也不嘶鸣，只是安静地看着他，眼睛亮得吓人。陆深忽然明白，师父临终前那句话不是叮嘱，而是预言。";

const ASCII_FIXTURE = "The rider walked into the rain with a lantern in hand, and the old street had already vanished behind the eaves. He remembered what his master once told him: never look back when walking at night. Yet the footsteps behind him kept pace, neither closer nor farther, as if someone were walking on his shadow. He counted his own breaths, one two three, until the outline of the old locust tree rose slowly from the curtain of rain like a beast that had crouched there for years.";

describe("stored message tokens：CJK 分段估算器（p-009 A4）", () => {
    it("纯 CJK 文本按 1.5 字符/token 折算并加消息 overhead", () => {
        // 150 CJK 字符 → 100 + 4
        expect(estimateStoredMessageTokens(userText("汉".repeat(150)))).toBe(100 + MESSAGE_OVERHEAD_TOKENS);
    });

    it("纯 ASCII 文本维持 4 字符/token 不退化", () => {
        // 200 ASCII 字符 → 50 + 4
        expect(estimateStoredMessageTokens(userText("a".repeat(200)))).toBe(50 + MESSAGE_OVERHEAD_TOKENS);
    });

    it("中英混排按段分别折算", () => {
        // "abcd汉字"：4 ASCII → 1；2 CJK → 1.333…；合计 ceil(2.333…) = 3 + 4
        expect(estimateStoredMessageTokens(userText("abcd汉字"))).toBe(3 + MESSAGE_OVERHEAD_TOKENS);
    });

    it("全角标点与假名按 CJK 段计", () => {
        // 22 个全角标点/假名/表意字 → ceil(22/1.5)=15 + 4
        expect(estimateStoredMessageTokens(userText("「」、。こんにちは世界".repeat(2)))).toBe(15 + MESSAGE_OVERHEAD_TOKENS);
    });

    it("表意文字扩展区代理对按 1 个 CJK 码点计", () => {
        // 4 个 U+20000 扩展 B 字符（UTF-16 为 8 单元）→ ceil(4/1.5)=3 + 4
        expect(estimateStoredMessageTokens(userText("𠀀𠀁𠀂𠀃"))).toBe(3 + MESSAGE_OVERHEAD_TOKENS);
    });

    it("基准带：CJK 重文本落在实测 1.69±25% 区间，且系数取安全侧高估", () => {
        const estimated = estimatePlainTextTokens(CJK_FIXTURE);
        const charsPerToken = CJK_FIXTURE.length / estimated;
        // 2026-09-23 生产 traces 实测：CJK 50–90% 文本 1.69 字符/token（p10–p90 1.63–1.71）。
        expect(charsPerToken).toBeGreaterThanOrEqual(1.69 * 0.75);
        expect(charsPerToken).toBeLessThanOrEqual(1.69 * 1.25);
        // 系数 1.5 ≤ 实测 1.69：方向是高估 token（压缩提前触发），低估才是事故侧。
        expect(CJK_CHARS_PER_TOKEN).toBeLessThanOrEqual(1.69);
    });

    it("基准带：ASCII 主导文本落在实测 4.1–4.75 的 ±25% 区间", () => {
        const estimated = estimatePlainTextTokens(ASCII_FIXTURE);
        const charsPerToken = ASCII_FIXTURE.length / estimated;
        expect(charsPerToken).toBeGreaterThanOrEqual(4.1 * 0.75);
        expect(charsPerToken).toBeLessThanOrEqual(4.75 * 1.25);
        expect(NON_CJK_CHARS_PER_TOKEN).toBe(4);
    });

    it("estimatePlainTextTokens：非消息负载同口径、无 overhead", () => {
        expect(estimatePlainTextTokens("a".repeat(40))).toBe(10);
        expect(estimatePlainTextTokens("汉".repeat(40))).toBe(27);
        expect(estimatePlainTextTokens("")).toBe(0);
    });

    it("usage 优先路径语义不变，trailing CJK 段按新口径修正", () => {
        const messages: StoredAgentMessage[] = [
            userText("汉".repeat(300), 1),
            assistantWithUsage("done", 120),
            userText("汉".repeat(150), 3),
        ];
        const estimate = estimateStoredContextTokens(messages);
        expect(estimate.usageTokens).toBe(120);
        expect(estimate.lastUsageIndex).toBe(1);
        // trailing：150 CJK → 100 + 4；若仍是 chars/4 口径只会得到 38+4。
        expect(estimate.trailingTokens).toBe(100 + MESSAGE_OVERHEAD_TOKENS);
        expect(estimate.tokens).toBe(120 + 100 + MESSAGE_OVERHEAD_TOKENS);
    });

    it("aborted/error 与零值 usage 不作数，退回全量估算", () => {
        const withError: StoredAgentMessage[] = [assistantWithUsage("x", 500, "error"), userText("汉".repeat(30), 2)];
        const errorEstimate = estimateStoredContextTokens(withError);
        expect(errorEstimate.usageTokens).toBe(0);
        expect(errorEstimate.lastUsageIndex).toBeNull();

        const zeroUsage: StoredAgentMessage[] = [assistantWithUsage("x", 0), userText("汉".repeat(30), 2)];
        expect(estimateStoredContextTokens(zeroUsage).lastUsageIndex).toBeNull();
    });

    it("toolCall 按 name + JSON 参数计数", () => {
        const message = {
            role: "assistant",
            content: [
                {type: "toolCall", id: "c1", name: "write", arguments: {path: "章节.md", text: "汉".repeat(30)}},
            ],
            timestamp: 1,
        } as unknown as StoredAgentMessage;
        // name "write"（5 ASCII→1.25）+ JSON：24 ASCII→6 + 32 CJK→21.33…，合计 28.58… → ceil 29 + 4。
        // 对照：若仍按 chars/4 口径，30 个 CJK 字只计 7.5 token。
        expect(estimateStoredMessageTokens(message)).toBe(29 + MESSAGE_OVERHEAD_TOKENS);
    });
});
