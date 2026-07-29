import { buildOpenAICompatibleUrl } from '../proxy/openaiCompatUrl.js'
import type {
  ApiFormat,
  ProviderModelInfo,
} from '../types/provider.js'
import { discoverModelsDevModels } from './modelsDevCatalog.js'

type DiscoveryInput = {
  baseUrl: string
  apiKey?: string
  apiFormat: ApiFormat
  presetId?: string
  endpoint?: string
  headers?: Record<string, string>
  cacheScope?: string
}

export type ProviderModelDiscoveryResult = {
  models: ProviderModelInfo[]
  endpoint: string
  cached: boolean
}

type DiscoveryOptions = {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  force?: boolean
  catalogFallback?: boolean
}

type CachedDiscovery = {
  expiresAt: number
  endpoint: string
  models: ProviderModelInfo[]
}

const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map<string, CachedDiscovery>()
const VERIFIED_OPENCODE_FREE_MODEL_IDS = new Set([
  'north-mini-code-free',
  'mimo-v2.5-free',
  'ling-3.0-flash-free',
])

function originOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin
  } catch {
    return baseUrl.replace(/\/+$/, '')
  }
}

function isOllama(input: DiscoveryInput): boolean {
  if (input.presetId === 'ollama' || input.presetId === 'ollama-cloud') return true
  try {
    return new URL(input.baseUrl).port === '11434'
  } catch {
    return false
  }
}

function isLmStudio(input: DiscoveryInput): boolean {
  if (input.presetId === 'lmstudio') return true
  try {
    return new URL(input.baseUrl).port === '1234'
  } catch {
    return false
  }
}

function cloudflareModelSearchEndpoint(input: DiscoveryInput): string | undefined {
  if (input.presetId !== 'cloudflare-ai') return undefined

  try {
    const endpoint = new URL(input.baseUrl)
    const path = endpoint.pathname.replace(/\/+$/, '')
    const match = path.match(
      /^(\/client\/v4\/accounts\/([^/]+))\/ai\/v1$/i,
    )
    if (!match || match[2]?.toUpperCase() === 'ACCOUNT_ID') return undefined

    endpoint.pathname = `${match[1]}/ai/models/search`
    endpoint.search = ''
    endpoint.searchParams.set('task', 'Text Generation')
    endpoint.searchParams.set('per_page', '100')
    endpoint.hash = ''
    return endpoint.toString()
  } catch {
    return undefined
  }
}

function modelRecords(body: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(body)) {
    return body.filter((item): item is Record<string, unknown> =>
      !!item && typeof item === 'object' && !Array.isArray(item)
    )
  }
  if (!body || typeof body !== 'object') return []
  const record = body as Record<string, unknown>
  for (const key of ['data', 'models', 'items', 'result']) {
    if (Array.isArray(record[key])) {
      return (record[key] as unknown[]).filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === 'object' && !Array.isArray(item),
      )
    }
  }
  return []
}

function modelId(record: Record<string, unknown>): string | undefined {
  for (const key of ['slug', 'id', 'model', 'name', 'key']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function parsePositiveInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 1_000) {
    return Math.round(value)
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.replace(/[,_\s]/g, ''), 10)
    if (Number.isFinite(parsed) && parsed >= 1_000) return parsed
  }
  return undefined
}

function findContextWindow(value: unknown, depth = 0): number | undefined {
  if (!value || typeof value !== 'object' || depth > 3) return undefined
  const record = value as Record<string, unknown>
  const directKeys = [
    'context_window',
    'contextWindow',
    'context_length',
    'contextLength',
    'max_context_length',
    'maxContextLength',
    'max_input_tokens',
    'maxInputTokens',
    'loaded_context_length',
    'max_context_window',
    'maxContextWindow',
  ]
  for (const key of directKeys) {
    const parsed = parsePositiveInteger(record[key])
    if (parsed) return parsed
  }
  for (const [key, nested] of Object.entries(record)) {
    if (/context(?:_length)?$/i.test(key)) {
      const parsed = parsePositiveInteger(nested)
      if (parsed) return parsed
    }
  }
  for (const nested of Object.values(record)) {
    const parsed = findContextWindow(nested, depth + 1)
    if (parsed) return parsed
  }
  return undefined
}

function parseCapabilities(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string')
  }
  if (!value || typeof value !== 'object') return undefined
  const entries = Object.entries(value as Record<string, unknown>)
  const enabled = entries
    .filter(([, state]) => state === true)
    .map(([name]) => name)
  return entries.some(([, state]) => typeof state === 'boolean') ? enabled : undefined
}

