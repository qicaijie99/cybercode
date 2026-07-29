import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

import { initializeDesktopServerUrl } from '../../lib/desktopRuntime'
import { useChatStore } from '../../stores/chatStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'
import { COMPACT_APP_LAYOUT_QUERY, useUIStore } from '../../stores/uiStore'
import { AppShell } from './AppShell'

vi.mock('../../lib/desktopRuntime', () => ({
  initializeDesktopServerUrl: vi.fn(),
}))

vi.mock('../../hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: vi.fn(),
}))

vi.mock('../../services/providerWorkspacePreload', () => ({
  preloadProviderWorkspace: vi.fn(async () => {}),
}))

vi.mock('./IconRail', () => ({
  IconRail: () => <div data-testid="icon-rail" />,
}))

vi.mock('./Sidebar', () => ({
  Sidebar: () => <aside data-testid="sidebar" />,
}))

vi.mock('./ContentRouter', () => ({
  ContentRouter: () => <main data-testid="content-router" />,
}))

vi.mock('./TabBar', () => ({
  TabBar: () => <div data-testid="tab-bar" />,
}))

vi.mock('./SettingsPanel', () => ({
  SettingsPanel: ({
    reserveRightRail,
    reserveSidebar,
  }: {
    reserveRightRail?: boolean
    reserveSidebar?: boolean
  }) => (
    <div
      data-testid="settings-panel"
      data-reserve-right-rail={String(Boolean(reserveRightRail))}
      data-reserve-sidebar={String(Boolean(reserveSidebar))}
    />
  ),
}))

vi.mock('../chat/ChatModeSidebar', () => ({
  ChatModeSidebar: () => <div data-testid="chat-mode-sidebar" />,
}))

vi.mock('../shared/Toast', () => ({
  ToastContainer: () => <div data-testid="toast-container" />,
}))

let compactViewport = false
const mediaListeners = new Set<(event: MediaQueryListEvent) => void>()

function installMatchMedia(compact = false) {
  compactViewport = compact
  mediaListeners.clear()
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: query === COMPACT_APP_LAYOUT_QUERY ? compactViewport : false,
      media: query,
      onchange: null,
      addEventListener: (event: string, listener: (event: MediaQueryListEvent) => void) => {
        if (query === COMPACT_APP_LAYOUT_QUERY && event === 'change') mediaListeners.add(listener)
      },
      removeEventListener: (event: string, listener: (event: MediaQueryListEvent) => void) => {
        if (event === 'change') mediaListeners.delete(listener)
      },
      addListener: (listener: (event: MediaQueryListEvent) => void) => mediaListeners.add(listener),
      removeListener: (listener: (event: MediaQueryListEvent) => void) => mediaListeners.delete(listener),
      dispatchEvent: () => true,
    })),
  })
}

function setCompactViewport(compact: boolean) {
  compactViewport = compact
  const event = {
    matches: compact,
    media: COMPACT_APP_LAYOUT_QUERY,
  } as MediaQueryListEvent
  act(() => mediaListeners.forEach((listener) => listener(event)))
}

