const BYTE_UNITS = ["KiB", "MiB", "GiB", "TiB"] as const;

/**
 * 字节数人性化展示：小于 1 KiB 保留 B，否则按最大合适单位保留一位小数。
 * 新增代码统一走这里；个别旧面板仍有语义略异的私有实现（自适应小数位、仅 KiB/MiB），
 * 收敛会改变既有显示，另案处理。
 */
export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) {
        return "0 B";
    }
    if (bytes < 1024) {
        return `${Math.floor(bytes)} B`;
    }
    let value = bytes;
    let unitIndex = -1;
    while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
        value /= 1024;
        unitIndex++;
    }
    return `${value.toFixed(1)} ${BYTE_UNITS[unitIndex]}`;
}
