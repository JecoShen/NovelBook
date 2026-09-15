/**
 * 下拉菜单项。
 */
export interface DropdownItem {
    label: string;
    value: string;
    active?: boolean;
    iconClass?: string;
    rightIconClass?: string;
    /** 禁用后不可选中（用于选择依赖型动作，如无选中切片时的编辑/删除） */
    disabled?: boolean;
    /** 破坏性动作：danger 角色色呈现，配合确认流使用 */
    danger?: boolean;
}
