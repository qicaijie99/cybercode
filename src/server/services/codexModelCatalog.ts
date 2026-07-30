import type {
  ModelContextWindows,
  ModelMapping,
  ProviderModelInfo,
} from '../types/provider.js'

export const CODEX_CLIENT_VERSION = '0.144.1'

export const CODEX_DEFAULT_MODELS: ModelMapping = {
  main: 'gpt-5.6-sol',
  haiku: 'gpt-5.6-luna',
  sonnet: 'gpt-5.6-terra',
  opus: 'gpt-5.6-sol',
}

export const CODEX_DEFAULT_MODEL_CONTEXT_WINDOWS: ModelContextWindows = {
  main: 272_000,
  haiku: 272_000,
  sonnet: 272_000,
  opus: 272_000,
}

export const CODEX_FALLBACK_MODEL_CATALOG: ProviderModelInfo[] = [
  {
    id: 'gpt-5.6-sol',
    label: 'GPT-5.6 Sol',
    contextWindow: 272_000,
    supportsImages: true,
  },
  {
    id: 'gpt-5.6-terra',
    label: 'GPT-5.6 Terra',
    contextWindow: 272_000,
    supportsImages: true,
  },
  {
    id: 'gpt-5.6-luna',
    label: 'GPT-5.6 Luna',
    contextWindow: 272_000,
    supportsImages: true,
  },
]

const LEGACY_CODEX_DEFAULT_MODELS: ModelMapping[] = [
  {
    main: 'gpt-5.5',
    haiku: 'gpt-5.5-low',
    sonnet: 'gpt-5.5',
    opus: 'gpt-5.5-high',
  },
]

export function getCodexModelListEndpoint(baseUrl: string): string {
  const endpoint = new URL(`${baseUrl.replace(/\/+$/, '')}/models`)
  endpoint.searchParams.set('client_version', CODEX_CLIENT_VERSION)
  return endpoint.toString()
}

export function isLegacyCodexDefaultModels(models: ModelMapping): boolean {
  return LEGACY_CODEX_DEFAULT_MODELS.some((legacy) =>
    (Object.keys(legacy) as Array<keyof ModelMapping>).every(
      (role) => models[role].trim().toLowerCase() === legacy[role].toLowerCase(),
    )
  )
}

export function isLegacyCodexContextWindows(
  contextWindows: ModelContextWindows | undefined,
): boolean {
  if (!contextWindows) return true
  return (Object.keys(CODEX_DEFAULT_MODELS) as Array<keyof ModelMapping>).every(
    (role) => contextWindows[role] === undefined || contextWindows[role] === 400_000,
  )
}
