<script setup lang="ts">
import {storeToRefs} from "pinia";
import {useNotification, type NotificationHistoryEntry, type NotificationItem, type NotificationPosition} from "nbook/app/composables/useNotification";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {themeTokens, type ThemeVars} from "nbook/app/utils/theme/theme-tokens";
import {resolveNotificationToneColor, sanitizeNotificationVars} from "nbook/app/utils/theme/notification-tone";

const props = withDefaults(defineProps<{desktop?: boolean}>(), {
    desktop: false,
});

type NotificationGroup = {
    key: string;
    position: NotificationPosition;
    offsetX: number;
    offsetY: number;
    items: NotificationItem[];
};

const {notifications, history, remove, clearHistory} = useNotification();
const historyOpen = ref(false);
const {t, locale} = useI18n();
const novelIdeStore = useNovelIdeStore();
const {activeThemeAppearance, themeVarsSnapshot} = storeToRefs(novelIdeStore);

// 通知视口挂在 .novel-ide-theme 宿主外：CSS 变量只会命中 :root 的 sepia fallback，
// 因此消费 store 已解析快照的具体色。快照未就绪回退 sepia；自定义主题的非法颜色值
// 由 sanitizeNotificationVars 逐字段回退 sepia，避免垃圾色进入配对与对比度计算。
const FALLBACK_VARS: ThemeVars = themeTokens.sepia;

const safeThemeVars = computed<ThemeVars>(() => sanitizeNotificationVars(themeVarsSnapshot.value ?? FALLBACK_VARS, activeThemeAppearance.value));

// 嵌套元素消费的 var(--bg-*/--text-*/--border-color) 在宿主外同样命中 :root 的
// sepia fallback；把净化后的快照值以同名自定义属性发布到卡片根，跟随当前主题。
const cardSurfaceVars = computed<Record<string, string>>(() => ({
    "--bg-panel": safeThemeVars.value["--bg-panel"],
    "--bg-hover": safeThemeVars.value["--bg-hover"],
    "--border-color": safeThemeVars.value["--border-color"],
    "--text-muted": safeThemeVars.value["--text-muted"],
    "--text-main": safeThemeVars.value["--text-main"],
}));

function historyDotStyle(entry: NotificationHistoryEntry): Record<string, string> {
    return {
        backgroundColor: resolveNotificationToneColor(entry.tone, safeThemeVars.value).badge,
    };
}

function formatHistoryTime(createdAt: number): string {
    return new Date(createdAt).toLocaleTimeString(locale.value, {hour: "2-digit", minute: "2-digit"});
}

function toneColor(item: NotificationItem) {
    return resolveNotificationToneColor(item.tone, safeThemeVars.value);
}

function cardToneStyle(item: NotificationItem): Record<string, string> {
    const color = toneColor(item);
    return {
        backgroundColor: color.background,
        borderColor: color.border,
        color: color.foreground,
    };
}

function badgeToneStyle(item: NotificationItem): Record<string, string> {
    return {
        backgroundColor: toneColor(item).badge,
    };
}

const groupedNotifications = computed<NotificationGroup[]>(() => {
    const groupMap = new Map<string, NotificationGroup>();

    for (const item of notifications.value) {
        const key = `${item.position}:${String(item.offsetX)}:${String(item.offsetY)}`;
        const existing = groupMap.get(key);
        if (existing) {
            existing.items.push(item);
            continue;
        }

        groupMap.set(key, {
            key,
            position: item.position,
            offsetX: item.offsetX,
            offsetY: item.offsetY,
            items: [item],
        });
    }

    return [...groupMap.values()];
});

function positionClass(position: NotificationPosition): string {
    if (position === "top-left") {
        return "top-0 left-0 items-start";
    }
    if (position === "top-center") {
        return "top-0 left-1/2 -translate-x-1/2 items-center";
    }
    if (position === "bottom-left") {
        return "bottom-0 left-0 items-start";
    }
    if (position === "bottom-center") {
        return "bottom-0 left-1/2 -translate-x-1/2 items-center";
    }
    if (position === "bottom-right") {
        return "bottom-0 right-0 items-end";
    }

    return "top-0 right-0 items-end";
}

function groupStyle(group: NotificationGroup): Record<string, string> {
    const style: Record<string, string> = {};

    if (group.position.startsWith("top")) {
        style.marginTop = `${String(group.offsetY)}px`;
    } else {
        style.marginBottom = `${String(group.offsetY)}px`;
    }

    if (group.position.endsWith("left")) {
        style.marginLeft = `${String(group.offsetX)}px`;
    } else if (group.position.endsWith("right")) {
        style.marginRight = `${String(group.offsetX)}px`;
    }

    return style;
}
</script>

