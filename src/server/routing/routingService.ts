import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { CYBERCODE_MODEL_CONTEXT_WINDOWS_ENV } from '../../utils/modelContextWindows.js'
import { IMAGE_INPUT_CAPABILITY } from '../../utils/model/imageSupport.js'
import { PROVIDER_PRESETS } from '../config/providerPresets.js'
import { ApiError } from '../middleware/errorHandler.js'
import { ProviderService } from '../services/providerService.js'
import { resolveProviderImageSupport } from '../services/modelImageSupport.js'
import type { SavedProvider } from '../types/provider.js'
import {
  buildRoutingSource,
  getRouteTargetCost,
  getSourceMetadata,
  isFreeRouteTarget,
  isProviderRuntimeRoutable,
} from './sourceCatalog.js'
import {
  RoutingConfigSchema,
  type RouteHealthSnapshot,
  type RouteProfile,
  type RoutingConfig,
  type RoutingDashboard,
  type RoutingEvent,
  type RoutingStrategy,
} from './types.js'

type HealthState = {
  requests: number
  successes: number
  failures: number
  latencyTotalMs: number
  consecutiveFailures: number
  cooldownUntil?: number
  lastUsedAt?: number
  lastError?: string
}

export type ResolvedRouteTarget = {
  provider: SavedProvider
  modelId: string
  contextWindow?: number
}

type Candidate = ResolvedRouteTarget & {
  key: string
  costRank: number
  riskRank: number
  priority: number
  weight: number
  health: HealthState
}

type RequestShape = {
  model?: string
  max_tokens?: number
  system?: unknown
  messages?: Array<{ role?: string; content?: unknown }>
  tools?: unknown[]
}

function createHealthState(): HealthState {
  return {
    requests: 0,
    successes: 0,
    failures: 0,
    latencyTotalMs: 0,
    consecutiveFailures: 0,
  }
}

const DEFAULT_CONFIG: RoutingConfig = {
  version: 1,
  enabled: true,
  profiles: [],
}

const LEGACY_BUILT_IN_ROUTES = new Map<string, {
  name: string
  strategy: RoutingStrategy
  strictFree: boolean
}>([
  ['balanced', { name: 'Balanced', strategy: 'auto', strictFree: false }],
  ['coding-first', { name: 'Coding first', strategy: 'headroom', strictFree: false }],
  ['free-first', { name: 'Free first', strategy: 'cost-optimized', strictFree: true }],
  ['fastest', { name: 'Fastest', strategy: 'p2c', strictFree: false }],
  ['stable', { name: 'Stable', strategy: 'lkgp', strictFree: false }],
])

const PROVIDER_PRESET_BY_ID = new Map(PROVIDER_PRESETS.map((preset) => [preset.id, preset]))
const RETRYABLE_STATUS = new Set([400, 401, 402, 403, 404, 408, 409, 413, 422, 425, 429])
const HEALTH_COOLDOWN_MS = 60_000
const PIN_TTL_MS = 60 * 60_000
const MAX_EVENTS = 100

