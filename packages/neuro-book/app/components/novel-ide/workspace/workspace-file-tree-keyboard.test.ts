import {describe, expect, it} from "vitest";
import {collectVisibleTreePaths, type WorkspaceTreeNode} from "nbook/app/components/novel-ide/workspace/workspace-file-tree";

function node(path: string, isDirectory = false, children: WorkspaceTreeNode[] = []): WorkspaceTreeNode {
    return {
        path,
        absolutePath: `/${path}`,
        title: path,
        isDirectory,
        editable: true,
        contentNode: false,
        children,
    } as WorkspaceTreeNode;
}

const tree: WorkspaceTreeNode[] = [
    node("manuscript", true, [
        node("manuscript/001-volume", true, [
            node("manuscript/001-volume/001-chapter", true, [
                node("manuscript/001-volume/001-chapter/index.md"),
            ]),
        ]),
    ]),
    node("lorebook", true, [
        node("lorebook/README.md"),
    ]),
    node("notes.md"),
];

describe("collectVisibleTreePaths", () => {
    it("全部收起时只列出根层", () => {
        expect(collectVisibleTreePaths(tree, new Set())).toEqual([
            "manuscript",
            "lorebook",
            "notes.md",
        ]);
    });

    it("展开的目录递归列出子节点, 未展开的仍然折叠", () => {
        expect(collectVisibleTreePaths(tree, new Set(["manuscript"]))).toEqual([
            "manuscript",
            "manuscript/001-volume",
            "lorebook",
            "notes.md",
        ]);
    });

    it("嵌套展开需要每一级祖先都在集合内", () => {
        const paths = collectVisibleTreePaths(tree, new Set(["manuscript", "manuscript/001-volume", "manuscript/001-volume/001-chapter"]));
        expect(paths).toEqual([
            "manuscript",
            "manuscript/001-volume",
            "manuscript/001-volume/001-chapter",
            "manuscript/001-volume/001-chapter/index.md",
            "lorebook",
            "notes.md",
        ]);
    });

    it("深层路径在集合中但祖先未展开时不可见", () => {
        expect(collectVisibleTreePaths(tree, new Set(["manuscript/001-volume/001-chapter"]))).toEqual([
            "manuscript",
            "lorebook",
            "notes.md",
        ]);
    });

    it("空子节点目录不阻断兄弟节点", () => {
        const paths = collectVisibleTreePaths(tree, new Set(["lorebook"]));
        expect(paths).toContain("lorebook/README.md");
        expect(paths[paths.length - 1]).toBe("notes.md");
    });
});
