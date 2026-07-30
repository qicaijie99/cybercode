import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { PROVIDER_PRESETS } from '../config/providerPresets.js'
import { ApiError } from '../middleware/errorHandler.js'
import { routingService } from '../routing/routingService.js'
import { isProviderRuntimeRoutable } from '../routing/sourceCatalog.js'
import { ProviderService } from '../services/providerService.js'
import type { SavedProvider } from '../types/provider.js'
import {
  GatewayConfigSchema,
  GatewayConfigUpdateSchema,
  GatewayKeyCreateSchema,
  GatewayKeyUpdateSchema,
  type GatewayConfig,
  type GatewayConfigUpdate,
  type GatewayKey,
  type GatewayKeyCreate,
  type GatewayKeyStatus,
  type GatewayKeyUpdate,
  type GatewayStatus,
  type GatewayTarget,
} from './types.js'

const DEFAULT_CONFIG: GatewayConfig = {
  version: 2,
  enabled: false,
  keys: [],
}

const PROVIDER_PRESET_BY_ID = new Map(
  PROVIDER_PRESETS.map((preset) => [preset.id, preset]),
)

const PUBLIC_PROVIDER_ALIASES: Record<string, string> = {
  official: 'claude',
  zhipuglm: 'zhipu',
  xiaomimimo: 'mimo',
}

function monthKey(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

function normalizePublicBaseUrl(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  const parsed = new URL(trimmed)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw ApiError.badRequest('Node URL must use http or https')
  }
  return parsed.toString().replace(/\/+$/, '')
}

function targetModels(provider: SavedProvider): string[] {
  return [...new Set([
    provider.models.main,
    provider.models.haiku,
    provider.models.sonnet,
    provider.models.opus,
    ...(provider.modelCatalog ?? []).map((model) => model.id),
  ].map((model) => model?.trim()).filter((model): model is string => Boolean(model)))]
}

function makeModelTargetId(providerId: string, modelId: string): string {
  return `model/${providerId}/${encodeURIComponent(modelId)}`
}

function publicSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function publicProviderAliases(providers: SavedProvider[]): Map<string, string> {
  const aliases = new Map<string, string>()
  const used = new Set<string>()

  for (const provider of providers) {
    let alias = provider.publicAlias
    if (!alias || used.has(alias)) {
      const presetAlias = PUBLIC_PROVIDER_ALIASES[provider.presetId] ?? provider.presetId
      const source = provider.presetId === 'custom' ? provider.name : presetAlias
      const base = publicSlug(source) || 'custom'
      alias = used.has(base)
        ? `${base}-${createHash('sha256').update(provider.id).digest('hex').slice(0, 6)}`
        : base
    }
    aliases.set(provider.id, alias)
    used.add(alias)
  }

  return aliases
}

export type AuthenticatedGatewayKey = {
  key: GatewayKey
}

export class GatewayService {
  private providerService = new ProviderService()
  private mutationTail: Promise<void> = Promise.resolve()

  private get configPath(): string {
    return path.join(getClaudeConfigHomeDir(), 'cybercode', 'gateway.json')
  }

