/**
 * 命令面板与设置对话框共享的分区目录与条目构建。
 * 分区目录(10 分区 × 4 配置目标)在这里登记为单一源:
 * 设置对话框的左导航、对话框内搜索、命令面板的「设置:」直达都从这里派生,
 * 新增分区只改 CATALOG 一处。
 */

export type SettingsScope = "boot" | "global" | "project" | "browser";
export type SettingsSection = "security" | "frontend" | "editor" | "models" | "embedding" | "cost" | "web-tools" | "agent-profile-models" | "observability" | "desktop";

export type SettingsSectionCatalogEntry = Readonly<{
    value: SettingsSection;
    /** 该分区可见的配置目标;多 scope 分区(如角色模型)在每个目标下都出现。 */
    scopes: readonly SettingsScope[];
    iconClass: string;
    /** i18n 键;为空时用 fallbackLabel(如 Embedding 是专有名词不翻译)。 */
    labelKey: string | null;
    fallbackLabel?: string;
    descriptionKey: string;
    /**
     * 检索别名:作者按心智词搜(「字体」),设置按功能分区住(「编辑器」)。
     * 设置对话框搜索与命令面板「设置:」直达共用这份词表;新增分区必须登记,词表只对检索生效不改导航文案。
     */
    keywords: readonly string[];
}>;

/** 顺序即对话框导航顺序;按 scope 过滤时必须保持这个相对顺序。 */
export const SETTINGS_SECTION_CATALOG: readonly SettingsSectionCatalogEntry[] = [
    {value: "security", scopes: ["boot"], iconClass: "i-lucide-shield-check", labelKey: "settings.section.security.label", descriptionKey: "settings.section.security.description", keywords: ["密码", "口令", "登录", "鉴权", "auth"]},
    {value: "frontend", scopes: ["browser"], iconClass: "i-lucide-monitor-cog", labelKey: "settings.section.frontend.label", descriptionKey: "settings.section.frontend.description", keywords: ["主题", "外观", "皮肤", "颜色", "语言", "界面", "theme"]},
    {value: "editor", scopes: ["browser"], iconClass: "i-lucide-type", labelKey: "settings.section.editor.label", descriptionKey: "settings.section.editor.description", keywords: ["字体", "字号", "排版", "默认视图", "预览", "源码", "富文本", "font", "markdown"]},
    {value: "models", scopes: ["global"], iconClass: "i-lucide-cpu", labelKey: "settings.section.models.label", descriptionKey: "settings.section.models.description", keywords: ["服务商", "默认模型", "密钥", "接口", "provider", "api", "key"]},
    {value: "embedding", scopes: ["global"], iconClass: "i-lucide-binary", labelKey: null, fallbackLabel: "Embedding", descriptionKey: "settings.section.embedding.description", keywords: ["向量", "嵌入", "检索", "embedding"]},
    {value: "cost", scopes: ["global"], iconClass: "i-lucide-circle-dollar-sign", labelKey: "settings.section.cost.label", descriptionKey: "settings.section.cost.description", keywords: ["费用", "成本", "价格", "币种", "汇率", "token"]},
    {value: "web-tools", scopes: ["global"], iconClass: "i-lucide-search-code", labelKey: "settings.section.webTools.label", descriptionKey: "settings.section.webTools.description", keywords: ["搜索", "联网", "抓取", "网页", "tavily", "brave"]},
    {value: "agent-profile-models", scopes: ["global", "project"], iconClass: "i-lucide-bot-message-square", labelKey: "settings.section.agentProfileModels.label", descriptionKey: "settings.section.agentProfileModels.description", keywords: ["角色", "可用模型", "参数", "思考", "agent", "profile"]},
    {value: "observability", scopes: ["global"], iconClass: "i-lucide-activity", labelKey: "settings.section.observability.label", descriptionKey: "settings.section.observability.description", keywords: ["日志", "记录", "请求", "遥测", "trace"]},
    {value: "desktop", scopes: ["browser"], iconClass: "i-lucide-panels-top-left", labelKey: "settings.section.desktop.label", descriptionKey: "settings.section.desktop.description", keywords: ["窗口", "缩放", "托盘", "标题栏", "桌面"]},
];

