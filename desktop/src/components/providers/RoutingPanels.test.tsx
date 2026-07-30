import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useRoutingStore } from '../../stores/routingStore'
import { useSettingsStore } from '../../stores/settingsStore'
import type { RouteProfile, RoutingDashboard, RoutingSource } from '../../types/routing'
import {
  RoutingStatusPanel,
  SmartRoutingPanel,
  summarizeRoutingHealth,
} from './RoutingPanels'

const balancedRoute: RouteProfile = {
  id: 'balanced',
  name: 'Balanced',
  description: 'Balanced route',
  enabled: true,
  strategy: 'auto',
  strictFree: false,
  allowExperimental: false,
  maxAttempts: 3,
  targets: [],
}

const connectedSource: RoutingSource = {
  id: 'provider-1',
  providerId: 'provider-1',
  presetId: 'custom',
  name: 'Acme AI',
  configured: true,
  routable: true,
  cost: 'paid',
  auth: 'api-key',
  risk: 'stable',
  models: [{ id: 'model-a' }, { id: 'model-b' }],
}

function makeDashboard(overrides: Partial<RoutingDashboard> = {}): RoutingDashboard {
  return {
    config: {
      version: 1,
      enabled: false,
      profiles: [balancedRoute],
    },
    sources: [],
    health: [],
    events: [],
    routeAvailability: {
      balanced: { candidateCount: 0, available: false, reason: 'routing-disabled' },
    },
    ...overrides,
  }
}

