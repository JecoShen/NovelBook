/**
 * 左侧工具面板 tab 合同。文件名是历史遗留：早期的演示数据已全部移除，
 * 活导出只剩这三件；改名会牵动全部 import 点，留待独立清理。
 */
export const NOVEL_IDE_TABS = ["files", "characters", "plot"] as const;

export type NovelIdeTab = typeof NOVEL_IDE_TABS[number];

/**
 * 判断给定值是否为合法的左侧工具面板 tab。
 */
export function isNovelIdeTab(value: string | null | undefined): value is NovelIdeTab {
    return typeof value === "string" && (NOVEL_IDE_TABS as readonly string[]).includes(value);
}
