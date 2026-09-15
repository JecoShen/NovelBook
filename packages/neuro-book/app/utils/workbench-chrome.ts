export type TitleBarMenuPresentation = "full" | "compact";

export type TitleBarMenuMeasurements = Readonly<{
    availableWidth: number;
    fullMenuWidth: number;
    titleWidth: number;
    controlsWidth: number;
}>;

export const MINIMUM_TITLE_BAR_DRAG_WIDTH = 120;

export type WorkbenchActivityItemId =
    | "home"
    | "files"
    | "characters"
    | "plot"
    | "world"
    | "trace"
    | "history"
    | "agent-panel"
    | "account"
    | "settings";

export type WorkbenchActivityItem = Readonly<{
    id: WorkbenchActivityItemId;
    disabled: boolean;
}>;

/**
 * 槽位快捷键顺序:Alt+1..9 与此数组下标一一对应。
 * Activity Bar tooltip 与全局键盘处理共用这一份,account 是菜单不是目的地,不占号。
 * 浏览器里 Ctrl+1..8 被标签切换抢占且页面不可拦截,Alt 是唯一可行修饰键。
 */
export const ACTIVITY_SHORTCUT_ORDER: readonly WorkbenchActivityItemId[] = [
    "home",
    "files",
    "characters",
    "plot",
    "world",
    "trace",
    "history",
    "agent-panel",
    "settings",
];

/** 读取槽位的快捷键提示文案;不在快捷键层里的(account)返回 null。 */
export function resolveActivityShortcut(id: WorkbenchActivityItemId): string | null {
    const index = ACTIVITY_SHORTCUT_ORDER.indexOf(id);
    return index < 0 ? null : `Alt+${index + 1}`;
}

/** 槽位图标:Activity Bar 与命令面板共用,避免两处图标漂移。 */
export const ACTIVITY_ICON_CLASSES: Record<WorkbenchActivityItemId, string> = {
    home: "i-lucide-library",
    files: "i-lucide-files",
    characters: "i-lucide-users-round",
    plot: "i-lucide-git-branch",
    world: "i-lucide-globe-2",
    trace: "i-lucide-activity",
    history: "i-lucide-inbox",
    "agent-panel": "i-lucide-bot",
    account: "i-lucide-user-round",
    settings: "i-lucide-settings",
};

export type WorkbenchActivityContext = Readonly<{
    desktopAvailable: boolean;
    surfaceActive: boolean;
    userAssetsMode: boolean;
}>;

export type WorkbenchActivityItems = Readonly<{
    primary: WorkbenchActivityItem[];
    secondary: WorkbenchActivityItem[];
    agentPanel: WorkbenchActivityItem | null;
    footer: WorkbenchActivityItem[];
}>;

export type ActivityBarSecondaryMeasurements = Readonly<{
    availableHeight: number;
    fixedHeight: number;
    itemHeight: number;
    moreButtonHeight: number;
}>;

/** 保证完整菜单不会挤掉标题栏的最小可拖动区域。 */
export function resolveTitleBarMenuPresentation(
    measurements: TitleBarMenuMeasurements,
): TitleBarMenuPresentation {
    const requiredWidth = measurements.fullMenuWidth
        + measurements.titleWidth
        + measurements.controlsWidth
        + MINIMUM_TITLE_BAR_DRAG_WIDTH;
    return measurements.availableWidth >= requiredWidth ? "full" : "compact";
}

/** 返回各宿主共享的 Activity Bar 能力；组件只负责图标、文案和事件。 */
export function createWorkbenchActivityItems(
    context: WorkbenchActivityContext,
): WorkbenchActivityItems {
    const projectDisabled = !context.surfaceActive;
    const novelOnlyDisabled = projectDisabled || context.userAssetsMode;
    return {
        primary: [
            ...(!context.desktopAvailable ? [{id: "home" as const, disabled: false}] : []),
            {id: "files", disabled: projectDisabled},
            {id: "characters", disabled: novelOnlyDisabled},
            {id: "plot", disabled: novelOnlyDisabled},
            {id: "world", disabled: novelOnlyDisabled},
        ],
        secondary: [
            {id: "trace", disabled: projectDisabled},
            {id: "history", disabled: novelOnlyDisabled},
        ],
        agentPanel: context.desktopAvailable
            ? null
            : {id: "agent-panel", disabled: projectDisabled},
        footer: [
            {id: "account", disabled: false},
            {id: "settings", disabled: false},
        ],
    };
}

/**
 * 次要入口只在放不下时进入 More。只要存在 overflow，就先为 More 预留一个完整按钮位。
 */
export function resolveActivityBarSecondaryItems<T>(
    items: readonly T[],
    measurements: ActivityBarSecondaryMeasurements,
): {visible: T[]; overflow: T[]} {
    if (items.length === 0) {
        return {visible: [], overflow: []};
    }
    const itemHeight = Math.max(1, measurements.itemHeight);
    const remainingHeight = Math.max(0, measurements.availableHeight - measurements.fixedHeight);
    const fullCapacity = Math.floor(remainingHeight / itemHeight);
    if (fullCapacity >= items.length) {
        return {visible: [...items], overflow: []};
    }
    const visibleCapacity = Math.max(
        0,
        Math.floor((remainingHeight - measurements.moreButtonHeight) / itemHeight),
    );
    return {
        visible: items.slice(0, visibleCapacity),
        overflow: items.slice(visibleCapacity),
    };
}
