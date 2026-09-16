export type NotificationTone = "success" | "warning" | "info" | "error";
export type NotificationPosition =
    | "top-left"
    | "top-center"
    | "top-right"
    | "bottom-left"
    | "bottom-center"
    | "bottom-right";

export type NotificationInput = {
    title?: string;
    message?: string;
    html?: string;
    tone?: NotificationTone;
    autoClose?: boolean;
    duration?: number;
    position?: NotificationPosition;
    offsetX?: number;
    offsetY?: number;
};

export type NotificationItem = Required<
    Pick<NotificationInput, "tone" | "autoClose" | "duration" | "position" | "offsetX" | "offsetY">
> & NotificationInput & {
    id: string;
    createdAt: number;
};

/** 沉淀条目:error/warning 消逝后留在「近期通知」账本里的记录;账本只存纯文本,不回放 html。 */
export type NotificationHistoryEntry = {
    id: string;
    tone: NotificationTone;
    title?: string;
    message?: string;
    createdAt: number;
};

/**
 * 只有失败/警告需要沉淀:晚看一眼的作者要能追回「刚才是不是没存上」;
 * 成功/信息保持即逝,不进账本。账本只活在本会话(内存环形 30 条),不落盘。
 */
const NOTIFICATION_HISTORY_LIMIT = 30;
const NOTIFICATION_HISTORY_TONES = new Set<NotificationTone>(["error", "warning"]);

const DEFAULT_POSITION: NotificationPosition = "top-right";
const DEFAULT_OFFSET_X = 16;
const DEFAULT_OFFSET_Y = 16;
const DEFAULT_DURATION_BY_TONE: Record<NotificationTone, number> = {
    success: 3200,
    warning: 4200,
    info: 3600,
    error: 5600,
};

const notificationTimerMap = new Map<string, number | ReturnType<typeof globalThis.setTimeout>>();

function createNotificationId(): string {
    return `notification-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function clearNotificationTimer(id: string): void {
    const timer = notificationTimerMap.get(id);
    if (!timer) {
        return;
    }

    globalThis.clearTimeout(timer as ReturnType<typeof globalThis.setTimeout>);
    notificationTimerMap.delete(id);
}

export function useNotification() {
    const notifications = useState<NotificationItem[]>("notifications", () => []);
    const history = useState<NotificationHistoryEntry[]>("notification-history", () => []);

    const remove = (id: string): void => {
        clearNotificationTimer(id);
        notifications.value = notifications.value.filter((item) => item.id !== id);
    };

    const notify = (input: NotificationInput | string): string => {
        const normalizedInput = typeof input === "string"
            ? {message: input}
            : input;
        const tone = normalizedInput.tone ?? "info";
        const id = createNotificationId();
        const item: NotificationItem = {
            id,
            title: normalizedInput.title,
            message: normalizedInput.message,
            html: normalizedInput.html,
            tone,
            autoClose: normalizedInput.autoClose ?? true,
            duration: normalizedInput.duration ?? DEFAULT_DURATION_BY_TONE[tone],
            position: normalizedInput.position ?? DEFAULT_POSITION,
            offsetX: normalizedInput.offsetX ?? DEFAULT_OFFSET_X,
            offsetY: normalizedInput.offsetY ?? DEFAULT_OFFSET_Y,
            createdAt: Date.now(),
        };

        notifications.value = [...notifications.value, item];

        if (NOTIFICATION_HISTORY_TONES.has(tone)) {
            // html 通知在账本里降级为去标签纯文本:账本回放不引入第二个 v-html 面。
            const historyMessage = item.message ?? (item.html ? item.html.replace(/<[^>]+>/g, "").trim() : undefined);
            if (item.title || historyMessage) {
                history.value = [{
                    id: item.id,
                    tone,
                    title: item.title,
                    message: historyMessage,
                    createdAt: item.createdAt,
                }, ...history.value].slice(0, NOTIFICATION_HISTORY_LIMIT);
            }
        }

        if (import.meta.client && item.autoClose && item.duration > 0) {
            clearNotificationTimer(item.id);
            notificationTimerMap.set(item.id, window.setTimeout(() => {
                remove(item.id);
            }, item.duration));
        }

        return item.id;
    };

    const clear = (): void => {
        notifications.value.forEach((item) => clearNotificationTimer(item.id));
        notifications.value = [];
    };

    const clearHistory = (): void => {
        history.value = [];
    };

    const success = (message: string, options: Omit<NotificationInput, "message" | "tone"> = {}): string => notify({
        ...options,
        message,
        tone: "success",
    });

    const warning = (message: string, options: Omit<NotificationInput, "message" | "tone"> = {}): string => notify({
        ...options,
        message,
        tone: "warning",
    });

    const info = (message: string, options: Omit<NotificationInput, "message" | "tone"> = {}): string => notify({
        ...options,
        message,
        tone: "info",
    });

    const error = (message: string, options: Omit<NotificationInput, "message" | "tone"> = {}): string => notify({
        ...options,
        message,
        tone: "error",
    });

    return {
        notifications,
        history,
        notify,
        remove,
        clear,
        clearHistory,
        success,
        warning,
        info,
        error,
    };
}
