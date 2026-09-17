/**
 * 首启向导自动开门裁决。面板 watch 带 immediate,首次触发先于首个 load() 回合,
 * 彼时 providers 恒为空,不能据此判定首启;只有经历过完整 loading→落定 回合后
 * 仍零 Provider 才自动开门,否则已有配置的面板会被向导盖住。
 */
export type SetupWizardAutoOpenPhase = "idle" | "loading" | "settled";

export interface SetupWizardAutoOpenVerdict {
    phase: SetupWizardAutoOpenPhase;
    shouldOpen: boolean;
}

export function reduceSetupWizardAutoOpen(
    phase: SetupWizardAutoOpenPhase,
    isLoading: boolean,
    providerCount: number,
): SetupWizardAutoOpenVerdict {
    if (isLoading) {
        return {phase: "loading", shouldOpen: false};
    }
    if (phase === "idle") {
        return {phase: "idle", shouldOpen: false};
    }
    return {phase: "settled", shouldOpen: providerCount === 0};
}
