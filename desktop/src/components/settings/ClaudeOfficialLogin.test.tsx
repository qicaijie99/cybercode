import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

const { shellOpenMock } = vi.hoisted(() => ({
  shellOpenMock: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
  open: shellOpenMock,
}))

import { useSettingsStore } from '../../stores/settingsStore'
import { useCybercodeOAuthStore } from '../../stores/cybercodeOAuthStore'
import { ClaudeOAuthDialog } from './ClaudeOfficialLogin'

describe('ClaudeOAuthDialog', () => {
  const fetchStatus = vi.fn()
  const login = vi.fn()
  const logout = vi.fn()
  const startPolling = vi.fn()
  const stopPolling = vi.fn()

  beforeEach(() => {
    shellOpenMock.mockReset()
    shellOpenMock.mockResolvedValue(undefined)
    fetchStatus.mockReset()
    fetchStatus.mockResolvedValue(undefined)
    login.mockReset()
    logout.mockReset()
    logout.mockResolvedValue(undefined)
    startPolling.mockReset()
    stopPolling.mockReset()
    useSettingsStore.setState({ locale: 'en' })
    useCybercodeOAuthStore.setState({
      status: { loggedIn: false },
      isPolling: false,
      isLoading: false,
      error: null,
      fetchStatus,
      login,
      logout,
      startPolling,
      stopPolling,
    })
  })

  it('opens Claude browser authorization and keeps the flow inside the dialog', async () => {
    login.mockResolvedValue({
      authorizeUrl: 'https://claude.ai/oauth/authorize',
    })

    render(
      <ClaudeOAuthDialog
        open
        onClose={() => {}}
        isDefault
        onSetDefault={() => {}}
      />,
    )

    expect(screen.getByRole('dialog', { name: 'Claude Code' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Connect account' }))

    await waitFor(() => {
      expect(shellOpenMock).toHaveBeenCalledWith('https://claude.ai/oauth/authorize')
    })
    expect(startPolling).toHaveBeenCalledOnce()
    expect(
      screen.getByText('Waiting for Claude Code authorization in your browser'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Reopen official page' }),
    ).toBeInTheDocument()
  })

  it('shows connected account actions and preserves the default-provider action', async () => {
    const onSetDefault = vi.fn().mockResolvedValue(undefined)
    useCybercodeOAuthStore.setState({
      status: {
        loggedIn: true,
        expiresAt: null,
        scopes: ['user:inference'],
        subscriptionType: 'max',
      },
    })

    render(
      <ClaudeOAuthDialog
        open
        onClose={() => {}}
        isDefault={false}
        onSetDefault={onSetDefault}
      />,
    )

    expect(screen.getByText('Claude MAX')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Set default' }))
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))

    await waitFor(() => {
      expect(onSetDefault).toHaveBeenCalledOnce()
      expect(logout).toHaveBeenCalledOnce()
    })
  })
})
