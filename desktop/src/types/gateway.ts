export type GatewayTarget = {
  id: string
  publicId: string
  kind: 'model' | 'route'
  label: string
  description: string
  available: boolean
  providerId?: string
  modelId?: string
  routeId?: string
}

export type GatewayKeyStatus = {
  id: string
  name: string
  prefix: string
  createdAt: string
  lastUsedAt?: string
  monthlyRequestLimit: number
  allowedTargets: string[]
  defaultTarget?: string
  usage: { month: string; requests: number }
}

export type GatewayStatus = {
  baseUrl: string
  anthropicBaseUrl: string
  modelsUrl: string
  publicBaseUrl?: string
  enabled: boolean
  keys: GatewayKeyStatus[]
  targets: GatewayTarget[]
}

export type GatewayConfigInput = {
  enabled: boolean
  publicBaseUrl: string | null
}

export type GatewayKeyCreateInput = {
  name?: string
  monthlyRequestLimit?: number
  allowedTargets?: string[]
  defaultTarget?: string | null
}

export type GatewayKeyUpdateInput = {
  name?: string
  monthlyRequestLimit: number
  allowedTargets: string[]
  defaultTarget: string | null
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => (
    typeof value === 'string' && value.length > 0
  ))
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function nonNegativeInteger(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : fallback
}

function currentMonth(): string {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

function normalizeGatewayTarget(value: unknown): GatewayTarget | null {
  const target = asRecord(value)
  if (!target) return null
  const id = firstString(target.id)
  if (!id) return null
  const kind = target.kind === 'route' || id.startsWith('route/')
    ? 'route'
    : 'model'
  const suppliedPublicId = firstString(target.publicId)
  const publicId = kind === 'route' ? suppliedPublicId ?? id : suppliedPublicId
  if (!publicId || (kind === 'model' && publicId.startsWith('model/'))) return null
  const providerId = firstString(target.providerId)
  const modelId = firstString(target.modelId)
  const routeId = firstString(target.routeId)
  return {
    id,
    publicId,
    kind,
    label: firstString(target.label, modelId, routeId, publicId) ?? publicId,
    description: firstString(target.description) ?? '',
    available: target.available !== false,
    ...(providerId && { providerId }),
    ...(modelId && { modelId }),
    ...(routeId && { routeId }),
  }
}

function normalizeGatewayKey(
  value: unknown,
  legacyRoot: UnknownRecord,
): GatewayKeyStatus | null {
  const key = asRecord(value) ?? {}
  const prefix = firstString(key.prefix, legacyRoot.keyPrefix, legacyRoot.prefix)
  if (!prefix) return null

  const usageRecord = asRecord(key.usage) ?? asRecord(legacyRoot.usage)
  const usageMonth = firstString(usageRecord?.month)
  const defaultTarget = firstString(key.defaultTarget, legacyRoot.defaultTarget)
  const lastUsedAt = firstString(key.lastUsedAt, legacyRoot.keyLastUsedAt)
  return {
    id: firstString(key.id, legacyRoot.keyId) ?? 'legacy-default-node-key',
    name: firstString(key.name, legacyRoot.keyName) ?? 'Default node key',
    prefix,
    createdAt: firstString(
      key.createdAt,
      legacyRoot.keyCreatedAt,
    ) ?? '1970-01-01T00:00:00.000Z',
    ...(lastUsedAt && { lastUsedAt }),
    monthlyRequestLimit: nonNegativeInteger(
      key.monthlyRequestLimit,
      nonNegativeInteger(legacyRoot.monthlyRequestLimit),
    ),
    allowedTargets: stringArray(
      key.allowedTargets ?? legacyRoot.allowedTargets,
    ),
    ...(defaultTarget && { defaultTarget }),
    usage: {
      month: usageMonth && /^\d{4}-\d{2}$/.test(usageMonth)
        ? usageMonth
        : currentMonth(),
      requests: nonNegativeInteger(usageRecord?.requests),
    },
  }
}

export function normalizeGatewayStatus(value: unknown): GatewayStatus | null {
  const status = asRecord(value)
  if (!status) return null
  const baseUrl = firstString(status.baseUrl)
  if (!baseUrl) return null

  const rawTargets = Array.isArray(status.targets) ? status.targets : []
  const targets = rawTargets
    .map(normalizeGatewayTarget)
    .filter((target): target is GatewayTarget => target !== null)
  if (targets.length !== rawTargets.length) return null

  let keys: GatewayKeyStatus[]
  if (Array.isArray(status.keys)) {
    keys = status.keys
      .map((key) => normalizeGatewayKey(key, status))
      .filter((key): key is GatewayKeyStatus => key !== null)
  } else {
    const legacyKey = asRecord(status.key) ?? asRecord(status.accessKey) ?? status
    const normalizedKey = normalizeGatewayKey(legacyKey, status)
    keys = normalizedKey ? [normalizedKey] : []
  }

  const publicBaseUrl = firstString(status.publicBaseUrl)
  return {
    baseUrl,
    anthropicBaseUrl: firstString(
      status.anthropicBaseUrl,
    ) ?? baseUrl.replace(/\/v1\/?$/, ''),
    modelsUrl: firstString(status.modelsUrl) ?? `${baseUrl.replace(/\/+$/, '')}/models`,
    ...(publicBaseUrl && { publicBaseUrl }),
    enabled: status.enabled === true,
    keys,
    targets,
  }
}
