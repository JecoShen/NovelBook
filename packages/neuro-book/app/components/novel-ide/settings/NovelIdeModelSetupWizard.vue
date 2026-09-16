<script setup lang="ts">
import {computed} from "vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import NovelIdeModelSelect from "nbook/app/components/novel-ide/settings/NovelIdeModelSelect.vue";
import type {ModelSettingsProviderDraft} from "nbook/app/components/novel-ide/settings/model-settings-draft";
import {providerSetupMeta, type ProviderSetupMeta} from "nbook/app/utils/provider-setup-meta";
import type {EnabledModelOptionDto, ProviderTemplateDto} from "nbook/shared/dto/app-settings.dto";

const props = withDefaults(defineProps<{
    step: 1 | 2 | 3;
    templates: ProviderTemplateDto[];
    provider?: ModelSettingsProviderDraft | null;
    models: EnabledModelOptionDto[];
    defaultModelKey: string | null;
    discovering?: boolean;
}>(), {
    provider: null,
    discovering: false,
});

const emit = defineEmits<{
    (e: "selectTemplate", templateId: string): void;
    (e: "updateProviderOption", field: "baseURL" | "apiKey", value: string): void;
    (e: "updateDefaultModelKey", value: string | null): void;
    (e: "discover" | "back" | "next" | "finish" | "dismiss"): void;
}>();

const {t} = useI18n();

const steps = computed(() => [
    {index: 1, label: t("settings.panels.models.setup.stepProvider")},
    {index: 2, label: t("settings.panels.models.setup.stepKey")},
    {index: 3, label: t("settings.panels.models.setup.stepModel")},
]);

const wizardProviderMeta = computed<ProviderSetupMeta | null>(() => props.provider ? providerSetupMeta(props.provider.id, props.provider.name) : null);

function templateMeta(template: ProviderTemplateDto): ProviderSetupMeta {
    return providerSetupMeta(template.id, template.name);
}

function stepState(index: number): "done" | "active" | "todo" {
    if (index < props.step) {
        return "done";
    }
    return index === props.step ? "active" : "todo";
}
</script>

