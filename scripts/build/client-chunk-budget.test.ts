import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";

import {
    assertClientChunkBudget,
    CLIENT_CHUNK_BUDGET,
    resolveEagerChunkFiles,
} from "#scripts/build/client-chunk-budget.mjs";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

const MINIFIED_ENTRY_ONLY = 'const x={file:"Bb728ywI.js",name:"entry",src:"../../../node_modules/nuxt/dist/app/entry.js",isEntry:!0,dynamicImports:["_lazy111.js"]};';
const MINIFIED_ENTRY_WITH_IMPORTS = 'const x={file:"Dbs6iZdR.js",name:"entry",src:"../../../node_modules/nuxt/dist/app/entry.js",isEntry:!0,imports:["_vendor-monaco.aaa.js","_vendor-tiptap.bbb.js"],dynamicImports:[]};';
const RAW_ENTRY_ONLY = 'const x={file:"entry.aaa.js",name:"entry",src:"entry.js",isEntry:true,dynamicImports:[]};';

async function createImageRoot(options: {
    chunks: Record<string, string>;
    manifest?: string;
    manifestPath?: string;
}): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "nbook-chunk-budget-"));
    roots.push(root);
    const nuxtDir = join(root, "public", "_nuxt");
    await mkdir(nuxtDir, {recursive: true});
    for (const [name, content] of Object.entries(options.chunks)) {
        await writeFile(join(nuxtDir, name), content, "utf8");
    }
    if (options.manifest !== undefined) {
        const manifestPath = join(root, options.manifestPath ?? "server/index.mjs");
        await mkdir(join(manifestPath, ".."), {recursive: true});
        await writeFile(manifestPath, options.manifest, "utf8");
    }
    return root;
}

const tightBudget = Object.freeze({
    eager: Object.freeze({maxRawBytes: 1_000, maxGzipBytes: 1_000}),
    perChunk: Object.freeze({maxRawBytes: 100_000, maxGzipBytes: 100_000}),
    maxTotalGzipBytes: 100_000,
});

describe("resolveEagerChunkFiles", () => {
    it("minified entry 无静态 imports 时 eager 只有 entry 自身", () => {
        expect(resolveEagerChunkFiles(MINIFIED_ENTRY_ONLY)).toEqual(["Bb728ywI.js"]);
    });

    it("entry 的 imports 里下划线键按共享 chunk 文件名还原", () => {
        expect(resolveEagerChunkFiles(MINIFIED_ENTRY_WITH_IMPORTS)).toEqual([
            "Dbs6iZdR.js",
            "vendor-monaco.aaa.js",
            "vendor-tiptap.bbb.js",
        ]);
    });

    it("imports 出现非下划线键时 fail closed（manifest 结构漂移交人审）", () => {
        const drifted = 'const x={file:"e.js",name:"entry",src:"entry.js",isEntry:!0,imports:["../../../node_modules/nuxt/dist/app/error-500.vue"]};';
        expect(() => resolveEagerChunkFiles(drifted)).toThrow(/无法静态还原/);
    });

    it("manifest 里没有 isEntry 节点时 fail closed", () => {
        expect(() => resolveEagerChunkFiles("const x = {};")).toThrow(/isEntry/);
    });
});

describe("assertClientChunkBudget", () => {
    it("健康产物（entry 无静态依赖）返回实测摘要", async () => {
        const root = await createImageRoot({
            chunks: {"Bb728ywI.js": "a".repeat(400), "_lazy.js": "b".repeat(50_000)},
            manifest: MINIFIED_ENTRY_ONLY,
        });

        const summary = await assertClientChunkBudget(root, tightBudget);
        expect(summary.eagerFiles).toEqual(["Bb728ywI.js"]);
        expect(summary.chunks).toBe(2);
    });

    it("raw 构建的 manifest 载体（server/chunks/build/client.precomputed.mjs）同样可检", async () => {
        const root = await createImageRoot({
            chunks: {"entry.aaa.js": "a".repeat(100)},
            manifest: RAW_ENTRY_ONLY,
            manifestPath: "server/chunks/build/client.precomputed.mjs",
        });

        await expect(assertClientChunkBudget(root, tightBudget)).resolves.toMatchObject({chunks: 1});
    });

    it("entry 静态依赖把 eager 集合顶超预算时 fail closed（manualChunks 回归形态）", async () => {
        const root = await createImageRoot({
            chunks: {
                "Dbs6iZdR.js": "a".repeat(300),
                "vendor-monaco.aaa.js": "m".repeat(5_000),
                "vendor-tiptap.bbb.js": "t".repeat(5_000),
            },
            manifest: MINIFIED_ENTRY_WITH_IMPORTS,
        });

        await expect(assertClientChunkBudget(root, tightBudget)).rejects.toThrow(/eager 集合/);
    });

    it("懒加载大 chunk 在 perChunk 预算内即放行（eager 与 lazy 分开计价）", async () => {
        const root = await createImageRoot({
            chunks: {"Bb728ywI.js": "a".repeat(400), "lazy-big.js": "b".repeat(90_000)},
            manifest: MINIFIED_ENTRY_ONLY,
        });

        await expect(assertClientChunkBudget(root, tightBudget)).resolves.toMatchObject({chunks: 2});
    });

    it("单 chunk 超 perChunk 事故上限时 fail closed", async () => {
        const root = await createImageRoot({
            chunks: {"Bb728ywI.js": "a".repeat(100), "monster.js": "b".repeat(100_001)},
            manifest: MINIFIED_ENTRY_ONLY,
        });

        await expect(assertClientChunkBudget(root, tightBudget)).rejects.toThrow(/monster\.js raw/);
    });

    it("manifest 缺失时 fail closed，不放行无依据产物", async () => {
        const root = await createImageRoot({chunks: {"a.js": "a"}});
        await expect(assertClientChunkBudget(root, tightBudget)).rejects.toThrow(/找不到 client manifest/);
    });

    it("登记的默认预算与健康产物实测量级一致（防阈值被静默放宽）", async () => {
        // 健康实测（2026-09-20 生产产物，门禁自检通过）：entry 432KB raw / 147KB gzip
        // 零静态依赖；最差懒 chunk 4.8MB / 1.34MB；合计 gzip 3.66MB。余量见实现头注释。
        expect(CLIENT_CHUNK_BUDGET.eager).toEqual({maxRawBytes: 1_500_000, maxGzipBytes: 450_000});
        expect(CLIENT_CHUNK_BUDGET.perChunk).toEqual({maxRawBytes: 5_500_000, maxGzipBytes: 1_500_000});
        expect(CLIENT_CHUNK_BUDGET.maxTotalGzipBytes).toBe(6_500_000);
    });
});
