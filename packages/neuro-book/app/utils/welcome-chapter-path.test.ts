import {describe, expect, it} from "vitest";
import {resolveLatestVolumeSegment, resolveManagedChapterPath, resolveNextChapterSegment} from "nbook/app/utils/welcome-chapter-path";

const dir = (path: string) => ({path, isDirectory: true});
const file = (path: string) => ({path, isDirectory: false});

describe("resolveLatestVolumeSegment", () => {
    it("空树回退 001-volume", () => {
        expect(resolveLatestVolumeSegment([])).toBe("001-volume");
    });

    it("取字典序最新的卷目录", () => {
        expect(resolveLatestVolumeSegment([
            dir("manuscript/001-volume"),
            dir("manuscript/003-volume"),
            dir("manuscript/002-volume"),
        ])).toBe("003-volume");
    });

    it("忽略非卷命名与非 manuscript 目录", () => {
        expect(resolveLatestVolumeSegment([
            dir("manuscript/notes"),
            dir("lorebook/character"),
            file("manuscript/009-volume/index.md"),
        ])).toBe("001-volume");
    });
});

describe("resolveNextChapterSegment", () => {
    it("空卷从 001 起", () => {
        expect(resolveNextChapterSegment([], "001-volume")).toBe("001-chapter");
    });

    it("取现存最大章号 +1,兼容 index.md 深层路径", () => {
        expect(resolveNextChapterSegment([
            dir("manuscript/001-volume/001-chapter"),
            file("manuscript/001-volume/001-chapter/index.md"),
            dir("manuscript/001-volume/013-chapter/"),
            dir("manuscript/002-volume/009-chapter"),
        ], "001-volume")).toBe("014-chapter");
    });

    it("忽略非章节命名的目录", () => {
        expect(resolveNextChapterSegment([
            dir("manuscript/001-volume/appendix"),
        ], "001-volume")).toBe("001-chapter");
    });
});

describe("resolveManagedChapterPath", () => {
    it("空树落到 001-volume/001-chapter", () => {
        expect(resolveManagedChapterPath([])).toBe("manuscript/001-volume/001-chapter/index.md");
    });

    it("落到最新卷的下一章", () => {
        expect(resolveManagedChapterPath([
            dir("manuscript/001-volume"),
            dir("manuscript/001-volume/001-chapter"),
            dir("manuscript/002-volume"),
            dir("manuscript/002-volume/001-chapter"),
            dir("manuscript/002-volume/002-chapter"),
        ])).toBe("manuscript/002-volume/003-chapter/index.md");
    });
});
