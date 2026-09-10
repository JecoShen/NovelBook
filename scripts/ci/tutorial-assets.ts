import {readFile} from "node:fs/promises";
import {isAbsolute, join, relative, resolve, sep} from "node:path";

const REQUIRED_TUTORIAL_ASSETS = [
    "tutorial-api-config-step-01-provider.png",
    "tutorial-api-config-step-02-endpoint.png",
    "tutorial-api-config-step-03-api-key.png",
    "tutorial-api-config-step-04-model.png",
] as const;
const TUTORIAL_DOCUMENTS = [
    "vitepress/locales/zh-Hans/quick-start.md",
    "vitepress/locales/zh-Hans/tutorials/00-before-you-start.md",
    "vitepress/locales/en-US/quick-start.md",
    "vitepress/locales/en-US/tutorials/00-before-you-start.md",
] as const;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IMAGE_REFERENCE_PATTERN = /!\[[^\]]*\]\(([^)]+)\)/gu;

export async function verifyTutorialAssets(repoRoot: string): Promise<string[]> {
    const root = resolve(repoRoot);
    const failures: string[] = [];
    const imageRoot = join(root, "vitepress", "public", "images");

    for (const asset of REQUIRED_TUTORIAL_ASSETS) {
        const path = join(imageRoot, asset);
        try {
            const bytes = await readFile(path);
            if (!bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
                failures.push(`教程图片不是 PNG：vitepress/public/images/${asset}`);
            }
        } catch {
            failures.push(`教程图片缺失：vitepress/public/images/${asset}`);
        }
    }

    for (const document of TUTORIAL_DOCUMENTS) {
        const path = join(root, document);
        let source: string;
        try {
            source = await readFile(path, "utf8");
        } catch {
            failures.push(`教程页面缺失：${document}`);
            continue;
        }
        const referencedTargets = new Set<string>();
        const references = [...source.matchAll(IMAGE_REFERENCE_PATTERN)].map((match) => match[1]);
        for (const reference of references) {
            if (!reference || reference.startsWith("http://") || reference.startsWith("https://")) continue;
            const target = reference.startsWith("/")
                ? resolve(root, "vitepress/public", reference.slice(1))
                : resolve(dirname(path), reference);
            if (!isContained(root, target)) {
                failures.push(`教程图片引用越界：${document} -> ${reference}`);
                continue;
            }
            try {
                await readFile(target);
                referencedTargets.add(target);
            } catch {
                failures.push(`教程图片引用缺失：${document} -> ${reference}`);
            }
        }
        for (const asset of REQUIRED_TUTORIAL_ASSETS) {
            if (!referencedTargets.has(resolve(imageRoot, asset))) {
                failures.push(`教程页面缺少步骤图引用：${document} -> ${asset}`);
            }
        }
    }

    return failures;
}

function dirname(path: string): string {
    return path.slice(0, Math.max(path.lastIndexOf(sep), path.lastIndexOf("/")));
}

function isContained(root: string, target: string): boolean {
    const relativePath = relative(root, target);
    return relativePath !== "" && relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
}