function supportsImages(record: Record<string, unknown>): boolean | undefined {
  const direct = record.supports_images ?? record.supportsImages
  if (typeof direct === 'boolean') return direct

  const modalities = record.modalities
  const modalityRecord = modalities && typeof modalities === 'object' && !Array.isArray(modalities)
    ? modalities as Record<string, unknown>
    : undefined
  const candidates = [
    record.capabilities,
    record.input_modalities,
    record.inputModalities,
    record.supported_input_modalities,
    modalityRecord?.input,
    modalityRecord?.inputs,
    Array.isArray(modalities) ? modalities : undefined,
  ]
  let hasExplicitMetadata = false
  for (const candidate of candidates) {
    const capabilities = parseCapabilities(candidate)
    if (!capabilities) continue
    hasExplicitMetadata = true
    if (capabilities.some((capability) =>
      /^(?:vision|image|images|image_input|input_image|multimodal)$/i.test(capability.trim())
    )) return true
  }
  return hasExplicitMetadata ? false : undefined
}

function toModelInfo(record: Record<string, unknown>): ProviderModelInfo | undefined {
  const id = modelId(record)
  if (!id) return undefined
  const contextWindow = findContextWindow(record)
  const imageSupport = supportsImages(record)
  return {
    id,
    ...(typeof record.display_name === 'string'
      ? { label: record.display_name }
      : typeof record.displayName === 'string'
        ? { label: record.displayName }
        : typeof record.name === 'string' && record.name !== id
          ? { label: record.name }
          : {}),
    ...(contextWindow && { contextWindow }),
    ...(imageSupport !== undefined && { supportsImages: imageSupport }),
  }
}

function dedupeModels(models: ProviderModelInfo[]): ProviderModelInfo[] {
  const byId = new Map<string, ProviderModelInfo>()
  for (const model of models) {
    const key = model.id.trim().toLowerCase()
    if (!key) continue
    const existing = byId.get(key)
    byId.set(key, {
      ...existing,
      ...model,
      id: existing?.id ?? model.id.trim(),
    })
  }
  return [...byId.values()].sort(compareModels)
}

function numericSegments(modelId: string): number[] {
  return [...modelId.matchAll(/\d+/g)].map((match) => Number.parseInt(match[0], 10))
}

function modelTierRank(modelId: string): number {
  const normalized = modelId.toLowerCase()
  if (/(?:^|[-_.])sol(?:$|[-_.])/.test(normalized)) return 0
  if (/(?:^|[-_.])terra(?:$|[-_.])/.test(normalized)) return 1
  if (/(?:^|[-_.])luna(?:$|[-_.])/.test(normalized)) return 2
  return 3
}

function compareModels(left: ProviderModelInfo, right: ProviderModelInfo): number {
  const leftNumbers = numericSegments(left.id)
  const rightNumbers = numericSegments(right.id)
  if (leftNumbers.length > 0 && rightNumbers.length > 0) {
    const length = Math.max(leftNumbers.length, rightNumbers.length)
    for (let index = 0; index < length; index += 1) {
      const difference = (rightNumbers[index] ?? -1) - (leftNumbers[index] ?? -1)
      if (difference !== 0) return difference
    }
  }
  const tierDifference = modelTierRank(left.id) - modelTierRank(right.id)
  if (tierDifference !== 0) return tierDifference
  return left.id.localeCompare(right.id, undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}

function authHeaders(input: DiscoveryInput): Record<string, string> {
  const key = input.apiKey?.trim()
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...input.headers,
  }
  if (!key) return headers
  if (input.apiFormat === 'anthropic') {
    headers['x-api-key'] = key
    headers['anthropic-version'] = '2023-06-01'
    return headers
  }

  headers.Authorization = `Bearer ${key}`
  return headers
}

async function enrichOllamaModels(
  endpoint: string,
  models: ProviderModelInfo[],
  fetchImpl: typeof fetch,
  timeoutMs: number,
  headers: Record<string, string>,
): Promise<ProviderModelInfo[]> {
  const origin = endpoint.replace(/\/api\/tags\/?$/i, '')
  return Promise.all(models.map(async (model) => {
    try {
      const response = await fetchImpl(`${origin}/api/show`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: model.id }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) return model
      const metadata = await response.json() as Record<string, unknown>
      const contextWindow = findContextWindow(metadata)
      const imageSupport = supportsImages(metadata)
      return {
        ...model,
        ...(contextWindow && { contextWindow }),
        ...(imageSupport !== undefined && { supportsImages: imageSupport }),
      }
    } catch {
      return model
    }
  }))
}

