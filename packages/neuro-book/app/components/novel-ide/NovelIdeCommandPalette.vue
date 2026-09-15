<script setup lang="ts">
import {IDE_THEME_HOST_CLASS} from "nbook/app/utils/theme/theme-tokens";
import {searchWorkspaceReferences} from "nbook/app/utils/workspace-reference-search";
import type {CommandPaletteItem, CommandPaletteItemKind} from "nbook/app/utils/command-palette-items";

const props = defineProps<{
    modelValue: boolean;
    /** 全量条目(文件+动作+设置直达),父组件按当前上下文预组装。 */
    items: CommandPaletteItem[];
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "pick", item: CommandPaletteItem): void;
}>();

const {t} = useI18n();
const query = ref("");
const activeIndex = ref(0);
const inputRef = ref<HTMLInputElement | null>(null);
const listRef = ref<HTMLElement | null>(null);
const isMounted = ref(false);
let previouslyFocused: Element | null = null;

const MAX_RESULTS = 50;

const kindOrder: Record<CommandPaletteItemKind, number> = {action: 0, settings: 1, file: 2};

/**
 * 检索:空查询按父组件顺序(动作→设置→文件,条数截断);
 * 非空走统一的 workspace 搜索(路径/拼音/首字母/容错),再按类别分组渲染。
 */
const visibleItems = computed<CommandPaletteItem[]>(() => {
    const results = searchWorkspaceReferences(
        props.items.map((item, order) => ({
            item,
            label: item.label,
            target: item.target,
            description: item.description ?? "",
            order,
        })),
        query.value,
        MAX_RESULTS,
    ).map((result) => result.item);
    return results;
});

type PaletteRow = Readonly<{item: CommandPaletteItem; flatIndex: number}>;

/** 分组渲染:组内保持检索分数顺序,组间按 动作→设置→文件;每行预带扁平索引供 activedescendant。 */
const visibleGroups = computed<Array<{kind: CommandPaletteItemKind; label: string; rows: PaletteRow[]}>>(() => {
    const groups = new Map<CommandPaletteItemKind, CommandPaletteItem[]>();
    for (const item of visibleItems.value) {
        const bucket = groups.get(item.kind) ?? [];
        bucket.push(item);
        groups.set(item.kind, bucket);
    }
    let flatIndex = 0;
    return [...groups.entries()]
        .sort((left, right) => kindOrder[left[0]] - kindOrder[right[0]])
        .map(([kind, items]) => ({
            kind,
            label: t(`ide.commandPalette.group.${kind}`),
            rows: items.map((item) => ({item, flatIndex: flatIndex++})),
        }));
});

/** 扁平可见序列,键盘 activedescendant 以它为索引。 */
const flatItems = computed<CommandPaletteItem[]>(() => visibleGroups.value.flatMap((group) => group.rows.map((row) => row.item)));

function optionId(index: number): string {
    return `nb-command-palette-option-${index}`;
}

function close(): void {
    emit("update:modelValue", false);
}

function pick(item: CommandPaletteItem | undefined): void {
    if (!item) {
        return;
    }
    emit("pick", item);
    close();
}

function clampActive(): void {
    if (flatItems.value.length === 0) {
        activeIndex.value = 0;
        return;
    }
    activeIndex.value = Math.min(activeIndex.value, flatItems.value.length - 1);
}

function moveActive(delta: 1 | -1): void {
    const count = flatItems.value.length;
    if (count === 0) {
        return;
    }
    activeIndex.value = (activeIndex.value + delta + count) % count;
    nextTick(() => {
        listRef.value?.querySelector(`#${optionId(activeIndex.value)}`)?.scrollIntoView({block: "nearest"});
    });
}

watch(query, () => {
    activeIndex.value = 0;
});

watch(flatItems, clampActive);

watch(() => props.modelValue, (open) => {
    if (!import.meta.client) {
        return;
    }
    if (open) {
        previouslyFocused = document.activeElement;
        query.value = "";
        activeIndex.value = 0;
        nextTick(() => inputRef.value?.focus());
        return;
    }
    if (previouslyFocused instanceof HTMLElement) {
        previouslyFocused.focus();
    }
    previouslyFocused = null;
});

onMounted(() => {
    isMounted.value = true;
});
</script>