  private async readConfig(): Promise<GatewayConfig> {
    try {
      const raw = await fs.readFile(this.configPath, 'utf-8')
      return GatewayConfigSchema.parse(JSON.parse(raw))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[gateway] Ignoring invalid node config:', error)
      }
      return structuredClone(DEFAULT_CONFIG)
    }
  }

  private async writeConfig(config: GatewayConfig): Promise<void> {
    const parsed = GatewayConfigSchema.parse(config)
    const directory = path.dirname(this.configPath)
    await fs.mkdir(directory, { recursive: true, mode: 0o700 })
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

  private runMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation)
    this.mutationTail = result.then(() => undefined, () => undefined)
    return result
  }

  private async listTargets(): Promise<GatewayTarget[]> {
    const [{ providers }, dashboard] = await Promise.all([
      this.providerService.listProviders(),
      routingService.getDashboard(),
    ])
    const targets: GatewayTarget[] = []
    const aliases = publicProviderAliases(providers)

    for (const provider of providers) {
      const available = isProviderRuntimeRoutable(
        provider,
        PROVIDER_PRESET_BY_ID.get(provider.presetId),
      )
      const publicProviderId = aliases.get(provider.id) ?? 'custom'
      for (const modelId of targetModels(provider)) {
        targets.push({
          id: makeModelTargetId(provider.id, modelId),
          publicId: `${publicProviderId}/${modelId}`,
          kind: 'model',
          label: modelId,
          description: provider.name,
          available,
          providerId: provider.id,
          modelId,
        })
      }
    }

    for (const route of dashboard.config.profiles) {
      const availability = dashboard.routeAvailability[route.id]
      targets.push({
        id: `route/${route.id}`,
        publicId: `route/${route.id}`,
        kind: 'route',
        label: route.name,
        description: route.description || route.strategy,
        available: availability?.available === true,
        routeId: route.id,
      })
    }

    return targets.sort((left, right) => (
      left.kind === right.kind
        ? left.label.localeCompare(right.label)
        : left.kind === 'model' ? -1 : 1
    ))
  }

  private resolveBaseUrl(config: GatewayConfig, requestUrl?: URL): string {
    const configured = normalizePublicBaseUrl(config.publicBaseUrl)
    if (configured) return `${configured}/v1`
    if (requestUrl) return `${requestUrl.origin}/v1`
    return `http://127.0.0.1:${ProviderService.getServerPort()}/v1`
  }

  private keyStatus(key: GatewayKey): GatewayKeyStatus {
    const currentMonth = monthKey()
    const usage = key.usage?.month === currentMonth
      ? key.usage
      : { month: currentMonth, requests: 0 }
    return {
      id: key.id,
      name: key.name,
      prefix: key.prefix,
      createdAt: key.createdAt,
      ...(key.lastUsedAt && { lastUsedAt: key.lastUsedAt }),
      monthlyRequestLimit: key.monthlyRequestLimit,
      allowedTargets: key.allowedTargets,
      ...(key.defaultTarget && { defaultTarget: key.defaultTarget }),
      usage,
    }
  }

  async getStatus(requestUrl?: URL): Promise<GatewayStatus> {
    const [config, targets] = await Promise.all([this.readConfig(), this.listTargets()])
    const baseUrl = this.resolveBaseUrl(config, requestUrl)
    return {
      baseUrl,
      anthropicBaseUrl: baseUrl.replace(/\/v1$/, ''),
      modelsUrl: `${baseUrl}/models`,
      ...(config.publicBaseUrl && { publicBaseUrl: config.publicBaseUrl }),
      enabled: config.enabled,
      keys: config.keys.map((key) => this.keyStatus(key)),
      targets,
    }
  }

  private defaultKeyName(keys: GatewayKey[]): string {
    const names = new Set(keys.map((key) => key.name.toLocaleLowerCase()))
    for (let index = 1; index <= 101; index += 1) {
      const candidate = `Access key ${index}`
      if (!names.has(candidate.toLocaleLowerCase())) return candidate
    }
    return `Access key ${Date.now()}`
  }

  private assertUniqueKeyName(keys: GatewayKey[], name: string, exceptId?: string): void {
    if (keys.some((key) => (
      key.id !== exceptId && key.name.toLocaleLowerCase() === name.toLocaleLowerCase()
    ))) {
      throw new ApiError(409, `An API key named "${name}" already exists`, 'KEY_NAME_CONFLICT')
    }
  }

  private resolveKeyScope(
    targets: GatewayTarget[],
    update: Pick<GatewayKeyCreate | GatewayKeyUpdate, 'allowedTargets' | 'defaultTarget'>,
    current?: GatewayKey,
  ): { allowedTargets: string[]; defaultTarget?: string } {
    const knownTargets = new Map(targets.map((target) => [target.id, target]))
    const allowedTargets = update.allowedTargets
      ? [...new Set(update.allowedTargets)].filter((target) => knownTargets.has(target))
      : current?.allowedTargets.filter((target) => knownTargets.has(target))
        ?? targets.filter((target) => target.available).map((target) => target.id)
    const explicitDefault = update.defaultTarget !== undefined
    const requestedDefault = explicitDefault
      ? update.defaultTarget ?? undefined
      : current?.defaultTarget
    if (explicitDefault && requestedDefault && !allowedTargets.includes(requestedDefault)) {
      throw ApiError.badRequest('The default target must be included in this API key scope')
    }

    let defaultTarget: string | undefined
    if (requestedDefault && allowedTargets.includes(requestedDefault)) {
      defaultTarget = requestedDefault
    } else if (!current && !explicitDefault) {
      defaultTarget = targets.find((target) => (
        target.kind === 'route' && target.available && allowedTargets.includes(target.id)
      ))?.id ?? targets.find((target) => (
        target.available && allowedTargets.includes(target.id)
      ))?.id
    }

    if (defaultTarget && !knownTargets.get(defaultTarget)?.available) {
      throw ApiError.badRequest('The default target is currently unavailable')
    }
    return {
      allowedTargets,
      ...(defaultTarget && { defaultTarget }),
    }
  }

  async createKey(
    inputOrUrl: unknown = {},
    requestUrl?: URL,
  ): Promise<{ status: GatewayStatus; keyId: string; apiKey: string }> {
    return this.runMutation(async () => {
      const resolvedRequestUrl = inputOrUrl instanceof URL ? inputOrUrl : requestUrl
      const input = GatewayKeyCreateSchema.parse(inputOrUrl instanceof URL ? {} : inputOrUrl)
      const [config, targets] = await Promise.all([this.readConfig(), this.listTargets()])
      if (config.keys.length >= 100) {
        throw new ApiError(409, 'This node already has the maximum of 100 API keys', 'KEY_LIMIT_REACHED')
      }
      const apiKey = `cc_${randomBytes(32).toString('base64url')}`
      const name = input.name ?? this.defaultKeyName(config.keys)
      this.assertUniqueKeyName(config.keys, name)
      const scope = this.resolveKeyScope(targets, input)
      const key: GatewayKey = {
        id: crypto.randomUUID(),
        name,
        prefix: apiKey.slice(0, 12),
        secretHash: hashSecret(apiKey),
        createdAt: new Date().toISOString(),
        monthlyRequestLimit: input.monthlyRequestLimit ?? 0,
        ...scope,
        usage: { month: monthKey(), requests: 0 },
      }
      await this.writeConfig({
        ...config,
        version: 2,
        enabled: true,
        keys: [...config.keys, key],
      })
      return {
        status: await this.getStatus(resolvedRequestUrl),
        keyId: key.id,
        apiKey,
      }
    })
  }

  async updateConfig(input: unknown, requestUrl?: URL): Promise<GatewayStatus> {
    const update = GatewayConfigUpdateSchema.parse(input)
    return this.runMutation(() => this.applyConfigUpdate(update, requestUrl))
  }

  private async applyConfigUpdate(update: GatewayConfigUpdate, requestUrl?: URL): Promise<GatewayStatus> {
    const config = await this.readConfig()
    const publicBaseUrl = normalizePublicBaseUrl(update.publicBaseUrl)
    await this.writeConfig({
      ...config,
      version: 2,
      enabled: update.enabled,
      ...(publicBaseUrl ? { publicBaseUrl } : {}),
      ...(publicBaseUrl ? {} : { publicBaseUrl: undefined }),
    })
    return this.getStatus(requestUrl)
  }

  async updateKey(keyId: string, input: unknown, requestUrl?: URL): Promise<GatewayStatus> {
    const update = GatewayKeyUpdateSchema.parse(input)
    return this.runMutation(async () => {
      const [config, targets] = await Promise.all([this.readConfig(), this.listTargets()])
      const keyIndex = config.keys.findIndex((key) => key.id === keyId)
      if (keyIndex < 0) throw ApiError.notFound('API key not found')
      const currentKey = config.keys[keyIndex]
      if (update.name) this.assertUniqueKeyName(config.keys, update.name, keyId)
      const scope = this.resolveKeyScope(targets, update, currentKey)
      const nextKey: GatewayKey = {
        ...currentKey,
        ...(update.name && { name: update.name }),
        ...(update.monthlyRequestLimit !== undefined && {
          monthlyRequestLimit: update.monthlyRequestLimit,
        }),
        allowedTargets: scope.allowedTargets,
        defaultTarget: scope.defaultTarget,
      }
      const keys = [...config.keys]
      keys[keyIndex] = nextKey
      await this.writeConfig({ ...config, version: 2, keys })
      return this.getStatus(requestUrl)
    })
  }

  async rotateKey(
    keyId: string,
    requestUrl?: URL,
  ): Promise<{ status: GatewayStatus; keyId: string; apiKey: string }> {
    return this.runMutation(async () => {
      const config = await this.readConfig()
      const keyIndex = config.keys.findIndex((key) => key.id === keyId)
      if (keyIndex < 0) throw ApiError.notFound('API key not found')
      const apiKey = `cc_${randomBytes(32).toString('base64url')}`
      const keys = [...config.keys]
      keys[keyIndex] = {
        ...keys[keyIndex],
        prefix: apiKey.slice(0, 12),
        secretHash: hashSecret(apiKey),
        lastUsedAt: undefined,
      }
      await this.writeConfig({
        ...config,
        version: 2,
        keys,
      })
      return {
        status: await this.getStatus(requestUrl),
        keyId,
        apiKey,
      }
    })
  }

  async revokeKey(keyId: string, requestUrl?: URL): Promise<GatewayStatus> {
    return this.runMutation(async () => {
      const config = await this.readConfig()
      if (!config.keys.some((key) => key.id === keyId)) {
        throw ApiError.notFound('API key not found')
      }
      const keys = config.keys.filter((key) => key.id !== keyId)
      await this.writeConfig({
        ...config,
        version: 2,
        enabled: keys.length > 0 ? config.enabled : false,
        keys,
      })
      return this.getStatus(requestUrl)
    })
  }

  async authenticate(req: Request): Promise<AuthenticatedGatewayKey> {
    const token = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
      ?? req.headers.get('x-api-key')
    const config = await this.readConfig()
    if (!config.enabled || config.keys.length === 0) {
      throw new ApiError(401, 'The CyberCode node is not enabled', 'INVALID_API_KEY')
    }
    if (!token) throw new ApiError(401, 'Missing API key', 'INVALID_API_KEY')

    const actual = Buffer.from(hashSecret(token))
    const key = config.keys.find((candidate) => {
      const expected = Buffer.from(candidate.secretHash)
      return actual.length === expected.length && timingSafeEqual(actual, expected)
    })
    if (!key) {
      throw new ApiError(401, 'Invalid API key', 'INVALID_API_KEY')
    }
    return { key }
  }

  async resolveAuthorizedTarget(key: GatewayKey, requestedTarget?: string): Promise<GatewayTarget> {
    const [config, targets] = await Promise.all([this.readConfig(), this.listTargets()])
    const currentKey = config.keys.find((candidate) => candidate.id === key.id)
    if (!config.enabled || !currentKey) {
      throw new ApiError(401, 'This API key has been revoked', 'INVALID_API_KEY')
    }
    const requested = requestedTarget?.trim() || 'auto'
    const requestedEntry = requested === 'auto'
      ? undefined
      : targets.find((entry) => entry.publicId === requested || entry.id === requested)
    const effectiveTarget = requested === 'auto'
      ? currentKey.defaultTarget
      : requestedEntry?.id ?? requested
    if (!effectiveTarget) throw ApiError.badRequest('No default node target is configured')
    if (!currentKey.allowedTargets.includes(effectiveTarget)) {
      throw new ApiError(403, `The API key cannot use "${requested}"`, 'MODEL_NOT_ALLOWED')
    }
    const target = targets.find((entry) => entry.id === effectiveTarget)
    if (!target) throw ApiError.notFound(`Unknown model or route: ${requested}`)
    if (!target.available) throw ApiError.conflict(`Target is currently unavailable: ${requested}`)
    return target
  }

  async consumeRequest(key: GatewayKey, targetId: string): Promise<void> {
    return this.runMutation(async () => {
      const config = await this.readConfig()
      const keyIndex = config.keys.findIndex((candidate) => candidate.id === key.id)
      if (!config.enabled || keyIndex < 0) {
        throw new ApiError(401, 'This API key has been revoked', 'INVALID_API_KEY')
      }
      const currentKey = config.keys[keyIndex]
      if (!currentKey.allowedTargets.includes(targetId)) {
        throw new ApiError(403, `The API key cannot use "${targetId}"`, 'MODEL_NOT_ALLOWED')
      }
      const month = monthKey()
      const currentUsage = currentKey.usage?.month === month
        ? currentKey.usage.requests
        : 0
      if (
        currentKey.monthlyRequestLimit > 0 &&
        currentUsage >= currentKey.monthlyRequestLimit
      ) {
        throw new ApiError(429, 'This API key has reached its monthly request limit', 'QUOTA_EXCEEDED')
      }
      const keys = [...config.keys]
      keys[keyIndex] = {
        ...currentKey,
        lastUsedAt: new Date().toISOString(),
        usage: { month, requests: currentUsage + 1 },
      }
      await this.writeConfig({
        ...config,
        keys,
      })
    })
  }
}

export const gatewayService = new GatewayService()
