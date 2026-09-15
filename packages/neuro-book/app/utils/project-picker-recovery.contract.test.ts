import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const pickerPath = fileURLToPath(new URL("../components/novel-ide/ProjectPickerScreen.vue", import.meta.url));

describe("Project Picker Session recovery contract", () => {
    it("挂载即按 recovery filter 预取首屏;已知零待确认且未展开时整块隐藏", async () => {
        const picker = await readFile(pickerPath, "utf8");

        expect(picker).toContain("void loadRecoverySessions(0, false);");
        expect(picker).toContain('v-if="!recoveryLoaded || recoveryTotal > 0 || recoveryExpanded"');
        expect(picker).toContain('scope: "all"');
        expect(picker).toContain('recovery: "required"');
        expect(picker).toContain("limit: RECOVERY_PAGE_SIZE");
    });

    it("展开承担预取失败后的重试;分页沿用服务端 offset/limit 协议", async () => {
        const picker = await readFile(pickerPath, "utf8");

        expect(picker).toContain("if (recoveryExpanded.value && !recoveryLoaded.value)");
        expect(picker).toContain("await loadRecoverySessions(0, false)");
    });

    it("沿用 nextOffset/hasMore 分页，并支持 Project 与 Workspace Root 两种恢复", async () => {
        const picker = await readFile(pickerPath, "utf8");

        expect(picker).toContain("recoveryOffset.value = page.nextOffset ?? offset + page.items.length");
        expect(picker).toContain("recoveryHasMore.value = page.hasMore");
        expect(picker).toContain("loadRecoverySessions(recoveryOffset, true)");
        expect(picker).toContain("projectRoot: workspaceRoot ? null : target");
        expect(picker).toContain("sessionApi.updateSessionCurrentProject(session.sessionId");
    });

    it("追加页按 sessionId 去重，恢复一项后同步前移下一页 offset", async () => {
        const picker = await readFile(pickerPath, "utf8");

        expect(picker).toContain("const knownSessionIds = new Set(recoverySessions.value.map((session) => session.sessionId));");
        expect(picker).toContain("page.items.filter((session) => !knownSessionIds.has(session.sessionId))");
        expect(picker).toContain("recoveryOffset.value = Math.max(0, recoveryOffset.value - 1);");
    });
});
