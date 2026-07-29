import { api } from './client'
import type { AdapterFileConfig, AdapterLoginState } from '../types/adapter'

export const adaptersApi = {
  getConfig() {
    return api.get<AdapterFileConfig>('/api/adapters')
  },

  updateConfig(patch: Partial<AdapterFileConfig>) {
    return api.put<AdapterFileConfig>('/api/adapters', patch)
  },

  startLogin(platform: 'weixin' | 'qq') {
    return api.post<AdapterLoginState>(`/api/adapters/login/${platform}`, undefined, { timeout: 30_000 })
  },

  getLoginStatus(sessionId: string) {
    return api.get<AdapterLoginState>(`/api/adapters/login/session/${encodeURIComponent(sessionId)}`, { timeout: 45_000 })
  },

  submitWeixinVerification(sessionId: string, code: string) {
    return api.post<AdapterLoginState>(
      `/api/adapters/login/session/${encodeURIComponent(sessionId)}/verify`,
      { code },
    )
  },

  cancelLogin(sessionId: string) {
    return api.delete<void>(`/api/adapters/login/session/${encodeURIComponent(sessionId)}`)
  },
}
