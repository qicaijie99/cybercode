import type { ProviderPreset } from '../config/providerPresets.js'
import type { SavedProvider } from '../types/provider.js'
import type {
  RoutingSource,
  SourceAuthClass,
  SourceCostClass,
  SourceRiskClass,
} from './types.js'

export type SourceMetadata = {
  cost: SourceCostClass
  auth: SourceAuthClass
  risk: SourceRiskClass
  costNote?: string
  routable?: boolean
}

const DEFAULT_SOURCE_METADATA: SourceMetadata = {
  cost: 'unknown',
  auth: 'api-key',
  risk: 'stable',
}

const SOURCE_METADATA: Record<string, SourceMetadata> = {
  official: {
    cost: 'paid',
    auth: 'oauth',
    risk: 'stable',
    costNote: 'OAuth or subscription access',
    // Official OAuth stays on its native CLI path. It is deliberately not
    // replayed through the router because doing so would widen token exposure.
    routable: false,
  },
  deepseek: {
    cost: 'paid',
    auth: 'api-key',
    risk: 'stable',
  },
  zhipuglm: {
    cost: 'mixed',
    auth: 'api-key',
    risk: 'stable',
    costNote: 'GLM Flash models are free; flagship GLM models are paid',
  },
  'kimi-code': {
    cost: 'paid',
    auth: 'api-key',
    risk: 'stable',
    costNote: 'Membership or coding-plan access',
  },
  'github-copilot': {
    cost: 'paid',
    auth: 'oauth',
    risk: 'restricted',
    costNote: 'Uses the connected GitHub Copilot subscription',
  },
  'openai-codex': {
    cost: 'paid',
    auth: 'oauth',
    risk: 'restricted',
    costNote: 'Uses the connected ChatGPT subscription',
  },
  kimi: {
    cost: 'signup-credit',
    auth: 'api-key',
    risk: 'stable',
    costNote: 'Promotional credit may vary by account',
  },
  minimax: {
    cost: 'signup-credit',
    auth: 'api-key',
    risk: 'stable',
    costNote: 'Promotional credit may vary by account',
  },
  xiaomimimo: {
    cost: 'recurring-free',
    auth: 'api-key',
    risk: 'experimental',
    costNote: 'Free access policy can change',
  },
  openai: {
    cost: 'paid',
    auth: 'api-key',
    risk: 'stable',
  },
  google: {
    cost: 'recurring-free',
    auth: 'api-key',
    risk: 'stable',
    costNote: 'Model and regional quotas vary',
  },
  openrouter: {
    cost: 'mixed',
    auth: 'api-key',
    risk: 'stable',
    costNote: 'Use openrouter/free or a :free model variant for zero-cost routing',
  },
  'cloudflare-ai': {
    cost: 'recurring-free',
    auth: 'api-key',
    risk: 'stable',
    costNote: 'Includes 10,000 Neurons per day; paid Workers plans may allow billed overage',
  },
  llm7: {
    cost: 'mixed',
    auth: 'api-key',
    risk: 'experimental',
    costNote: 'The default selector has a recurring free quota; other selectors may be paid',
  },
  groq: {
    cost: 'recurring-free',
    auth: 'api-key',
    risk: 'stable',
    costNote: 'Rate limits vary by model and account tier',
  },
  mistral: {
    cost: 'recurring-free',
    auth: 'api-key',
    risk: 'stable',
    costNote: 'Free experiment-tier limits apply',
  },
  reka: {
    cost: 'recurring-free',
    auth: 'api-key',
    risk: 'stable',
    costNote: 'Recurring credit and availability can vary by account',
  },
  cerebras: {
    cost: 'recurring-free',
    auth: 'api-key',
    risk: 'stable',
    costNote: 'Free inference limits apply',
  },
  nvidia: {
    cost: 'recurring-free',
    auth: 'api-key',
    risk: 'stable',
    costNote: 'Rate-limited developer access; production terms differ',
  },
  sambanova: {
    cost: 'recurring-free',
    auth: 'api-key',
    risk: 'stable',
    costNote: 'Rate limits vary by model',
  },
  siliconflow: {
    cost: 'mixed',
    auth: 'api-key',
    risk: 'stable',
    costNote: 'The catalog contains both permanently free and paid models',
  },
  'github-models': {
    cost: 'recurring-free',
    auth: 'api-key',
    risk: 'restricted',
    costNote: 'Free preview quotas are intended for experimentation',
  },
  huggingface: {
    cost: 'recurring-free',
    auth: 'api-key',
    risk: 'restricted',
    costNote: 'Inference credits and provider availability vary',
  },
  fireworks: {
    cost: 'signup-credit',
    auth: 'api-key',
    risk: 'stable',
  },
  deepinfra: {
    cost: 'paid',
    auth: 'api-key',
    risk: 'stable',
    costNote: 'No general public free quota is assumed',
  },
  openvecta: {
    cost: 'signup-credit',
    auth: 'api-key',
    risk: 'experimental',
  },
  hyperbolic: {
    cost: 'signup-credit',
    auth: 'api-key',
    risk: 'stable',
  },
  nebius: {
    cost: 'signup-credit',
    auth: 'api-key',
    risk: 'stable',
  },
  modelscope: {
    cost: 'recurring-free',
    auth: 'api-key',
    risk: 'restricted',
    costNote: 'Regional account and rate limits apply',
  },
  'nous-research': {
    cost: 'recurring-free',
    auth: 'api-key',
    risk: 'experimental',
  },
  friendliai: {
    cost: 'mixed',
    auth: 'api-key',
    risk: 'restricted',
    costNote: 'Only designated models and account tiers may be free',
  },
  'featherless-ai': {
    cost: 'paid',
    auth: 'api-key',
    risk: 'restricted',
    costNote: 'No general public free tier is assumed',
  },
  'ollama-cloud': {
    cost: 'recurring-free',
    auth: 'api-key',
    risk: 'experimental',
    costNote: 'Free light-usage limits reset across session and weekly windows',
  },
  pioneer: {
    cost: 'signup-credit',
    auth: 'api-key',
    risk: 'experimental',
  },
  bytez: {
    cost: 'signup-credit',
    auth: 'api-key',
    risk: 'experimental',
    costNote: 'One-time signup credit may vary by account',
  },
  'opencode-free': {
    cost: 'recurring-free',
    auth: 'none',
    risk: 'experimental',
    costNote: 'Anonymous public access; model availability and rate limits may change',
  },
  lmstudio: {
    cost: 'uncapped',
    auth: 'local',
    risk: 'stable',
    costNote: 'Limited by local hardware',
  },
  ollama: {
    cost: 'uncapped',
    auth: 'local',
    risk: 'stable',
    costNote: 'Limited by local hardware',
  },
  custom: DEFAULT_SOURCE_METADATA,
}