function candidateKey(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`
}

function costRank(cost: ReturnType<typeof getSourceMetadata>['cost']): number {
  switch (cost) {
    case 'uncapped': return 0
    case 'recurring-free': return 1
    case 'signup-credit': return 2
    case 'mixed': return 3
    case 'paid': return 4
    default: return 3
  }
}

function stableHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function isToolResultOnly(content: unknown): boolean {
  return Array.isArray(content) && content.length > 0 && content.every((block) => (
    block && typeof block === 'object' && (block as { type?: unknown }).type === 'tool_result'
  ))
}

function turnFingerprint(body: RequestShape): string {
  const messages = body.messages ?? []
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'user' || isToolResultOnly(message.content)) continue
    return `${index}:${stableHash(JSON.stringify(message.content)).toString(36)}`
  }
  return stableHash(JSON.stringify(messages)).toString(36)
}

function requestContainsImage(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(requestContainsImage)
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (record.type === 'image' || record.type === 'image_url' || record.type === 'input_image') {
    return true
  }
  return Object.values(record).some(requestContainsImage)
}

function countImageInputs(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce((count, item) => count + countImageInputs(item), 0)
  }
  if (!value || typeof value !== 'object') return 0
  const record = value as Record<string, unknown>
  if (record.type === 'image' || record.type === 'image_url' || record.type === 'input_image') {
    return 1
  }
  return Object.values(record).reduce((count, item) => count + countImageInputs(item), 0)
}

function withoutImagePayloads(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutImagePayloads)
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  if (record.type === 'image' || record.type === 'image_url' || record.type === 'input_image') {
    return { type: record.type }
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, withoutImagePayloads(item)]),
  )
}

function estimateRequestTokens(body: RequestShape): number {
  const input = { system: body.system, messages: body.messages, tools: body.tools }
  const textSize = JSON.stringify(withoutImagePayloads(input)).length
  const estimatedInput = Math.ceil(textSize / 3.2) + countImageInputs(input) * 2_000
  const maxOutput = typeof body.max_tokens === 'number' ? body.max_tokens : 4096
  return estimatedInput + maxOutput
}

function averageLatency(health: HealthState): number {
  return health.successes > 0 ? health.latencyTotalMs / health.successes : Number.POSITIVE_INFINITY
}

function normalizeLegacyBuiltInRoutes(config: RoutingConfig): {
  config: RoutingConfig
  changed: boolean
} {
  let changed = false
  const profiles = config.profiles.map((profile) => {
    const legacyRoute = LEGACY_BUILT_IN_ROUTES.get(profile.id)
    const stillUsesLegacyTargets = profile.targets.every((target) => !target.modelId)
    if (
      !legacyRoute ||
      profile.name !== legacyRoute.name ||
      !stillUsesLegacyTargets ||
      (
        profile.strategy === legacyRoute.strategy &&
        profile.strictFree === legacyRoute.strictFree
      )
    ) {
      return profile
    }

    changed = true
    return {
      ...profile,
      strategy: legacyRoute.strategy,
      strictFree: legacyRoute.strictFree,
    }
  })

  return {
    config: changed ? { ...config, profiles } : config,
    changed,
  }
}

function weightedOrder(candidates: Candidate[]): Candidate[] {
  const remaining = [...candidates]
  const ordered: Candidate[] = []
  while (remaining.length > 0) {
    const total = remaining.reduce((sum, candidate) => sum + candidate.weight, 0)
    let cursor = Math.random() * total
    let picked = 0
    for (let index = 0; index < remaining.length; index += 1) {
      cursor -= remaining[index]!.weight
      if (cursor <= 0) {
        picked = index
        break
      }
    }
    ordered.push(remaining.splice(picked, 1)[0]!)
  }
  return ordered
}

function randomOrder(candidates: Candidate[]): Candidate[] {
  const result = [...candidates]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!]
  }
  return result
}

export class RoutingService {
  private providerService = new ProviderService()
  private health = new Map<string, HealthState>()
  private events: RoutingEvent[] = []
  private roundRobinCursor = new Map<string, number>()
  private lastKnownGood = new Map<string, string>()
  private pins = new Map<string, { candidateKey: string; touchedAt: number }>()

  private get configPath(): string {
    return path.join(getClaudeConfigHomeDir(), 'cybercode', 'routing.json')
  }

  private async readConfig(): Promise<RoutingConfig> {
    try {
      const parsed = RoutingConfigSchema.parse(
        JSON.parse(await fs.readFile(this.configPath, 'utf-8')),
      )
      const normalized = normalizeLegacyBuiltInRoutes(parsed)
      if (normalized.changed) {
        await this.writeConfig(normalized.config).catch((error) => {
          console.warn('[routing] Could not persist legacy route migration:', error)
        })
      }
      return normalized.config
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[routing] Ignoring invalid routing config:', error)
      }
      return structuredClone(DEFAULT_CONFIG)
    }
  }

  private async writeConfig(config: RoutingConfig): Promise<void> {
    const parsed = RoutingConfigSchema.parse(config)
    await fs.mkdir(path.dirname(this.configPath), { recursive: true, mode: 0o700 })
    const temporaryPath = `${this.configPath}.${process.pid}.${Date.now()}.tmp`
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, {
        encoding: 'utf-8',
        mode: 0o600,
      })
      await fs.rename(temporaryPath, this.configPath)
      await fs.chmod(this.configPath, 0o600).catch(() => {})
    } catch (error) {
      await fs.unlink(temporaryPath).catch(() => {})
      throw error
    }
  }

  async getConfig(): Promise<RoutingConfig> {
    return this.readConfig()
  }

  async updateConfig(input: unknown): Promise<RoutingConfig> {
    const config = RoutingConfigSchema.parse(input)
    await this.writeConfig(config)
    return this.readConfig()
  }

  async getDashboard(): Promise<RoutingDashboard> {
    const [config, { providers }] = await Promise.all([
      this.readConfig(),
      this.providerService.listProviders(),
    ])
    const sources = []
    for (const preset of PROVIDER_PRESETS) {
      const matches = providers.filter((provider) => provider.presetId === preset.id)
      if (matches.length === 0) sources.push(buildRoutingSource(preset))
      else for (const provider of matches) sources.push(buildRoutingSource(preset, provider))
    }
    for (const provider of providers) {
      if (PROVIDER_PRESET_BY_ID.has(provider.presetId)) continue
      sources.push(buildRoutingSource({
        id: provider.presetId,
        name: provider.name,
        baseUrl: provider.baseUrl,
        apiFormat: provider.apiFormat,
        defaultModels: provider.models,
        defaultModelContextWindows: provider.modelContextWindows,
        supportsImages: provider.supportsImages,
        needsApiKey: true,
        websiteUrl: '',
      }, provider))
    }

    const routeAvailability: RoutingDashboard['routeAvailability'] = {}
    for (const profile of config.profiles) {
      const candidates = await this.buildCandidates(profile, providers, {
        estimatedTokens: 0,
        requiresImages: false,
      })
      const contextWindow = candidates.reduce(
        (largest, candidate) => Math.max(largest, candidate.contextWindow ?? 0),
        0,
      )
      routeAvailability[profile.id] = {
        candidateCount: candidates.length,
        available: config.enabled && profile.enabled && candidates.length > 0,
        ...(contextWindow > 0 && { contextWindow }),
        ...(!config.enabled
          ? { reason: 'routing-disabled' }
          : !profile.enabled
            ? { reason: 'profile-disabled' }
            : candidates.length === 0
              ? { reason: profile.strictFree ? 'no-free-candidates' : 'no-candidates' }
              : {}),
      }
    }

    return {
      config,
      sources,
      health: this.getHealthSnapshots(providers),
      events: [...this.events],
      routeAvailability,
    }
  }

  async getRuntimeEnv(routeId: string, sessionId: string): Promise<Record<string, string>> {
    const config = await this.readConfig()
    const profile = config.profiles.find((entry) => entry.id === routeId)
    if (!config.enabled) throw ApiError.conflict('Smart routing is disabled')
    if (!profile?.enabled) throw ApiError.notFound(`Route is unavailable: ${routeId}`)

    const { providers } = await this.providerService.listProviders()
    const candidates = await this.buildCandidates(profile, providers, {
      estimatedTokens: 0,
      requiresImages: false,
    })
    if (candidates.length === 0) {
      throw ApiError.conflict(
        profile.strictFree
          ? 'This route has no configured free or local source'
          : 'This route has no configured source',
      )
    }

    const runtimeModel = `cybercode-route-${profile.id}`
    const maxContext = candidates.reduce(
      (largest, candidate) => Math.max(largest, candidate.contextWindow ?? 0),
      0,
    )
    const encodedRoute = encodeURIComponent(profile.id)
    const encodedSession = encodeURIComponent(sessionId)

    return {
      ANTHROPIC_BASE_URL:
        `http://127.0.0.1:${ProviderService.getServerPort()}` +
        `/proxy/routes/${encodedRoute}/sessions/${encodedSession}`,
      ANTHROPIC_API_KEY: process.env.SERVER_AUTH_TOKEN || 'routing-managed',
      ANTHROPIC_MODEL: runtimeModel,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: runtimeModel,
      ANTHROPIC_DEFAULT_SONNET_MODEL: runtimeModel,
      ANTHROPIC_DEFAULT_OPUS_MODEL: runtimeModel,
      ...(candidates.some((candidate) => (
        resolveProviderImageSupport(candidate.provider, candidate.modelId).supportsImages
      ))
        ? {
            ANTHROPIC_MODEL_SUPPORTED_CAPABILITIES: IMAGE_INPUT_CAPABILITY,
            ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES: IMAGE_INPUT_CAPABILITY,
            ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES: IMAGE_INPUT_CAPABILITY,
            ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES: IMAGE_INPUT_CAPABILITY,
          }
        : {}),
      ...(maxContext > 0
        ? { [CYBERCODE_MODEL_CONTEXT_WINDOWS_ENV]: JSON.stringify({ [runtimeModel]: maxContext }) }
        : {}),
    }
  }

  async routeSupportsImages(routeId: string): Promise<boolean> {
    const config = await this.readConfig()
    const profile = config.profiles.find((entry) => entry.id === routeId)
    if (!config.enabled || !profile?.enabled) return false
    const { providers } = await this.providerService.listProviders()
    const candidates = await this.buildCandidates(profile, providers, {
      estimatedTokens: 0,
      requiresImages: true,
    })
    return candidates.length > 0
  }

  async resolveAttempts(
    routeId: string,
    sessionId: string,
    body: RequestShape,
  ): Promise<{ profile: RouteProfile; fingerprint: string; targets: ResolvedRouteTarget[] }> {
    const config = await this.readConfig()
    if (!config.enabled) throw ApiError.conflict('Smart routing is disabled')
    const profile = config.profiles.find((entry) => entry.id === routeId)
    if (!profile?.enabled) throw ApiError.notFound(`Route is unavailable: ${routeId}`)

    const { providers } = await this.providerService.listProviders()
    const candidates = await this.buildCandidates(profile, providers, {
      estimatedTokens: estimateRequestTokens(body),
      requiresImages: requestContainsImage(body.messages),
    })
    if (candidates.length === 0) {
      throw ApiError.conflict('No route candidate satisfies this request')
    }

    const fingerprint = turnFingerprint(body)
    const pinKey = `${routeId}:${sessionId}:${fingerprint}`
    this.expirePins()
    const pinned = this.pins.get(pinKey)
    let ordered = this.orderCandidates(profile, candidates, `${sessionId}:${fingerprint}`)
    if (pinned) {
      const pinnedCandidate = ordered.find((candidate) => candidate.key === pinned.candidateKey)
      if (pinnedCandidate) {
        ordered = [pinnedCandidate, ...ordered.filter((candidate) => candidate !== pinnedCandidate)]
      }
    }

    return {
      profile,
      fingerprint,
      targets: ordered.slice(0, profile.maxAttempts).map(({ provider, modelId, contextWindow }) => ({
        provider,
        modelId,
        contextWindow,
      })),
    }
  }

  recordSuccess(input: {
    routeId: string
    sessionId: string
    fingerprint: string
    target: ResolvedRouteTarget
    latencyMs: number
    attempt: number
  }): void {
    const key = candidateKey(input.target.provider.id, input.target.modelId)
    const health = this.getHealth(key)
    health.requests += 1
    health.successes += 1
    health.latencyTotalMs += input.latencyMs
    health.consecutiveFailures = 0
    health.cooldownUntil = undefined
    health.lastError = undefined
    health.lastUsedAt = Date.now()
    this.lastKnownGood.set(input.routeId, key)
    this.pins.set(`${input.routeId}:${input.sessionId}:${input.fingerprint}`, {
      candidateKey: key,
      touchedAt: Date.now(),
    })
    this.pushEvent(input, 'success')
  }

  recordFailure(input: {
    routeId: string
    sessionId: string
    fingerprint: string
    target: ResolvedRouteTarget
    latencyMs: number
    attempt: number
    error: string
    retryable: boolean
  }): void {
    const key = candidateKey(input.target.provider.id, input.target.modelId)
    const health = this.getHealth(key)
    health.requests += 1
    health.failures += 1
    health.consecutiveFailures += 1
    health.lastError = input.error.slice(0, 300)
    health.lastUsedAt = Date.now()
    if (input.retryable && health.consecutiveFailures >= 2) {
      health.cooldownUntil = Date.now() + HEALTH_COOLDOWN_MS
    }
    const pinKey = `${input.routeId}:${input.sessionId}:${input.fingerprint}`
    if (this.pins.get(pinKey)?.candidateKey === key) this.pins.delete(pinKey)
    if (this.lastKnownGood.get(input.routeId) === key) this.lastKnownGood.delete(input.routeId)
    this.pushEvent(input, 'failed')
  }

  isRetryableStatus(status: number): boolean {
    return RETRYABLE_STATUS.has(status) || status >= 500
  }

  resetHealth(): void {
    this.health.clear()
    this.events = []
    this.roundRobinCursor.clear()
    this.lastKnownGood.clear()
    this.pins.clear()
  }

  private async buildCandidates(
    profile: RouteProfile,
    providers: SavedProvider[],
    request: { estimatedTokens: number; requiresImages: boolean },
  ): Promise<Candidate[]> {
    const candidates: Candidate[] = []
    const providerById = new Map(providers.map((provider) => [provider.id, provider]))
    const routeEntries = profile.targets.length > 0
      ? profile.targets.flatMap((target, index) => {
          const provider = providerById.get(target.providerId)
          return provider ? [{ provider, target, index }] : []
        })
      : providers.map((provider, index) => ({ provider, target: undefined, index }))

    for (const { provider, target: explicitTarget, index } of routeEntries) {
      const metadata = getSourceMetadata(provider.presetId)
      if (!profile.allowExperimental && metadata.risk !== 'stable') continue
      const preset = PROVIDER_PRESET_BY_ID.get(provider.presetId)
      if (!isProviderRuntimeRoutable(provider, preset)) continue
      const modelId = explicitTarget?.modelId?.trim() || provider.models.main.trim()
      if (!modelId) continue
      if (profile.strictFree && !isFreeRouteTarget(provider.presetId, modelId)) continue
      const contextWindow = this.providerService.getProviderModelContextWindowMap(provider)[modelId]
      if (contextWindow && contextWindow < request.estimatedTokens) continue
      if (
        request.requiresImages &&
        !resolveProviderImageSupport(provider, modelId).supportsImages
      ) continue

      const key = candidateKey(provider.id, modelId)
      const health = this.health.get(key) ?? createHealthState()
      const learnedWeight = health.requests > 0
        ? Math.max(0.25, health.successes / health.requests)
        : 1
      candidates.push({
        provider,
        modelId,
        contextWindow,
        key,
        costRank: costRank(getRouteTargetCost(provider.presetId, modelId)),
        riskRank: metadata.risk === 'stable' ? 0 : metadata.risk === 'experimental' ? 1 : 2,
        priority: explicitTarget?.priority ?? index,
        weight: (explicitTarget?.weight ?? 1) * learnedWeight,
        health,
      })
    }

    const available = candidates.filter((candidate) => (
      !candidate.health.cooldownUntil || candidate.health.cooldownUntil <= Date.now()
    ))
    // A health cooldown is advisory. Compatibility filters above are hard and
    // never fail open; when every compatible target is cooling down, retry the
    // one whose cooldown expires first instead of claiming no model exists.
    return available.length > 0
      ? available
      : candidates.sort((left, right) => (
          (left.health.cooldownUntil ?? 0) - (right.health.cooldownUntil ?? 0)
        )).slice(0, 1)
  }

  private orderCandidates(
    profile: RouteProfile,
    candidates: Candidate[],
    seed: string,
  ): Candidate[] {
    const byPriority = () => [...candidates].sort((left, right) => (
      left.priority - right.priority || left.health.failures - right.health.failures
    ))
    const byHealth = () => [...candidates].sort((left, right) => {
      const leftRate = left.health.requests > 0 ? left.health.successes / left.health.requests : 0.75
      const rightRate = right.health.requests > 0 ? right.health.successes / right.health.requests : 0.75
      return rightRate - leftRate || averageLatency(left.health) - averageLatency(right.health)
    })
    const strategy: RoutingStrategy = profile.strategy

    if (strategy === 'weighted') return weightedOrder(candidates)
    if (strategy === 'random' || strategy === 'strict-random') return randomOrder(candidates)
    if (strategy === 'round-robin') {
      const sorted = byPriority()
      const cursor = this.roundRobinCursor.get(profile.id) ?? 0
      this.roundRobinCursor.set(profile.id, (cursor + 1) % sorted.length)
      return [...sorted.slice(cursor), ...sorted.slice(0, cursor)]
    }
    if (strategy === 'context-relay') {
      const sorted = byPriority()
      const cursor = stableHash(seed) % sorted.length
      return [...sorted.slice(cursor), ...sorted.slice(0, cursor)]
    }
    if (strategy === 'least-used') {
      return [...candidates].sort((left, right) => (
        left.health.requests - right.health.requests || left.priority - right.priority
      ))
    }
    if (strategy === 'fill-first') return byPriority()
    if (strategy === 'cost-optimized') {
      return [...candidates].sort((left, right) => (
        left.costRank - right.costRank || averageLatency(left.health) - averageLatency(right.health)
      ))
    }
    if (strategy === 'headroom') {
      return [...candidates].sort((left, right) => (
        (right.contextWindow ?? 0) - (left.contextWindow ?? 0) ||
        averageLatency(left.health) - averageLatency(right.health)
      ))
    }
    if (strategy === 'context-optimized') {
      return [...candidates].sort((left, right) => (
        (left.contextWindow ?? Number.MAX_SAFE_INTEGER) -
        (right.contextWindow ?? Number.MAX_SAFE_INTEGER)
      ))
    }
    if (strategy === 'lkgp') {
      const known = this.lastKnownGood.get(profile.id)
      const sorted = byHealth()
      const match = sorted.find((candidate) => candidate.key === known)
      return match ? [match, ...sorted.filter((candidate) => candidate !== match)] : sorted
    }
    if (strategy === 'p2c') {
      const shuffled = randomOrder(candidates)
      if (shuffled.length < 2) return shuffled
      const best = [shuffled[0]!, shuffled[1]!].sort((left, right) => (
        averageLatency(left.health) - averageLatency(right.health) ||
        left.health.failures - right.health.failures
      ))[0]!
      return [best, ...shuffled.filter((candidate) => candidate !== best)]
    }
    if (strategy === 'reset-aware' || strategy === 'reset-window') {
      return [...candidates].sort((left, right) => (
        left.health.consecutiveFailures - right.health.consecutiveFailures ||
        left.costRank - right.costRank ||
        left.priority - right.priority
      ))
    }
    if (strategy === 'auto') {
      return [...candidates].sort((left, right) => {
        const score = (candidate: Candidate) => {
          const successRate = candidate.health.requests > 0
            ? candidate.health.successes / candidate.health.requests
            : 0.75
          const latencyPenalty = Number.isFinite(averageLatency(candidate.health))
            ? Math.min(averageLatency(candidate.health) / 2000, 2)
            : 0.5
          return successRate * 5 - latencyPenalty - candidate.costRank * 0.35 - candidate.riskRank
        }
        return score(right) - score(left) || left.priority - right.priority
      })
    }
    return byPriority()
  }

  private getHealth(key: string): HealthState {
    const existing = this.health.get(key)
    if (existing) return existing
    const created = createHealthState()
    this.health.set(key, created)
    return created
  }

  private getHealthSnapshots(providers: SavedProvider[]): RouteHealthSnapshot[] {
    const providerById = new Map(providers.map((provider) => [provider.id, provider]))
    const now = Date.now()
    return [...this.health.entries()].flatMap(([key, health]) => {
      if (health.cooldownUntil && health.cooldownUntil <= now) {
        health.cooldownUntil = undefined
      }
      const separator = key.indexOf(':')
      const providerId = key.slice(0, separator)
      const modelId = key.slice(separator + 1)
      const provider = providerById.get(providerId)
      if (!provider) {
        this.health.delete(key)
        return []
      }
      return [{
        providerId,
        providerName: provider.name,
        modelId,
        requests: health.requests,
        successes: health.successes,
        failures: health.failures,
        averageLatencyMs: health.successes > 0
          ? Math.round(health.latencyTotalMs / health.successes)
          : null,
        consecutiveFailures: health.consecutiveFailures,
        ...(health.cooldownUntil && { cooldownUntil: new Date(health.cooldownUntil).toISOString() }),
        ...(health.lastUsedAt && { lastUsedAt: new Date(health.lastUsedAt).toISOString() }),
        ...(health.lastError && { lastError: health.lastError }),
      }]
    }).sort((left, right) => (right.lastUsedAt ?? '').localeCompare(left.lastUsedAt ?? ''))
  }

  private pushEvent(
    input: {
      routeId: string
      sessionId: string
      target: ResolvedRouteTarget
      latencyMs: number
      attempt: number
      error?: string
    },
    status: RoutingEvent['status'],
  ): void {
    this.events.unshift({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      routeId: input.routeId,
      sessionId: input.sessionId,
      providerId: input.target.provider.id,
      providerName: input.target.provider.name,
      modelId: input.target.modelId,
      status,
      latencyMs: Math.round(input.latencyMs),
      attempt: input.attempt,
      ...(input.error && { error: input.error.slice(0, 300) }),
    })
    if (this.events.length > MAX_EVENTS) this.events.length = MAX_EVENTS
  }

  private expirePins(): void {
    const cutoff = Date.now() - PIN_TTL_MS
    for (const [key, value] of this.pins) {
      if (value.touchedAt < cutoff) this.pins.delete(key)
    }
  }
}

export const routingService = new RoutingService()
