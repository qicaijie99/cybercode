import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

import { useSettingsStore } from '../../stores/settingsStore'
import { ProviderOAuthDialog } from './ProviderOAuthDialog'

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  poll: vi.fn(),
  detect: vi.fn(),
  importConnection: vi.fn(),
  disconnect: vi.fn(),
  shellOpen: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
  open: mocks.shellOpen,
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
    mocks.shellOpen.mockReset()
    mocks.shellOpen.mockResolvedValue(undefined)
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

    fireEvent.click(screen.getByRole('button', { name: 'Connect account' }))

    expect(await screen.findByText('ABCD-EFGH')).toBeInTheDocument()
    expect(mocks.start).toHaveBeenCalledWith('kimi-coding', undefined)
    expect(mocks.shellOpen).toHaveBeenCalledWith(
      'https://www.kimi.com/device?code=ABCD-EFGH',
    )
    expect(screen.getByRole('button', { name: 'Reopen official page' })).toBeEnabled()
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
})
