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
