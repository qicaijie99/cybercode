import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isTauriRuntime: vi.fn(),
  shellOpen: vi.fn(),
}))

vi.mock('./desktopRuntime', () => ({
  isTauriRuntime: mocks.isTauriRuntime,
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
  open: mocks.shellOpen,
}))

import { openExternalUrl } from './openExternalUrl'

describe('openExternalUrl', () => {
  const browserWindow = {
    opener: window,
    location: {
      replace: vi.fn(),
    },
  } as unknown as Window

  beforeEach(() => {
    mocks.isTauriRuntime.mockReset()
    mocks.shellOpen.mockReset()
    browserWindow.opener = window
    vi.mocked(browserWindow.location.replace).mockReset()
    vi.spyOn(window, 'open').mockReturnValue(browserWindow)
  })

  it('uses a normal browser window outside Tauri', async () => {
    mocks.isTauriRuntime.mockReturnValue(false)

    await openExternalUrl('https://example.com/login')

    expect(window.open).toHaveBeenCalledWith('', '_blank')
    expect(browserWindow.opener).toBeNull()
    expect(browserWindow.location.replace).toHaveBeenCalledWith(
      'https://example.com/login',
    )
    expect(mocks.shellOpen).not.toHaveBeenCalled()
  })

  it('uses the Tauri shell in the desktop runtime', async () => {
    mocks.isTauriRuntime.mockReturnValue(true)
    mocks.shellOpen.mockResolvedValue(undefined)

    await openExternalUrl('https://example.com/login')

    expect(mocks.shellOpen).toHaveBeenCalledWith('https://example.com/login')
    expect(window.open).not.toHaveBeenCalled()
  })

  it('falls back to a browser window if the Tauri shell is unavailable', async () => {
    mocks.isTauriRuntime.mockReturnValue(true)
    mocks.shellOpen.mockRejectedValue(new Error('invoke unavailable'))

    await openExternalUrl('https://example.com/login')

    expect(window.open).toHaveBeenCalledWith('', '_blank')
    expect(browserWindow.opener).toBeNull()
    expect(browserWindow.location.replace).toHaveBeenCalledWith(
      'https://example.com/login',
    )
  })

  it('reports a blocked browser window', async () => {
    mocks.isTauriRuntime.mockReturnValue(false)
    vi.mocked(window.open).mockReturnValue(null)

    await expect(openExternalUrl('https://example.com/login')).rejects.toThrow(
      'blocked the authorization window',
    )
  })
})
