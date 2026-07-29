import type { ApiFormat } from './provider'
import type { SourceCostClass } from './routing'

export type ModelMapping = {
  main: string
  haiku: string
  sonnet: string
  opus: string
}

export type ModelContextWindows = Partial<Record<keyof ModelMapping, number>>

export type ProviderModelOption = {
  id: string
  label?: string
  contextWindow?: number
  supportsImages?: boolean
}

export type ProviderPreset = {
  id: string
  name: string
  baseUrl: string
  apiFormat: ApiFormat
  defaultModels: ModelMapping
  defaultModelContextWindows?: ModelContextWindows
  modelOptions?: ProviderModelOption[]
  supportsImages?: boolean
  needsApiKey: boolean
  websiteUrl: string
  apiKeyUrl?: string
  promoText?: string
  featured?: boolean
  defaultEnv?: Record<string, string>
  cost?: SourceCostClass
  costNote?: string
}
