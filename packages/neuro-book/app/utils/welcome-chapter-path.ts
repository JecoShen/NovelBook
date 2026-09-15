/**
 * 欢迎页新建章节的路径代管:作者只给章节起名,产品按既有约定
 * (manuscript/<NNN-volume>/<NNN>-chapter/index.md)决定保存位置。
 * 与 plot 预览页 silver-dragon-hime 的 013-chapter 命名保持一致。
 */
export type WelcomeChapterTreeNode = Readonly<{
    path: string;
    isDirectory: boolean;
}>;

const VOLUME_SEGMENT_PATTERN = /^(\d+)-volume$/;
const CHAPTER_SEGMENT_PATTERN = /^(\d+)-chapter$/;

function normalizeDirPath(path: string): string {
    return path.replace(/\/+$/u, "");
}

/** 读取 manuscript/ 下最新的卷目录名;没有卷时回退 001-volume。 */
export function resolveLatestVolumeSegment(tree: readonly WelcomeChapterTreeNode[]): string {
    let latest: string | null = null;
    for (const node of tree) {
        if (!node.isDirectory) {
            continue;
        }
        const normalized = normalizeDirPath(node.path);
        const segment = /^manuscript\/([^/]+)$/u.exec(normalized)?.[1];
        if (!segment || !VOLUME_SEGMENT_PATTERN.test(segment)) {
            continue;
        }
        if (latest === null || segment > latest) {
            latest = segment;
        }
    }
    return latest ?? "001-volume";
}

/** 解析指定卷里下一个 NNN-chapter 目录名(取现存最大序号 +1,从 001 起)。 */
export function resolveNextChapterSegment(tree: readonly WelcomeChapterTreeNode[], volumeSegment: string): string {
    const prefix = `manuscript/${volumeSegment}/`;
    let maxIndex = 0;
    for (const node of tree) {
        const normalized = normalizeDirPath(node.path);
        if (!normalized.startsWith(prefix)) {
            continue;
        }
        const rest = normalized.slice(prefix.length);
        const segment = rest.includes("/") ? rest.slice(0, rest.indexOf("/")) : rest;
        const chapterIndex = CHAPTER_SEGMENT_PATTERN.exec(segment)?.[1];
        if (chapterIndex) {
            maxIndex = Math.max(maxIndex, Number.parseInt(chapterIndex, 10));
        }
    }
    return `${String(maxIndex + 1).padStart(3, "0")}-chapter`;
}

/** 新建章节的完整代管路径。 */
export function resolveManagedChapterPath(tree: readonly WelcomeChapterTreeNode[]): string {
    const volume = resolveLatestVolumeSegment(tree);
    const chapter = resolveNextChapterSegment(tree, volume);
    return `manuscript/${volume}/${chapter}/index.md`;
}

/** 下一章的数字序号(供「第 N 章」这类默认标题;与 resolveManagedChapterPath 同卷同号)。 */
export function resolveManagedChapterNumber(tree: readonly WelcomeChapterTreeNode[]): number {
    const volume = resolveLatestVolumeSegment(tree);
    const chapter = resolveNextChapterSegment(tree, volume);
    return Number.parseInt(CHAPTER_SEGMENT_PATTERN.exec(chapter)?.[1] ?? "1", 10);
}

/** 章节初始内容:标题来自作者起的章节名,而不是路径段。 */
export function buildManagedChapterContent(chapterTitle: string): string {
    return `---\ntitle: ${JSON.stringify(chapterTitle)}\nstatus: draft\n---\n\n`;
}
