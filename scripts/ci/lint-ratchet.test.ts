import {readFile} from "node:fs/promises";
import {resolve} from "node:path";

import {describe, expect, it} from "vitest";

import {evaluateRatchet, readBaseline} from "./lint-ratchet";

const root = resolve(import.meta.dirname, "..", "..");

describe("lint ratchet（P1-5 基线只降不升）", () => {
    it("evaluateRatchet 只在计数上升时失败", () => {
        const baseline = {errors: 10, warnings: 20};
        expect(evaluateRatchet(baseline, {errors: 10, warnings: 20}).ok).toBe(true);
        expect(evaluateRatchet(baseline, {errors: 9, warnings: 18}).ok).toBe(true);
        const errorUp = evaluateRatchet(baseline, {errors: 11, warnings: 20});
        expect(errorUp.ok).toBe(false);
        expect(errorUp.failures.join("\n")).toContain("error 计数上升");
        const warningUp = evaluateRatchet(baseline, {errors: 10, warnings: 21});
        expect(warningUp.ok).toBe(false);
        expect(warningUp.failures.join("\n")).toContain("warning 计数上升");
    });

    it("基线文件存在且为非负整数计数", () => {
        const baseline = readBaseline();
        expect(Number.isInteger(baseline.errors)).toBe(true);
        expect(Number.isInteger(baseline.warnings)).toBe(true);
        expect(baseline.errors).toBeGreaterThanOrEqual(0);
        expect(baseline.warnings).toBeGreaterThanOrEqual(0);
        expect(baseline.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    });

    it("code-baseline.yml 挂 lint ratchet job 且根脚本登记入口", async () => {
        const workflow = await readFile(resolve(root, ".github/workflows/code-baseline.yml"), "utf8");
        expect(workflow).toContain("bun run lint:ratchet");
        const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as {scripts: Record<string, string>};
        expect(manifest.scripts["lint:ratchet"]).toBe("bun scripts/ci/lint-ratchet.ts");
        expect(manifest.scripts["lint:ratchet:update"]).toBe("bun scripts/ci/lint-ratchet.ts --update");
    });
});
