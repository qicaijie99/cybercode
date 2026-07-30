import { api } from './client'
import { createReadThroughCache, type CachedReadOptions } from './readThroughCache'

export type ProviderOAuthStatus = {
  providerId: string
  connected: boolean
  expiresAt: number | null
  accountLabel?: string
}

export type ProviderOAuthSetupMode =
  | 'device_code'
  | 'browser'
  | 'local_import'
  | 'token_import'
  | 'configured_browser'

export type ProviderOAuthCapability = {
  providerId: string
  setupMode: ProviderOAuthSetupMode
  canAutoDetect?: boolean
  requiresClientRegistration?: boolean
  helpUrl?: string
}

// Keep the connection wizard usable while the local server catalog is loading.
// The server response remains authoritative and overrides these built-in values.
export const BUILTIN_PROVIDER_OAUTH_CAPABILITIES: ProviderOAuthCapability[] = [
  { providerId: 'codex', setupMode: 'browser' },
  { providerId: 'cline', setupMode: 'browser' },
  { providerId: 'antigravity', setupMode: 'browser' },
  { providerId: 'gemini-cli', setupMode: 'browser' },
  {
    providerId: 'gitlab-duo',
    setupMode: 'configured_browser',
    requiresClientRegistration: true,
    helpUrl: 'https://docs.gitlab.com/integration/oauth_provider/',
  },
  { providerId: 'kimi-coding', setupMode: 'device_code' },
  { providerId: 'github', setupMode: 'device_code' },
  { providerId: 'kilocode', setupMode: 'device_code' },
  { providerId: 'codebuddy-cn', setupMode: 'device_code' },
  { providerId: 'grok-cli', setupMode: 'device_code' },
  { providerId: 'amazon-q', setupMode: 'device_code' },
  {
    providerId: 'cursor',
    setupMode: 'local_import',
    canAutoDetect: true,
  },
  {
    providerId: 'qoder',
    setupMode: 'token_import',
    helpUrl: 'https://qoder.com/account/integrations',
  },
  {
    providerId: 'windsurf',
    setupMode: 'token_import',
    helpUrl: 'https://windsurf.com/show-auth-token',
  },
  {
    providerId: 'trae',
    setupMode: 'token_import',
    helpUrl: 'https://solo.trae.ai/',
  },
]

export function mergeProviderOAuthCapabilities(
  capabilities: readonly ProviderOAuthCapability[] = [],
): Map<string, ProviderOAuthCapability> {
  const merged = new Map(
    BUILTIN_PROVIDER_OAUTH_CAPABILITIES.map((capability) => [
      capability.providerId,
      capability,
    ]),
  )
  for (const capability of capabilities) {
    merged.set(capability.providerId, capability)
  }
  return merged
}

export type ProviderOAuthCatalog = {
  supportedProviders: string[]
  capabilities: ProviderOAuthCapability[]
  statuses: ProviderOAuthStatus[]
}

export type ProviderDeviceOAuthStart = {
  flowType: 'device_code'
  providerId: string
  sessionId: string
  userCode: string
  verificationUri: string
  verificationUriComplete: string
  expiresAt: number
  intervalMs: number
}

export type ProviderBrowserOAuthStart = {
  flowType: 'authorization_code_pkce' | 'authorization_code'
  providerId: string
  sessionId: string
  authorizeUrl: string
  redirectUri: string
  expiresAt: number
  intervalMs: number
}

export type ProviderOAuthStart = ProviderDeviceOAuthStart | ProviderBrowserOAuthStart

export type ProviderOAuthPoll =
  | { status: 'pending'; intervalMs: number }
  | {
      status: 'connected'
      connection: ProviderOAuthStatus
      providerId: string
    }

export type ProviderOAuthStartOptions = {
  baseUrl?: string
  clientId?: string
  clientSecret?: string
}

export type ProviderOAuthImportInput = {
  accessToken?: string
  machineId?: string
  webId?: string
  bizUserId?: string
  userUniqueId?: string
  scope?: string
  tenant?: string
  region?: string
  autoDetect?: boolean
}

export type ProviderOAuthDetection = {
  providerId: string
  found: boolean
  source?: string
}

const providerOAuthCatalogCache = createReadThroughCache(
  () => api.get<ProviderOAuthCatalog>('/api/provider-oauth'),
)

export const providerOAuthApi = {
  catalog(options?: CachedReadOptions) {
    return providerOAuthCatalogCache.read(options)
  },

  peekCatalog() {
    return providerOAuthCatalogCache.peek()
  },

  status(providerId: string) {
    return api.get<ProviderOAuthStatus>(
      `/api/provider-oauth/${encodeURIComponent(providerId)}`,
    )
  },

  start(providerId: string, options?: ProviderOAuthStartOptions) {
    return api.post<ProviderOAuthStart>(
      `/api/provider-oauth/${encodeURIComponent(providerId)}/start`,
      options,
    )
  },

  async poll(providerId: string, sessionId: string) {
    const result = await api.post<ProviderOAuthPoll>(
      `/api/provider-oauth/${encodeURIComponent(providerId)}/poll`,
      { sessionId },
    )
    if (result.status === 'connected') providerOAuthCatalogCache.invalidate()
    return result
  },

  async disconnect(providerId: string) {
    const result = await api.delete<{ ok: true }>(
      `/api/provider-oauth/${encodeURIComponent(providerId)}`,
    )
    providerOAuthCatalogCache.invalidate()
    return result
  },

  detect(providerId: string) {
    return api.get<ProviderOAuthDetection>(
      `/api/provider-oauth/${encodeURIComponent(providerId)}/detect`,
    )
  },

  async importConnection(providerId: string, input: ProviderOAuthImportInput) {
    const result = await api.post<{
      connection: ProviderOAuthStatus
      providerId: string
    }>(
      `/api/provider-oauth/${encodeURIComponent(providerId)}/import`,
      input,
    )
    providerOAuthCatalogCache.invalidate()
    return result
  },
}
