import type {
  MediaProviderKind,
} from '../../../src/shared/mediaProviders'
import { api } from './client'
import { createReadThroughCache, type CachedReadOptions } from './readThroughCache'

export type MediaCredentialSource =
  | 'media'
  | 'provider'
  | 'local'
  | 'not-required'
  | 'missing'

export type MediaProviderStatus = {
  key: string
  kind: MediaProviderKind
  providerId: string
  connected: boolean
  configured: boolean
  credentialSource: MediaCredentialSource
  modelId: string
}

export type MediaProviderCatalogStatus = {
  total: number
  configured: number
  totalsByKind: Record<MediaProviderKind, number>
  statuses: MediaProviderStatus[]
}

export type MediaProviderTestResult = {
  key: string
  kind: MediaProviderKind
  providerId: string
  success: boolean
  latencyMs: number
  verification: 'credential' | 'reachability'
  httpStatus?: number
  error?: string
}

const mediaCatalogCache = createReadThroughCache(
  () => api.get<MediaProviderCatalogStatus>('/api/media-providers'),
)

export const mediaProvidersApi = {
  catalog(options?: CachedReadOptions) {
    return mediaCatalogCache.read(options)
  },

  peekCatalog() {
    return mediaCatalogCache.peek()
  },

  async save(
    kind: MediaProviderKind,
    providerId: string,
    input: {
      credentials?: Record<string, string>
      modelId: string
    },
  ) {
    const result = await api.put<{ status: MediaProviderStatus }>(
      `/api/media-providers/${encodeURIComponent(kind)}/${encodeURIComponent(providerId)}`,
      input,
    )
    mediaCatalogCache.invalidate()
    return result
  },

  async disconnect(kind: MediaProviderKind, providerId: string) {
    const result = await api.delete<{ ok: true }>(
      `/api/media-providers/${encodeURIComponent(kind)}/${encodeURIComponent(providerId)}`,
    )
    mediaCatalogCache.invalidate()
    return result
  },

  test(kind: MediaProviderKind, providerId: string) {
    return api.post<{ result: MediaProviderTestResult }>(
      `/api/media-providers/${encodeURIComponent(kind)}/${encodeURIComponent(providerId)}/test`,
      undefined,
      { timeout: 20_000 },
    )
  },
}
