export type ProductPlatformMatrixEntry = {
    platform: string;
    runner: string;
    command: string;
    archive: string;
    port: number;
    browser: string;
    prGate?: boolean;
};

export type SelectedProductPlatformEntry = Omit<ProductPlatformMatrixEntry, "prGate">;

export const PRODUCT_PLATFORM_MATRIX_ENTRIES: ProductPlatformMatrixEntry[] = [
    {
        platform: "linux-x64-glibc",
        runner: "ubuntu-latest",
        command: "release:product:linux",
        archive: "neuro-book-product-linux-x64-glibc.tar.gz",
        port: 39223,
        browser: "playwright",
        prGate: true,
    },
    {
        platform: "linux-aarch64-glibc",
        runner: "ubuntu-24.04-arm",
        command: "release:product:linux-aarch64",
        archive: "neuro-book-product-linux-aarch64-glibc.tar.gz",
        port: 39224,
        browser: "playwright",
    },
    {
        platform: "darwin-x64",
        runner: "macos-15-intel",
        command: "release:product:darwin",
        archive: "neuro-book-product-darwin-x64.tar.gz",
        port: 39225,
        browser: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    },
    {
        platform: "darwin-aarch64",
        runner: "macos-15",
        command: "release:product:darwin-aarch64",
        archive: "neuro-book-product-darwin-aarch64.tar.gz",
        port: 39226,
        browser: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    },
];

/**
 * 本仓只部署到本机 linux-x64（无桌面端/其他服务器平台），CI 矩阵只跑目标平台。
 * 其余平台条目保留在 ENTRIES 里作为上游合同数据与恢复路径；
 * 需要重新支持某平台时把它加回本集合即可，注册表与基线无需改动。
 */
const FORK_CI_TARGET_PLATFORMS: ReadonlySet<string> = new Set(["linux-x64-glibc"]);

export function selectProductPlatformMatrix(eventName: string): Array<SelectedProductPlatformEntry> {
    const selected = PRODUCT_PLATFORM_MATRIX_ENTRIES
        .filter((entry) => FORK_CI_TARGET_PLATFORMS.has(entry.platform))
        .filter((entry) => eventName !== "pull_request" || entry.prGate === true);
    return selected.map(({prGate: _prGate, ...entry}) => entry);
}

if (import.meta.main) {
    const eventName = process.argv[2] ?? process.env.EVENT_NAME ?? "";
    if (eventName === "") {
        throw new Error("Usage: bun scripts/build/product-platform-matrix.ts <event-name> (or set EVENT_NAME)");
    }
    process.stdout.write(`${JSON.stringify({include: selectProductPlatformMatrix(eventName)})}\n`);
}
