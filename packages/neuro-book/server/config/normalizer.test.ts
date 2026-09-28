import {describe, expect, it} from "vitest";
import {normalizeGlobalConfig, resolveEffectiveConfig} from "nbook/server/config/normalizer";
import type {StoredProjectConfig} from "nbook/server/config/types";

describe("config normalizer theme", () => {
    it("允许内置 8 主题并保留自定义主题选择", () => {
        const global = normalizeGlobalConfig({
            ui: {
                theme: "custom-night",
                customThemes: [{
                    id: "custom-night",
                    name: "Night",
                    appearance: "dark",
                    vars: {
                        "bg-main": "#111111",
                        "accent-main": "#88ccff",
                        unknown: "#ffffff",
                    },
                } as never, {
                    id: "custom-night",
                    name: "Duplicate",
                    appearance: "light",
                    vars: {"bg-main": "#ffffff"},
                }],
            },
        });
        const effective = resolveEffectiveConfig(global, null);

        expect(effective.ui.theme).toBe("custom-night");
        expect(effective.ui.customThemes).toEqual([{
            id: "custom-night",
            name: "Night",
            appearance: "dark",
            vars: {
                "bg-main": "#111111",
                "accent-main": "#88ccff",
            },
        }]);
    });

    it("未知主题回退 sepia，但 tokyo-night 等内置主题保持有效", () => {
        expect(resolveEffectiveConfig(normalizeGlobalConfig({
            ui: {theme: "tokyo-night"},
        }), null).ui.theme).toBe("tokyo-night");

        expect(resolveEffectiveConfig(normalizeGlobalConfig({
            ui: {theme: "missing-theme"},
        }), null).ui.theme).toBe("sepia");
    });
});

describe("config normalizer profile runtime", () => {
    const globalWithDisabled = normalizeGlobalConfig({
        agent: {
            profiles: {
                "leader.default": {
                    model: {},
                    runtime: {summarizer: {enabled: false}},
                },
            },
        },
    });

    it("仅 global 配置时 effective 保留 summarizer 开关", () => {
        const effective = resolveEffectiveConfig(globalWithDisabled, null);
        expect(effective.agent.profiles["leader.default"]?.runtime?.summarizer).toEqual({enabled: false});
    });

    it("project 空/非法 summarizer 不遮蔽 global 的禁用（enabled 字段级合并）", () => {
        const emptyProject = {
            agent: {
                profiles: {
                    "leader.default": {
                        model: {},
                        runtime: {summarizer: {}},
                    },
                },
            },
        } as StoredProjectConfig;
        expect(resolveEffectiveConfig(globalWithDisabled, emptyProject).agent.profiles["leader.default"]?.runtime?.summarizer).toEqual({enabled: false});

        const invalidProject = {
            agent: {
                profiles: {
                    "leader.default": {
                        model: {},
                        runtime: {summarizer: {enabled: "yes"}},
                    },
                },
            },
        } as never as StoredProjectConfig;
        expect(resolveEffectiveConfig(globalWithDisabled, invalidProject).agent.profiles["leader.default"]?.runtime?.summarizer).toEqual({enabled: false});
    });

    it("project 合法 summarizer 覆盖 global；双方未配置时不携带 key", () => {
        const enabledProject = {
            agent: {
                profiles: {
                    "leader.default": {
                        model: {},
                        runtime: {summarizer: {enabled: true}},
                    },
                },
            },
        } as StoredProjectConfig;
        expect(resolveEffectiveConfig(globalWithDisabled, enabledProject).agent.profiles["leader.default"]?.runtime?.summarizer).toEqual({enabled: true});

        const plainGlobal = normalizeGlobalConfig({
            agent: {
                profiles: {
                    "leader.default": {model: {}},
                },
            },
        });
        const plainProject = {
            agent: {
                profiles: {
                    "leader.default": {model: {}},
                },
            },
        } as StoredProjectConfig;
        expect(resolveEffectiveConfig(plainGlobal, plainProject).agent.profiles["leader.default"]?.runtime).toEqual({});
    });

    it("默认使用 512，Project 可继承或覆盖 Global", () => {
        const global = normalizeGlobalConfig({
            agent: {profileRuntimeDefaults: {fileChangeNotice: {diffMaxChars: 1024}}},
        });
        expect(resolveEffectiveConfig(global, null).agent.profileRuntimeDefaults?.fileChangeNotice?.diffMaxChars).toBe(1024);

        const inherited = resolveEffectiveConfig(global, {agent: {profiles: {writer: {model: {}}}}} as StoredProjectConfig);
        expect(inherited.agent.profiles.writer?.runtime?.fileChangeNotice?.diffMaxChars).toBe(1024);

        const overridden = resolveEffectiveConfig(global, {agent: {profiles: {writer: {model: {}, runtime: {fileChangeNotice: {diffMaxChars: 0}}}}}} as StoredProjectConfig);
        expect(overridden.agent.profiles.writer?.runtime?.fileChangeNotice?.diffMaxChars).toBe(0);

        const defaults = resolveEffectiveConfig(normalizeGlobalConfig({}), null);
        expect(defaults.agent.profileRuntimeDefaults).toEqual({});
    });

    it("接受 0 与 8192，非法或越界值不参与遮蔽", () => {
        const global = normalizeGlobalConfig({
            agent: {profiles: {
                min: {model: {}, runtime: {fileChangeNotice: {diffMaxChars: 0}}},
                max: {model: {}, runtime: {fileChangeNotice: {diffMaxChars: 8192}}},
                invalid: {model: {}, runtime: {fileChangeNotice: {diffMaxChars: 9000}}},
            }},
        });
        const effective = resolveEffectiveConfig(global, {
            agent: {profiles: {max: {model: {}, runtime: {fileChangeNotice: {diffMaxChars: -1}}}}},
        } as StoredProjectConfig);

        expect(effective.agent.profiles.min?.runtime?.fileChangeNotice?.diffMaxChars).toBe(0);
        expect(effective.agent.profiles.max?.runtime?.fileChangeNotice?.diffMaxChars).toBe(8192);
        expect(effective.agent.profiles.invalid?.runtime?.fileChangeNotice).toBeUndefined();
    });
});

