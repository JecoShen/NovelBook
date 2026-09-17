import {describe, expect, it} from "vitest";
import {formatYamlScalar} from "nbook/app/utils/yaml-scalar";

describe("formatYamlScalar", () => {
    it("纯中文标题平铺不带引号", () => {
        expect(formatYamlScalar("夜巡")).toBe("夜巡");
    });

    it("含冒号等特殊字符退回 JSON 双引号", () => {
        expect(formatYamlScalar("卷一: 起点")).toBe(JSON.stringify("卷一: 起点"));
    });

    it("安全标题裁剪首尾空白", () => {
        expect(formatYamlScalar("  夜巡  ")).toBe("夜巡");
    });

    it("含 # 注释符退回引号", () => {
        expect(formatYamlScalar("夜巡 #1")).toBe(JSON.stringify("夜巡 #1"));
    });
});
