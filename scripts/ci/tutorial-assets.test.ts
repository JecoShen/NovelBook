import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {verifyTutorialAssets} from "#scripts/ci/tutorial-assets";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const assets = [
    "tutorial-api-config-step-01-provider.png",
    "tutorial-api-config-step-02-endpoint.png",
    "tutorial-api-config-step-03-api-key.png",
    "tutorial-api-config-step-04-model.png",
] as const;
const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("tutorial assets", () => {
    it("接受四张 PNG 及中文、英文页面中的本地引用", async () => {
        const root = await fixtureRoot();
        await Promise.all(assets.map((asset) => writeFile(join(root, "vitepress", "public", "images", asset), PNG)));
        await writePages(root);

        await expect(verifyTutorialAssets(root)).resolves.toEqual([]);
    });

    it("报告缺失或伪造的步骤图", async () => {
        const root = await fixtureRoot();
        await Promise.all(assets.slice(0, 2).map((asset) => writeFile(join(root, "vitepress", "public", "images", asset), PNG)));
        await writeFile(join(root, "vitepress", "public", "images", assets[2]), "not a png", "utf8");
        await writePages(root);

        const failures = await verifyTutorialAssets(root);

        expect(failures).toEqual(expect.arrayContaining([
            "教程图片缺失：vitepress/public/images/tutorial-api-config-step-04-model.png",
            "教程图片不是 PNG：vitepress/public/images/tutorial-api-config-step-03-api-key.png",
        ]));
    });
    it("报告页面缺少任一步骤图引用", async () => {
        const root = await fixtureRoot();
        await Promise.all(assets.map((asset) => writeFile(join(root, "vitepress", "public", "images", asset), PNG)));
        await writePages(root);
        const quickStartPath = join(root, "vitepress/locales/zh-Hans/quick-start.md");
        await writeFile(quickStartPath, "![step](/images/tutorial-api-config-step-01-provider.png)\n", "utf8");

        const failures = await verifyTutorialAssets(root);

        expect(failures).toContain("教程页面缺少步骤图引用：vitepress/locales/zh-Hans/quick-start.md -> tutorial-api-config-step-02-endpoint.png");
    });

    it("拒绝教程页面引用站点根之外的文件", async () => {
        const root = await fixtureRoot();
        await Promise.all(assets.map((asset) => writeFile(join(root, "vitepress", "public", "images", asset), PNG)));
        await writePages(root, "../../../../outside.png");

        await expect(verifyTutorialAssets(root)).resolves.toContain("教程图片引用越界：vitepress/locales/zh-Hans/quick-start.md -> ../../../../outside.png");
    });

    it("检查当前站点的四张步骤图和四个页面", async () => {
        await expect(verifyTutorialAssets(process.cwd())).resolves.toEqual([]);
    });
});

async function fixtureRoot(): Promise<string> {
    const root = await createTestTmpRoot("tutorial-assets", "tutorial-assets-test");
    roots.push(root);
    await mkdir(join(root, "vitepress", "public", "images"), {recursive: true});
    await mkdir(join(root, "vitepress", "locales", "zh-Hans", "tutorials"), {recursive: true});
    return root;
}

async function writePages(root: string, quickStartReference = "/images/tutorial-api-config-step-01-provider.png"): Promise<void> {
    const pages = [
        {file: "vitepress/locales/zh-Hans/quick-start.md", directory: "vitepress/locales/zh-Hans", firstReference: quickStartReference},
        {file: "vitepress/locales/zh-Hans/tutorials/00-before-you-start.md", directory: "vitepress/locales/zh-Hans/tutorials", firstReference: ""},
        {file: "vitepress/locales/en-US/quick-start.md", directory: "vitepress/locales/en-US", firstReference: ""},
        {file: "vitepress/locales/en-US/tutorials/00-before-you-start.md", directory: "vitepress/locales/en-US/tutorials", firstReference: ""},
    ] as const;
    await Promise.all(pages.map(async (page) => {
        await mkdir(join(root, page.directory), {recursive: true});
        const references = assets.map((asset, index) => index === 0 && page.firstReference ? page.firstReference : `/images/${asset}`);
        await writeFile(join(root, page.file), `${references.map((reference) => `![step](${reference})`).join("\n")}\n`, "utf8");
    }));
}