<template>
    <Teleport v-if="isMounted && modelValue" :to="`.${IDE_THEME_HOST_CLASS}`">
        <!-- 顶置面板而非居中对话框:命令面板惯例;Esc/遮罩关闭,键盘事件止于输入框(.stop 不穿透到底层 Dialog 的 document 监听) -->
        <div
            class="fixed inset-0 z-[9010] flex items-start justify-center bg-black/50 px-4 pt-[14vh]"
            role="presentation"
            @click.self="close"
            @contextmenu.prevent
        >
            <div
                class="flex max-h-[min(560px,72dvh)] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--text-main)] shadow-xl"
                role="dialog"
                aria-modal="true"
                :aria-label="t('ide.commandPalette.title')"
            >
                <div class="flex items-center gap-2 border-b border-[var(--border-color)] px-3">
                    <span class="i-lucide-search h-4 w-4 shrink-0 text-[var(--text-muted)]" />
                    <input
                        ref="inputRef"
                        v-model="query"
                        type="text"
                        role="combobox"
                        aria-expanded="true"
                        aria-controls="nb-command-palette-list"
                        :aria-activedescendant="flatItems.length > 0 ? optionId(activeIndex) : undefined"
                        aria-autocomplete="list"
                        :placeholder="t('ide.commandPalette.placeholder')"
                        class="h-11 min-w-0 flex-1 bg-transparent text-sm text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)]"
                        @keydown.esc.stop="close"
                        @keydown.down.prevent.stop="moveActive(1)"
                        @keydown.up.prevent.stop="moveActive(-1)"
                        @keydown.enter.prevent.stop="pick(flatItems[activeIndex])"
                    >
                    <kbd class="shrink-0 rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">Esc</kbd>
                </div>

                <div v-if="flatItems.length === 0" class="flex flex-col items-center gap-2 px-4 py-10 text-[var(--text-muted)]">
                    <span class="i-lucide-search-x h-6 w-6" />
                    <p class="text-xs">{{ t("ide.commandPalette.empty") }}</p>
                </div>

                <ul v-else id="nb-command-palette-list" ref="listRef" role="listbox" :aria-label="t('ide.commandPalette.title')" class="min-h-0 flex-1 overflow-y-auto p-1.5">
                    <template v-for="group in visibleGroups" :key="group.kind">
                        <li role="presentation" class="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">{{ group.label }}</li>
                        <li
                            v-for="row in group.rows"
                            :id="optionId(row.flatIndex)"
                            :key="row.item.id"
                            role="option"
                            :aria-selected="activeIndex === row.flatIndex"
                            class="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5"
                            :class="activeIndex === row.flatIndex ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'text-[var(--text-secondary)]'"
                            @mouseenter="activeIndex = row.flatIndex"
                            @click="pick(row.item)"
                        >
                            <span class="h-4 w-4 shrink-0" :class="[row.item.iconClass, activeIndex === row.flatIndex ? 'text-[var(--accent-text)]' : 'text-[var(--text-muted)]']" />
                            <span class="min-w-0 flex-1 truncate text-xs" :class="activeIndex === row.flatIndex ? 'text-[var(--accent-text)]' : 'text-[var(--text-main)]'">{{ row.item.label }}</span>
                            <kbd v-if="row.item.shortcut" class="shrink-0 rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">{{ row.item.shortcut }}</kbd>
                            <span v-else-if="row.item.description" class="min-w-0 max-w-[45%] truncate text-[10px] text-[var(--text-muted)]">{{ row.item.description }}</span>
                        </li>
                    </template>
                </ul>

                <div class="flex items-center gap-3 border-t border-[var(--border-color)] px-3 py-1.5 text-[10px] text-[var(--text-muted)]">
                    <span class="flex items-center gap-1"><kbd class="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1">↑↓</kbd>{{ t("ide.commandPalette.hintMove") }}</span>
                    <span class="flex items-center gap-1"><kbd class="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1">Enter</kbd>{{ t("ide.commandPalette.hintOpen") }}</span>
                    <span class="flex items-center gap-1"><kbd class="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1">Esc</kbd>{{ t("ide.commandPalette.hintClose") }}</span>
                </div>
            </div>
        </div>
    </Teleport>
</template>