describe("config normalizer workspace history", () => {
    it("默认值：enabled 开、90 天窗口、auto-accept 14 天", () => {
        const effective = resolveEffectiveConfig(normalizeGlobalConfig({}), null);
        expect(effective.history).toEqual({
            enabled: true,
            retentionFullDays: 90,
            keepDailyLastAfterWindow: true,
            autoAcceptEnabled: true,
            autoAcceptDays: 14,
        });
    });

    it("非法值回退默认：负数/小数天数与非布尔开关不参与遮蔽", () => {
        const effective = resolveEffectiveConfig(normalizeGlobalConfig({
            history: {
                enabled: "yes" as unknown as boolean,
                retentionFullDays: -3,
                autoAcceptDays: 2.5,
                keepDailyLastAfterWindow: "no" as unknown as boolean,
            },
        }), null);
        expect(effective.history).toEqual({
            enabled: true,
            retentionFullDays: 90,
            keepDailyLastAfterWindow: true,
            autoAcceptEnabled: true,
            autoAcceptDays: 14,
        });
    });

    it("project 覆盖 retention/auto-accept 子集；enabled 被结构性剥离不可遮蔽", () => {
        const global = normalizeGlobalConfig({
            history: {enabled: false, retentionFullDays: 30},
        });
        const project = {
            history: {
                retentionFullDays: 7,
                autoAcceptEnabled: false,
                // project 文件手写 enabled 也不会生效（patch 归一化不输出该字段）
                enabled: true,
            },
        } as StoredProjectConfig;
        const effective = resolveEffectiveConfig(global, project);
        expect(effective.history.enabled).toBe(false);
        expect(effective.history.retentionFullDays).toBe(7);
        expect(effective.history.autoAcceptEnabled).toBe(false);
        expect(effective.history.autoAcceptDays).toBe(14);
    });
});

describe("config normalizer Provider Config identity", () => {
    it("runtime Record 化会跳过重复 Provider 组而不是以后项覆盖前项", () => {
        const provider = {
            id: "duplicate",
            name: "First",
            enabled: true,
            modelApi: "openai-completions",
            options: {apiKey: "", baseURL: "https://example.com/v1", proxy: "", timeoutMs: null, requestOptions: {}},
            models: [{id: "model", name: "Model", enabled: true}],
        };
        const effective = resolveEffectiveConfig(normalizeGlobalConfig({
            models: {default: "duplicate/model", providers: [provider, {...provider, name: "Second"}]},
        }), null);

        expect(effective.models.providers).toEqual({});
    });

    it("runtime Record 化会跳过 Provider 内重复模型组并保留其他唯一模型", () => {
        const effective = resolveEffectiveConfig(normalizeGlobalConfig({
            models: {
                default: "provider/unique",
                providers: [{
                    id: "provider",
                    name: "Provider",
                    enabled: true,
                    modelApi: "openai-completions",
                    options: {apiKey: "", baseURL: "https://example.com/v1", proxy: "", timeoutMs: null, requestOptions: {}},
                    models: [
                        {id: "duplicate", name: "First", enabled: true},
                        {id: "duplicate", name: "Second", enabled: false},
                        {id: "unique", name: "Unique", enabled: false},
                    ],
                }],
            },
        }), null);

        expect(Object.keys(effective.models.providers.provider?.models ?? {})).toEqual(["unique"]);
    });
});

