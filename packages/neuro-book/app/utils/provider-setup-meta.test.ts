import {describe, expect, it} from "vitest";
import {providerSetupMeta} from "nbook/app/utils/provider-setup-meta";

describe("providerSetupMeta", () => {
    it("策展模板返回中文名与取 Key 链接", () => {
        const meta = providerSetupMeta("deepseek", "DeepSeek");
        expect(meta.monogram).toBe("D");
        expect(meta.keyHelpUrl).toBe("https://platform.deepseek.com/api_keys");
        expect(providerSetupMeta("moonshotai-cn", "Moonshot AI").zhName).toBe("月之暗面 Kimi");
    });

    it("custom 模板用扳手图标而不是字母徽标", () => {
        const meta = providerSetupMeta("custom", "Custom Provider");
        expect(meta.monogram).toBe("");
        expect(meta.fallbackIcon).toBe("i-lucide-wrench");
        expect(meta.zhName).toBe("自定义接入");
    });

    it("未策展模板回退原名 + 首字母徽标,绝不臆造链接", () => {
        const meta = providerSetupMeta("some-new-vendor", "Some New Vendor");
        expect(meta.monogram).toBe("S");
        expect(meta.zhName).toBeNull();
        expect(meta.keyHelpUrl).toBeNull();
    });

    it("空名模板回退到通用服务器图标", () => {
        const meta = providerSetupMeta("unknown-blank", "  ");
        expect(meta.monogram).toBe("");
        expect(meta.fallbackIcon).toBe("i-lucide-server");
    });
});
