import {readFile, readdir} from "node:fs/promises";
import {join} from "node:path";
import {parseArgs} from "node:util";
import {gzipSync} from "node:zlib";

/**
 * 客户端体积预算门禁：镜像级 files/bytes 预算管产物总量，管不了两类回归——
 * ① 首屏 eager 集合膨胀：2026-09-20 实测 manualChunks 会把 monaco/tiptap 从
 *    entry 的 dynamic import 提升为静态依赖，首屏预载从 432KB 涨到 4.8MB；
 * ② 单 chunk 失控：entry 曾达 4.8MB raw / 1.34MB gzip 无门禁（架构审查 §7.4）。
 * eager 集合从 client manifest 的 entry 节点取（file + imports 里 "_<file>" 形态
 * 的共享 chunk 键），阈值=健康实测+余量，调整须在同提交注释里给实测依据。
 */
export const CLIENT_CHUNK_BUDGET = Object.freeze({
    // 健康实测（2026-09-20 生产产物，门禁自检通过）：entry 432KB raw / 147KB gzip，静态依赖为零。
    eager: Object.freeze({maxRawBytes: 1_500_000, maxGzipBytes: 450_000}),
    // 健康最差懒加载 chunk（monaco+tiptap 合 chunk）：4.8MB raw / 1.34MB gzip。
    perChunk: Object.freeze({maxRawBytes: 5_500_000, maxGzipBytes: 1_500_000}),
    // 健康实测合计 gzip 3.66MB。
    maxTotalGzipBytes: 6_500_000,
});

/** 产物中 client manifest 的候选载体（后处理 bundle 与 raw 构建各一份）。 */
const MANIFEST_CANDIDATES = [
    "server/index.mjs",
    "server/chunks/build/client.precomputed.mjs",
    "server/chunks/nitro/nitro.mjs",
];

function formatKiB(bytes) {
    return `${(bytes / 1024).toFixed(1)}KiB`;
}

async function readManifestSource(imageRoot) {
    for (const relative of MANIFEST_CANDIDATES) {
        try {
            const source = await readFile(join(imageRoot, relative), "utf8");
            // raw 构建的 server/index.mjs 只是 nitro 引导壳，manifest 在 chunks 里，
            // 必须按内容而非存在性选定载体。
            if (source.includes("isEntry")) {
                return source;
            }
        } catch {
            // 候选路径不存在是正常情况，继续找下一份。
        }
    }
    throw new Error(`Client chunk 预算检查找不到 client manifest：${MANIFEST_CANDIDATES.join(" / ")} 均不存在于 ${imageRoot}`);
}

/**
 * 从 manifest 提取 eager 集合：entry chunk 文件 + 其 imports 中 "_<file>" 形态的
 * 共享 chunk（minify 后变量引用无法静态还原，但键名本身携带文件名）。
 * imports 出现非 "_" 键说明结构漂移，fail closed 交人审。
 */
export function resolveEagerChunkFiles(manifestSource) {
    const entryPattern = /file:"([^"]+\.js)",name:"entry",src:"[^"]*",isEntry:(?:!0|true)(?:,imports:\[([^\]]*)\])?/u;
    const match = entryPattern.exec(manifestSource);
    if (!match) {
        throw new Error("Client manifest 中找不到 isEntry 的 entry chunk 节点。");
    }
    const eager = new Set([match[1]]);
    const importKeys = match[2] ? match[2].match(/"([^"]+)"/gu) ?? [] : [];
    for (const quoted of importKeys) {
        const key = quoted.slice(1, -1);
        if (!key.startsWith("_")) {
            throw new Error(`entry 的静态依赖出现无法静态还原的键：${key}（manifest 结构漂移，需人审预算口径）`);
        }
        eager.add(key.slice(1));
    }
    return [...eager];
}

/**
 * 断言 Product 镜像（含 public/_nuxt 与 server manifest）满足体积预算；返回实测摘要。
 * 违规时抛出聚合全部违例行的 Error。
 */
