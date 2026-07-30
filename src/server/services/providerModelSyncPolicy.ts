import { getWebSessionProviderIdFromPreset } from '../../shared/webSessionProviders.js'
import type { SavedProvider } from '../types/provider.js'
import { hasModelsDevCatalog } from './modelsDevCatalog.js'

export function supportsProviderModelSynchronization(provider: SavedProvider): boolean {
  if (provider.presetId === 'official') return false
  if (getWebSessionProviderIdFromPreset(provider.presetId)) return false

  if (provider.oauthProviderId) {
    return provider.oauthProviderId === 'codex' || hasModelsDevCatalog(provider.presetId)
  }

  try {
    const url = new URL(provider.baseUrl)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function shouldEnableProviderModelSynchronization(
  provider: SavedProvider,
): boolean {
  return supportsProviderModelSynchronization(provider)
}
