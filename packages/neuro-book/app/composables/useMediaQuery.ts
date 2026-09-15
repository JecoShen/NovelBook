import {onBeforeUnmount, onMounted, ref} from "vue";

/**
 * matchMedia 的响应式封装。SSR 与挂载前恒为 false(桌面布局为默认形态);
 * 仅在客户端挂载后订阅变化,卸载时解除。
 */
export function useMediaQuery(query: string) {
    const matches = ref(false);
    let media: MediaQueryList | null = null;
    const update = (): void => {
        matches.value = media?.matches ?? false;
    };
    onMounted(() => {
        media = window.matchMedia(query);
        update();
        media.addEventListener("change", update);
    });
    onBeforeUnmount(() => {
        media?.removeEventListener("change", update);
        media = null;
    });
    return matches;
}
