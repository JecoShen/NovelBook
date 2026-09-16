/**
 * 模型配置向导的服务商展示元数据:模板目录(Pi builtin)只给 id/name/baseUrl,
 * 首启向导需要中文名、首字母徽标与「从哪里获取 Key」链接。这里按模板 id 策展,
 * 未策展的模板一律回退:原名 + 首字母徽标 + 通用取 Key 提示,绝不臆造链接。
 */
export type ProviderSetupMeta = {
    /** 徽标字符(1~2 个);为空时用 fallbackIcon。 */
    monogram: string;
    /** monogram 为空时的 lucide 图标类。 */
    fallbackIcon: string;
    /** 中文名;null 时展示模板原名。 */
    zhName: string | null;
    /** 「从哪里获取」控制台链接;null 时展示通用提示,不给链接。 */
    keyHelpUrl: string | null;
};

const CURATED: Record<string, ProviderSetupMeta> = {
    "anthropic": {monogram: "A", fallbackIcon: "", zhName: null, keyHelpUrl: "https://console.anthropic.com/settings/keys"},
    "openai": {monogram: "O", fallbackIcon: "", zhName: null, keyHelpUrl: "https://platform.openai.com/api-keys"},
    "google": {monogram: "G", fallbackIcon: "", zhName: "Google Gemini", keyHelpUrl: "https://aistudio.google.com/apikey"},
    "deepseek": {monogram: "D", fallbackIcon: "", zhName: null, keyHelpUrl: "https://platform.deepseek.com/api_keys"},
    "xai": {monogram: "X", fallbackIcon: "", zhName: "xAI(Grok)", keyHelpUrl: "https://console.x.ai/"},
    "moonshotai-cn": {monogram: "K", fallbackIcon: "", zhName: "月之暗面 Kimi", keyHelpUrl: "https://platform.moonshot.cn/console/api-keys"},
    "moonshotai": {monogram: "K", fallbackIcon: "", zhName: "Moonshot AI", keyHelpUrl: "https://platform.moonshot.ai/console/api-keys"},
    "kimi-coding": {monogram: "K", fallbackIcon: "", zhName: "Kimi Coding", keyHelpUrl: "https://platform.moonshot.cn/console/api-keys"},
    "zai": {monogram: "Z", fallbackIcon: "", zhName: "Z.AI(智谱)", keyHelpUrl: null},
    "zai-coding-cn": {monogram: "Z", fallbackIcon: "", zhName: "智谱 Coding Plan", keyHelpUrl: "https://open.bigmodel.cn/usercenter/apikeys"},
    "openrouter": {monogram: "OR", fallbackIcon: "", zhName: null, keyHelpUrl: "https://openrouter.ai/keys"},
    "groq": {monogram: "G", fallbackIcon: "", zhName: null, keyHelpUrl: "https://console.groq.com/keys"},
    "mistral": {monogram: "M", fallbackIcon: "", zhName: null, keyHelpUrl: "https://console.mistral.ai/api-keys/"},
    "minimax-cn": {monogram: "M", fallbackIcon: "", zhName: "MiniMax 国内版", keyHelpUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key"},
    "minimax": {monogram: "M", fallbackIcon: "", zhName: null, keyHelpUrl: null},
    "cerebras": {monogram: "C", fallbackIcon: "", zhName: null, keyHelpUrl: "https://cloud.cerebras.ai/"},
    "nvidia": {monogram: "N", fallbackIcon: "", zhName: "NVIDIA NIM", keyHelpUrl: "https://build.nvidia.com/"},
    "fireworks": {monogram: "F", fallbackIcon: "", zhName: null, keyHelpUrl: "https://fireworks.ai/account/api-keys"},
    "together": {monogram: "T", fallbackIcon: "", zhName: null, keyHelpUrl: "https://api.together.xyz/settings/api-keys"},
    "huggingface": {monogram: "H", fallbackIcon: "", zhName: "Hugging Face", keyHelpUrl: "https://huggingface.co/settings/tokens"},
    "xiaomi": {monogram: "X", fallbackIcon: "", zhName: "小米 MiMo", keyHelpUrl: null},
    "xiaomi-token-plan-cn": {monogram: "X", fallbackIcon: "", zhName: "小米 Token Plan", keyHelpUrl: null},
    "xiaomi-token-plan-ams": {monogram: "X", fallbackIcon: "", zhName: "小米 Token Plan(AMS)", keyHelpUrl: null},
    "xiaomi-token-plan-sgp": {monogram: "X", fallbackIcon: "", zhName: "小米 Token Plan(SGP)", keyHelpUrl: null},
    "custom": {monogram: "", fallbackIcon: "i-lucide-wrench", zhName: "自定义接入", keyHelpUrl: null},
};

/** 返回模板的向导展示元数据;未策展模板回退原名 + 首字母徽标。 */
export function providerSetupMeta(templateId: string, fallbackName: string): ProviderSetupMeta {
    const curated = CURATED[templateId.trim()];
    if (curated) {
        return curated;
    }
    const initial = fallbackName.trim().charAt(0).toUpperCase();
    return {
        monogram: initial,
        fallbackIcon: initial ? "" : "i-lucide-server",
        zhName: null,
        keyHelpUrl: null,
    };
}