export async function assertClientChunkBudget(imageRoot, budget = CLIENT_CHUNK_BUDGET) {
    const nuxtDir = join(imageRoot, "public", "_nuxt");
    const names = (await readdir(nuxtDir)).filter((name) => name.endsWith(".js")).sort();
    if (names.length === 0) {
        throw new Error(`Client chunk 预算检查未找到任何 JS chunk：${nuxtDir}`);
    }
    const manifestSource = await readManifestSource(imageRoot);
    const eagerFiles = resolveEagerChunkFiles(manifestSource);

    const chunks = new Map();
    let totalGzipBytes = 0;
    for (const name of names) {
        const content = await readFile(join(nuxtDir, name));
        const gzipBytes = gzipSync(content).length;
        chunks.set(name, {name, rawBytes: content.length, gzipBytes});
        totalGzipBytes += gzipBytes;
    }

    const violations = [];
    let eagerRawBytes = 0;
    let eagerGzipBytes = 0;
    for (const file of eagerFiles) {
        const chunk = chunks.get(file);
        if (!chunk) {
            violations.push(`manifest 的 eager chunk ${file} 不在 public/_nuxt 产物中`);
            continue;
        }
        eagerRawBytes += chunk.rawBytes;
        eagerGzipBytes += chunk.gzipBytes;
    }
    if (eagerRawBytes > budget.eager.maxRawBytes) {
        violations.push(`eager 集合（${eagerFiles.join(", ")}）raw ${formatKiB(eagerRawBytes)} 超上限 ${formatKiB(budget.eager.maxRawBytes)}`);
    }
    if (eagerGzipBytes > budget.eager.maxGzipBytes) {
        violations.push(`eager 集合（${eagerFiles.join(", ")}）gzip ${formatKiB(eagerGzipBytes)} 超上限 ${formatKiB(budget.eager.maxGzipBytes)}`);
    }
    for (const chunk of chunks.values()) {
        if (chunk.rawBytes > budget.perChunk.maxRawBytes) {
            violations.push(`${chunk.name} raw ${formatKiB(chunk.rawBytes)} 超单 chunk 上限 ${formatKiB(budget.perChunk.maxRawBytes)}`);
        }
        if (chunk.gzipBytes > budget.perChunk.maxGzipBytes) {
            violations.push(`${chunk.name} gzip ${formatKiB(chunk.gzipBytes)} 超单 chunk 上限 ${formatKiB(budget.perChunk.maxGzipBytes)}`);
        }
    }
    if (totalGzipBytes > budget.maxTotalGzipBytes) {
        violations.push(`_nuxt 合计 gzip ${formatKiB(totalGzipBytes)} 超总量上限 ${formatKiB(budget.maxTotalGzipBytes)}`);
    }
    if (violations.length > 0) {
        throw new Error(`Client chunk 体积预算超支：\n- ${violations.join("\n- ")}`);
    }

    const worst = [...chunks.values()].reduce((a, b) => (a.gzipBytes >= b.gzipBytes ? a : b));
    return {chunks: chunks.size, eagerFiles, eagerRawBytes, eagerGzipBytes, totalGzipBytes, worst};
}

if (import.meta.main) {
    const {values} = parseArgs({
        allowPositionals: false,
        options: {"image-root": {type: "string"}},
        strict: true,
    });
    const imageRoot = values["image-root"]?.trim();
    if (!imageRoot) {
        throw new Error("缺少 --image-root <Product 镜像目录>");
    }
    const summary = await assertClientChunkBudget(imageRoot);
    console.log([
        `Client chunk 预算通过：chunks=${summary.chunks}`,
        `eager=${summary.eagerFiles.length} 个 gzip=${formatKiB(summary.eagerGzipBytes)}`,
        `worst=${summary.worst.name} gzip=${formatKiB(summary.worst.gzipBytes)}`,
        `totalGzip=${formatKiB(summary.totalGzipBytes)}`,
    ].join(" "));
}
