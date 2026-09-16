import {describe, expect, it} from "vitest";
import {
    buildCommandPaletteFileItems,
    resolveAvailableSettingsSections,
    resolveAvailableSettingsTargets,
    SETTINGS_SECTION_CATALOG,
    settingsSectionsForScope,
} from "nbook/app/utils/command-palette-items";

const file = (path: string, title = "") => ({path, title, isDirectory: false, contentNode: false});
const dir = (path: string, contentNode = false, title = "") => ({path, title, isDirectory: true, contentNode});

describe("settingsSectionsForScope", () => {
    it("boot 只有安全分区", () => {
        expect(settingsSectionsForScope("boot")).toEqual(["security"]);
    });

    it("global 保持既有六分区顺序", () => {
        expect(settingsSectionsForScope("global")).toEqual(["models", "embedding", "cost", "web-tools", "agent-profile-models", "observability"]);
    });

    it("browser 三分区,project 仅角色模型", () => {
        expect(settingsSectionsForScope("browser")).toEqual(["frontend", "editor", "desktop"]);
        expect(settingsSectionsForScope("project")).toEqual(["agent-profile-models"]);
    });
});

describe("resolveAvailableSettingsSections", () => {
    it("项目目标不可用时多 scope 分区仍保留(还有 global)", () => {
        const values = resolveAvailableSettingsSections({projectScopeAvailable: false, desktopAvailable: false}).map((entry) => entry.value);
        expect(values).toContain("agent-profile-models");
        expect(values).not.toContain("desktop");
    });

    it("桌面桥可用时 desktop 分区回归", () => {
        const values = resolveAvailableSettingsSections({projectScopeAvailable: false, desktopAvailable: true}).map((entry) => entry.value);
        expect(values).toContain("desktop");
    });
});

describe("resolveAvailableSettingsTargets", () => {
    it("多 scope 分区按可用目标展开成行", () => {
        const targets = resolveAvailableSettingsTargets({projectScopeAvailable: true, desktopAvailable: false});
        const profileTargets = targets.filter((target) => target.section === "agent-profile-models").map((target) => target.scope);
        expect(profileTargets).toEqual(["global", "project"]);
    });

    it("项目目标不可用时不出 project 行", () => {
        const targets = resolveAvailableSettingsTargets({projectScopeAvailable: false, desktopAvailable: false});
        expect(targets.every((target) => target.scope !== "project")).toBe(true);
        expect(targets.length).toBe(SETTINGS_SECTION_CATALOG.length - 1);
    });
});

describe("SETTINGS_SECTION_CATALOG 检索别名", () => {
    it("每个分区都登记非空别名表", () => {
        for (const entry of SETTINGS_SECTION_CATALOG) {
            expect(entry.keywords.length, `${entry.value} 缺检索别名`).toBeGreaterThan(0);
        }
    });

    it("作者心智词能落到功能分区:字体→编辑器,主题→前端设定,服务商→模型设置", () => {
        const keywordsOf = (value: string) => SETTINGS_SECTION_CATALOG.find((entry) => entry.value === value)?.keywords ?? [];
        expect(keywordsOf("editor")).toContain("字体");
        expect(keywordsOf("frontend")).toContain("主题");
        expect(keywordsOf("models")).toContain("服务商");
    });
});

describe("buildCommandPaletteFileItems", () => {
    it("纯目录不进面板,内容目录与文件进", () => {
        const items = buildCommandPaletteFileItems([
            dir("manuscript/001-volume"),
            dir("manuscript/001-volume/001-chapter", true, "夜巡"),
            file("manuscript/001-volume/002-chapter/index.md", "围城"),
            file("project.yaml"),
        ]);
        expect(items.map((item) => item.target)).toEqual([
            "manuscript/001-volume/001-chapter",
            "manuscript/001-volume/002-chapter/index.md",
            "project.yaml",
        ]);
    });

    it("空标题回退路径 basename,id 稳定带前缀", () => {
        const items = buildCommandPaletteFileItems([file("lorebook/character/ren/index.md")]);
        expect(items).toHaveLength(1);
        expect(items[0]?.label).toBe("index.md");
        expect(items[0]?.id).toBe("file:lorebook/character/ren/index.md");
        expect(items[0]?.iconClass).toBe("i-lucide-file-text");
    });

    it("内容目录用文件夹图标", () => {
        const items = buildCommandPaletteFileItems([dir("manuscript/001-volume/001-chapter", true, "夜巡")]);
        expect(items).toHaveLength(1);
        expect(items[0]?.label).toBe("夜巡");
        expect(items[0]?.iconClass).toBe("i-lucide-folder");
    });
});
