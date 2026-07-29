import type {
  ProviderModelInfo,
  ProviderModelSyncState,
  SavedProvider,
} from '../types/provider.js'
import { discoverProviderModels } from './providerModelDiscovery.js'
import { ProviderService } from './providerService.js'
import { providerOAuthService } from './providerOAuthService.js'
import { getCodexModelListEndpoint } from './codexModelCatalog.js'
import { supportsProviderModelSynchronization } from './providerModelSyncPolicy.js'

const providerService = new ProviderService()
let syncMutationTail: Promise<void> = Promise.resolve()

type SyncOptions = {
  force?: boolean
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export type ProviderModelSyncResult = {
  provider: SavedProvider
  endpoint: string
  cached: boolean
  total: number
  added: number
  updated: number
  removed: number
}

function modelKey(modelId: string): string {
  return modelId.trim().toLowerCase()
}

function dedupeModels(models: ProviderModelInfo[]): ProviderModelInfo[] {
  const byId = new Map<string, ProviderModelInfo>()
  for (const model of models) {
    const key = modelKey(model.id)
    if (!key) continue
    const previous = byId.get(key)
    byId.set(key, {
      ...previous,
      ...model,
      id: previous?.id ?? model.id.trim(),
    })
  }
  return [...byId.values()]
}

function modelsEqual(left: ProviderModelInfo, right: ProviderModelInfo): boolean {
  return left.id === right.id &&
    left.label === right.label &&
    left.contextWindow === right.contextWindow &&
    left.supportsImages === right.supportsImages
}

function runSerialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = syncMutationTail.then(operation, operation)
  syncMutationTail = result.then(() => undefined, () => undefined)
  return result
}

function currentSyncState(provider: SavedProvider): ProviderModelSyncState {
  return {
    enabled: provider.modelSync?.enabled ?? false,
    syncedModelIds: provider.modelSync?.syncedModelIds ?? [],
    ...(provider.modelSync?.lastSyncedAt && {
      lastSyncedAt: provider.modelSync.lastSyncedAt,
    }),
    ...(provider.modelSync?.lastSyncError && {
      lastSyncError: provider.modelSync.lastSyncError,
    }),
    ...(provider.modelSync?.endpoint && {
      endpoint: provider.modelSync.endpoint,
    }),
  }
}

export function supportsProviderModelSync(provider: SavedProvider): boolean {
  return supportsProviderModelSynchronization(provider)
}

export async function setProviderModelAutoSync(
  providerId: string,
  enabled: boolean,
): Promise<SavedProvider> {
  return runSerialized(async () => {
    const provider = await providerService.getProvider(providerId)
    if (enabled && !supportsProviderModelSync(provider)) {
      throw new Error('This provider does not support model synchronization')
    }
    return providerService.updateProviderModelSync(providerId, {
      modelSync: {
        ...currentSyncState(provider),
        enabled,
      },
    })
  })
}

export async function syncProviderModels(
  providerId: string,
  options: SyncOptions = {},
): Promise<ProviderModelSyncResult> {
  return runSerialized(async () => {
    const provider = await providerService.getProvider(providerId)
    if (!supportsProviderModelSync(provider)) {
      throw new Error('This provider does not support model synchronization')
    }

    try {
      const runtimeAuth = provider.oauthProviderId
        ? await providerOAuthService.runtimeAuth(provider.oauthProviderId)
        : null
      if (provider.oauthProviderId && !runtimeAuth) {
        throw new Error(`${provider.name} account is not connected`)
      }
      const isCodex = provider.oauthProviderId === 'codex'
      const discovered = await discoverProviderModels({
        baseUrl: provider.baseUrl,
        apiKey: runtimeAuth?.token ?? provider.apiKey,
        apiFormat: provider.apiFormat,
        presetId: provider.presetId,
        cacheScope: provider.id,
        ...(runtimeAuth && {
          headers: runtimeAuth.headers,
        }),
        ...(isCodex && {
          endpoint: getCodexModelListEndpoint(provider.baseUrl),
        }),
      }, {
        force: options.force ?? true,
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
        catalogFallback: true,
      })

      const previousCatalog = dedupeModels(provider.modelCatalog ?? [])
      const previousSyncedIds = new Set(
        (provider.modelSync?.syncedModelIds ?? []).map(modelKey),
      )
      const manualModels = previousCatalog.filter(
        (model) => !previousSyncedIds.has(modelKey(model.id)),
      )
      const manualIds = new Set(manualModels.map((model) => modelKey(model.id)))
      const syncedModels = dedupeModels(discovered.models).filter(
        (model) => !manualIds.has(modelKey(model.id)),
      )
      const nextCatalog = [...manualModels, ...syncedModels]

      const previousSyncedModels = new Map(
        previousCatalog
          .filter((model) => previousSyncedIds.has(modelKey(model.id)))
          .map((model) => [modelKey(model.id), model]),
      )
      const nextSyncedModels = new Map(
        syncedModels.map((model) => [modelKey(model.id), model]),
      )
      let added = 0
      let updated = 0
      let removed = 0
      for (const [key, model] of nextSyncedModels) {
        const previous = previousSyncedModels.get(key)
        if (!previous) added += 1
        else if (!modelsEqual(previous, model)) updated += 1
      }
      for (const key of previousSyncedModels.keys()) {
        if (!nextSyncedModels.has(key)) removed += 1
      }

      const updatedProvider = await providerService.updateProviderModelSync(providerId, {
        modelCatalog: nextCatalog,
        modelSync: {
          ...currentSyncState(provider),
          syncedModelIds: syncedModels.map((model) => model.id),
          lastSyncedAt: new Date().toISOString(),
          lastSyncError: undefined,
          endpoint: discovered.endpoint,
        },
      })

      return {
        provider: updatedProvider,
        endpoint: discovered.endpoint,
        cached: discovered.cached,
        total: nextCatalog.length,
        added,
        updated,
        removed,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await providerService.updateProviderModelSync(providerId, {
        modelSync: {
          ...currentSyncState(provider),
          lastSyncError: message,
        },
      })
      throw error
    }
  })
}

export async function listAutoSyncProviders(): Promise<SavedProvider[]> {
  const { providers } = await providerService.listProviders()
  return providers.filter(
    (provider) => provider.modelSync?.enabled && supportsProviderModelSync(provider),
  )
}
