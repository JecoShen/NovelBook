import {describe, expect, it} from "vitest";
import {formatBytes} from "nbook/app/utils/format-bytes";

describe("formatBytes", () => {
    it("小于 1 KiB 保留 B", () => {
        expect(formatBytes(0)).toBe("0 B");
        expect(formatBytes(512)).toBe("512 B");
        expect(formatBytes(1023)).toBe("1023 B");
    });

    it("按最大合适单位保留一位小数", () => {
        expect(formatBytes(1024)).toBe("1.0 KiB");
        expect(formatBytes(1536)).toBe("1.5 KiB");
        expect(formatBytes(1024 * 1024)).toBe("1.0 MiB");
        expect(formatBytes(1.7 * 1024 * 1024)).toBe("1.7 MiB");
        expect(formatBytes(3 * 1024 ** 3)).toBe("3.0 GiB");
        expect(formatBytes(2 * 1024 ** 4)).toBe("2.0 TiB");
    });

    it("非法输入按 0 B 处理", () => {
        expect(formatBytes(Number.NaN)).toBe("0 B");
        expect(formatBytes(-5)).toBe("0 B");
    });
});