describe('AppShell bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installMatchMedia(false)
    localStorage.removeItem('cybercode-sidebar-open')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    useSettingsStore.setState({
      fetchAll: vi.fn(async () => {}),
      locale: 'en',
    } as Partial<ReturnType<typeof useSettingsStore.getState>>)
    useTabStore.setState({
      tabs: [],
      activeTabId: null,
      recentSessionIds: [],
      restoreTabs: vi.fn(async () => {}),
    } as Partial<ReturnType<typeof useTabStore.getState>>)
    useChatStore.setState({
      sessions: {},
      ensureSessionReady: vi.fn(async () => {}),
    } as Partial<ReturnType<typeof useChatStore.getState>>)
    useSessionStore.setState({
      fetchSessions: vi.fn(async () => {}),
    } as Partial<ReturnType<typeof useSessionStore.getState>>)
    useUIStore.setState({
      sidebarOpen: true,
      settingsOpen: false,
      activeView: 'code',
      settingsPanelView: 'settings',
      railSettingsView: null,
      activeModal: null,
      toasts: [],
    })
    document.body.insertAdjacentHTML(
      'afterbegin',
      '<div id="boot-splash" class="boot-splash" data-testid="boot-splash"></div>',
    )
  })

  afterEach(() => {
    document.getElementById('boot-splash')?.remove()
    vi.restoreAllMocks()
  })

  it('continues into the app when startup settings load times out', async () => {
    vi.mocked(initializeDesktopServerUrl).mockResolvedValue('http://127.0.0.1:3456')
    const fetchAll = vi.fn(async () => {
      throw new Error('Request timed out after 30s')
    })
    useSettingsStore.setState({
      fetchAll,
    } as Partial<ReturnType<typeof useSettingsStore.getState>>)

    render(<AppShell />)

    expect(await screen.findByTestId('content-router')).toBeInTheDocument()
    expect(screen.getByTestId('chat-mode-sidebar')).toBeInTheDocument()
    expect(screen.queryByText('Local server failed to start')).not.toBeInTheDocument()
    await waitFor(() => expect(fetchAll).toHaveBeenCalled())
    expect(console.warn).toHaveBeenCalledWith(
      '[desktop] Failed to load startup settings:',
      expect.any(Error),
    )
  })

  it('keeps the right tool rail visible without an active conversation', async () => {
    vi.mocked(initializeDesktopServerUrl).mockResolvedValue('http://127.0.0.1:3456')
    useTabStore.setState({ tabs: [], activeTabId: null, recentSessionIds: [] })

    render(<AppShell />)

    expect(await screen.findByTestId('content-router')).toBeInTheDocument()
    expect(screen.getByTestId('chat-mode-sidebar')).toBeInTheDocument()
  })

  it('keeps the single boot splash until settings finish loading', async () => {
    vi.mocked(initializeDesktopServerUrl).mockResolvedValue('http://127.0.0.1:3456')
    let finishSettings!: () => void
    const pendingSettings = new Promise<void>((resolve) => {
      finishSettings = resolve
    })
    const fetchAll = vi.fn(() => pendingSettings)
    useSettingsStore.setState({
      fetchAll,
    } as Partial<ReturnType<typeof useSettingsStore.getState>>)

    render(<AppShell />)

    expect(screen.getByTestId('boot-splash')).toBeInTheDocument()
    expect(screen.queryByTestId('content-router')).not.toBeInTheDocument()
    await waitFor(() => expect(fetchAll).toHaveBeenCalledOnce())

    finishSettings()
    expect(await screen.findByTestId('content-router')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('boot-splash')).not.toBeInTheDocument())
  })

  it('keeps the startup splash visible while the restored session prepares', async () => {
    vi.mocked(initializeDesktopServerUrl).mockResolvedValue('http://127.0.0.1:3456')
    let finishHistory!: () => void
    const pendingHistory = new Promise<void>((resolve) => {
      finishHistory = resolve
    })
    const ensureSessionReady = vi.fn(() => pendingHistory)
    const restoreTabs = vi.fn(async () => {
      useTabStore.setState({
        tabs: [{
          sessionId: 'session-1',
          projectPath: '/workspace/project',
          title: 'Restored session',
          type: 'session',
          status: 'idle',
        }],
        activeTabId: 'session-1',
        recentSessionIds: ['session-1'],
      })
    })
    useTabStore.setState({ restoreTabs } as Partial<ReturnType<typeof useTabStore.getState>>)
    useChatStore.setState({
      ensureSessionReady,
    } as Partial<ReturnType<typeof useChatStore.getState>>)

    render(<AppShell />)

    await waitFor(() => {
      expect(ensureSessionReady).toHaveBeenCalledWith('session-1', '/workspace/project')
    })
    expect(screen.getByTestId('boot-splash')).toBeInTheDocument()
    expect(screen.queryByTestId('content-router')).not.toBeInTheDocument()

    finishHistory()
    expect(await screen.findByTestId('content-router')).toBeInTheDocument()
  })

  it('shows the startup error view when the local server cannot initialize', async () => {
    vi.mocked(initializeDesktopServerUrl).mockRejectedValue(new Error('sidecar missing'))

    render(<AppShell />)

    expect(await screen.findByText('Local server failed to start')).toBeInTheDocument()
    expect(screen.getByText('sidecar missing')).toBeInTheDocument()
  })

  it('uses a dismissible overlay sidebar when the viewport becomes compact', async () => {
    vi.mocked(initializeDesktopServerUrl).mockResolvedValue('http://127.0.0.1:3456')

    render(<AppShell />)

    expect(await screen.findByTestId('content-router')).toBeInTheDocument()
    const sidebarShell = screen.getByTestId('app-sidebar-shell')
    const settingsPanel = screen.getByTestId('settings-panel')
    expect(sidebarShell.closest('.compact-density-scope')).toBeInTheDocument()
    expect(sidebarShell).toHaveAttribute('data-state', 'open')
    expect(sidebarShell).toHaveClass('border-r')
    expect(sidebarShell).not.toHaveClass('border-r-0')
    expect(settingsPanel).toHaveAttribute('data-reserve-sidebar', 'true')

    setCompactViewport(true)

    await waitFor(() => expect(useUIStore.getState().sidebarOpen).toBe(false))
    expect(settingsPanel).toHaveAttribute('data-reserve-sidebar', 'false')
    expect(sidebarShell).toHaveAttribute('data-state', 'closed')
    expect(sidebarShell).toHaveClass('border-r-0')
    expect(sidebarShell).not.toHaveClass('border-r')

    act(() => useUIStore.getState().setSidebarOpen(true))
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toHaveClass('app-sidebar-backdrop')
    expect(sidebarShell).toHaveAttribute('data-state', 'open')
    expect(sidebarShell).toHaveClass('border-r')

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(useUIStore.getState().sidebarOpen).toBe(false)
    expect(screen.queryByRole('button', { name: 'Collapse sidebar' })).not.toBeInTheDocument()

    act(() => useUIStore.getState().setSidebarOpen(true))
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument()

    act(() => useUIStore.getState().openSettings('settings'))
    expect(useUIStore.getState().sidebarOpen).toBe(false)
    expect(screen.queryByRole('button', { name: 'Collapse sidebar' })).not.toBeInTheDocument()
  })
})