function discoveryEndpoints(input: DiscoveryInput): string[] {
  if (input.endpoint) return [input.endpoint]

  const endpoints: string[] = []
  if (isOllama(input)) endpoints.push(`${originOf(input.baseUrl)}/api/tags`)
  if (isLmStudio(input)) endpoints.push(`${originOf(input.baseUrl)}/api/v1/models`)
  if (input.presetId === 'github-models') {
    endpoints.push(`${originOf(input.baseUrl)}/catalog/models`)
  }
  const cloudflareEndpoint = cloudflareModelSearchEndpoint(input)
  if (cloudflareEndpoint) endpoints.push(cloudflareEndpoint)
  endpoints.push(buildOpenAICompatibleUrl(input.baseUrl, 'models'))
  return [...new Set(endpoints)]
}

export async function discoverProviderModels(
  input: DiscoveryInput,
  options: DiscoveryOptions = {},
): Promise<ProviderModelDiscoveryResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 5_000
  const cacheKey = [
    input.presetId ?? '',
    input.apiFormat,
    input.baseUrl.replace(/\/+$/, '').toLowerCase(),
    input.cacheScope ?? '',
  ].join('|')
  const cached = cache.get(cacheKey)
  if (!options.force && cached && cached.expiresAt > Date.now()) {
    return { models: cached.models, endpoint: cached.endpoint, cached: true }
  }

  let lastError = ''
  let authenticationRejected = false
  for (const endpoint of discoveryEndpoints(input)) {
    try {
      const response = await fetchImpl(endpoint, {
        headers: authHeaders(input),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          authenticationRejected = true
        }
        const raw = await response.text().catch(() => '')
        let detail = raw.trim().slice(0, 300)
        try {
          const parsed = JSON.parse(raw) as Record<string, unknown>
          const nested = parsed.error &&
            typeof parsed.error === 'object' &&
            !Array.isArray(parsed.error)
            ? parsed.error as Record<string, unknown>
            : undefined
          const message = nested?.message ?? parsed.message ?? parsed.error_description
          if (typeof message === 'string' && message.trim()) detail = message.trim()
        } catch {
          // Plain-text provider errors are already useful.
        }
        lastError = `HTTP ${response.status}${detail ? `: ${detail}` : ''}`
        continue
      }

      let models = modelRecords(await response.json())
        .filter((record) =>
          record.hidden !== true &&
          record.visibility !== 'hide' &&
          record.visibility !== 'hidden'
        )
        .map(toModelInfo)
        .filter((model): model is ProviderModelInfo => model !== undefined)
      if (models.length === 0) {
        lastError = 'The endpoint returned no model IDs'
        continue
      }
      if (/\/api\/tags\/?$/i.test(endpoint)) {
        models = await enrichOllamaModels(
          endpoint,
          models,
          fetchImpl,
          timeoutMs,
          authHeaders(input),
        )
      }
      models = dedupeModels(models)
      if (input.presetId === 'opencode-free') {
        models = models.filter((model) => VERIFIED_OPENCODE_FREE_MODEL_IDS.has(model.id))
        if (models.length === 0) {
          lastError = 'The endpoint returned no verified anonymous models'
          continue
        }
      }
      cache.set(cacheKey, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        endpoint,
        models,
      })
      return { models, endpoint, cached: false }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  if (options.catalogFallback && !authenticationRejected) {
    try {
      const catalog = await discoverModelsDevModels(input.presetId, {
        fetchImpl,
        timeoutMs,
      })
      if (catalog?.models.length) {
        // models.dev already returns a deduplicated, release-date-first list.
        // Keep that ordering so newly released models are not pushed behind
        // older IDs by the endpoint-oriented numeric sorter above.
        const models = catalog.models
        cache.set(cacheKey, {
          expiresAt: Date.now() + CACHE_TTL_MS,
          endpoint: catalog.endpoint,
          models,
        })
        return {
          models,
          endpoint: catalog.endpoint,
          cached: false,
        }
      }
    } catch {
      // Preserve the provider endpoint error; the bundled catalog remains available.
    }
  }

  throw new Error(
    lastError
      ? `Unable to discover models: ${lastError}`
      : 'This provider does not expose a model-list endpoint',
  )
}

export function clearProviderModelDiscoveryCache(): void {
  cache.clear()
}
