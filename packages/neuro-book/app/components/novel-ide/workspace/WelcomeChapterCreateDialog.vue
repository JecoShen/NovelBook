<script setup lang="ts">
// 欢迎页新建章节:作者只给章节起名,保存位置按约定代管(manuscript/<卷>/<NNN>-chapter/index.md),
// 高级作者可展开自定义路径。章节名写入 frontmatter title,不再要求作者理解 index.md。
import {computed, nextTick, ref, watch} from "vue";
import Dialog from "nbook/app/components/common/Dialog.vue";
import FormField from "nbook/app/components/common/form/FormField.vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";

export type WelcomeChapterCreatePayload = {
    title: string;
    /** 展开高级项且填了路径时为自定义输入;为 null 时父级使用代管路径。 */
    customPath: string | null;
};

const props = defineProps<{
    modelValue: boolean;
    /** 产品按约定算出的代管路径,展示给作者知情。 */
    managedPath: string;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "create", payload: WelcomeChapterCreatePayload): void;
}>();

const {t} = useI18n();

const chapterName = ref("");
const advancedOpen = ref(false);
const customPath = ref("");
const formRef = ref<HTMLElement | null>(null);

watch(() => props.modelValue, (visible) => {
    if (!visible) {
        return;
    }
    chapterName.value = "";
    advancedOpen.value = false;
    customPath.value = "";
    // FormInput 是组件包装,ref 拿不到原生 input;从表单里取第一个输入框聚焦。
    void nextTick(() => formRef.value?.querySelector("input")?.focus());
});

const nameValid = computed(() => chapterName.value.trim().length > 0);
const customPathActive = computed(() => advancedOpen.value && customPath.value.trim().length > 0);
const effectivePath = computed(() => customPathActive.value ? customPath.value.trim() : props.managedPath);

function submit(): void {
    if (!nameValid.value) {
        return;
    }
    emit("create", {
        title: chapterName.value.trim(),
        customPath: customPathActive.value ? customPath.value.trim() : null,
    });
    emit("update:modelValue", false);
}
</script>

<template>
    <!-- 新建章节:单字段 + 代管路径预览 + 高级自定义 -->
    <Dialog
        :model-value="props.modelValue"
        :title="t('ide.shell.createChapterTitle')"
        size="sm"
        :show-footer="false"
        @update:model-value="emit('update:modelValue', $event)"
    >
        <form ref="formRef" class="m-0 flex flex-col gap-3" @submit.prevent="submit">
            <FormField :label="t('ide.shell.createChapterNameLabel')">
                <FormInput v-model="chapterName" :placeholder="t('ide.shell.createChapterNamePlaceholder')" />
            </FormField>
            <p class="m-0 break-all text-[12px] leading-5 text-[var(--text-muted)]">
                {{ t("ide.shell.createChapterManagedPathHint", {path: effectivePath}) }}
            </p>
            <details class="group rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2" @toggle="advancedOpen = ($event.target as HTMLDetailsElement).open">
                <summary class="cursor-pointer select-none text-[12px] text-[var(--text-secondary)] outline-none">
                    {{ t("ide.shell.createChapterAdvancedToggle") }}
                </summary>
                <div class="mt-2">
                    <FormInput v-model="customPath" :placeholder="props.managedPath" />
                </div>
            </details>
            <div class="mt-1 flex items-center justify-end gap-2.5">
                <button
                    type="button"
                    class="inline-flex h-8 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-4 text-[13px] font-medium text-[var(--text-main)] transition-colors duration-200 hover:bg-[var(--bg-hover)] active:scale-95"
                    @click="emit('update:modelValue', false)"
                >
                    {{ t("common.cancel") }}
                </button>
                <button
                    type="submit"
                    class="inline-flex h-8 items-center justify-center rounded-md border border-transparent bg-[var(--accent-main)] px-4 text-[13px] font-medium text-[var(--text-inverse)] transition-all duration-200 hover:opacity-90 hover:shadow-md active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                    :disabled="!nameValid"
                >
                    {{ t("ide.shell.createChapterConfirm") }}
                </button>
            </div>
        </form>
    </Dialog>
</template>
