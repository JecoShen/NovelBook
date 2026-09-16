<script setup lang="ts">
import Dialog from "nbook/app/components/common/Dialog.vue";

defineProps<{
    modelValue: boolean;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
}>();

const {t} = useI18n();

/** 概念清单:名词表与文案在 locale(ide.help.concepts),这里只定顺序与图标;新增概念先加 locale 再登记。 */
const conceptKeys = ["worldEngine", "subject", "slice", "lorebook", "plotThread", "profile", "session", "embedding", "provider"] as const;

type ConceptKey = (typeof conceptKeys)[number];

const conceptIcons: Record<ConceptKey, string> = {
    worldEngine: "i-lucide-earth",
    subject: "i-lucide-shapes",
    slice: "i-lucide-heart-pulse",
    lorebook: "i-lucide-book-open",
    plotThread: "i-lucide-spline",
    profile: "i-lucide-id-card",
    session: "i-lucide-messages-square",
    embedding: "i-lucide-binary",
    provider: "i-lucide-cloud-cog",
};
</script>

<template>
    <Dialog
        :model-value="modelValue"
        :title="t('ide.help.title')"
        size="lg"
        :show-footer="false"
        @update:model-value="emit('update:modelValue', $event)"
    >
        <p class="text-xs leading-relaxed text-[var(--text-muted)]">{{ t("ide.help.subtitle") }}</p>
        <dl class="mt-3 flex flex-col gap-1">
            <div
                v-for="key in conceptKeys"
                :key="key"
                class="flex items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-[var(--bg-hover)]"
            >
                <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--border-color)] text-[var(--text-muted)]">
                    <span class="h-4 w-4" :class="conceptIcons[key]" />
                </span>
                <div class="min-w-0">
                    <dt class="text-[13px] font-semibold text-[var(--text-main)]">{{ t(`ide.help.concepts.${key}.name`) }}</dt>
                    <dd class="mt-0.5 text-xs leading-relaxed text-[var(--text-secondary)]">{{ t(`ide.help.concepts.${key}.description`) }}</dd>
                </div>
            </div>
        </dl>
    </Dialog>
</template>
