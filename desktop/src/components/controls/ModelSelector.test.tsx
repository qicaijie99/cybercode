import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OFFICIAL_MODELS } from '../../constants/modelCatalog'
import { useProviderStore } from '../../stores/providerStore'
import { useRoutingStore } from '../../stores/routingStore'
import { useSessionRuntimeStore } from '../../stores/sessionRuntimeStore'
import { useSettingsStore } from '../../stores/settingsStore'
import type { SavedProvider } from '../../types/provider'
import { ModelSelector } from './ModelSelector'

function makeProvider(overrides: Partial<SavedProvider>): SavedProvider {
  return {
    id: 'provider-id',
    presetId: 'custom',
    name: 'Custom',
    apiKey: '***',
    baseUrl: 'https://example.com',
    apiFormat: 'anthropic',
    models: {
      main: '',
      haiku: '',
      sonnet: '',
      opus: '',
    },
    ...overrides,
  }
}

describe('ModelSelector', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettingsStore.setState({
      locale: 'en',
      availableModels: OFFICIAL_MODELS,
      currentModel: OFFICIAL_MODELS[0] ?? null,
      activeProviderName: null,
      effortLevel: 'medium',
    })
    useSessionRuntimeStore.setState({ selections: {} })
    useProviderStore.setState({
      providers: [],
      activeId: null,
      hasLoadedProviders: true,
      presets: [],
      isLoading: false,
      isPresetsLoading: false,
      error: null,
      fetchProviders: vi.fn(),
    })
    useRoutingStore.setState({
      dashboard: null,
      isLoading: false,
      isSaving: false,
      error: null,
      fetchDashboard: vi.fn(),
    })
  })

  it('uses custom endpoint identities instead of mixed model IDs', () => {
    useProviderStore.setState({
      providers: [
        makeProvider({
          id: 'volcano',
          name: '火山',
          baseUrl: 'https://ark.cn-beijing.volces.com/api/plan',
          models: {
            main: 'glm-5.1',
            haiku: 'kimi-k2.6',
            sonnet: '',
            opus: '',
          },
        }),
        makeProvider({
          id: 'qianfan',
          name: '百度千帆',
          baseUrl: 'https://qianfan.baidubce.com/anthropic/coding',
          models: {
            main: 'glm-5.1',
            haiku: 'deepseek-v4-flash',
            sonnet: '',
            opus: '',
          },
        }),
      ],
    })

    render(<ModelSelector runtimeKey="draft-session" compact variant="pill" />)

    fireEvent.click(screen.getByRole('button', { name: /Opus 4\.8/i }))

    const volcanoHeader = screen
      .getAllByText('火山')
      .find((element) => element.className.includes('text-[var(--color-text-primary)]'))
      ?.parentElement
    const qianfanHeader = screen
      .getAllByText('百度千帆')
      .find((element) => element.className.includes('text-[var(--color-text-primary)]'))
      ?.parentElement

    expect(volcanoHeader?.querySelector('[data-provider-logo="volcengine"]')).toBeInTheDocument()
    expect(volcanoHeader?.querySelector('[data-provider-logo="zhipuglm"]')).not.toBeInTheDocument()
    expect(volcanoHeader?.querySelector('[data-provider-logo="kimi"]')).not.toBeInTheDocument()

    expect(qianfanHeader?.querySelector('[data-provider-logo="qianfan"]')).toBeInTheDocument()
    expect(qianfanHeader?.querySelector('[data-provider-logo="deepseek"]')).not.toBeInTheDocument()
    expect(qianfanHeader?.querySelector('[data-provider-logo="zhipuglm"]')).not.toBeInTheDocument()
  })

  it('supports externally controlled provider and model selection', () => {
    useProviderStore.setState({
      providers: [
        makeProvider({
          id: 'kimi',
          presetId: 'kimi',
          name: 'Kimi',
          models: {
            main: 'kimi-k2.6',
            haiku: '',
            sonnet: '',
            opus: '',
          },
        }),
      ],
    })
    const onRuntimeChange = vi.fn()

    render(
      <ModelSelector
        runtimeValue={{ providerId: null, modelId: 'claude-opus-4-8' }}
        onRuntimeChange={onRuntimeChange}
        compact
        variant="pill"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Opus 4\.8/i }))
    fireEvent.click(screen.getByText('kimi-k2.6').closest('button')!)

    expect(onRuntimeChange).toHaveBeenCalledWith({
      providerId: 'kimi',
      modelId: 'kimi-k2.6',
      contextWindow: undefined,
    })
  })

  it('offers available route profiles without replacing direct model choices', () => {
    useRoutingStore.setState({
      dashboard: {
        config: {
          version: 1,
          enabled: true,
          profiles: [{
            id: 'team-route',
            name: 'Team route',
            description: 'Custom route',
            enabled: true,
            strategy: 'priority',
            strictFree: false,
            allowExperimental: false,
            maxAttempts: 2,
            targets: [],
          }],
        },
        sources: [],
        health: [],
        events: [],
        routeAvailability: {
          'team-route': { candidateCount: 2, available: true, contextWindow: 262_144 },
        },
      },
    })
    const onRuntimeChange = vi.fn()

    render(
      <ModelSelector
        runtimeValue={{ providerId: null, modelId: 'claude-opus-4-8' }}
        onRuntimeChange={onRuntimeChange}
        compact
        variant="pill"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Opus 4\.8/i }))
    expect(screen.getAllByText('Claude Official').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByText('Team route').closest('button')!)

    expect(onRuntimeChange).toHaveBeenCalledWith({
      kind: 'route',
      providerId: null,
      routeId: 'team-route',
      modelId: 'cybercode-route-team-route',
      contextWindow: 262_144,
    })
  })

  it('refreshes route availability whenever the runtime selector is reopened', async () => {
    const fetchDashboard = vi.fn().mockResolvedValue(undefined)
    useRoutingStore.setState({ fetchDashboard })

    render(
      <ModelSelector
        runtimeValue={{ providerId: null, modelId: 'claude-opus-4-8' }}
        onRuntimeChange={vi.fn()}
        compact
        variant="pill"
      />,
    )

    const trigger = screen.getByRole('button', { name: /Opus 4\.8/i })
    await waitFor(() => expect(fetchDashboard).toHaveBeenCalledTimes(1))
    fireEvent.click(trigger)
    await waitFor(() => expect(fetchDashboard).toHaveBeenCalledTimes(2))
    fireEvent.click(trigger)
    fireEvent.click(trigger)
    await waitFor(() => expect(fetchDashboard).toHaveBeenCalledTimes(3))
  })
})
