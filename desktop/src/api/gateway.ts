import { api } from './client'
import type {
  GatewayConfigInput,
  GatewayKeyCreateInput,
  GatewayKeyUpdateInput,
  GatewayStatus,
} from '../types/gateway'
import { createReadThroughCache, type CachedReadOptions } from './readThroughCache'

const gatewayStatusCache = createReadThroughCache(
  () => api.get<GatewayStatus>('/api/gateway'),
  10_000,
)

export const gatewayApi = {
  status(options?: CachedReadOptions) {
    return gatewayStatusCache.read(options)
  },

  peekStatus() {
    return gatewayStatusCache.peek()
  },

  async updateConfig(config: GatewayConfigInput) {
    const result = await api.put<{ status: GatewayStatus }>('/api/gateway/config', config)
    gatewayStatusCache.prime(result.status)
    return result
  },

  async createKey(input: GatewayKeyCreateInput = {}) {
    const result = await api.post<{ status: GatewayStatus; keyId: string; apiKey: string }>(
      '/api/gateway/keys',
      input,
    )
    gatewayStatusCache.prime(result.status)
    return result
  },

  async updateKey(keyId: string, input: Partial<GatewayKeyUpdateInput>) {
    const result = await api.put<{ status: GatewayStatus }>(
      `/api/gateway/keys/${encodeURIComponent(keyId)}`,
      input,
    )
    gatewayStatusCache.prime(result.status)
    return result
  },

  async rotateKey(keyId: string) {
    const result = await api.post<{ status: GatewayStatus; keyId: string; apiKey: string }>(
      `/api/gateway/keys/${encodeURIComponent(keyId)}/rotate`,
    )
    gatewayStatusCache.prime(result.status)
    return result
  },

  async revokeKey(keyId: string) {
    const result = await api.delete<{ status: GatewayStatus }>(
      `/api/gateway/keys/${encodeURIComponent(keyId)}`,
    )
    gatewayStatusCache.prime(result.status)
    return result
  },
}
