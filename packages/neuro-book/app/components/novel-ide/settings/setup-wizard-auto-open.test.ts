import {describe, expect, it} from "vitest";
import {reduceSetupWizardAutoOpen, type SetupWizardAutoOpenPhase} from "nbook/app/components/novel-ide/settings/setup-wizard-auto-open";

describe("首启向导自动开门裁决", () => {
    it("挂载期 immediate 触发即使零 Provider 也不开门", () => {
        const verdict = reduceSetupWizardAutoOpen("idle", false, 0);
        expect(verdict).toEqual({phase: "idle", shouldOpen: false});
    });

    it("完整加载回合结束后仍零 Provider 才开门", () => {
        const loading = reduceSetupWizardAutoOpen("idle", true, 0);
        expect(loading).toEqual({phase: "loading", shouldOpen: false});
        const settled = reduceSetupWizardAutoOpen(loading.phase, false, 0);
        expect(settled).toEqual({phase: "settled", shouldOpen: true});
    });

    it("回归:已有 Provider 的面板从挂载到加载完成全程不开门", () => {
        let phase: SetupWizardAutoOpenPhase = "idle";
        // 挂载时 immediate 触发:草稿尚未加载,providers 恒为零。
        const mount = reduceSetupWizardAutoOpen(phase, false, 0);
        phase = mount.phase;
        expect(mount.shouldOpen).toBe(false);
        const loading = reduceSetupWizardAutoOpen(phase, true, 0);
        phase = loading.phase;
        expect(loading.shouldOpen).toBe(false);
        const settled = reduceSetupWizardAutoOpen(phase, false, 2);
        expect(settled).toEqual({phase: "settled", shouldOpen: false});
    });

    it("落定后 Provider 减到零会重新开门", () => {
        const afterLoad = reduceSetupWizardAutoOpen("loading", false, 1);
        expect(afterLoad.shouldOpen).toBe(false);
        const emptied = reduceSetupWizardAutoOpen(afterLoad.phase, false, 0);
        expect(emptied.shouldOpen).toBe(true);
    });

    it("加载中从不开门", () => {
        expect(reduceSetupWizardAutoOpen("settled", true, 0).shouldOpen).toBe(false);
        expect(reduceSetupWizardAutoOpen("idle", true, 0).phase).toBe("loading");
    });
});
