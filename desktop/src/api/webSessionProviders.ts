import type { WebSessionProviderId } from '../../../src/shared/webSessionProviders'
import { api } from './client'
import { createReadThroughCache, type CachedReadOptions } from './readThroughCache'

export type WebSessionProviderStatus = {
  providerId: WebSessionProviderId
  connected: boolean
  active: boolean
  providerRecordId?: string
  modelId?: string
}

export type WebSessionProviderCatalogStatus = {
  total: number
  configured: number
  statuses: WebSessionProviderStatus[]
}

export type WebSessionProviderTestResult = {
  providerId: WebSessionProviderId
  success: boolean
  latencyMs: number
  error?: string
}

const webSessionCatalogCache = createReadThroughCache(
  () => api.get<WebSessionProviderCatalogStatus>('/api/web-session-providers'),
)

export const webSessionProvidersApi = {
  catalog(options?: CachedReadOptions) {
    return webSessionCatalogCache.read(options)
  },

  peekCatalog() {
    return webSessionCatalogCache.peek()
  },

  async save(
    providerId: WebSessionProviderId,
    input: { credential?: string; modelId: string },
  ) {
    const result = await api.put<{ status: WebSessionProviderStatus }>(
      `/api/web-session-providers/${encodeURIComponent(providerId)}`,
      input,
    )
    webSessionCatalogCache.invalidate()
    return result
  },

  async disconnect(providerId: WebSessionProviderId) {
    const result = await api.delete<{ ok: true }>(
      `/api/web-session-providers/${encodeURIComponent(providerId)}`,
    )
    webSessionCatalogCache.invalidate()
    return result
  },

  async activate(providerId: WebSessionProviderId) {
    const result = await api.post<{ ok: true }>(
      `/api/web-session-providers/${encodeURIComponent(providerId)}/activate`,
    )
    webSessionCatalogCache.invalidate()
    return result
  },

  test(providerId: WebSessionProviderId) {
    return api.post<{ result: WebSessionProviderTestResult }>(
      `/api/web-session-providers/${encodeURIComponent(providerId)}/test`,
      undefined,
      { timeout: 50_000 },
    )
  },

  testAll() {
    return api.post<{ results: WebSessionProviderTestResult[] }>(
      '/api/web-session-providers/test-all',
      undefined,
      { timeout: 15 * 60_000 },
    )
  },
}
