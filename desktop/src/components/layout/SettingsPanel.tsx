import { useEffect, useState, memo, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  AboutSettings,
  AgentsSettings,
  GeneralSettings,
  MemorySettings,
  PermissionSettings,
  PluginSettings,
  ProviderSettings,
  Settings,
  SkillSettings,
} from '../../pages/Settings'
import { AdapterSettings } from '../../pages/AdapterSettings'
import { ComputerUseSettings } from '../../pages/ComputerUseSettings'
import { McpSettings } from '../../pages/McpSettings'
import { ScheduledTasks } from '../../pages/ScheduledTasks'
import { TerminalSettings } from '../../pages/TerminalSettings'
import { SSHSettings } from '../../pages/SSHSettings'
import { TokenOptimization } from '../../pages/TokenOptimization'
import { KnowledgeSpace } from '../../pages/KnowledgeSpace'
import { DataMigration } from '../../pages/DataMigration'
import { GitWorkspace } from '../../pages/GitWorkspace'
import { useUIStore, type SettingsPanelView } from '../../stores/uiStore'
import { useTranslation } from '../../i18n'
import { Icon } from '../shared/Icon'

const MemoSettings = memo(Settings)
const SIDEBAR_MOTION_FALLBACK_MS = 240

function getSidebarMotionDurationMs() {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--motion-sidebar-duration')
    .trim()
  const value = Number.parseFloat(raw)
  if (!Number.isFinite(value)) return SIDEBAR_MOTION_FALLBACK_MS
  return raw.endsWith('s') && !raw.endsWith('ms') ? value * 1000 : value
}

type Props = {
  visible: boolean
  reserveRightRail?: boolean
  reserveSidebar?: boolean
}

export function SettingsPanel({
  visible,
  reserveRightRail = false,
  reserveSidebar = false,
}: Props) {
  const closeSettings = useUIStore((s) => s.closeSettings)
  const panelView = useUIStore((s) => s.settingsPanelView)
  const t = useTranslation()
  const [rendered, setRendered] = useState(visible)
  const [renderedPanelView, setRenderedPanelView] = useState(panelView)
  const [providerClosing, setProviderClosing] = useState(false)

  useEffect(() => {
    if (visible) {
      setRendered(true)
      setRenderedPanelView(panelView)
      setProviderClosing(false)
      return
    }

    if (!rendered) return
    if (renderedPanelView !== 'providers') {
      setRendered(false)
      setProviderClosing(false)
      return
    }

    setProviderClosing(true)
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const timer = window.setTimeout(() => {
      setRendered(false)
      setProviderClosing(false)
    }, reduceMotion ? 0 : getSidebarMotionDurationMs())
    return () => window.clearTimeout(timer)
  }, [panelView, rendered, renderedPanelView, visible])

  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Defer to any open modal dialog so ESC closes the modal first
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
      closeSettings()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, closeSettings])

  if (!visible && !rendered) return null
  const displayedPanelView = visible ? panelView : renderedPanelView
  const isSettingsHome = displayedPanelView === 'settings'
  const isKnowledgeSpace = displayedPanelView === 'codeGraph'
  const isProviderWorkspace = displayedPanelView === 'providers'
  const isGitWorkspace = displayedPanelView === 'git'

  return createPortal(
    <section
      role="region"
      aria-label={getPanelLabel(displayedPanelView, t)}
      data-testid="settings-panel"
      data-layout={isProviderWorkspace ? 'drawer' : isGitWorkspace ? 'workspace-drawer' : 'floating'}
      data-state={providerClosing ? 'closing' : 'open'}
      data-reserve-right-rail={reserveRightRail ? 'true' : 'false'}
      data-reserve-sidebar={reserveSidebar ? 'true' : 'false'}
      className={isProviderWorkspace
        ? `compact-density-scope settings-provider-shell settings-ui native-ui-text fixed bottom-0 top-0 z-[100] flex overflow-hidden ${reserveRightRail ? 'right-[var(--chat-mode-sidebar-width)]' : 'right-0'}`
        : isGitWorkspace
          ? `compact-density-scope git-workspace-shell settings-ui native-ui-text fixed bottom-0 top-0 z-[94] flex overflow-hidden ${reserveRightRail ? 'right-[var(--chat-mode-sidebar-width)]' : 'right-0'}`
        : `compact-density-scope settings-ui settings-panel-overlay native-ui-text fixed bottom-0 top-0 z-[90] flex flex-col items-center justify-center bg-black/10 p-[16px] dark:bg-black/45 ${reserveSidebar ? 'settings-panel-overlay--reserve-sidebar' : ''} ${reserveRightRail ? 'settings-panel-overlay--reserve-right-rail' : ''}`}
    >
      <div
        data-testid="settings-panel-card"
        className={isProviderWorkspace
          ? `settings-provider-drawer flex h-full w-full max-w-none flex-col overflow-hidden bg-[var(--color-background)] ${providerClosing ? 'settings-provider-drawer--closing' : ''}`
          : isGitWorkspace
            ? 'git-workspace-drawer flex h-full w-full flex-col overflow-hidden border-l border-[var(--color-border-separator)] bg-[var(--color-background)] shadow-[var(--shadow-window)]'
          : `settings-panel-card flex w-full flex-col overflow-hidden rounded-[14px] border border-[var(--color-border-separator)] bg-[var(--color-background)] shadow-[var(--shadow-window)] ${isKnowledgeSpace ? 'h-[92vh] max-w-[1480px]' : 'h-[88vh] max-w-[1100px]'}`}
      >
        <div className="min-h-0 flex-1 flex flex-col overflow-hidden">
          {isGitWorkspace ? (
            <PanelBody key={displayedPanelView} view={displayedPanelView}>
              <GitWorkspace />
            </PanelBody>
          ) : isSettingsHome ? (
            <div key="settings-home" className="settings-panel-content min-h-0 flex flex-1 flex-col overflow-hidden">
              <MemoSettings />
            </div>
          ) : (
            <>
              <PanelHeader
                compact={isKnowledgeSpace}
                drawer={isProviderWorkspace}
                onClose={closeSettings}
              />
              <PanelBody key={displayedPanelView} view={displayedPanelView}>
                {renderPanelContent(displayedPanelView)}
              </PanelBody>
            </>
          )}
        </div>
      </div>
    </section>,
    document.body,
  )
}

