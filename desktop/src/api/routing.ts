import { api } from './client'
import type { RoutingConfig, RoutingDashboard } from '../types/routing'

export const routingApi = {
  dashboard() {
    return api.get<RoutingDashboard>('/api/routing')
  },

  updateConfig(config: RoutingConfig) {
    return api.put<{ config: RoutingConfig }>('/api/routing/config', config)
  },

  resetHealth() {
    return api.post<{ ok: true }>('/api/routing/reset-health')
  },
}
