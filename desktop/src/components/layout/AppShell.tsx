import { useEffect, useState } from 'react'
import { IconRail } from './IconRail'
import { Sidebar } from './Sidebar'
import { ContentRouter } from './ContentRouter'
import { ToastContainer } from '../shared/Toast'
import { useSettingsStore } from '../../stores/settingsStore'
import {
  COMPACT_APP_LAYOUT_QUERY,
  useUIStore,
  type SettingsTab,
} from '../../stores/uiStore'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import { initializeDesktopServerUrl } from '../../lib/desktopRuntime'
import { TabBar } from './TabBar'
import { StartupErrorView } from './StartupErrorView'
import { SettingsPanel } from './SettingsPanel'
import { findActiveTab, useTabStore } from '../../stores/tabStore'
import { useChatStore } from '../../stores/chatStore'
import { useSessionStore } from '../../stores/sessionStore'
import { ChatModeSidebar } from '../chat/ChatModeSidebar'
import { useTranslation } from '../../i18n'
import { preloadProviderWorkspace } from '../../services/providerWorkspacePreload'

const BOOT_SPLASH_REMOVE_DELAY_MS = 16

function dismissBootSplash() {
  const splash = document.getElementById('boot-splash')
  if (!splash) return () => {}

  splash.classList.add('boot-splash-exit')
  const remove = () => splash.remove()
  const timeout = window.setTimeout(remove, BOOT_SPLASH_REMOVE_DELAY_MS)

  return () => {
    window.clearTimeout(timeout)
  }
}

export function AppShell() {
  const fetchSettings = useSettingsStore((s) => s.fetchAll)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen)
  const syncSidebarForViewport = useUIStore((s) => s.syncSidebarForViewport)
  const settingsOpen = useUIStore((s) => s.settingsOpen)
  const closeSettings = useUIStore((s) => s.closeSettings)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const activeTabKey = useTabStore((s) => s.activeTabKey)
  const t = useTranslation()
  const [ready, setReady] = useState(false)
  const [startupError, setStartupError] = useState<string | null>(null)
  const [compactLayout, setCompactLayout] = useState(() => (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(COMPACT_APP_LAYOUT_QUERY).matches
  ))

  useEffect(() => {
    if (settingsOpen) closeSettings()
    if (compactLayout) useUIStore.setState({ sidebarOpen: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, activeTabKey])

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(COMPACT_APP_LAYOUT_QUERY)
    const update = (compact: boolean) => {
      setCompactLayout(compact)
      syncSidebarForViewport(compact)
    }
    const onChange = (event: MediaQueryListEvent) => update(event.matches)

    update(media.matches)
    media.addEventListener?.('change', onChange)
    return () => media.removeEventListener?.('change', onChange)
  }, [syncSidebarForViewport])

  useEffect(() => {
    let cancelled = false

    const loadStartupSessions = async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await useSessionStore.getState().fetchSessions()
        if (!useSessionStore.getState().error) return
        await new Promise((resolve) => setTimeout(resolve, 800))
      }
      console.warn('[desktop] Failed to load startup sessions:', useSessionStore.getState().error)
    }

    const bootstrap = async () => {
      try {
        await initializeDesktopServerUrl()
      } catch (error) {
        if (!cancelled) {
          setStartupError(error instanceof Error ? error.message : String(error))
        }
        return
      }

      // Warm the provider workspace as soon as the local server is ready.
      // This is intentionally not awaited, so startup stays responsive while
      // provider and agent-node data are usually ready before either view opens.
      void preloadProviderWorkspace().catch((error) => {
        console.warn('[desktop] Provider workspace preload failed:', error)
      })

      await Promise.all([
        fetchSettings().catch((error) => {
          console.warn('[desktop] Failed to load startup settings:', error)
        }),
        useTabStore.getState().restoreTabs().catch((error) => {
          console.warn('[desktop] Failed to restore startup tabs:', error)
        }),
        loadStartupSessions(),
      ])

      const { activeTabId: activeId, activeTabKey: activeKey, tabs } = useTabStore.getState()
      const activeTab = findActiveTab(tabs, activeKey, activeId)
      if (activeId && activeTab?.type === 'session') {
        try {
          await useChatStore.getState().ensureSessionReady(activeTab.sessionId, activeTab.projectPath)
        } catch (error) {
          console.warn('[desktop] Failed to prepare the startup session:', error)
        }
      }

      if (!cancelled) setReady(true)
    }

    void bootstrap()
    return () => { cancelled = true }
  }, [fetchSettings])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    import(/* @vite-ignore */ '@tauri-apps/api/event')
      .then(({ listen }) =>
        listen<string>('native-menu-navigate', (event) => {
          const target = event.payload as SettingsTab | 'settings'
          useUIStore.getState().openSettings(target === 'about' ? 'about' : undefined)
        }),
      )
      .then((fn) => { unlisten = fn })
      .catch(() => {})
    return () => { unlisten?.() }
  }, [])

  useEffect(() => {
    if (!ready && !startupError) return
    return dismissBootSplash()
  }, [ready, startupError])

  useKeyboardShortcuts()

  if (startupError) {
    return <StartupErrorView error={startupError} />
  }

  if (!ready) {
    return null
  }

  return (
    <div
      className="compact-density-scope flex h-screen w-screen overflow-hidden bg-transparent font-sans text-[var(--color-text-primary)]"
      data-compact-layout={compactLayout ? 'true' : 'false'}
    >
      <div className="relative flex h-full w-full overflow-hidden bg-transparent">
        <IconRail />
        {compactLayout && sidebarOpen && (
          <button
            type="button"
            className="app-sidebar-backdrop"
            aria-label={t('sidebar.collapse')}
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <div
          data-testid="app-sidebar-shell"
          data-state={sidebarOpen ? 'open' : 'closed'}
          className={`app-sidebar-shell relative z-20 flex h-full shrink-0 overflow-hidden bg-[var(--color-surface-sidebar)] transition-[width] duration-[var(--motion-sidebar-duration)] ease-[var(--motion-sidebar-easing)] ${sidebarOpen ? 'w-[var(--sidebar-width)] border-r border-[var(--color-border-separator)]' : 'w-0 border-r-0'}`}
        >
          <Sidebar />
        </div>
        <main
          id="content-area"
          className="relative z-10 flex min-w-0 w-0 flex-1 flex-col overflow-hidden bg-[var(--color-background)] transition-colors duration-150"
        >
          <TabBar />
          <ContentRouter />
        </main>
        <ChatModeSidebar label={t('chat.programmingMode')} ariaLabel={t('chat.sideRail')} />
        <SettingsPanel
          visible={settingsOpen}
          reserveRightRail
          reserveSidebar={sidebarOpen && !compactLayout}
        />
        <ToastContainer />
      </div>
    </div>
  )
}
