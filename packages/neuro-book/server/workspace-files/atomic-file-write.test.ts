import fs, {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {afterEach, describe, expect, it, vi} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {writeTextFileAtomically} from "nbook/server/workspace-files/atomic-file-write";
import {createWorkspaceDirectory, createWorkspaceFile, writeWorkspaceTextFile} from "nbook/server/workspace-files/workspace-files";

const roots: string[] = [];

afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("原子文本写盘", () => {
    it("写入后内容完整且目录无临时文件残留", async () => {
        const root = await fixtureRoot();
        const target = path.join(root, "manuscript", "chapter-1.md");
        await mkdir(path.dirname(target), {recursive: true});
        const content = "---\ntitle: 第一章\n---\n\n正文\n".repeat(100);

        await writeTextFileAtomically(target, content);

        expect(await readFile(target, "utf-8")).toBe(content);
        expect(await residualTmpNames(path.dirname(target))).toEqual([]);
    });

    it("覆盖写整体替换内容，不残留旧内容前缀", async () => {
        const root = await fixtureRoot();
        const target = path.join(root, "note.md");
        await writeFile(target, "旧内容".repeat(500), "utf-8");

        await writeTextFileAtomically(target, "新");

        expect(await readFile(target, "utf-8")).toBe("新");
        expect(await residualTmpNames(root)).toEqual([]);
    });

    it("rename 失败时原文件不被截断且临时文件被清理", async () => {
        const root = await fixtureRoot();
        const target = path.join(root, "manuscript", "chapter-1.md");
        await mkdir(path.dirname(target), {recursive: true});
        const original = "完整旧版".repeat(200);
        await writeFile(target, original, "utf-8");
        vi.spyOn(fs, "rename").mockRejectedValueOnce(new Error("injected rename failure"));

        await expect(writeTextFileAtomically(target, "新版")).rejects.toThrow("injected rename failure");

        expect(await readFile(target, "utf-8")).toBe(original);
        expect(await residualTmpNames(path.dirname(target))).toEqual([]);
    });

    it("并发写同一目标时最终内容为某一完整版本且无临时文件残留", async () => {
        const root = await fixtureRoot();
        const target = path.join(root, "note.md");
        const left = "左".repeat(1000);
        const right = "右".repeat(1000);

        await Promise.all([
            writeTextFileAtomically(target, left),
            writeTextFileAtomically(target, right),
        ]);

        expect([left, right]).toContain(await readFile(target, "utf-8"));
        expect(await residualTmpNames(root)).toEqual([]);
    });

    it("writeWorkspaceTextFile 覆盖正文后内容完整且无临时文件残留", async () => {
        const root = await fixtureRoot();
        const workspaceRoot = absoluteFsPath(root);

        await writeWorkspaceTextFile(workspaceRoot, "manuscript/chapter-1.md", "第一版");
        await writeWorkspaceTextFile(workspaceRoot, "manuscript/chapter-1.md", "第二版");

        expect(await readFile(path.join(root, "manuscript", "chapter-1.md"), "utf-8")).toBe("第二版");
        expect(await residualTmpNames(path.join(root, "manuscript"))).toEqual([]);
    });

    it("createWorkspaceFile 与 createWorkspaceDirectory 落盘后无临时文件残留", async () => {
        const root = await fixtureRoot();
        const workspaceRoot = absoluteFsPath(root);

        await createWorkspaceFile({root: workspaceRoot, filePath: "note.md", content: "笔记"});
        await createWorkspaceDirectory({
            root: workspaceRoot,
            dirPath: "manuscript/vol-1",
            indexContent: "---\ntitle: 卷一\n---\n",
            stateContent: "---\n---\n",
        });

        expect(await readFile(path.join(root, "note.md"), "utf-8")).toBe("笔记");
        expect(await readFile(path.join(root, "manuscript", "vol-1", "index.md"), "utf-8")).toBe("---\ntitle: 卷一\n---\n");
        expect(await residualTmpNames(root)).toEqual([]);
        expect(await residualTmpNames(path.join(root, "manuscript", "vol-1"))).toEqual([]);
    });
});

async function fixtureRoot(): Promise<string> {
    const root = await mkdtemp(testHostPath("nbook-atomic-write-"));
    roots.push(root);
    return root;
}

async function residualTmpNames(directory: string): Promise<string[]> {
    return (await readdir(directory)).filter((name) => name.endsWith(".tmp"));
}