<template>
    <ClientOnly>
        <!-- live region 常驻:分组容器随 toast 挂载会导致读屏器漏播第一条,role/aria-live 上移到恒挂载的外层 -->
        <div class="pointer-events-none fixed inset-0 z-[9800]" :class="{'notification-viewport--desktop': props.desktop}" role="status" aria-live="polite">
            <div
                v-for="group in groupedNotifications"
                :key="group.key"
                class="pointer-events-none absolute flex w-full max-w-[420px] flex-col gap-2 px-4"
                :class="positionClass(group.position)"
                :style="groupStyle(group)"
            >
                <TransitionGroup name="nb-notification">
                    <div
                        v-for="item in group.items"
                        :key="item.id"
                        class="pointer-events-auto overflow-hidden rounded-2xl border shadow-[0_14px_40px_rgba(0,0,0,0.22)] backdrop-blur-sm"
                        :style="[cardSurfaceVars, cardToneStyle(item)]"
                        :role="item.tone === 'error' ? 'alert' : undefined"
                        aria-atomic="true"
                    >
                        <div class="flex items-center gap-3 px-4 py-3">
                            <span class="h-2.5 w-2.5 shrink-0 rounded-full" :style="badgeToneStyle(item)"></span>
                            <div class="min-w-0 flex-1">
                                <div v-if="item.title" class="text-sm font-semibold leading-5">
                                    {{ item.title }}
                                </div>
                                <div
                                    v-if="item.html"
                                    :class="item.title ? 'mt-0.5' : ''"
                                    class="text-xs leading-5 [&_a]:underline [&_code]:rounded [&_code]:bg-[var(--bg-hover)] [&_code]:px-1 [&_strong]:font-semibold"
                                    v-html="item.html"
                                ></div>
                                <div
                                    v-else-if="item.message"
                                    :class="item.title ? 'mt-0.5' : ''"
                                    class="text-xs leading-5"
                                >
                                    {{ item.message }}
                                </div>
                            </div>
                            <button
                                type="button"
                                aria-label="关闭通知"
                                title="关闭通知"
                                class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                                @click="remove(item.id)"
                            >
                                <span class="i-lucide-x h-3.5 w-3.5"></span>
                            </button>
                        </div>
                    </div>
                </TransitionGroup>
            </div>

            <!-- 近期通知沉淀:error/warning 消逝后进入右下角账本,作者能追回「刚才是不是没存上」 -->
            <div v-if="history.length > 0" class="pointer-events-auto absolute bottom-0 right-0 mb-4 mr-4 flex flex-col items-end gap-2" :style="cardSurfaceVars">
                <div v-if="historyOpen" class="fixed inset-0" @click="historyOpen = false"></div>
                <div
                    v-if="historyOpen"
                    role="log"
                    :aria-label="t('notifications.recent')"
                    class="relative w-[360px] max-w-[calc(100vw-32px)] overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--text-main)] shadow-[0_14px_40px_rgba(0,0,0,0.22)] backdrop-blur-sm"
                >
                    <div class="flex items-center justify-between border-b border-[var(--border-color)] px-4 py-2.5">
                        <span class="text-sm font-semibold">{{ t("notifications.recent") }}</span>
                        <button
                            type="button"
                            class="rounded-md px-2 py-1 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                            @click="clearHistory()"
                        >
                            {{ t("notifications.clear") }}
                        </button>
                    </div>
                    <ul class="max-h-[320px] overflow-y-auto">
                        <li v-for="entry in history" :key="entry.id" class="flex items-start gap-3 border-b border-[var(--border-color)] px-4 py-2.5 last:border-b-0">
                            <span class="mt-1.5 h-2 w-2 shrink-0 rounded-full" :style="historyDotStyle(entry)" />
                            <div class="min-w-0 flex-1">
                                <div v-if="entry.title" class="text-xs font-semibold leading-5">{{ entry.title }}</div>
                                <div v-if="entry.message" class="text-xs leading-5">{{ entry.message }}</div>
                            </div>
                            <span class="shrink-0 text-[10px] leading-5 text-[var(--text-muted)]">{{ formatHistoryTime(entry.createdAt) }}</span>
                        </li>
                    </ul>
                </div>
                <button
                    type="button"
                    class="relative flex h-9 items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-xs text-[var(--text-main)] shadow-[0_14px_40px_rgba(0,0,0,0.22)] backdrop-blur-sm transition-colors hover:bg-[var(--bg-hover)]"
                    :aria-label="t('notifications.showRecent')"
                    :aria-expanded="historyOpen"
                    :title="t('notifications.showRecent')"
                    @click="historyOpen = !historyOpen"
                >
                    <span class="i-lucide-bell h-3.5 w-3.5" />
                    {{ history.length }}
                </button>
            </div>
        </div>
    </ClientOnly>
</template>

<style scoped>
.nb-notification-enter-active,
.nb-notification-leave-active {
    transition: all 0.22s ease;
}

.nb-notification-enter-from,
.nb-notification-leave-to {
    opacity: 0;
    transform: translateY(-8px) scale(0.98);
}

.nb-notification-move {
    transition: transform 0.22s ease;
}
</style>

<style>
.notification-viewport--desktop {
    top: 36px;
}
</style>
