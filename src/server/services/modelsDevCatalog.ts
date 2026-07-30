import type { ProviderModelInfo } from '../types/provider.js'

const DEFAULT_MODELS_DEV_URL = 'https://models.dev/api.json'
const CATALOG_TTL_MS = 6 * 60 * 60 * 1000
const MAX_CATALOG_BYTES = 20 * 1024 * 1024
const MAX_MODELS_PER_PROVIDER = 400

const MODELS_DEV_PROVIDER_BY_PRESET: Readonly<Record<string, string>> = {
  'anthropic-api': 'anthropic',
  deepseek: 'deepseek',
  zhipuglm: 'zhipuai',
  'kimi-code': 'kimi-for-coding',
  kimi: 'moonshotai-cn',
  minimax: 'minimax-cn',
  xiaomimimo: 'xiaomi',
  openai: 'openai',
  google: 'google',
  xai: 'xai',
  alibaba: 'alibaba-cn',
  perplexity: 'perplexity',
  cohere: 'cohere',
  'meta-llama': 'llama',
  openrouter: 'openrouter',
  'cloudflare-ai': 'cloudflare-workers-ai',
  'ollama-cloud': 'ollama-cloud',
  synthetic: 'synthetic',
  'kilo-gateway': 'kilo',
  novita: 'novita-ai',
  'vercel-ai-gateway': 'vercel',
  poe: 'poe',
  chutes: 'chutes',
  nanogpt: 'nano-gpt',
  groq: 'groq',
  mistral: 'mistral',
  cerebras: 'cerebras',
  nvidia: 'nvidia',
  siliconflow: 'siliconflow',
  'github-models': 'github-models',
  huggingface: 'huggingface',
  fireworks: 'fireworks-ai',
  deepinfra: 'deepinfra',
  nebius: 'nebius',
  modelscope: 'modelscope',
  friendliai: 'friendli',
  pioneer: 'pioneer',
  'github-copilot': 'github-copilot',
  kilocode: 'kilo',
  cline: 'cline-pass',
  'grok-cli': 'xai',
  'gemini-cli-oauth': 'google',
  'qoder-token': 'alibaba-cn',
  'gitlab-duo-oauth': 'gitlab',
  'amazon-q-oauth': 'amazon-bedrock',
}

type ModelsDevModel = {
  id?: unknown
  name?: unknown
  status?: unknown
  tool_call?: unknown
  release_date?: unknown
  last_updated?: unknown
  limit?: unknown
  modalities?: unknown
}

type ModelsDevProvider = {
  models?: unknown
}

type CatalogSnapshot = {
  endpoint: string
  expiresAt: number
  modelsByProvider: Map<string, ProviderModelInfo[]>
}

type CatalogOptions = {
  fetchImpl?: typeof fetch
  force?: boolean
  timeoutMs?: number
}

let cachedSnapshot: CatalogSnapshot | null = null
let inFlightSnapshot: Promise<CatalogSnapshot> | null = null

function configuredCatalogUrl(): string {
  const configured = process.env.CYBERCODE_MODELS_CATALOG_URL?.trim()
  if (!configured) return DEFAULT_MODELS_DEV_URL

  try {
    const parsed = new URL(configured)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString()
    }
  } catch {
    // Fall through to the trusted default.
  }
  return DEFAULT_MODELS_DEV_URL
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : undefined
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function tierRank(modelId: string): number {
  const normalized = modelId.toLowerCase()
  if (/(?:^|[-_.])sol(?:$|[-_.])/.test(normalized)) return 0
  if (/(?:^|[-_.])terra(?:$|[-_.])/.test(normalized)) return 1
  if (/(?:^|[-_.])luna(?:$|[-_.])/.test(normalized)) return 2
  return 3
}