export function getSourceMetadata(presetId: string): SourceMetadata {
  return SOURCE_METADATA[presetId] ?? DEFAULT_SOURCE_METADATA
}

const SILICONFLOW_FREE_MODELS = new Set([
  'deepseek-ai/deepseek-v3.2',
  'deepseek-ai/deepseek-v3.1',
  'deepseek-ai/deepseek-r1',
  'qwen/qwen3-235b-a22b-instruct-2507',
  'qwen/qwen3-coder-480b-a35b-instruct',
  'qwen/qwen3-32b',
  'moonshotai/kimi-k2.5',
  'zai-org/glm-4.7',
  'openai/gpt-oss-120b',
  'baidu/ernie-4.5-300b-a47b',
])

const ZHIPU_FREE_MODELS = new Set([
  'glm-4.7-flash',
  'glm-4-flash-250414',
  'glm-4.6v-flash',
  'glm-4.1v-thinking-flash',
])

export function getRouteTargetCost(
  presetId: string,
  modelId: string,
): SourceCostClass {
  const metadata = getSourceMetadata(presetId)
  if (metadata.cost !== 'mixed') return metadata.cost

  const normalizedModel = modelId.trim().toLowerCase()
  if (
    presetId === 'openrouter' &&
    (normalizedModel === 'openrouter/free' || normalizedModel.endsWith(':free'))
  ) {
    return 'recurring-free'
  }
  if (presetId === 'llm7' && normalizedModel === 'default') {
    return 'recurring-free'
  }
  if (presetId === 'zhipuglm' && ZHIPU_FREE_MODELS.has(normalizedModel)) {
    return 'recurring-free'
  }
  if (presetId === 'siliconflow' && SILICONFLOW_FREE_MODELS.has(normalizedModel)) {
    return 'recurring-free'
  }
  return 'paid'
}

export function isFreeRouteTarget(presetId: string, modelId: string): boolean {
  const cost = getRouteTargetCost(presetId, modelId)
  return cost === 'recurring-free' || cost === 'uncapped'
}

function uniqueModels(provider: SavedProvider | undefined, preset: ProviderPreset) {
  const models = new Map<string, { id: string; contextWindow?: number; supportsImages?: boolean }>()
  const add = (id: string | undefined, contextWindow?: number, supportsImages?: boolean) => {
    const normalized = id?.trim()
    if (!normalized) return
    const existing = models.get(normalized)
    models.set(normalized, {
      id: normalized,
      contextWindow: contextWindow ?? existing?.contextWindow,
      supportsImages: supportsImages ?? existing?.supportsImages,
    })
  }

  if (provider) {
    const roleContext = provider.modelContextWindows ?? {}
    add(provider.models.main, roleContext.main)
    add(provider.models.haiku, roleContext.haiku)
    add(provider.models.sonnet, roleContext.sonnet)
    add(provider.models.opus, roleContext.opus)
    for (const model of provider.modelCatalog ?? []) {
      add(model.id, model.contextWindow, model.supportsImages)
    }
  } else {
    add(preset.defaultModels.main, preset.defaultModelContextWindows?.main)
    for (const model of preset.modelOptions ?? []) {
      add(model.id, model.contextWindow, model.supportsImages)
    }
  }

  return [...models.values()]
}

export function buildRoutingSource(
  preset: ProviderPreset,
  provider?: SavedProvider,
): RoutingSource {
  const metadata = getSourceMetadata(provider?.presetId ?? preset.id)
  const configured = preset.id === 'official' || Boolean(provider)
  const hasRuntimeTarget = Boolean(
    provider &&
    provider.baseUrl.trim() &&
    provider.models.main.trim() &&
    (provider.apiKey.trim() || provider.oauthProviderId || preset.needsApiKey === false),
  )

  return {
    id: provider?.id ?? `preset:${preset.id}`,
    ...(provider && { providerId: provider.id }),
    presetId: provider?.presetId ?? preset.id,
    name: provider?.name ?? preset.name,
    configured,
    routable: metadata.routable !== false && hasRuntimeTarget,
    cost: metadata.cost,
    auth: provider?.oauthProviderId ? 'oauth' : metadata.auth,
    risk: metadata.risk,
    ...(metadata.costNote && { costNote: metadata.costNote }),
    models: uniqueModels(provider, preset),
  }
}
