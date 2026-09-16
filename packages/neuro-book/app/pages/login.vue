<script setup lang="ts">
import {storeToRefs} from "pinia";
import {useIdeTheme} from "nbook/app/composables/useIdeTheme";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {AuthSessionDto} from "nbook/shared/dto/auth.dto";

definePageMeta({
    layout: false,
});

const route = useRoute();
const router = useRouter();
const themeHostRef = ref<HTMLElement | null>(null);
const username = ref("");
const password = ref("");
const busy = ref(false);
const errorMessage = ref("");
const novelIdeStore = useNovelIdeStore();
const {activeThemeId, customThemes, themeVarsSnapshot} = storeToRefs(novelIdeStore);
const {mountThemeHost} = useIdeTheme(activeThemeId, customThemes, themeVarsSnapshot);
const {t} = useI18n();

/**
 * 解析安全的登录后跳转地址。
 */
const resolveRedirect = (): string => {
    return typeof route.query.redirect === "string" && route.query.redirect.trim().startsWith("/") && !route.query.redirect.trim().startsWith("//")
        ? route.query.redirect
        : "/";
};

/**
 * 登录提交。
 */
const submit = async (): Promise<void> => {
    if (busy.value) {
        return;
    }

    busy.value = true;
    errorMessage.value = "";
    try {
        await $fetch<AuthSessionDto>("/api/auth/login", {
            method: "POST",
            body: {
                username: username.value,
                password: password.value,
            },
        });
        await router.push(resolveRedirect());
    } catch (error) {
        // $fetch 的 FetchError 本身是 Error,直接上屏会带 `[POST] "/api/auth/login": 401` 包络;
        // 走 resolveApiErrorMessage 取服务器业务文案(用户名或密码错误),通用短语落回三要素 fallback。
        errorMessage.value = resolveApiErrorMessage(error, t("auth.loginFailed"));
    } finally {
        busy.value = false;
    }
};

onMounted(() => {
    mountThemeHost(themeHostRef.value);
    void (async () => {
        try {
            const session = await $fetch<AuthSessionDto>("/api/auth/me");
            if (!session.authEnabled || session.user) {
                await router.replace(resolveRedirect());
            }
        } catch {
            // 路由守卫已经处理常规鉴权失败；这里仅兜底 auth disabled / 已登录场景。
        }
    })();
});
</script>

<template>
    <!-- 登录页外壳 -->
    <div ref="themeHostRef" class="auth-page min-h-screen bg-[var(--bg-main)] text-[var(--text-main)] transition-colors duration-300">
        <div class="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-4 py-10">
            <!-- 品牌区:与书架同源的羽毛笔+衬线字标,登录是产品门面不是裸表单 -->
            <div class="mb-8 flex flex-col items-center text-center">
                <div class="flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--border-accent)] bg-[var(--accent-bg)] text-[var(--accent-text)] shadow-sm">
                    <span class="i-lucide-feather h-6 w-6" />
                </div>
                <div class="mt-4 font-serif text-3xl font-bold text-[var(--text-main)]">NeuroBook</div>
                <p class="mt-2 text-sm text-[var(--text-secondary)]">{{ t("auth.brandTagline") }}</p>
            </div>
            <div class="w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-6 shadow-2xl">
                <div class="mb-6">
                    <div class="text-2xl font-semibold">{{ t("auth.loginTitle") }}</div>
                    <div class="mt-2 text-sm text-[var(--text-secondary)]">{{ t("auth.loginDescription") }}</div>
                </div>

                <form class="space-y-4" @submit.prevent="submit">
                    <label class="block">
                        <div class="mb-2 text-sm text-[var(--text-secondary)]">{{ t("auth.username") }}</div>
                        <FormInput v-model="username" autocomplete="username" :placeholder="t('auth.usernamePlaceholder')" />
                    </label>

                    <label class="block">
                        <div class="mb-2 text-sm text-[var(--text-secondary)]">{{ t("auth.password") }}</div>
                        <FormInput v-model="password" type="password" autocomplete="current-password" :placeholder="t('auth.passwordPlaceholder')" />
                    </label>

                    <div v-if="errorMessage" class="rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-sm text-[var(--status-danger)]">
                        {{ errorMessage }}
                    </div>

                    <button
                        type="submit"
                        class="inline-flex h-10 w-full items-center justify-center rounded-lg bg-[var(--accent-main)] px-4 text-sm font-medium text-[var(--text-inverse)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                        :disabled="busy"
                    >
                        {{ busy ? t("auth.loggingIn") : t("auth.loginButton") }}
                    </button>

                    <!-- 首次部署与关闭认证指引 -->
                    <div class="space-y-2 rounded-lg border border-[var(--status-info-border)] bg-[var(--status-info-bg)] px-3 py-3 text-xs text-[var(--text-secondary)]">
                        <div class="font-medium text-[var(--text-main)]">{{ t("auth.setupAdminTitle") }}</div>
                        <p>
                            {{ t("auth.setupAdminCommandBefore") }}
                            <code class="rounded bg-[var(--bg-main)] px-1.5 py-0.5 font-mono text-[var(--status-info)]">bun run create-admin</code>
                            {{ t("auth.setupAdminCommandAfter") }}
                        </p>
                        <p>
                            {{ t("auth.disableAuthBefore") }}
                            <code class="rounded bg-[var(--bg-main)] px-1.5 py-0.5 font-mono text-[var(--status-info)]">config.yaml</code>
                            {{ t("auth.disableAuthAfter") }}
                        </p>
                    </div>
                </form>
            </div>
        </div>
    </div>
</template>
