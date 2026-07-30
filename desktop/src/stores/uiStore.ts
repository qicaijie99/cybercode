import { create } from 'zustand'
import type { ThemeMode } from '../types/settings'

const THEME_STORAGE_KEY = 'cybercode-theme'
const SIDEBAR_STORAGE_KEY = 'cybercode-sidebar-open'
export const COMPACT_APP_LAYOUT_QUERY = '(max-width: 1119px)'

function getStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch { /* localStorage unavailable */ }
  return 'light'
}

function getStoredSidebarPreference(): boolean {
  try {
    const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY)
    if (stored === 'true') return true
    if (stored === 'false') return false
  } catch { /* localStorage unavailable */ }
  return true
}

function persistSidebarPreference(open: boolean) {
  try { localStorage.setItem(SIDEBAR_STORAGE_KEY, String(open)) } catch { /* noop */ }
}

function isCompactAppLayout(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(COMPACT_APP_LAYOUT_QUERY).matches
}

export function applyTheme(theme: ThemeMode) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', theme)
  document.documentElement.style.colorScheme = theme
}

export function initializeTheme() {
  applyTheme(getStoredTheme())
}

export type Toast = {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  message: string
  duration?: number
}

export type SettingsTab =
  | 'providers'
  | 'permissions'
  | 'general'
  | 'adapters'
  | 'terminal'
  | 'mcp'
  | 'agents'
  | 'memory'
  | 'skills'
  | 'plugins'
  | 'computerUse'
  | 'about'

export type SettingsPanelView =
  | SettingsTab
  | 'settings'
  | 'scheduled'
  | 'tokenOptimization'
  | 'codeGraph'
  | 'git'
  | 'agentMigration'
  | 'usbMigration'

type ActiveView = 'code' | 'scheduled' | 'terminal' | 'history' | 'settings'

type UIStore = {
  theme: ThemeMode
  sidebarOpen: boolean
  activeView: ActiveView
  pendingSettingsTab: SettingsTab | null
  settingsOpen: boolean
  settingsPanelView: SettingsPanelView
  /** Which settings page is shown directly in the content area via the icon rail.
   * Deprecated: rail entries now open the shared floating settings panel. */
  railSettingsView: SettingsTab | null
  activeModal: string | null
  toasts: Toast[]

  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  syncSidebarForViewport: (compact: boolean) => void
  setActiveView: (view: ActiveView) => void
  setPendingSettingsTab: (tab: SettingsTab | null) => void
  openSettings: (view?: SettingsPanelView) => void
  closeSettings: () => void
  setRailSettingsView: (view: SettingsTab | null) => void
  openModal: (id: string) => void
  closeModal: () => void
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
}

let toastCounter = 0

export const useUIStore = create<UIStore>((set) => ({
  theme: getStoredTheme(),
  sidebarOpen: !isCompactAppLayout() && getStoredSidebarPreference(),
  activeView: 'code',
  pendingSettingsTab: null,
  settingsOpen: false,
  settingsPanelView: 'settings',
  railSettingsView: null,
  activeModal: null,
  toasts: [],

  setTheme: (theme) => {
    applyTheme(theme)
    try { localStorage.setItem(THEME_STORAGE_KEY, theme) } catch { /* noop */ }
    set({ theme })
  },

  toggleTheme: () => {
    set((state) => {
      const next = state.theme === 'light' ? 'dark' : 'light'
      applyTheme(next)
      try { localStorage.setItem(THEME_STORAGE_KEY, next) } catch { /* noop */ }
      return { theme: next }
    })
  },

  toggleSidebar: () => set((s) => {
    const open = !s.sidebarOpen
    persistSidebarPreference(open)
    return { sidebarOpen: open }
  }),
  setSidebarOpen: (open) => {
    persistSidebarPreference(open)
    set({ sidebarOpen: open })
  },
  syncSidebarForViewport: (compact) => set({
    sidebarOpen: compact ? false : getStoredSidebarPreference(),
  }),
  setActiveView: (view) => set({ activeView: view }),
  setPendingSettingsTab: (tab) => set({ pendingSettingsTab: tab }),
  openSettings: (view = 'settings') => set({
    settingsOpen: true,
    settingsPanelView: view,
    pendingSettingsTab:
      view !== 'settings'
      && view !== 'scheduled'
      && view !== 'tokenOptimization'
      && view !== 'codeGraph'
      && view !== 'git'
      && view !== 'agentMigration'
      && view !== 'usbMigration'
        ? view
        : null,
    railSettingsView: null,
    ...(isCompactAppLayout() ? { sidebarOpen: false } : {}),
  }),
  closeSettings: () => set({ settingsOpen: false }),
  setRailSettingsView: (view) => set(view
    ? {
        settingsOpen: true,
        settingsPanelView: view,
        pendingSettingsTab: view,
        railSettingsView: null,
        ...(isCompactAppLayout() ? { sidebarOpen: false } : {}),
      }
    : { settingsOpen: false, railSettingsView: null }),
  openModal: (id) => set({ activeModal: id }),
  closeModal: () => set({ activeModal: null }),

  addToast: (toast) => {
    const id = `toast-${++toastCounter}`
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }))
    // Auto-remove after duration
    const duration = toast.duration ?? 4000
    if (duration > 0) {
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
      }, duration)
    }
  },

  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))