describe('SmartRoutingPanel', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    useRoutingStore.setState({
      dashboard: makeDashboard(),
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

  it('uses a custom route name as the route switch label', () => {
    useRoutingStore.setState({
      dashboard: makeDashboard({
        config: {
          version: 1,
          enabled: true,
          profiles: [{ ...balancedRoute, id: 'team-route', name: 'Team route' }],
        },
        routeAvailability: {
          'team-route': { candidateCount: 1, available: true },
        },
      }),
    })

    render(<SmartRoutingPanel />)

    expect(screen.getByRole('switch', { name: 'Team route' })).toBeChecked()
  })

  it('keeps legacy route names and behavior descriptions aligned', () => {
    useRoutingStore.setState({
      dashboard: makeDashboard({
        config: {
          version: 1,
          enabled: true,
          profiles: [
            {
              ...balancedRoute,
              id: 'coding-first',
              name: 'Coding first',
              strategy: 'headroom',
              targets: [{ providerId: 'provider-1', modelId: 'model-a', priority: 0 }],
            },
            {
              ...balancedRoute,
              id: 'free-first',
              name: 'Free first',
              strategy: 'cost-optimized',
              strictFree: true,
              targets: [{ providerId: 'provider-1', modelId: 'model-b', priority: 0 }],
            },
          ],
        },
        sources: [connectedSource],
        routeAvailability: {
          'coding-first': { candidateCount: 1, available: true },
          'free-first': { candidateCount: 1, available: true },
        },
      }),
    })

    render(<SmartRoutingPanel />)

    expect(screen.getByText('Context headroom')).toBeInTheDocument()
    expect(screen.getByText('Cost optimized')).toBeInTheDocument()
    expect(screen.getByText('Prefers healthy models with more context headroom.')).toBeInTheDocument()
    expect(screen.getByText('Uses only recurring-free or local sources.')).toBeInTheDocument()
  })

  it('uses the actual mode for an explicitly edited legacy route', () => {
    useRoutingStore.setState({
      dashboard: makeDashboard({
        config: {
          version: 1,
          enabled: true,
          profiles: [{
            ...balancedRoute,
            name: 'My balanced route',
            strategy: 'cost-optimized',
            targets: [{ providerId: 'provider-1', modelId: 'model-a' }],
          }],
        },
        sources: [connectedSource],
        routeAvailability: {
          balanced: { candidateCount: 1, available: true },
        },
      }),
    })

    render(<SmartRoutingPanel />)

    expect(screen.getByRole('switch', { name: 'My balanced route' })).toBeChecked()
    expect(screen.getByText('Prefer free or lower-cost models, then use other fallbacks only when needed.')).toBeInTheDocument()
    expect(screen.queryByText('Balances health, latency, cost and context.')).not.toBeInTheDocument()
  })

  it('shows the source default model for a legacy provider-only target', () => {
    useRoutingStore.setState({
      dashboard: makeDashboard({
        config: {
          version: 1,
          enabled: true,
          profiles: [{
            ...balancedRoute,
            targets: [{ providerId: 'provider-1', priority: 0 }],
          }],
        },
        sources: [connectedSource],
        routeAvailability: {
          balanced: { candidateCount: 1, available: true },
        },
      }),
    })

    render(<SmartRoutingPanel />)

    expect(screen.getByText('model-a')).toBeInTheDocument()
  })

  it('keeps a legacy free-only route explicit when editing it', () => {
    useRoutingStore.setState({
      dashboard: makeDashboard({
        config: {
          version: 1,
          enabled: true,
          profiles: [{
            ...balancedRoute,
            strictFree: true,
            targets: [{ providerId: 'provider-1', modelId: 'model-a', priority: 0 }],
          }],
        },
        sources: [connectedSource],
      }),
    })

    render(<SmartRoutingPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit route' }))

    expect(screen.getByRole('button', { name: /Save money/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/legacy route still uses free-only mode/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText(/Order breaks ties/)).toBeInTheDocument()
    expect(screen.getByText('Candidate 1')).toBeInTheDocument()
  })

  it('creates an ordered route through the three-step guide', async () => {
    const updateConfig = vi.fn().mockResolvedValue(undefined)
    useRoutingStore.setState({
      updateConfig,
      dashboard: makeDashboard({
        config: { version: 1, enabled: true, profiles: [] },
        sources: [connectedSource],
        routeAvailability: {},
      }),
    })

    render(<SmartRoutingPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Create first route' }))

    expect(screen.getByRole('dialog', { name: 'Create route' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Route name'), {
      target: { value: 'Daily coding' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Fixed order/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    fireEvent.click(screen.getByRole('button', { name: 'Add a model' }))
    fireEvent.click(screen.getByText('model-a').closest('button')!)
    fireEvent.click(screen.getByRole('button', { name: 'Add a model' }))
    fireEvent.click(screen.getByText('model-b').closest('button')!)
    fireEvent.click(screen.getAllByRole('button', { name: 'Move up' })[1]!)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.getByText(/Start with Acme AI · model-b/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create route' }))

    await waitFor(() => expect(updateConfig).toHaveBeenCalledWith({
      version: 1,
      enabled: true,
      profiles: [expect.objectContaining({
        id: 'daily-coding',
        name: 'Daily coding',
        strategy: 'priority',
        maxAttempts: 2,
        targets: [
          { providerId: 'provider-1', modelId: 'model-b', priority: 0 },
          { providerId: 'provider-1', modelId: 'model-a', priority: 1 },
        ],
      })],
    }))
  })

  it('duplicates a route as a disabled user-owned copy', () => {
    const updateConfig = vi.fn()
    useRoutingStore.setState({ updateConfig })

    render(<SmartRoutingPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate route' }))

    expect(updateConfig).toHaveBeenCalledWith(expect.objectContaining({
      profiles: [
        balancedRoute,
        expect.objectContaining({
          id: 'balanced-copy',
          name: 'Balanced copy',
          enabled: false,
        }),
      ],
    }))
  })

  it('deletes a route only after confirmation', async () => {
    const updateConfig = vi.fn().mockResolvedValue(undefined)
    useRoutingStore.setState({ updateConfig })

    render(<SmartRoutingPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete route' }))

    expect(screen.getByRole('dialog', { name: 'Delete this route?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(updateConfig).toHaveBeenCalledWith(expect.objectContaining({
      profiles: [],
    })))
  })

  it('links an empty setup to model sources when no provider is routable', () => {
    const onOpenSources = vi.fn()
    useRoutingStore.setState({
      dashboard: makeDashboard({
        config: { version: 1, enabled: true, profiles: [] },
        sources: [{
          ...connectedSource,
          id: 'preset:github-models',
          providerId: undefined,
          presetId: 'github-models',
          name: 'GitHub Models',
          configured: false,
          routable: false,
          auth: 'oauth',
        }],
        routeAvailability: {},
      }),
    })

    render(<SmartRoutingPanel onOpenSources={onOpenSources} />)

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
