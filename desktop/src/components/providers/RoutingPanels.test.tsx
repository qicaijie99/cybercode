import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useRoutingStore } from '../../stores/routingStore'
import { useSettingsStore } from '../../stores/settingsStore'
import {
  RoutingStatusPanel,
  SmartRoutingPanel,
  summarizeRoutingHealth,
} from './RoutingPanels'

describe('SmartRoutingPanel', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    useRoutingStore.setState({
      dashboard: {
        config: {
          version: 1,
          enabled: false,
          profiles: [{
            id: 'balanced',
            name: 'Balanced',
            description: 'Balanced route',
            enabled: true,
            strategy: 'auto',
            strictFree: false,
            allowExperimental: false,
            maxAttempts: 3,
            targets: [],
          }],
        },
        sources: [],
        health: [],
        events: [],
        routeAvailability: {
          balanced: { candidateCount: 0, available: false, reason: 'routing-disabled' },
        },
      },
      isLoading: false,
      isSaving: false,
      error: null,
      fetchDashboard: vi.fn(),
      updateConfig: vi.fn(),
      updateProfile: vi.fn(),
      resetHealth: vi.fn(),
    })
  })

  it('preserves a route enabled state while the global switch is off', () => {
    render(<SmartRoutingPanel />)

    expect(screen.getByRole('switch', { name: 'Smart routing' })).not.toBeChecked()
    const routeSwitch = screen.getByRole('switch', { name: 'Balanced' })
    expect(routeSwitch).toBeChecked()
    expect(routeSwitch).toBeDisabled()
  })

  it('does not turn an empty source selection back into all sources', () => {
    useRoutingStore.setState({
      dashboard: {
        config: {
          version: 1,
          enabled: true,
          profiles: [{
            id: 'balanced',
            name: 'Balanced',
            description: 'Balanced route',
            enabled: true,
            strategy: 'auto',
            strictFree: false,
            allowExperimental: false,
            maxAttempts: 3,
            targets: [],
          }],
        },
        sources: [{
          id: 'provider-1',
          providerId: 'provider-1',
          presetId: 'custom',
          name: 'Only source',
          configured: true,
          routable: true,
          cost: 'paid',
          auth: 'api-key',
          risk: 'stable',
          models: [{ id: 'model-a' }],
        }],
        health: [],
        events: [],
        routeAvailability: {
          balanced: { candidateCount: 1, available: true },
        },
      },
    })

    render(<SmartRoutingPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }))

    const onlySource = screen.getByRole('checkbox', {
      name: 'Include Only source in this route',
    })
    expect(onlySource).toBeChecked()
    expect(onlySource).toBeDisabled()
  })

  it('uses a custom profile name as the route switch label', () => {
    const dashboard = useRoutingStore.getState().dashboard!
    useRoutingStore.setState({
      dashboard: {
        ...dashboard,
        config: {
          ...dashboard.config,
          enabled: true,
          profiles: [{
            ...dashboard.config.profiles[0]!,
            id: 'team-route',
            name: 'Team route',
          }],
        },
        routeAvailability: {
          'team-route': { candidateCount: 1, available: true },
        },
      },
    })

    render(<SmartRoutingPanel />)

    expect(screen.getByRole('switch', { name: 'Team route' })).toBeChecked()
  })

  it('groups the long strategy catalog into a bounded picker', () => {
    const dashboard = useRoutingStore.getState().dashboard!
    const updateProfile = vi.fn()
    useRoutingStore.setState({
      updateProfile,
      dashboard: {
        ...dashboard,
        config: {
          ...dashboard.config,
          enabled: true,
        },
      },
    })

    render(<SmartRoutingPanel />)
    expect(screen.queryByRole('button', { name: 'Strategy: Automatic' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Advanced settings/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Strategy: Automatic' }))

    const picker = screen.getByRole('dialog', { name: 'Choose routing strategy' })
    expect(picker).toHaveClass('max-h-[280px]')
    expect(picker).toHaveClass('bottom-[calc(100%+6px)]')
    expect(screen.getByRole('tab', { name: 'Recommended' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('option', { name: /^Automatic/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /^Round robin/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Load balancing' }))
    fireEvent.click(screen.getByRole('option', { name: /^Round robin/ }))

    expect(updateProfile).toHaveBeenCalledWith(expect.objectContaining({
      id: 'balanced',
      strategy: 'round-robin',
    }))
  })

  it('maps the prefer-free cost boundary to the existing cost-optimized strategy', () => {
    const updateProfile = vi.fn()
    useRoutingStore.setState({ updateProfile })

    render(<SmartRoutingPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Prefer free' }))

    expect(updateProfile).toHaveBeenCalledWith(expect.objectContaining({
      id: 'balanced',
      strictFree: false,
      strategy: 'cost-optimized',
    }))
  })

  it('keeps unavailable providers out of the route editor and links to source setup', () => {
    const onOpenSources = vi.fn()
    const dashboard = useRoutingStore.getState().dashboard!
    useRoutingStore.setState({
      dashboard: {
        ...dashboard,
        sources: [{
          id: 'preset:github-models',
          presetId: 'github-models',
          name: 'GitHub Models',
          configured: false,
          routable: false,
          cost: 'recurring-free',
          auth: 'oauth',
          risk: 'stable',
          models: [{ id: 'model-a' }],
        }],
      },
    })

    render(<SmartRoutingPanel onOpenSources={onOpenSources} />)

    expect(screen.queryByText('GitHub Models')).not.toBeInTheDocument()
    expect(screen.queryByText(/Missing API keys or OAuth access/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add model sources' }))
    expect(onOpenSources).toHaveBeenCalledTimes(1)
  })
})

describe('RoutingStatusPanel', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
  })

  it('weights latency by successful requests and ignores expired cooldowns', () => {
    const now = Date.parse('2026-07-21T12:00:00.000Z')
    const summary = summarizeRoutingHealth([
      {
        providerId: 'provider-a',
        providerName: 'Provider A',
        modelId: 'model-a',
        requests: 9,
        successes: 9,
        failures: 0,
        averageLatencyMs: 100,
        consecutiveFailures: 0,
        cooldownUntil: '2026-07-21T11:59:00.000Z',
      },
      {
        providerId: 'provider-b',
        providerName: 'Provider B',
        modelId: 'model-b',
        requests: 1,
        successes: 1,
        failures: 0,
        averageLatencyMs: 1_000,
        consecutiveFailures: 0,
        cooldownUntil: '2026-07-21T12:01:00.000Z',
      },
    ], now)

    expect(summary).toEqual({
      requests: 10,
      successRate: 100,
      active: 1,
      latency: 190,
    })
  })

  it('renders an expired cooldown as healthy', () => {
    useRoutingStore.setState({
      dashboard: {
        config: { version: 1, enabled: true, profiles: [] },
        sources: [],
        health: [{
          providerId: 'provider-a',
          providerName: 'Provider A',
          modelId: 'model-a',
          requests: 2,
          successes: 1,
          failures: 1,
          averageLatencyMs: 100,
          consecutiveFailures: 0,
          cooldownUntil: new Date(Date.now() - 60_000).toISOString(),
        }],
        events: [],
        routeAvailability: {},
      },
      isLoading: false,
      isSaving: false,
      error: null,
      fetchDashboard: vi.fn(),
      updateConfig: vi.fn(),
      updateProfile: vi.fn(),
      resetHealth: vi.fn(),
    })

    render(<RoutingStatusPanel />)

    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.queryByText('Cooling down')).not.toBeInTheDocument()
  })

  it('disables health reset while a routing update is in progress', () => {
    useRoutingStore.setState({
      dashboard: {
        config: { version: 1, enabled: true, profiles: [] },
        sources: [],
        health: [],
        events: [],
        routeAvailability: {},
      },
      isLoading: false,
      isSaving: true,
      error: null,
      fetchDashboard: vi.fn(),
      resetHealth: vi.fn(),
    })

    render(<RoutingStatusPanel />)

    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled()
  })
})
