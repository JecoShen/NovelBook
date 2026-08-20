import type { Api, Model } from '@earendil-works/pi-ai'
import { resolvePiModelMetadata, type ResolvedPiModel } from 'nbook/server/agent/harness/pi-model-metadata'
import type { AgentProfileModelConfig, ConfiguredModelConfig, ConfiguredProviderConfig, EffectiveConfig } from 'nbook/server/config/types'
import { loadGlobalEffectiveConfigSync } from 'nbook/server/config/config-service'
import { appLogger } from 'nbook/server/app-logs/logger'

type ModelOverrideInput = Partial<AgentProfileModelConfig> & {
  model?: string | null
}

export type { ResolvedPiModel } from 'nbook/server/agent/harness/pi-model-metadata'

/**
 * Volcengine Ark（方舟）OpenAI-compat 端点的 baseURL 启发式。
 *
 * 只匹配官方 `ark.<region>.volces.com` 三段式，避免误伤同样走
 * openai-completions 的 DeepSeek / Moonshot 等 provider；详细背景见
 * `reference/harness/ark-models.md`。
 */
const ARK_BASE_URL_PATTERN = /^https:\/\/ark\.[a-z0-9-]+\.volces\.com\/api\/v3\/?$/u

/** 已为本次进程 warn 过的 (providerId/modelId) 集合，跨 invocation 去重。 */
const arkCompatWarnedKeys = new Set<string>()

/**
 * 检查单个 model provider 是否命中"ARK + reasoning + 没显式关 developer role"组合，
 * 命中时输出一条 `appLogger.warn` 提醒用户在 settings 补
 * `compat.supportsDeveloperRole: false`。同一 (provider, model) 只 warn 一次。
 *
 * 设计取舍：best-effort 启发式，不阻塞 harness 启动；用户可以在 UI 看到 warn
 * 后再补 compat 字段（registry 标 `next-run`，下次会话生效）。
 */
export function warnArkDeveloperRoleCompatIfNeeded(
  providerId: string,
  provider: ConfiguredProviderConfig,
  model: ConfiguredModelConfig,
): void {
  const dedupeKey = `${providerId}/${model.id}`
  if (arkCompatWarnedKeys.has(dedupeKey)) return
  if (model.api !== 'openai-completions') return
  if (!model.reasoning) return
  const baseUrl = provider.options.baseURL?.trim() ?? ''
  if (!ARK_BASE_URL_PATTERN.test(baseUrl)) return
  if (model.compat && (model.compat as Record<string, unknown>).supportsDeveloperRole === false) return

  arkCompatWarnedKeys.add(dedupeKey)
  void appLogger.warn('agent.model.arkCompat.developerRoleNotDisabled', {
    provider: providerId,
    model: model.id,
    baseURL: baseUrl,
    hint: 'ARK OpenAI 端点拒 developer role，请在 model.compat 设 supportsDeveloperRole:false。详见 reference/harness/ark-models.md。',
  })
}

/**
 * 扫描全量 enabled 模型 provider，触发 ARK compat warn。设计为：每次进程启动
 * 由 harness 初始化入口调用一次；后续用户切换/保存新配置时再调一次。
 */
export function warnProviderCompatIssues(
  config: Pick<EffectiveConfig, 'models'>,
): void {
  for (const [providerId, provider] of Object.entries(config.models.providers)) {
    if (!provider?.enabled) continue
    for (const model of Object.values(provider.models)) {
      if (!model?.enabled) continue
      warnArkDeveloperRoleCompatIfNeeded(providerId, provider, model)
    }
  }
}

/**
 * 将当前 effective config 的模型引用解析成 Pi Model。
 */
export function resolvePiModelFromConfig(
  config: Pick<EffectiveConfig, 'agent' | 'models'>,
  profileKey: string,
  override?: ModelOverrideInput | null,
): ResolvedPiModel {
  const profileModelKey = config.agent.profiles[profileKey]?.model.modelKey ?? config.agent.profileModelDefaults.modelKey ?? null
  const modelKey = override?.modelKey ?? override?.model ?? profileModelKey ?? config.models.defaultModelKey
  if (!modelKey) {
    throw new Error('配置未设置 models.default')
  }

  const [providerId, ...modelIdParts] = modelKey.split('/')
  const modelId = modelIdParts.join('/')
  if (!providerId || !modelId) {
    throw new Error(`模型 key 格式错误：${modelKey}`)
  }
  const provider = config.models.providers[providerId]
  const model = provider?.models[modelId]
  if (!provider || !provider.enabled || !model || !model.enabled) {
    throw new Error(`模型未启用或不存在：${modelKey}`)
  }

  // 顺手触发 ARK compat 启发式 warn（同一 (provider, model) 在进程内只 warn 一次）
  warnArkDeveloperRoleCompatIfNeeded(providerId, provider, model)

  return resolvePiModelMetadata(providerId, provider, model)
}

/**
 * 将 Global Config 的模型引用解析成 Pi Model。主要给测试和旧同步入口使用。
 */
export function resolvePiModel(profileKey: string, override?: ModelOverrideInput | null): ResolvedPiModel {
  return resolvePiModelFromConfig(loadGlobalEffectiveConfigSync(), profileKey, override)
}

/**
 * 从 effective config 返回当前模型 provider 的 API key。
 */
export function resolvePiApiKeyFromConfig(
  config: Pick<EffectiveConfig, 'models'>,
  providerId: string,
): string | undefined {
  return config.models.providers[providerId]?.options.apiKey || undefined
}

/**
 * resolved model.provider 永远是本地 Provider Config ID。
 */
export function resolvePiApiKeyForModelFromConfig(
  config: Pick<EffectiveConfig, 'models'>,
  model: Model<Api>,
): string | undefined {
  return resolvePiApiKeyFromConfig(config, model.provider)
}

/**
 * 返回 Global Config 中当前模型 provider 的 API key。
 */
export function resolvePiApiKey(providerId: string): string | undefined {
  return resolvePiApiKeyFromConfig(loadGlobalEffectiveConfigSync(), providerId)
}