function parseProviderModels(provider: ModelsDevProvider): ProviderModelInfo[] {
  if (!provider.models || typeof provider.models !== 'object' || Array.isArray(provider.models)) {
    return []
  }

  const candidates: Array<{
    model: ProviderModelInfo
    releaseDate: string
    lastUpdated: string
  }> = []
  for (const [key, raw] of Object.entries(provider.models as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const record = raw as ModelsDevModel
    if (stringValue(record.status).toLowerCase() === 'deprecated') continue
    if (record.tool_call === false) continue

    const modalities = record.modalities &&
      typeof record.modalities === 'object' &&
      !Array.isArray(record.modalities)
      ? record.modalities as Record<string, unknown>
      : undefined
    const outputModalities = stringList(modalities?.output)
    if (outputModalities && !outputModalities.includes('text')) continue

    const id = stringValue(record.id) || key.trim()
    if (!id) continue
    const inputModalities = stringList(modalities?.input)
    const limit = record.limit &&
      typeof record.limit === 'object' &&
      !Array.isArray(record.limit)
      ? record.limit as Record<string, unknown>
      : undefined
    const contextWindow = positiveInteger(limit?.context)
    const name = stringValue(record.name)

    candidates.push({
      model: {
        id,
        ...(name && name !== id && { label: name }),
        ...(contextWindow && { contextWindow }),
        ...(inputModalities && {
          supportsImages: inputModalities.includes('image'),
        }),
      },
      releaseDate: stringValue(record.release_date),
      lastUpdated: stringValue(record.last_updated),
    })
  }

  candidates.sort((left, right) => {
    const releaseDifference = right.releaseDate.localeCompare(left.releaseDate)
    if (releaseDifference !== 0) return releaseDifference
    const updateDifference = right.lastUpdated.localeCompare(left.lastUpdated)
    if (updateDifference !== 0) return updateDifference
    const tierDifference = tierRank(left.model.id) - tierRank(right.model.id)
    if (tierDifference !== 0) return tierDifference
    return right.model.id.localeCompare(left.model.id, undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  })

  const seen = new Set<string>()
  const models: ProviderModelInfo[] = []
  for (const candidate of candidates) {
    const key = candidate.model.id.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    models.push(candidate.model)
    if (models.length >= MAX_MODELS_PER_PROVIDER) break
  }
  return models
}

async function fetchCatalogSnapshot(options: CatalogOptions): Promise<CatalogSnapshot> {
  const endpoint = configuredCatalogUrl()
  const response = await (options.fetchImpl ?? fetch)(endpoint, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(options.timeoutMs ?? 8_000),
  })
  if (!response.ok) {
    throw new Error(`Model catalog request failed with HTTP ${response.status}`)
  }

  const declaredLength = Number.parseInt(response.headers.get('content-length') ?? '', 10)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CATALOG_BYTES) {
    throw new Error('Model catalog response is too large')
  }
  const raw = await response.text()
  if (raw.length > MAX_CATALOG_BYTES) {
    throw new Error('Model catalog response is too large')
  }

  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Model catalog response is invalid')
  }

  const modelsByProvider = new Map<string, ProviderModelInfo[]>()
  const providers = parsed as Record<string, unknown>
  for (const providerId of new Set(Object.values(MODELS_DEV_PROVIDER_BY_PRESET))) {
    const provider = providers[providerId]
    if (!provider || typeof provider !== 'object' || Array.isArray(provider)) continue
    const models = parseProviderModels(provider as ModelsDevProvider)
    if (models.length > 0) modelsByProvider.set(providerId, models)
  }

  return {
    endpoint,
    expiresAt: Date.now() + CATALOG_TTL_MS,
    modelsByProvider,
  }
}

async function getCatalogSnapshot(options: CatalogOptions = {}): Promise<CatalogSnapshot> {
  const endpoint = configuredCatalogUrl()
  if (
    !options.force &&
    cachedSnapshot?.endpoint === endpoint &&
    cachedSnapshot.expiresAt > Date.now()
  ) {
    return cachedSnapshot
  }
  if (inFlightSnapshot) return inFlightSnapshot

  inFlightSnapshot = fetchCatalogSnapshot(options)
  try {
    cachedSnapshot = await inFlightSnapshot
    return cachedSnapshot
  } finally {
    inFlightSnapshot = null
  }
}

export function getModelsDevProviderId(presetId: string | undefined): string | undefined {
  return presetId ? MODELS_DEV_PROVIDER_BY_PRESET[presetId] : undefined
}

export function hasModelsDevCatalog(presetId: string | undefined): boolean {
  return getModelsDevProviderId(presetId) !== undefined
}

export function peekModelsDevModels(
  presetId: string | undefined,
): ProviderModelInfo[] | undefined {
  const providerId = getModelsDevProviderId(presetId)
  const models = providerId ? cachedSnapshot?.modelsByProvider.get(providerId) : undefined
  return models?.map((model) => ({ ...model }))
}

export async function discoverModelsDevModels(
  presetId: string | undefined,
  options: CatalogOptions = {},
): Promise<{ endpoint: string; models: ProviderModelInfo[] } | undefined> {
  const providerId = getModelsDevProviderId(presetId)
  if (!providerId) return undefined

  const snapshot = await getCatalogSnapshot(options)
  const models = snapshot.modelsByProvider.get(providerId)
  if (!models?.length) return undefined
  return {
    endpoint: `${snapshot.endpoint}#${providerId}`,
    models: models.map((model) => ({ ...model })),
  }
}

export async function warmModelsDevCatalog(options: CatalogOptions = {}): Promise<void> {
  await getCatalogSnapshot(options)
}

export function clearModelsDevCatalogCache(): void {
  cachedSnapshot = null
  inFlightSnapshot = null
}
