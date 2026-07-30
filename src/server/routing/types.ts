import { z } from 'zod'

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

export const RoutingStrategySchema = z.enum(ROUTING_STRATEGIES)
export type RoutingStrategy = z.infer<typeof RoutingStrategySchema>

export const SourceCostClassSchema = z.enum([
  'recurring-free',
  'signup-credit',
  'uncapped',
  'mixed',
  'paid',
  'unknown',
])
export type SourceCostClass = z.infer<typeof SourceCostClassSchema>

export const SourceAuthClassSchema = z.enum([
  'oauth',
  'api-key',
  'local',
  'none',
])
export type SourceAuthClass = z.infer<typeof SourceAuthClassSchema>

export const SourceRiskClassSchema = z.enum([
  'stable',
  'experimental',
  'restricted',
])
export type SourceRiskClass = z.infer<typeof SourceRiskClassSchema>

export const RouteTargetSchema = z.object({
  providerId: z.string().trim().min(1),
  modelId: z.string().trim().min(1).optional(),
  weight: z.number().positive().max(100).optional(),
  priority: z.number().int().min(0).max(10_000).optional(),
})
export type RouteTarget = z.infer<typeof RouteTargetSchema>

export const RouteProfileSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240).optional(),
  enabled: z.boolean().default(true),
  strategy: RoutingStrategySchema.default('auto'),
  strictFree: z.boolean().default(false),
  allowExperimental: z.boolean().default(false),
  maxAttempts: z.number().int().min(1).max(8).default(3),
  targets: z.array(RouteTargetSchema).default([]),
}).superRefine((profile, context) => {
  const targetIndexes = new Map<string, number>()
  for (const [index, target] of profile.targets.entries()) {
    const targetKey = `${target.providerId}\u0000${target.modelId ?? ''}`
    const firstIndex = targetIndexes.get(targetKey)
    if (firstIndex !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Route target is duplicated (first used at index ${firstIndex})`,
        path: ['targets', index],
      })
      continue
    }
    targetIndexes.set(targetKey, index)
  }
})
export type RouteProfile = z.infer<typeof RouteProfileSchema>

export const RoutingConfigSchema = z.object({
  version: z.literal(1).default(1),
  enabled: z.boolean().default(true),
  profiles: z.array(RouteProfileSchema),
}).superRefine((config, context) => {
  const profileIndexes = new Map<string, number>()
  for (const [index, profile] of config.profiles.entries()) {
    const firstIndex = profileIndexes.get(profile.id)
    if (firstIndex !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Route profile id is duplicated (first used at index ${firstIndex})`,
        path: ['profiles', index, 'id'],
      })
      continue
    }
    profileIndexes.set(profile.id, index)
  }
})
export type RoutingConfig = z.infer<typeof RoutingConfigSchema>

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
