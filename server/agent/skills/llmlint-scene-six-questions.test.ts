import {describe, expect, it} from "vitest";
import {loadConfig} from "nbook/assets/workspace/.nbook/agent/skills/llmlint/src/config";
import {loadRules} from "nbook/assets/workspace/.nbook/agent/skills/llmlint/src/rules";
import {scanText} from "nbook/assets/workspace/.nbook/agent/skills/llmlint/src/scanner";

describe("cn.structure.scene-six-questions ruleset (P1-4)", () => {
    it("loads scene-six-questions.json via builtin/default ruleset (level=low)", async () => {
        const {config} = await loadConfig({cwd: process.cwd()});
        const loadedRules = await loadRules(config);

        const scene6q = loadedRules.regexRules.find(
            (rule) => rule.id === "cn.structure.scene-six-questions"
        );

        expect(scene6q).toBeDefined();
        expect(scene6q?.level).toBe("low");
        expect(scene6q?.ruleset).toBe("builtin/default");
    });

    it("level is never medium or high (P1-4 决策: 软提示永不变强)", async () => {
        const {config} = await loadConfig({cwd: process.cwd()});
        const loadedRules = await loadRules(config);

        const scene6q = loadedRules.regexRules.find(
            (rule) => rule.id === "cn.structure.scene-six-questions"
        );

        expect(scene6q).toBeDefined(); // guard 防 vacuous pass (RED 严格性)
        expect(scene6q?.level).not.toBe("medium");
        expect(scene6q?.level).not.toBe("high");
    });

    it("action message 引用 reference/scene-six-questions.md 模板路径", async () => {
        const {config} = await loadConfig({cwd: process.cwd()});
        const loadedRules = await loadRules(config);

        const scene6q = loadedRules.regexRules.find(
            (rule) => rule.id === "cn.structure.scene-six-questions"
        );

        expect(scene6q).toBeDefined();
        expect(scene6q?.action.type).toBe("suggest");
        if (scene6q?.action.type === "suggest") {
            expect(scene6q.action.message).toContain("reference/scene-six-questions.md");
        }
    });

    it("trigger: scanText 缺 ## 场景 段时生成 issue (I2 修复: 真实 issue 生成验证)", async () => {
        const {config} = await loadConfig({cwd: process.cwd()});
        const loadedRules = await loadRules(config);

        const scene6q = loadedRules.regexRules.find(
            (rule) => rule.id === "cn.structure.scene-six-questions"
        );
        expect(scene6q).toBeDefined();

        const chapterNoScene = "# 标题\n\n正文无 ## 场景 段。\n";
        const issues = scanText(chapterNoScene, [scene6q!]);
        const scene6qIssue = issues.find(
            (i) => i.rule.id === "cn.structure.scene-six-questions"
        );
        expect(scene6qIssue).toBeDefined();
        expect(scene6qIssue?.rule.level).toBe("low");
    });
});