<template>
    <!-- 首启模型配置向导:零 Provider 时替代工程墙,三步接到第一个可用模型 -->
    <section class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-5 shadow-sm" data-testid="model-setup-wizard">
        <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
                <h3 class="text-base font-semibold text-[var(--text-main)]">{{ t("settings.panels.models.setup.title") }}</h3>
                <p class="mt-1 max-w-xl text-xs leading-5 text-[var(--text-secondary)]">{{ t("settings.panels.models.setup.description") }}</p>
            </div>
            <button type="button" class="shrink-0 text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--text-main)]" @click="emit('dismiss')">
                {{ t("settings.panels.models.setup.dismiss") }}
            </button>
        </div>

        <!-- 步骤指示:序号本身是作者需要的信息(还有几步),非装饰 -->
        <ol class="mt-4 flex items-center gap-2">
            <template v-for="(item, itemIndex) in steps" :key="item.index">
                <li class="flex items-center gap-1.5" :aria-current="stepState(item.index) === 'active' ? 'step' : undefined">
                    <span
                        class="flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-semibold"
                        :class="stepState(item.index) === 'active'
                            ? 'border-[var(--accent-main)] bg-[var(--accent-main)] text-[var(--text-inverse)]'
                            : stepState(item.index) === 'done'
                                ? 'border-[var(--accent-main)] text-[var(--accent-text)]'
                                : 'border-[var(--border-color)] text-[var(--text-muted)]'"
                    >
                        <span v-if="stepState(item.index) === 'done'" class="i-lucide-check h-3 w-3" />
                        <template v-else>{{ item.index }}</template>
                    </span>
                    <span class="text-xs" :class="stepState(item.index) === 'active' ? 'font-medium text-[var(--text-main)]' : 'text-[var(--text-muted)]'">{{ item.label }}</span>
                </li>
                <li v-if="itemIndex < steps.length - 1" class="h-px w-6 bg-[var(--border-color)]" aria-hidden="true" />
            </template>
        </ol>

        <!-- 第一步:选服务商(徽标 + 中文名) -->
        <div v-if="props.step === 1" class="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            <button
                v-for="template in props.templates"
                :key="template.id"
                type="button"
                class="flex items-center gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2.5 text-left transition-colors hover:border-[var(--accent-main)] hover:bg-[var(--bg-hover)]"
                @click="emit('selectTemplate', template.id)"
            >
                <!-- 徽标字形用 text-main:与 WE 徽标同一 @chip:accent 配对合同 -->
                <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[color-mix(in_srgb,var(--accent-main)_58%,var(--border-color))] bg-[color-mix(in_srgb,var(--accent-main)_18%,var(--bg-panel))] text-[12px] font-bold text-[var(--text-main)]">
                    <span v-if="templateMeta(template).fallbackIcon" :class="templateMeta(template).fallbackIcon" class="h-4 w-4" />
                    <template v-else>{{ templateMeta(template).monogram }}</template>
                </span>
                <span class="min-w-0 flex-1">
                    <span class="block truncate text-[13px] font-medium text-[var(--text-main)]">{{ templateMeta(template).zhName ?? template.name }}</span>
                    <span v-if="templateMeta(template).zhName" class="block truncate text-[10px] text-[var(--text-muted)]">{{ template.name }}</span>
                </span>
                <span class="i-lucide-chevron-right h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
            </button>
        </div>

        <!-- 第二步:贴 Key(带「从哪里获取」) -->
        <div v-else-if="props.step === 2 && props.provider && wizardProviderMeta" class="mt-4 max-w-xl">
            <div class="flex items-center gap-2.5">
                <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[color-mix(in_srgb,var(--accent-main)_58%,var(--border-color))] bg-[color-mix(in_srgb,var(--accent-main)_18%,var(--bg-panel))] text-[12px] font-bold text-[var(--text-main)]">
                    <span v-if="wizardProviderMeta.fallbackIcon" :class="wizardProviderMeta.fallbackIcon" class="h-4 w-4" />
                    <template v-else>{{ wizardProviderMeta.monogram }}</template>
                </span>
                <div class="min-w-0">
                    <div class="truncate text-sm font-semibold text-[var(--text-main)]">{{ wizardProviderMeta.zhName ?? props.provider.name }}</div>
                    <div class="truncate text-[11px] text-[var(--text-muted)]">{{ props.provider.id }}</div>
                </div>
            </div>

            <div class="mt-4 space-y-3">
                <div class="space-y-1.5">
                    <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.models.setup.apiBase") }}</label>
                    <FormInput :model-value="props.provider.options.baseURL" :placeholder="t('settings.panels.models.apiBasePlaceholder')" @update:model-value="emit('updateProviderOption', 'baseURL', $event)" />
                </div>
                <div class="space-y-1.5">
                    <label class="text-xs font-medium text-[var(--text-secondary)]">API Key</label>
                    <FormInput :model-value="props.provider.options.apiKey" placeholder="sk-..." type="password" @update:model-value="emit('updateProviderOption', 'apiKey', $event)" />
                    <p class="text-[11px] leading-5 text-[var(--text-muted)]">
                        <template v-if="wizardProviderMeta.keyHelpUrl">
                            {{ t("settings.panels.models.setup.keyHelpPrefix") }}
                            <a :href="wizardProviderMeta.keyHelpUrl" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-0.5 text-[var(--accent-text)] underline underline-offset-2 transition-colors hover:opacity-80">
                                {{ t("settings.panels.models.setup.keyHelpLink", {provider: wizardProviderMeta.zhName ?? props.provider.name}) }}
                                <span class="i-lucide-arrow-up-right h-3 w-3" />
                            </a>
                        </template>
                        <template v-else>
                            {{ t("settings.panels.models.setup.keyHelpGeneric", {provider: wizardProviderMeta.zhName ?? props.provider.name}) }}
                        </template>
                    </p>
                    <p class="text-[11px] leading-5 text-[var(--text-muted)]">{{ t("settings.panels.models.setup.keyLocalNote") }}</p>
                    <p class="text-[11px] leading-5 text-[var(--text-muted)]">{{ t("settings.panels.models.setup.keyOptional") }}</p>
                </div>
            </div>

            <div class="mt-5 flex items-center gap-2">
                <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-xs font-medium text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)]" @click="emit('back')">
                    <span class="i-lucide-arrow-left h-3.5 w-3.5" />
                    {{ t("settings.panels.models.setup.back") }}
                </button>
                <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--accent-main)] bg-[var(--accent-main)] px-4 text-xs font-medium text-[var(--text-inverse)] transition-opacity hover:opacity-90" @click="emit('next')">
                    {{ t("settings.panels.models.setup.next") }}
                    <span class="i-lucide-arrow-right h-3.5 w-3.5" />
                </button>
            </div>
        </div>

        <!-- 第三步:选模型(先发现,再定默认) -->
        <div v-else-if="props.step === 3" class="mt-4 max-w-xl">
            <div class="flex flex-wrap items-center gap-2">
                <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-xs font-medium text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)] disabled:pointer-events-none disabled:opacity-50" :disabled="props.discovering" @click="emit('discover')">
                    <span :class="props.discovering ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-cloud-lightning'" class="h-3.5 w-3.5" />
                    {{ props.discovering ? t("settings.panels.models.discovering") : t("settings.panels.models.setup.discoverModels") }}
                </button>
                <p v-if="props.models.length === 0" class="text-[11px] leading-5 text-[var(--text-muted)]">{{ t("settings.panels.models.setup.noModelsYet") }}</p>
            </div>

            <div class="mt-4 space-y-1.5">
                <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.models.globalDefaultTitle") }}</label>
                <NovelIdeModelSelect
                    :model-value="props.defaultModelKey"
                    :models="props.models"
                    :placeholder="t('settings.panels.models.noEnabledModels')"
                    @update:model-value="emit('updateDefaultModelKey', $event)"
                />
                <p class="text-[11px] leading-5 text-[var(--text-muted)]">{{ t("settings.panels.models.setup.modelHint") }}</p>
            </div>

            <div class="mt-5 flex items-center gap-2">
                <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-xs font-medium text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)]" @click="emit('back')">
                    <span class="i-lucide-arrow-left h-3.5 w-3.5" />
                    {{ t("settings.panels.models.setup.back") }}
                </button>
                <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--accent-main)] bg-[var(--accent-main)] px-4 text-xs font-medium text-[var(--text-inverse)] transition-opacity hover:opacity-90" @click="emit('finish')">
                    <span class="i-lucide-check h-3.5 w-3.5" />
                    {{ t("settings.panels.models.setup.finish") }}
                </button>
            </div>
        </div>
    </section>
</template>