describe("config normalizer loreContext（p-008）", () => {
    it("默认值：retriever=trigger（现状行为与永久降级兜底）", () => {
        const effective = resolveEffectiveConfig(normalizeGlobalConfig({}), null);
        expect(effective.agent.loreContext).toEqual({retriever: "trigger"});
    });

    it("合法值 shadow/memory 生效", () => {
        expect(resolveEffectiveConfig(normalizeGlobalConfig({
            agent: {loreContext: {retriever: "shadow"}},
        }), null).agent.loreContext.retriever).toBe("shadow");
        expect(resolveEffectiveConfig(normalizeGlobalConfig({
            agent: {loreContext: {retriever: "memory"}},
        }), null).agent.loreContext.retriever).toBe("memory");
    });

    it("非法 retriever 值 fail-closed 回落 trigger", () => {
        const effective = resolveEffectiveConfig(normalizeGlobalConfig({
            agent: {loreContext: {retriever: "bogus" as never}},
        }), null);
        expect(effective.agent.loreContext.retriever).toBe("trigger");
    });

    it("v1 global-only：project 文件手写 loreContext 不产生遮蔽", () => {
        const global = normalizeGlobalConfig({
            agent: {loreContext: {retriever: "shadow"}},
        });
        const project = {
            agent: {loreContext: {retriever: "memory"}},
        } as unknown as StoredProjectConfig;
        const effective = resolveEffectiveConfig(global, project);
        expect(effective.agent.loreContext.retriever).toBe("shadow");
    });
});

describe("config normalizer concurrency（p-010）", () => {
    it("默认值：2/1/60s/4/32/4（p-010 决策 1）", () => {
        const effective = resolveEffectiveConfig(normalizeGlobalConfig({}), null);
        expect(effective.agent.concurrency).toEqual({
            maxConcurrentInvocations: 2,
            reservedInteractiveSlots: 1,
            acquireTimeoutMs: 60_000,
            maxParallelToolCallsPerTurn: 4,
            maxToolCallsPerTurn: 32,
            maxActiveJobs: 4,
        });
    });

    it("合法值原样生效", () => {
        const effective = resolveEffectiveConfig(normalizeGlobalConfig({
            agent: {concurrency: {maxConcurrentInvocations: 8, reservedInteractiveSlots: 2, acquireTimeoutMs: 30_000}},
        }), null);
        expect(effective.agent.concurrency).toEqual(expect.objectContaining({
            maxConcurrentInvocations: 8,
            reservedInteractiveSlots: 2,
            acquireTimeoutMs: 30_000,
        }));
    });

    it("非法值逐字段 fail-closed 回落默认", () => {
        const effective = resolveEffectiveConfig(normalizeGlobalConfig({
            agent: {concurrency: {
                maxConcurrentInvocations: 0,
                reservedInteractiveSlots: -1,
                acquireTimeoutMs: 300,
                maxParallelToolCallsPerTurn: 1.5,
                maxToolCallsPerTurn: "32" as never,
                maxActiveJobs: 10_000,
            }},
        }), null);
        expect(effective.agent.concurrency).toEqual({
            maxConcurrentInvocations: 2,
            reservedInteractiveSlots: 1,
            acquireTimeoutMs: 60_000,
            maxParallelToolCallsPerTurn: 4,
            maxToolCallsPerTurn: 32,
            maxActiveJobs: 4,
        });
    });

    it("reservedInteractiveSlots 收敛到 < maxConcurrentInvocations（background 永不可运行的配置被钳断）", () => {
        expect(resolveEffectiveConfig(normalizeGlobalConfig({
            agent: {concurrency: {maxConcurrentInvocations: 2, reservedInteractiveSlots: 5}},
        }), null).agent.concurrency.reservedInteractiveSlots).toBe(1);
        expect(resolveEffectiveConfig(normalizeGlobalConfig({
            agent: {concurrency: {maxConcurrentInvocations: 1, reservedInteractiveSlots: 1}},
        }), null).agent.concurrency.reservedInteractiveSlots).toBe(0);
    });

    it("v1 global-only：project 文件手写 concurrency 不产生遮蔽", () => {
        const global = normalizeGlobalConfig({
            agent: {concurrency: {maxConcurrentInvocations: 4}},
        });
        const project = {
            agent: {concurrency: {maxConcurrentInvocations: 99}},
        } as unknown as StoredProjectConfig;
        const effective = resolveEffectiveConfig(global, project);
        expect(effective.agent.concurrency.maxConcurrentInvocations).toBe(4);
    });
});
