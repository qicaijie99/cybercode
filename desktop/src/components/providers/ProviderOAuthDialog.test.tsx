import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

import { useSettingsStore } from '../../stores/settingsStore'
import { OAUTH_PROVIDER_CATALOG } from './OAuthProviderCatalog'
import { ProviderOAuthDialog } from './ProviderOAuthDialog'

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  poll: vi.fn(),
  detect: vi.fn(),
  importConnection: vi.fn(),
  disconnect: vi.fn(),
  openExternalUrl: vi.fn(),
}))

vi.mock('../../lib/openExternalUrl', () => ({
  openExternalUrl: mocks.openExternalUrl,
}))

vi.mock('../../api/providerOAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/providerOAuth')>()
  return {
    ...actual,
    providerOAuthApi: {
      ...actual.providerOAuthApi,
      start: mocks.start,
      poll: mocks.poll,
      detect: mocks.detect,
      importConnection: mocks.importConnection,
      disconnect: mocks.disconnect,
    },
  }
})

describe('ProviderOAuthDialog', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    mocks.start.mockReset()
    mocks.poll.mockReset()
    mocks.detect.mockReset()
    mocks.importConnection.mockReset()
    mocks.disconnect.mockReset()
    mocks.openExternalUrl.mockReset()
    mocks.openExternalUrl.mockResolvedValue(undefined)
  })

  it('starts the official device flow and keeps the code available in-app', async () => {
    mocks.start.mockResolvedValue({
      flowType: 'device_code',
      providerId: 'kimi-coding',
      sessionId: 'session-id',
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://www.kimi.com/device',
      verificationUriComplete: 'https://www.kimi.com/device?code=ABCD-EFGH',
      expiresAt: Date.now() + 600_000,
      intervalMs: 60_000,
    })
    mocks.poll.mockResolvedValue({ status: 'pending', intervalMs: 60_000 })

    render(
      <ProviderOAuthDialog
        provider={{ id: 'kimi-coding', name: 'Kimi Coding' }}
        capability={{ providerId: 'kimi-coding', setupMode: 'device_code' }}
        status={{ providerId: 'kimi-coding', connected: false, expiresAt: null }}
        onClose={() => {}}
        onChanged={() => {}}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'CyberCode will reuse your Kimi Coding OAuth session or local sign-in.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Connect account' }))

    expect(await screen.findByText('ABCD-EFGH')).toBeInTheDocument()
    expect(mocks.start).toHaveBeenCalledWith('kimi-coding', undefined)
    expect(mocks.openExternalUrl).toHaveBeenCalledWith(
      'https://www.kimi.com/device?code=ABCD-EFGH',
    )
    expect(screen.getByRole('button', { name: 'Reopen official page' })).toBeEnabled()
  })

  it('shows the risk notice without adding another step to browser OAuth', async () => {
    mocks.start.mockResolvedValue({
      flowType: 'authorization_code_pkce',
      providerId: 'codex',
      sessionId: 'codex-session',
      authorizeUrl: 'https://auth.openai.com/oauth/authorize',
      redirectUri: 'http://localhost:1455/auth/callback',
      expiresAt: Date.now() + 600_000,
      intervalMs: 60_000,
    })
    mocks.poll.mockResolvedValue({ status: 'pending', intervalMs: 60_000 })

    render(
      <ProviderOAuthDialog
        provider={{ id: 'codex', name: 'OpenAI Codex' }}
        capability={{ providerId: 'codex', setupMode: 'browser' }}
        status={{ providerId: 'codex', connected: false, expiresAt: null }}
        onClose={() => {}}
        onChanged={() => {}}
      />,
    )

    expect(screen.getByText('Before connecting')).toBeInTheDocument()
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.openExternalUrl).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Connect account' }))

    await waitFor(() => {
      expect(mocks.start).toHaveBeenCalledWith('codex', undefined)
      expect(mocks.openExternalUrl).toHaveBeenCalledWith(
        'https://auth.openai.com/oauth/authorize',
      )
    })
  })

  it('clears the waiting state when the browser cannot be opened', async () => {
    mocks.start.mockResolvedValue({
      flowType: 'authorization_code_pkce',
      providerId: 'gemini-cli',
      sessionId: 'gemini-session',
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      redirectUri: 'http://127.0.0.1:1455/callback',
      expiresAt: Date.now() + 600_000,
      intervalMs: 60_000,
    })
    mocks.openExternalUrl.mockRejectedValue(new Error('invoke unavailable'))

    render(
      <ProviderOAuthDialog
        provider={{ id: 'gemini-cli', name: 'Gemini CLI' }}
        capability={{ providerId: 'gemini-cli', setupMode: 'browser' }}
        status={{ providerId: 'gemini-cli', connected: false, expiresAt: null }}
        onClose={() => {}}
        onChanged={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Connect account' }))

    expect(
      await screen.findByText(
        'The browser could not be opened automatically. Allow pop-ups and try again.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Waiting for Gemini CLI authorization in your browser'),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect account' })).toBeEnabled()
  })

  it('imports a Qoder PAT without leaving the connection wizard', async () => {
    const onChanged = vi.fn()
    mocks.importConnection.mockResolvedValue({
      providerId: 'provider-id',
      connection: {
        providerId: 'qoder',
        connected: true,
        expiresAt: null,
      },
    })

    render(
      <ProviderOAuthDialog
        provider={{ id: 'qoder', name: 'Qoder' }}
        capability={{
          providerId: 'qoder',
          setupMode: 'token_import',
          helpUrl: 'https://qoder.com/account/integrations',
        }}
        status={{ providerId: 'qoder', connected: false, expiresAt: null }}
        onClose={() => {}}
        onChanged={onChanged}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Before connecting')
    fireEvent.change(screen.getByLabelText('Access token'), {
      target: { value: 'pt-valid-qoder-token' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Import token' }))

    await waitFor(() => {
      expect(mocks.importConnection).toHaveBeenCalledWith('qoder', {
        accessToken: 'pt-valid-qoder-token',
      })
    })
    expect(onChanged).toHaveBeenCalledOnce()
    expect(screen.getByLabelText('Access token')).toHaveValue('')
  })

  it.each(OAUTH_PROVIDER_CATALOG.filter((provider) => provider.id !== 'claude'))(
    'shows a concise risk notice for $name while keeping setup available',
    (provider) => {
      render(
        <ProviderOAuthDialog
          provider={provider}
          capability={{ providerId: provider.id, setupMode: 'browser' }}
          status={{ providerId: provider.id, connected: false, expiresAt: null }}
          onClose={() => {}}
          onChanged={() => {}}
        />,
      )

      expect(screen.getByRole('alert')).toHaveTextContent(provider.name)
      expect(
        screen.getByRole('button', { name: 'Connect account' }),
      ).toBeEnabled()
      expect(
        screen.queryByRole('button', { name: 'I understand, continue' }),
      ).not.toBeInTheDocument()
    },
  )
})