function PanelHeader({
  compact = false,
  drawer = false,
  onClose,
}: {
  compact?: boolean
  drawer?: boolean
  onClose: () => void
}) {
  const t = useTranslation()
  const actionLabel = drawer ? t('common.back') : t('common.close')

  return (
    <header
      data-testid={drawer ? 'provider-drawer-drag-region' : undefined}
      {...(drawer ? { 'data-tauri-drag-region': true } : {})}
      className={`settings-panel-header flex shrink-0 items-center justify-end bg-[var(--color-background)] px-[16px] ${compact ? 'h-[48px]' : 'h-[52px] md:px-[32px]'}`}
    >
      <button
        onMouseDown={(event) => event.stopPropagation()}
        onClick={onClose}
        className="flex h-[36px] w-[36px] items-center justify-center rounded-full text-[var(--color-text-secondary)] transition-colors duration-100 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
        aria-label={actionLabel}
        title={drawer ? actionLabel : 'Esc'}
      >
        <Icon name={drawer ? 'arrow_back' : 'close'} size={drawer ? 20 : 18} />
      </button>
    </header>
  )
}

function PanelBody({ view, children }: { view: SettingsPanelView; children: ReactNode }) {
  if (view === 'codeGraph' || view === 'git') {
    return (
      <div className="settings-panel-body settings-panel-content min-h-0 flex flex-1 overflow-hidden bg-[var(--color-background)]">
        {children}
      </div>
    )
  }

  if (view === 'terminal' || view === 'scheduled' || view === 'ssh') {
    return (
      <div className="settings-panel-body settings-panel-content min-h-0 flex-1 flex flex-col overflow-hidden bg-[var(--color-background)] pt-[10px]">
        {children}
      </div>
    )
  }

  return (
    <div className={`settings-panel-body settings-panel-body--padded settings-panel-content min-h-0 flex-1 overflow-y-auto bg-[var(--color-background)] px-[24px] pb-[24px] pt-[18px] md:px-[32px] ${view === 'providers' ? 'lg:px-[40px] lg:pb-[32px]' : ''}`}>
      {children}
    </div>
  )
}

function renderPanelContent(view: SettingsPanelView): ReactNode {
  switch (view) {
    case 'providers':
      return <ProviderSettings />
    case 'permissions':
      return <PermissionSettings />
    case 'general':
      return <GeneralSettings />
    case 'adapters':
      return <AdapterSettings />
    case 'terminal':
      return <TerminalSettings active workspace />
    case 'ssh':
      return <SSHSettings />
    case 'mcp':
      return <McpSettings />
    case 'agents':
      return <AgentsSettings />
    case 'memory':
      return <MemorySettings />
    case 'skills':
      return <SkillSettings />
    case 'plugins':
      return <PluginSettings />
    case 'computerUse':
      return <ComputerUseSettings />
    case 'about':
      return <AboutSettings />
    case 'scheduled':
      return <ScheduledTasks />
    case 'tokenOptimization':
      return <TokenOptimization />
    case 'codeGraph':
      return <KnowledgeSpace />
    case 'git':
      return <GitWorkspace />
    case 'agentMigration':
      return <DataMigration />
    case 'usbMigration':
      return <DataMigration initialTab="usb" />
    case 'settings':
    default:
      return <MemoSettings />
  }
}

function getPanelLabel(view: SettingsPanelView, t: ReturnType<typeof useTranslation>) {
  if (view === 'settings') return t('sidebar.settings')
  if (view === 'scheduled') return t('sidebar.scheduled')
  if (view === 'tokenOptimization') return t('tokenOptimization.title')
  if (view === 'codeGraph') return t('knowledgeSpace.title')
  if (view === 'git') return t('git.title')
  if (view === 'agentMigration' || view === 'usbMigration') return t('dataMigration.title')
  return t(`settings.tab.${view}` as never)
}