/** 读取指定配置目标下可见的分区(保持 CATALOG 顺序)。 */
export function settingsSectionsForScope(scope: SettingsScope): SettingsSection[] {
    return SETTINGS_SECTION_CATALOG.filter((entry) => entry.scopes.includes(scope)).map((entry) => entry.value);
}

export type SettingsAvailabilityContext = Readonly<{
    /** 项目配置目标可用(已进入小说工作区);不可用时 project-only 行整体隐藏。 */
    projectScopeAvailable: boolean;
    /** 桌面桥可用;不可用时 desktop 分区隐藏(它在 browser 目标下)。 */
    desktopAvailable: boolean;
}>;

function entryScopesAvailable(entry: SettingsSectionCatalogEntry, context: SettingsAvailabilityContext): boolean {
    if (entry.value === "desktop" && !context.desktopAvailable) {
        return false;
    }
    return entry.scopes.some((scope) => scope !== "project" || context.projectScopeAvailable);
}

/** 过滤出当前可用的分区目录行;scope 不可用的分区只在受限入口隐藏,目录本身不变。 */
export function resolveAvailableSettingsSections(context: SettingsAvailabilityContext): SettingsSectionCatalogEntry[] {
    return SETTINGS_SECTION_CATALOG.filter((entry) => entryScopesAvailable(entry, context));
}

/** 一条可用的 (配置目标 × 分区) 跳转目标;对话框内搜索与命令面板直达共用。 */
export type SettingsSectionTarget = Readonly<{
    scope: SettingsScope;
    section: SettingsSection;
    entry: SettingsSectionCatalogEntry;
}>;

/** 展开可用分区为 (scope × section) 跳转目标;多 scope 分区每个可用目标一行。 */
export function resolveAvailableSettingsTargets(context: SettingsAvailabilityContext): SettingsSectionTarget[] {
    const targets: SettingsSectionTarget[] = [];
    for (const entry of resolveAvailableSettingsSections(context)) {
        for (const scope of entry.scopes) {
            if (scope === "project" && !context.projectScopeAvailable) {
                continue;
            }
            targets.push({scope, section: entry.value, entry});
        }
    }
    return targets;
}

/** 命令面板条目:文件、动作、设置跳转三类统一进同一个 listbox。 */
export type CommandPaletteItemKind = "file" | "action" | "settings";

export type CommandPaletteItem = Readonly<{
    /** 稳定 id:listbox key 与执行路由(action:<name> / file:<path> / settings:<scope>:<section>)。 */
    id: string;
    kind: CommandPaletteItemKind;
    /** 主文案:文件标题或动作名。 */
    label: string;
    /** 检索副字段:文件路径、动作关键词或分区 value。 */
    target: string;
    /** 行尾说明(文件路径、动作描述或配置目标名)。 */
    description?: string;
    iconClass: string;
    /** 行尾快捷键提示(Alt+N / Ctrl+K),纯展示。 */
    shortcut?: string;
}>;

export type CommandPaletteFileNode = Readonly<{
    path: string;
    title: string;
    isDirectory: boolean;
    contentNode: boolean;
}>;

function basename(path: string): string {
    const normalized = path.replace(/\/+$/u, "");
    return normalized.includes("/") ? normalized.slice(normalized.lastIndexOf("/") + 1) : normalized;
}

/** 拍平 workspace 树为可打开文件条目;规则与文件树行一致:纯目录只是容器,不进面板。 */
export function buildCommandPaletteFileItems(nodes: readonly CommandPaletteFileNode[]): CommandPaletteItem[] {
    const items: CommandPaletteItem[] = [];
    for (const node of nodes) {
        if (node.isDirectory && !node.contentNode) {
            continue;
        }
        items.push({
            id: `file:${node.path}`,
            kind: "file",
            label: node.title.trim() || basename(node.path),
            target: node.path,
            description: node.path,
            iconClass: node.isDirectory ? "i-lucide-folder" : "i-lucide-file-text",
        });
    }
    return items;
}
