import { create } from 'zustand'
import { routingApi } from '../api/routing'
import type { RouteProfile, RoutingConfig, RoutingDashboard } from '../types/routing'

type RoutingStore = {
  dashboard: RoutingDashboard | null
  isLoading: boolean
  isSaving: boolean
  error: string | null
  fetchDashboard: (options?: { quiet?: boolean }) => Promise<void>
  updateConfig: (config: RoutingConfig) => Promise<void>
  updateProfile: (profile: RouteProfile) => Promise<void>
  resetHealth: () => Promise<void>
}

let dashboardRequestId = 0
let mutationVersion = 0

export const useRoutingStore = create<RoutingStore>((set, get) => ({
  dashboard: null,
  isLoading: false,
  isSaving: false,
  error: null,

  fetchDashboard: async (options) => {
    if (get().isSaving) return
    const requestId = ++dashboardRequestId
    const requestMutationVersion = mutationVersion
    if (!options?.quiet) set({ isLoading: true, error: null })
    try {
      const dashboard = await routingApi.dashboard()
      if (
        requestId !== dashboardRequestId ||
        requestMutationVersion !== mutationVersion ||
        get().isSaving
      ) return
      set({ dashboard, isLoading: false, error: null })
    } catch (error) {
      if (
        requestId !== dashboardRequestId ||
        requestMutationVersion !== mutationVersion ||
        get().isSaving
      ) return
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },

  updateConfig: async (config) => {
    if (get().isSaving) return
    mutationVersion += 1
    dashboardRequestId += 1
    const previous = get().dashboard
    if (previous) {
      set({
        dashboard: { ...previous, config },
        isLoading: false,
        isSaving: true,
        error: null,
      })
    } else {
      set({ isLoading: false, isSaving: true, error: null })
    }
    try {
      const result = await routingApi.updateConfig(config)
      try {
        const dashboard = await routingApi.dashboard()
        set({ dashboard, isSaving: false, error: null })
      } catch (error) {
        const current = get().dashboard
        set({
          dashboard: current ? { ...current, config: result.config } : current,
          isSaving: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    } catch (error) {
      set({
        dashboard: previous,
        isSaving: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },

  updateProfile: async (profile) => {
    const config = get().dashboard?.config
    if (!config) return
    await get().updateConfig({
      ...config,
      profiles: config.profiles.map((entry) => entry.id === profile.id ? profile : entry),
    })
  },

  resetHealth: async () => {
    if (get().isSaving) return
    mutationVersion += 1
    dashboardRequestId += 1
    const previous = get().dashboard
    if (previous) {
      set({
        dashboard: { ...previous, health: [], events: [] },
        isLoading: false,
        isSaving: true,
        error: null,
      })
    } else {
      set({ isLoading: false, isSaving: true, error: null })
    }
    try {
      await routingApi.resetHealth()
      try {
        const dashboard = await routingApi.dashboard()
        set({ dashboard, isSaving: false, error: null })
      } catch (error) {
        set({
          isSaving: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    } catch (error) {
      set({
        dashboard: previous,
        isSaving: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },
}))
