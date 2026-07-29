export const ROUTING_STRATEGIES = [
  'priority',
  'weighted',
  'round-robin',
  'context-relay',
  'fill-first',
  'p2c',
  'random',
  'least-used',
  'cost-optimized',
  'reset-aware',
  'reset-window',
  'headroom',
  'strict-random',
  'auto',
  'lkgp',
  'context-optimized',
] as const

export type RoutingStrategy = (typeof ROUTING_STRATEGIES)[number]
export type SourceCostClass =
  | 'recurring-free'
  | 'signup-credit'
  | 'uncapped'
  | 'mixed'
  | 'paid'
  | 'unknown'
export type SourceAuthClass = 'oauth' | 'api-key' | 'local' | 'none'
export type SourceRiskClass = 'stable' | 'experimental' | 'restricted'

export type RouteTarget = {
  providerId: string
  modelId?: string
  weight?: number
  priority?: number
}

export type RouteProfile = {
  id: string
  name: string
  description?: string
  enabled: boolean
  strategy: RoutingStrategy
  strictFree: boolean
  allowExperimental: boolean
  maxAttempts: number
  targets: RouteTarget[]
}

export type RoutingConfig = {
  version: 1
  enabled: boolean
  profiles: RouteProfile[]
}

export type RoutingSource = {
  id: string
  providerId?: string
  presetId: string
  name: string
  configured: boolean
  routable: boolean
  cost: SourceCostClass
  auth: SourceAuthClass
  risk: SourceRiskClass
  costNote?: string
  models: Array<{
    id: string
    contextWindow?: number
    supportsImages?: boolean
  }>
}

export type RouteHealthSnapshot = {
  providerId: string
  providerName: string
  modelId: string
  requests: number
  successes: number
  failures: number
  averageLatencyMs: number | null
  consecutiveFailures: number
  cooldownUntil?: string
  lastUsedAt?: string
  lastError?: string
}

export type RoutingEvent = {
  id: string
  timestamp: string
  routeId: string
  sessionId: string
  providerId: string
  providerName: string
  modelId: string
  status: 'success' | 'failed' | 'skipped'
  latencyMs: number
  attempt: number
  error?: string
}

export type RoutingDashboard = {
  config: RoutingConfig
  sources: RoutingSource[]
  health: RouteHealthSnapshot[]
  events: RoutingEvent[]
  routeAvailability: Record<string, {
    candidateCount: number
    available: boolean
    contextWindow?: number
    reason?: string
  }>
}
