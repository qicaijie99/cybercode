import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RoutingDashboard } from '../types/routing'

const {
  dashboardRequest,
  resetHealthRequest,
  updateConfigRequest,
} = vi.hoisted(() => ({
  dashboardRequest: vi.fn(),
  resetHealthRequest: vi.fn(),
  updateConfigRequest: vi.fn(),
}))

vi.mock('../api/routing', () => ({
  routingApi: {
    dashboard: dashboardRequest,
    resetHealth: resetHealthRequest,
    updateConfig: updateConfigRequest,
  },
}))

import { useRoutingStore } from './routingStore'

function makeDashboard(overrides: Partial<RoutingDashboard> = {}): RoutingDashboard {
  return {
    config: { version: 1, enabled: true, profiles: [] },
    sources: [],
    health: [],
    events: [],
    routeAvailability: {},
    ...overrides,
  }
}

describe('routingStore', () => {
  beforeEach(() => {
    dashboardRequest.mockReset()
    resetHealthRequest.mockReset()
    updateConfigRequest.mockReset()
    useRoutingStore.setState({
      dashboard: null,
      isLoading: false,
      isSaving: false,
      error: null,
    })
  })

  it('clears health optimistically and refreshes after reset', async () => {
    const previous = makeDashboard({
      health: [{
        providerId: 'provider-a',
        providerName: 'Provider A',
        modelId: 'model-a',
        requests: 1,
        successes: 0,
        failures: 1,
        averageLatencyMs: null,
        consecutiveFailures: 1,
      }],
    })
    const refreshed = makeDashboard()
    useRoutingStore.setState({ dashboard: previous })
    resetHealthRequest.mockResolvedValue({ ok: true })
    dashboardRequest.mockResolvedValue(refreshed)

    await useRoutingStore.getState().resetHealth()

    expect(resetHealthRequest).toHaveBeenCalledOnce()
    expect(dashboardRequest).toHaveBeenCalledOnce()
    expect(useRoutingStore.getState()).toMatchObject({
      dashboard: refreshed,
      isSaving: false,
      error: null,
    })
  })

  it('restores the previous dashboard when reset fails', async () => {
    const previous = makeDashboard()
    useRoutingStore.setState({ dashboard: previous })
    resetHealthRequest.mockRejectedValue(new Error('Desktop server unavailable'))

    await useRoutingStore.getState().resetHealth()

    expect(useRoutingStore.getState()).toMatchObject({
      dashboard: previous,
      isSaving: false,
      error: 'Desktop server unavailable',
    })
  })

  it('does not let an older dashboard poll overwrite a completed config save', async () => {
    const previous = makeDashboard({
      config: { version: 1, enabled: true, profiles: [] },
    })
    const nextConfig = { version: 1 as const, enabled: false, profiles: [] }
    const refreshed = makeDashboard({ config: nextConfig })
    let resolveStalePoll!: (dashboard: RoutingDashboard) => void
    const stalePoll = new Promise<RoutingDashboard>((resolve) => {
      resolveStalePoll = resolve
    })
    dashboardRequest
      .mockImplementationOnce(() => stalePoll)
      .mockResolvedValueOnce(refreshed)
    updateConfigRequest.mockResolvedValue({ config: nextConfig })
    useRoutingStore.setState({ dashboard: previous })

    const poll = useRoutingStore.getState().fetchDashboard({ quiet: true })
    await useRoutingStore.getState().updateConfig(nextConfig)
    resolveStalePoll(previous)
    await poll

    expect(updateConfigRequest).toHaveBeenCalledWith(nextConfig)
    expect(dashboardRequest).toHaveBeenCalledTimes(2)
    expect(useRoutingStore.getState()).toMatchObject({
      dashboard: refreshed,
      isSaving: false,
      error: null,
    })
  })

  it('keeps the saved config when the post-save dashboard refresh fails', async () => {
    const previous = makeDashboard({
      config: { version: 1, enabled: true, profiles: [] },
    })
    const nextConfig = { version: 1 as const, enabled: false, profiles: [] }
    useRoutingStore.setState({ dashboard: previous })
    updateConfigRequest.mockResolvedValue({ config: nextConfig })
    dashboardRequest.mockRejectedValue(new Error('Refresh unavailable'))

    await useRoutingStore.getState().updateConfig(nextConfig)

    expect(useRoutingStore.getState()).toMatchObject({
      dashboard: { ...previous, config: nextConfig },
      isSaving: false,
      error: 'Refresh unavailable',
    })
  })
})
