import { z } from 'zod'

export const GatewayTargetIdSchema = z.string().trim().min(1).max(512)

const GatewayUsageSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  requests: z.number().int().nonnegative(),
})

const GatewayKeySchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  prefix: z.string().min(4).max(32),
  secretHash: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().optional(),
  monthlyRequestLimit: z.number().int().min(0).max(10_000_000).default(0),
  allowedTargets: z.array(GatewayTargetIdSchema).max(500).default([]),
  defaultTarget: GatewayTargetIdSchema.optional(),
  usage: GatewayUsageSchema.optional(),
})

const GatewayConfigV2Schema = z.object({
  version: z.literal(2),
  enabled: z.boolean().default(false),
  publicBaseUrl: z.string().url().optional(),
  keys: z.array(GatewayKeySchema).max(100).default([]),
})

const LegacyGatewayKeySchema = GatewayKeySchema.extend({
  name: z.string().trim().min(1).max(80).optional(),
})

const LegacyGatewayConfigSchema = z.object({
  version: z.literal(1),
  enabled: z.boolean().default(false),
  publicBaseUrl: z.string().url().optional(),
  key: LegacyGatewayKeySchema.optional(),
  usage: GatewayUsageSchema.optional(),
})

export const GatewayConfigSchema = z.preprocess((input) => {
  const legacy = LegacyGatewayConfigSchema.safeParse(input)
  if (!legacy.success) return input
  const { enabled, publicBaseUrl, key, usage } = legacy.data
  return {
    version: 2,
    enabled,
    ...(publicBaseUrl && { publicBaseUrl }),
    keys: key
      ? [{
          ...key,
          name: key.name ?? 'Default node key',
          usage: usage ?? key.usage,
        }]
      : [],
  }
}, GatewayConfigV2Schema)

export type GatewayConfig = z.infer<typeof GatewayConfigSchema>
export type GatewayKey = z.infer<typeof GatewayKeySchema>

export const GatewayConfigUpdateSchema = z.object({
  enabled: z.boolean(),
  publicBaseUrl: z.string().trim().url().nullable().optional(),
})

export const GatewayKeyCreateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  monthlyRequestLimit: z.number().int().min(0).max(10_000_000).optional(),
  allowedTargets: z.array(GatewayTargetIdSchema).max(500).optional(),
  defaultTarget: GatewayTargetIdSchema.nullable().optional(),
})

export const GatewayKeyUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  monthlyRequestLimit: z.number().int().min(0).max(10_000_000),
  allowedTargets: z.array(GatewayTargetIdSchema).max(500),
  defaultTarget: GatewayTargetIdSchema.nullable(),
}).partial()

export type GatewayConfigUpdate = z.infer<typeof GatewayConfigUpdateSchema>
export type GatewayKeyCreate = z.infer<typeof GatewayKeyCreateSchema>
export type GatewayKeyUpdate = z.infer<typeof GatewayKeyUpdateSchema>

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
