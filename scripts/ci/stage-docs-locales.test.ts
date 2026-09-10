import {access, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {DOCS_STAGING_MARKER, stageDocsLocales} from "#scripts/ci/stage-docs-locales";

const fixtureRoots: string[] = [];

afterEach(async () => {
    await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("docs locale staging", () => {
    it("clean rebuild 映射双语正文、public 并传播删除", async () => {
        const repoRoot = await createTestTmpRoot("docs-locale-staging", "docs-locale-staging-test");
        fixtureRoots.push(repoRoot);
        await writeFixture(repoRoot, "vitepress/locales/zh-Hans/index.md", "# 中文\n");
        await writeFixture(repoRoot, "vitepress/locales/zh-Hans/removed.md", "# removed\n");
        await writeFixture(repoRoot, "vitepress/locales/en-US/index.md", "# English\n");
        await writeFixture(repoRoot, "vitepress/public/official/index.html", "official\n");
        await writeFixture(repoRoot, "packages/llmlint/docs/promo/eval-lab/index.html", "eval-promo\n");
        await writeFixture(repoRoot, "packages/llmlint/docs/promo/evolution-lab/index.html", "evolution-promo\n");
        await writeFixture(repoRoot, "packages/llmlint/docs/promo/evolution-lab/mechanism.html", "mechanism-promo\n");
        const stagedRoot = await stageDocsLocales({repoRoot});
        await expect(readFile(join(stagedRoot, "index.md"), "utf8")).resolves.toBe("# 中文\n");
        await expect(readFile(join(stagedRoot, "en/index.md"), "utf8")).resolves.toBe("# English\n");
        await expect(readFile(join(stagedRoot, "public/promo/eval-lab/index.html"), "utf8")).resolves.toBe("eval-promo\n");
        await expect(readFile(join(stagedRoot, "public/promo/evolution-lab/index.html"), "utf8")).resolves.toBe("evolution-promo\n");
        await expect(readFile(join(stagedRoot, "public/promo/evolution-lab/mechanism.html"), "utf8")).resolves.toBe("mechanism-promo\n");
        await expect(readFile(join(stagedRoot, "public/en/promo/eval-lab/index.html"), "utf8")).resolves.toBe("eval-promo\n");
        await expect(readFile(join(stagedRoot, "public/en/promo/evolution-lab/index.html"), "utf8")).resolves.toBe("evolution-promo\n");
        await expect(readFile(join(stagedRoot, "public/en/promo/evolution-lab/mechanism.html"), "utf8")).resolves.toBe("mechanism-promo\n");
        await rm(join(repoRoot, "vitepress/locales/zh-Hans/removed.md"));
        await writeFixture(repoRoot, "vitepress/.vitepress/staged/stale.md", "stale\n");
        await stageDocsLocales({repoRoot});

        await expect(access(join(stagedRoot, "removed.md"))).rejects.toThrow();
        await expect(access(join(stagedRoot, "stale.md"))).rejects.toThrow();
        await expect(JSON.parse(await readFile(join(stagedRoot, DOCS_STAGING_MARKER), "utf8"))).toEqual({
            schema: "nbook.docs-locale-staging/v1",
            locales: {"zh-Hans": "/", "en-US": "/en/"},
        });
    });
});

async function writeFixture(repoRoot: string, relativePath: string, content: string): Promise<void> {
    const path = join(repoRoot, relativePath);
    await mkdir(join(path, ".."), {recursive: true});
    await writeFile(path, content, "utf8");
}
