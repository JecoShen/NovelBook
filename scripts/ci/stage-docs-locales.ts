#!/usr/bin/env bun
import {cp, mkdir, rm, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const DEFAULT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export const DOCS_STAGING_MARKER = ".staging-complete.json";

export type StageDocsLocalesOptions = {
    repoRoot?: string;
};

export async function stageDocsLocales(options: StageDocsLocalesOptions = {}): Promise<string> {
    const repoRoot = resolve(options.repoRoot ?? DEFAULT_REPO_ROOT);
    const vitepressRoot = resolve(repoRoot, "vitepress");
    const stagedRoot = resolve(vitepressRoot, ".vitepress/staged");

    await rm(stagedRoot, {recursive: true, force: true});
    await mkdir(stagedRoot, {recursive: true});
    await cp(resolve(vitepressRoot, "locales/zh-Hans"), stagedRoot, {recursive: true});
    await cp(resolve(vitepressRoot, "locales/en-US"), resolve(stagedRoot, "en"), {recursive: true});
    await cp(resolve(vitepressRoot, "public"), resolve(stagedRoot, "public"), {recursive: true});
    await cp(resolve(repoRoot, "packages/llmlint/docs/promo"), resolve(stagedRoot, "public/promo"), {recursive: true});
    await cp(resolve(repoRoot, "packages/llmlint/docs/promo"), resolve(stagedRoot, "public/en/promo"), {recursive: true});
    await writeFile(resolve(stagedRoot, DOCS_STAGING_MARKER), `${JSON.stringify({
        schema: "nbook.docs-locale-staging/v1",
        locales: {"zh-Hans": "/", "en-US": "/en/"},
    }, null, 2)}\n`, "utf8");

    return stagedRoot;
}

if (import.meta.main) {
    await stageDocsLocales();
}
