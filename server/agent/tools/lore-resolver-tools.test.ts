import {describe, expect, it} from "vitest";
import {createLoreResolverTools} from "nbook/server/agent/tools/lore-resolver-tools";
import type {ToolExecutionContext} from "nbook/server/agent/tools/types";

describe("lore_resolver_query 工具", () => {
    const tools = createLoreResolverTools();
    const tool = tools[0]!;

    it("定义 lore_resolver_query 只读工具与参数 schema", () => {
        expect(tool.key).toBe("lore_resolver_query");
        expect(tool.mutatesWorkspace).toBe(false);
        expect(tool.description.length).toBeGreaterThan(10);
        expect(tool.parameters).toBeDefined();
    });

    it("无已就绪 Project 时返回友好提示而非报错", async () => {
        const context = {currentProject: null} as unknown as ToolExecutionContext;
        const result = await tool.executeWithContext!(context, "tool-call-1", {
            extra_triggers: ["陆深"],
        });
        expect(result.content).toHaveLength(1);
        expect(result.content[0]).toMatchObject({type: "text"});
        expect((result.content[0] as {text: string}).text).toContain("没有已就绪的 Project");
    });

    it("execute() 需要 v3 session context（无 session 上下文执行入口必须抛错）", async () => {
        await expect(tool.execute!("tool-call-2", {extra_triggers: ["陆深"]})).rejects.toThrow(/session context/);
    });
});
