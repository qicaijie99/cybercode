import { api } from './client'
import type {
  GatewayConfigInput,
  GatewayKeyCreateInput,
  GatewayKeyUpdateInput,
  GatewayStatus,
} from '../types/gateway'
import { normalizeGatewayStatus } from '../types/gateway'
import { createReadThroughCache, type CachedReadOptions } from './readThroughCache'

const gatewayStatusCache = createReadThroughCache(
  () => api.get<unknown>('/api/gateway'),
  10_000,
)

function requireGatewayStatus(value: unknown): GatewayStatus {
  const status = normalizeGatewayStatus(value)
  if (!status) throw new Error('Invalid node status response')
  return status
}

export const gatewayApi = {
  async status(options?: CachedReadOptions): Promise<GatewayStatus> {
    const cachedOrLoaded = normalizeGatewayStatus(
      await gatewayStatusCache.read(options),
    )
    if (cachedOrLoaded) {
      gatewayStatusCache.prime(cachedOrLoaded)
      return cachedOrLoaded
    }

    gatewayStatusCache.invalidate()
    const refreshed = requireGatewayStatus(
      await gatewayStatusCache.read({ force: true }),
    )
    gatewayStatusCache.prime(refreshed)
    return refreshed
  },

  peekStatus() {
    return normalizeGatewayStatus(gatewayStatusCache.peek())
  },

  async updateConfig(config: GatewayConfigInput) {
    const result = await api.put<{ status: unknown }>('/api/gateway/config', config)
    const status = requireGatewayStatus(result.status)
    gatewayStatusCache.prime(status)
    return { ...result, status }
  },

  async createKey(input: GatewayKeyCreateInput = {}) {
    const result = await api.post<{ status: unknown; keyId: string; apiKey: string }>(
      '/api/gateway/keys',
      input,
    )
    const status = requireGatewayStatus(result.status)
    gatewayStatusCache.prime(status)
    return { ...result, status }
  },

  async updateKey(keyId: string, input: Partial<GatewayKeyUpdateInput>) {
    const result = await api.put<{ status: unknown }>(
      `/api/gateway/keys/${encodeURIComponent(keyId)}`,
      input,
    )
    const status = requireGatewayStatus(result.status)
    gatewayStatusCache.prime(status)
    return { ...result, status }
  },

  async rotateKey(keyId: string) {
    const result = await api.post<{ status: unknown; keyId: string; apiKey: string }>(
      `/api/gateway/keys/${encodeURIComponent(keyId)}/rotate`,
    )
    const status = requireGatewayStatus(result.status)
    gatewayStatusCache.prime(status)
    return { ...result, status }
  },

  async revokeKey(keyId: string) {
    const result = await api.delete<{ status: unknown }>(
      `/api/gateway/keys/${encodeURIComponent(keyId)}`,
    )
    const status = requireGatewayStatus(result.status)
    gatewayStatusCache.prime(status)
    return { ...result, status }
  },
}
