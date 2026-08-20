import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolvePiApiKeyForModelFromConfig, resolvePiModelFromConfig, warnProviderCompatIssues } from 'nbook/server/agent/harness/model-resolver'
import { createDefaultEffectiveConfig } from 'nbook/server/config/normalizer'
import type { EffectiveConfig } from 'nbook/server/config/types'

const appLoggerMocks = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('nbook/server/app-logs/logger', () => ({
  appLogger: appLoggerMocks,
}))

describe('model resolver', () => {
  beforeEach(() => {
    appLoggerMocks.warn.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('按 providerConfigId + model.id 从当前 effective config 解析完整模型', () => {
    const config = createConfig()
    const model = resolvePiModelFromConfig(config, 'leader.default')

    expect(model).toMatchObject({
      provider: 'local-openai',
      providerConfigId: 'local-openai',
      id: 'test-model',
      api: 'openai-completions',
      baseUrl: 'http://127.0.0.1:11434/v1',
      contextWindow: 128_000,
      maxTokens: 8_000,
    })
    expect(resolvePiApiKeyForModelFromConfig(config, model)).toBe('secret')
  })

  it('profile override 只改变 selection key，不读取 Catalog', () => {
    const config = createConfig()
    config.models.providers['local-openai']!.models['other-model'] = {
      ...config.models.providers['local-openai']!.models['test-model']!,
      id: 'other-model',
      name: 'Other Model',
    }

    expect(resolvePiModelFromConfig(config, 'leader.default', { modelKey: 'local-openai/other-model' }).id).toBe('other-model')
  })

  it('删除、禁用或格式错误的 selection 明确失败', () => {
    const config = createConfig()
    expect(() => resolvePiModelFromConfig(config, 'leader.default', { modelKey: 'missing/model' })).toThrow('模型未启用或不存在')
    expect(() => resolvePiModelFromConfig(config, 'leader.default', { modelKey: 'bad-key' })).toThrow('模型 key 格式错误')
  })

  describe('warnProviderCompatIssues ARK 启发式', () => {
    it('ARK baseURL + reasoning + 无 supportsDeveloperRole:false → warn 一次', () => {
      const config = createArkConfig({ supportsDeveloperRole: undefined })
      warnProviderCompatIssues(config)

      expect(appLoggerMocks.warn).toHaveBeenCalledTimes(1)
      const [event, payload] = appLoggerMocks.warn.mock.calls[0]!
      expect(event).toBe('agent.model.arkCompat.developerRoleNotDisabled')
      expect(payload).toMatchObject({
        provider: 'volcengine-ark',
        model: 'doubao-seed-2-0-code-preview-260215',
        baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
      })
      expect((payload as { hint: string }).hint).toContain('supportsDeveloperRole:false')
    })

    it('同一 (provider, model) 二次扫描不重复 warn（进程内去重）', () => {
      // 用独立的 provider/model id 避免与同 suite 上一个 test 的 dedupe Set 共用
      const config = createArkConfig({ supportsDeveloperRole: undefined })
      config.models.providers['volcengine-ark']!.models['dedupe-target'] = {
        ...config.models.providers['volcengine-ark']!.models['doubao-seed-2-0-code-preview-260215']!,
        id: 'dedupe-target',
        name: 'Dedupe Target',
      }

      warnProviderCompatIssues(config)
      expect(appLoggerMocks.warn).toHaveBeenCalledTimes(1)
      warnProviderCompatIssues(config)
      expect(appLoggerMocks.warn).toHaveBeenCalledTimes(1)
    })

    it('compat.supportsDeveloperRole=false 显式设置时不 warn', () => {
      const config = createArkConfig({ supportsDeveloperRole: false })
      warnProviderCompatIssues(config)

      expect(appLoggerMocks.warn).not.toHaveBeenCalled()
    })

    it('非 ARK baseURL（DeepSeek / OpenAI）不 warn', () => {
      const config = createDefaultEffectiveConfig()
      config.models = {
        defaultModelKey: 'deepseek/deepseek-v4-flash',
        providers: {
          deepseek: {
            name: 'DeepSeek',
            enabled: true,
            modelApi: 'openai-completions',
            options: { apiKey: 'sk', baseURL: 'https://api.deepseek.com', proxy: '', timeoutMs: null, requestOptions: {} },
            models: {
              'deepseek-v4-flash': {
                name: 'deepseek-v4-flash',
                id: 'deepseek-v4-flash',
                group: null,
                enabled: true,
                api: 'openai-completions',
                reasoning: true,
                input: ['text'],
                maxTokens: 32_000,
                cost: null,
                compat: null,
                headers: null,
                thinkingLevelMap: null,
                contextWindowTokens: 128_000,
              },
            },
          },
        },
      }
      config.agent.profileModelDefaults.modelKey = 'deepseek/deepseek-v4-flash'

      warnProviderCompatIssues(config)
      expect(appLoggerMocks.warn).not.toHaveBeenCalled()
    })

    it('reasoning=false 时即使 ARK 也不 warn（非 developer role 路径）', () => {
      const config = createArkConfig({ supportsDeveloperRole: undefined, reasoning: false })
      warnProviderCompatIssues(config)
      expect(appLoggerMocks.warn).not.toHaveBeenCalled()
    })
  })
})

function createConfig(): Pick<EffectiveConfig, 'agent' | 'models'> {
  const config = createDefaultEffectiveConfig()
  config.models = {
    defaultModelKey: 'local-openai/test-model',
    providers: {
      'local-openai': {
        name: 'Local OpenAI',
        enabled: true,
        modelApi: null,
        options: { apiKey: 'secret', baseURL: 'http://127.0.0.1:11434/v1', proxy: '', timeoutMs: null, requestOptions: {} },
        models: {
          'test-model': {
            name: 'Test Model',
            id: 'test-model',
            group: null,
            enabled: true,
            api: 'openai-completions',
            reasoning: false,
            input: ['text'],
            maxTokens: 8_000,
            cost: null,
            compat: null,
            headers: null,
            thinkingLevelMap: null,
            contextWindowTokens: 128_000,
          },
        },
      },
    },
  }
  config.agent.profileModelDefaults.modelKey = 'local-openai/test-model'
  return config
}

function createArkConfig(options: { supportsDeveloperRole?: boolean, reasoning?: boolean }): Pick<EffectiveConfig, 'agent' | 'models'> {
  const config = createDefaultEffectiveConfig()
  config.models = {
    defaultModelKey: 'volcengine-ark/doubao-seed-2-0-code-preview-260215',
    providers: {
      'volcengine-ark': {
        name: 'Volcengine Ark',
        enabled: true,
        modelApi: 'openai-completions',
        options: { apiKey: 'ark-test', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', proxy: '', timeoutMs: 60000, requestOptions: {} },
        models: {
          'doubao-seed-2-0-code-preview-260215': {
            name: 'doubao-seed-2-0-code-preview',
            id: 'doubao-seed-2-0-code-preview-260215',
            group: null,
            enabled: true,
            api: 'openai-completions',
            reasoning: options.reasoning ?? true,
            input: ['text'],
            maxTokens: 32_768,
            cost: null,
            compat: options.supportsDeveloperRole === undefined
              ? null
              : { supportsDeveloperRole: options.supportsDeveloperRole },
            headers: null,
            thinkingLevelMap: null,
            contextWindowTokens: 256_000,
          },
        },
      },
    },
  }
  config.agent.profileModelDefaults.modelKey = 'volcengine-ark/doubao-seed-2-0-code-preview-260215'
  return config
}
