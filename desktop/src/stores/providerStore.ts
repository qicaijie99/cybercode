// desktop/src/stores/providerStore.ts

import { create } from 'zustand'
import { providersApi } from '../api/providers'
import { useSettingsStore } from './settingsStore'
import { OFFICIAL_DEFAULT_MODEL_ID } from '../constants/modelCatalog'
import type {
  SavedProvider,
  CreateProviderInput,
  UpdateProviderInput,
  TestProviderConfigInput,
  ProviderTestResult,
  ProviderModelSyncResult,
  ModelMapping,
  ApiFormat,
} from '../types/provider'
import type { ProviderPreset } from '../types/providerPreset'

type ProviderStore = {
  providers: SavedProvider[]
  activeId: string | null
  hasLoadedProviders: boolean
  presets: ProviderPreset[]
  isLoading: boolean
  isPresetsLoading: boolean
  error: string | null

  fetchProviders: (options?: ProviderLoadOptions) => Promise<void>
  fetchPresets: (options?: ProviderLoadOptions) => Promise<void>
  createProvider: (input: CreateProviderInput) => Promise<SavedProvider>
  updateProvider: (id: string, input: UpdateProviderInput) => Promise<SavedProvider>
  deleteProvider: (id: string) => Promise<void>
  activateProvider: (id: string) => Promise<void>
  activateOfficial: () => Promise<void>
  testProvider: (id: string, overrides?: {
    baseUrl?: string
    modelId?: string
    models?: ModelMapping
    apiFormat?: ApiFormat
  }) => Promise<ProviderTestResult>
  testConfig: (input: TestProviderConfigInput) => Promise<ProviderTestResult>
  syncProviderModels: (id: string) => Promise<{
    provider: SavedProvider
    result: ProviderModelSyncResult
  }>
  setProviderModelAutoSync: (id: string, enabled: boolean) => Promise<{
    provider: SavedProvider
    result?: ProviderModelSyncResult
    warning?: string
  }>
}

type ProviderLoadOptions = {
  force?: boolean
  quiet?: boolean
}

const PROVIDER_CACHE_MAX_AGE_MS = 30_000
const PRESET_CACHE_MAX_AGE_MS = 5 * 60_000
let providersLoadedAt = 0
let presetsLoadedAt = 0
let providerLoadPromise: Promise<void> | null = null
let presetLoadPromise: Promise<void> | null = null

export const useProviderStore = create<ProviderStore>((set, get) => ({
  providers: [],
  activeId: null,
  hasLoadedProviders: false,
  presets: [],
  isLoading: false,
  isPresetsLoading: false,
  error: null,

  fetchProviders: async (options = {}) => {
    const cached = get().hasLoadedProviders &&
      Date.now() - providersLoadedAt < PROVIDER_CACHE_MAX_AGE_MS
    if (!options.force && cached) return

    if (providerLoadPromise) {
      const currentRequest = providerLoadPromise
      if (!options.quiet && !get().hasLoadedProviders) {
        set({ isLoading: true, error: null })
      }
      await currentRequest
      if (providerLoadPromise === currentRequest) providerLoadPromise = null
      if (options.force) {
        await get().fetchProviders({ ...options, force: true })
      }
      return
    }

    if (!options.quiet) set({ isLoading: true, error: null })
    const request = (async () => {
      try {
        const { providers, activeId } = await providersApi.list()
        providersLoadedAt = Date.now()
        set({ providers, activeId, hasLoadedProviders: true, isLoading: false })
      } catch (err) {
        set({
          isLoading: false,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    })()
    providerLoadPromise = request
    try {
      await request
    } finally {
      if (providerLoadPromise === request) providerLoadPromise = null
    }
  },

  fetchPresets: async (options = {}) => {
    const cached = get().presets.length > 0 &&
      Date.now() - presetsLoadedAt < PRESET_CACHE_MAX_AGE_MS
    if (!options.force && cached) return

    if (presetLoadPromise) {
      const currentRequest = presetLoadPromise
      if (!options.quiet && get().presets.length === 0) {
        set({ isPresetsLoading: true, error: null })
      }
      await currentRequest
      if (presetLoadPromise === currentRequest) presetLoadPromise = null
      if (options.force) {
        await get().fetchPresets({ ...options, force: true })
      }
      return
    }

    if (!options.quiet) set({ isPresetsLoading: true, error: null })
    const request = (async () => {
      try {
        const { presets } = await providersApi.presets()
        presetsLoadedAt = Date.now()
        set({ presets, isPresetsLoading: false })
      } catch (err) {
        set({
          isPresetsLoading: false,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    })()
    presetLoadPromise = request
    try {
      await request
    } finally {
      if (presetLoadPromise === request) presetLoadPromise = null
    }
  },

  createProvider: async (input) => {
    const { provider } = await providersApi.create(input)
    await get().fetchProviders({ force: true, quiet: true })
    return provider
  },

  updateProvider: async (id, input) => {
    const { provider } = await providersApi.update(id, input)
    await get().fetchProviders({ force: true, quiet: true })
    return provider
  },

  deleteProvider: async (id) => {
    await providersApi.delete(id)
    await get().fetchProviders({ force: true, quiet: true })
  },

  activateProvider: async (id) => {
    await providersApi.activate(id)
    await get().fetchProviders({ force: true, quiet: true })
    // 更新默认 provider 时，同步刷新默认 model，避免 settings.json 里残留
    // 旧 provider 的 model id 导致默认选择指向不存在的模型。
    const provider = get().providers.find((p) => p.id === id)
    if (provider) {
      const settings = useSettingsStore.getState()
      await settings.setModel(provider.models.main)
      await settings.fetchAll()
    }
  },

  activateOfficial: async () => {
    await providersApi.activateOfficial()
    await get().fetchProviders({ force: true, quiet: true })
    // 切回官方默认时同样重置 currentModel，避免残留第三方 model id。
    const settings = useSettingsStore.getState()
    await settings.setModel(OFFICIAL_DEFAULT_MODEL_ID)
    await settings.fetchAll()
  },

  testProvider: async (id, overrides?) => {
    const { result } = await providersApi.test(id, overrides)
    return result
  },

  testConfig: async (input) => {
    const { result } = await providersApi.testConfig(input)
    return result
  },

  syncProviderModels: async (id) => {
    const response = await providersApi.syncModels(id)
    await get().fetchProviders({ force: true, quiet: true })
    return response
  },

  setProviderModelAutoSync: async (id, enabled) => {
    const response = await providersApi.setModelAutoSync(id, enabled)
    await get().fetchProviders({ force: true, quiet: true })
    return response
  },
}))
