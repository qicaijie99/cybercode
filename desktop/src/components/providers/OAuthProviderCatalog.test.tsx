import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

import {
  OAuthProviderCatalog,
  OAUTH_PROVIDER_CATALOG,
} from './OAuthProviderCatalog'
import {
  BUILTIN_PROVIDER_OAUTH_CAPABILITIES,
  mergeProviderOAuthCapabilities,
  type ProviderOAuthCapability,
} from '../../api/providerOAuth'

const labels = {
  title: 'OAuth providers',
  description: 'OAuth provider catalog',
  connectedCount: '0/18',
  connected: 'Connected',
  nativeReady: 'Native login',
  pending: 'Pending native integration',
  openLogin: 'Open Claude login',
}

describe('OAuthProviderCatalog', () => {
  const capabilities = new Map<string, ProviderOAuthCapability>([
    ['kimi-coding', { providerId: 'kimi-coding', setupMode: 'device_code' }],
    ['github', { providerId: 'github', setupMode: 'device_code' }],
  ])

  it('lists active OAuth providers as cards with popular options first', () => {
    const { container } = render(
      <OAuthProviderCatalog
        claudeConnected={false}
        capabilities={mergeProviderOAuthCapabilities()}
        labels={labels}
      />,
    )

    expect(OAUTH_PROVIDER_CATALOG).toHaveLength(16)
    expect(OAUTH_PROVIDER_CATALOG.slice(0, 3).map((provider) => provider.id)).toEqual([
      'codex',
      'claude',
      'kimi-coding',
    ])
    expect(screen.getByText('Claude Code')).toBeInTheDocument()
    expect(screen.getByText('OpenAI Codex')).toBeInTheDocument()
    expect(screen.getByText('Gemini CLI')).toBeInTheDocument()
    expect(screen.getByText('CodeBuddy CN')).toBeInTheDocument()
    expect(screen.queryByText('Qwen Code')).not.toBeInTheDocument()
    expect(screen.queryByText('Kiro AI')).not.toBeInTheDocument()
    expect(screen.queryByText('Pending native integration')).not.toBeInTheDocument()
    expect(screen.getAllByText('Native login')).toHaveLength(
      OAUTH_PROVIDER_CATALOG.length,
    )

    const catalog = container.querySelector('[data-provider-catalog="oauth"]')
    const firstCard = screen
      .getByText('OpenAI Codex')
      .closest('[data-provider-card-layout="catalog"]')
    expect(catalog).toHaveAttribute('data-provider-catalog-layout', 'comfortable')
    expect(firstCard).toHaveClass('min-h-[104px]')
    expect(firstCard?.querySelector('[data-provider-logo]')).toHaveClass(
      'h-[40px]',
      'w-[40px]',
    )
    expect(firstCard).toHaveClass('border-[var(--color-border-separator)]')
    expect(firstCard).not.toHaveClass('border-[#1473e6]/30')
    expect(screen.getByText('OpenAI Codex')).toHaveClass('text-[13px]')
    expect(screen.getAllByText('Native login')[0]).toHaveClass(
      'text-[11px]',
      'text-[var(--color-text-tertiary)]',
    )
  })

  it('opens the Claude OAuth wizard from the provider card', () => {
    const onSelectProvider = vi.fn()
    render(
      <OAuthProviderCatalog
        claudeConnected
        onSelectProvider={onSelectProvider}
        labels={{ ...labels, connectedCount: '1/16' }}
      />,
    )

    const claudeCard = screen.getByRole('button', { name: 'Open Claude login' })
    expect(claudeCard).not.toHaveAttribute('aria-expanded')
    expect(screen.getByText('Connected')).toBeInTheDocument()
    fireEvent.click(claudeCard)
    expect(onSelectProvider).toHaveBeenCalledWith({
      id: 'claude',
      name: 'Claude Code',
    })
  })

  it('opens supported device OAuth providers from their cards', () => {
    const onSelectProvider = vi.fn()
    render(
      <OAuthProviderCatalog
        claudeConnected={false}
        capabilities={capabilities}
        connectedProviderIds={new Set(['github'])}
        onSelectProvider={onSelectProvider}
        labels={labels}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Kimi Coding: Native login' }))
    expect(onSelectProvider).toHaveBeenCalledWith({
      id: 'kimi-coding',
      name: 'Kimi Coding',
    })
    const connectedStatus = screen.getByText('Connected')
    const githubCard = screen
      .getByText('GitHub Copilot')
      .closest('[data-provider-card-layout="catalog"]')
    const kimiCard = screen
      .getByText('Kimi Coding')
      .closest('[data-provider-card-layout="catalog"]')
    expect(connectedStatus).toHaveClass('text-[#1473e6]')
    expect(githubCard).toHaveClass('border-[#1473e6]/30')
    expect(kimiCard).toHaveClass('border-[var(--color-border-separator)]')
    expect(kimiCard).not.toHaveClass('border-[#1473e6]/30')
  })

  it('keeps every non-Claude card actionable before the server catalog loads', () => {
    const providerIds = OAUTH_PROVIDER_CATALOG
      .filter((provider) => provider.id !== 'claude')
      .map((provider) => provider.id)
    const capabilityIds = BUILTIN_PROVIDER_OAUTH_CAPABILITIES
      .map((capability) => capability.providerId)

    expect(capabilityIds.sort()).toEqual(providerIds.sort())
    expect(mergeProviderOAuthCapabilities().get('qoder')).toMatchObject({
      setupMode: 'token_import',
    })
  })

  it('lets the server override a built-in connection method', () => {
    const merged = mergeProviderOAuthCapabilities([
      { providerId: 'qoder', setupMode: 'browser' },
    ])

    expect(merged.get('qoder')?.setupMode).toBe('browser')
  })
})
