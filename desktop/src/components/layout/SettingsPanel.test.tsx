import { act, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsPanel } from './SettingsPanel'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUIStore } from '../../stores/uiStore'

vi.mock('../../pages/Settings', () => ({
  Settings: () => <div data-testid="settings-home" />,
  ProviderSettings: () => <div data-testid="providers-panel" />,
  PermissionSettings: () => <div data-testid="permissions-panel" />,
  GeneralSettings: () => <div data-testid="general-panel" />,
  MemorySettings: () => <div data-testid="memory-panel" />,
  SkillSettings: () => <div data-testid="skills-panel" />,
  PluginSettings: () => <div data-testid="plugins-panel" />,
  AgentsSettings: () => <div data-testid="agents-panel" />,
  AboutSettings: () => <div data-testid="about-panel" />,
}))

vi.mock('../../pages/AdapterSettings', () => ({
  AdapterSettings: () => <div data-testid="adapters-panel" />,
}))

vi.mock('../../pages/ComputerUseSettings', () => ({
  ComputerUseSettings: () => <div data-testid="computer-use-panel" />,
}))

vi.mock('../../pages/McpSettings', () => ({
  McpSettings: () => <div data-testid="mcp-panel" />,
}))

vi.mock('../../pages/ScheduledTasks', () => ({
  ScheduledTasks: () => <div data-testid="scheduled-panel" />,
}))

vi.mock('../../pages/TerminalSettings', () => ({
  TerminalSettings: ({ active, workspace }: { active: boolean; workspace: boolean }) => (
    <div data-active={String(active)} data-workspace={String(workspace)} data-testid="terminal-panel" />
  ),
}))

vi.mock('../../pages/TokenOptimization', () => ({
  TokenOptimization: ({ initialView = 'overview' }: { initialView?: string }) => (
    <div data-initial-view={initialView} data-testid="token-optimization-panel" />
  ),
}))

vi.mock('../../pages/KnowledgeSpace', () => ({
  KnowledgeSpace: () => <div data-testid="knowledge-space-panel" />,
}))

vi.mock('../../pages/GitWorkspace', () => ({
  GitWorkspace: () => <div data-testid="git-workspace-panel" />,
}))

vi.mock('../../pages/DataMigration', () => ({
  DataMigration: ({ initialTab = 'agent' }: { initialTab?: string }) => (
    <div data-initial-tab={initialTab} data-testid="data-migration-panel" />
  ),
}))

describe('SettingsPanel content routing', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'zh' })
    useUIStore.setState({
      settingsOpen: true,
      settingsPanelView: 'settings',
      pendingSettingsTab: null,
      railSettingsView: null,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the normal settings home for the settings button', () => {
    const { container } = render(<SettingsPanel visible />)

    expect(screen.getByTestId('settings-home')).toBeInTheDocument()
    const panel = screen.getByTestId('settings-panel')
    expect(container.contains(panel)).toBe(false)
    expect(document.body.contains(panel)).toBe(true)
    expect(panel).toHaveClass('settings-panel-overlay', 'fixed', 'z-[90]')
    expect(panel).toHaveAttribute('data-reserve-sidebar', 'false')
    expect(panel).toHaveAttribute('data-reserve-right-rail', 'false')
  })

  it('keeps the chat-side rail clickable when opened from a project session', () => {
    render(<SettingsPanel visible reserveRightRail />)

    expect(screen.getByTestId('settings-panel')).toHaveClass('settings-panel-overlay--reserve-right-rail')
    expect(screen.getByTestId('settings-panel')).toHaveAttribute('data-reserve-right-rail', 'true')
  })

  it('centers floating panels inside the workspace when the sidebar is visible', () => {
    render(<SettingsPanel visible reserveSidebar reserveRightRail />)

    const panel = screen.getByTestId('settings-panel')
    expect(panel).toHaveClass(
      'settings-panel-overlay--reserve-sidebar',
      'settings-panel-overlay--reserve-right-rail',
    )
    expect(panel).toHaveAttribute('data-reserve-sidebar', 'true')
  })

  it('renders scheduled tasks inside the same floating panel shell', () => {
    useUIStore.setState({ settingsPanelView: 'scheduled' })

    render(<SettingsPanel visible />)

    expect(screen.getByTestId('settings-panel')).toHaveAttribute('aria-label', '定时任务')
    expect(screen.getByTestId('scheduled-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('settings-home')).not.toBeInTheDocument()
  })

  it('renders terminal as an active workspace panel', () => {
    useUIStore.setState({ settingsPanelView: 'terminal' })

    render(<SettingsPanel visible />)

    expect(screen.getByTestId('terminal-panel')).toHaveAttribute('data-active', 'true')
    expect(screen.getByTestId('terminal-panel')).toHaveAttribute('data-workspace', 'true')
  })

  it('closes direct panels from the shared close button', () => {
    useUIStore.setState({ settingsPanelView: 'providers' })

    render(<SettingsPanel visible />)
    fireEvent.click(screen.getByRole('button', { name: '返回' }))

    expect(useUIStore.getState().settingsOpen).toBe(false)
  })

  it('opens model settings as a full application drawer from the icon rail', () => {
    useUIStore.setState({ settingsPanelView: 'providers' })

    render(<SettingsPanel visible reserveRightRail />)

    const panel = screen.getByTestId('settings-panel')
    const card = screen.getByTestId('settings-panel-card')
    expect(panel).toHaveAttribute('data-layout', 'drawer')
    expect(panel).toHaveClass(
      'settings-provider-shell',
      'fixed',
      'right-[var(--chat-mode-sidebar-width)]',
      'z-[100]',
      'overflow-hidden',
    )
    expect(panel).not.toHaveClass('right-0')
    expect(panel).not.toHaveClass('p-[16px]', 'bg-black/10', 'bg-[var(--color-background)]')
    expect(card).toHaveClass('settings-provider-drawer', 'h-full', 'w-full', 'max-w-none')
    expect(card).not.toHaveClass('h-[88vh]', 'max-w-[1100px]', 'rounded-[14px]')
    expect(screen.getByTestId('providers-panel').parentElement).toHaveClass('lg:px-[40px]')
    expect(screen.getByTestId('provider-drawer-drag-region')).toHaveAttribute('data-tauri-drag-region')
    expect(screen.getByRole('button', { name: '返回' }).querySelector('.codicon-arrow-left')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '返回' })).not.toHaveAttribute('data-tauri-drag-region')
    expect(screen.queryByRole('button', { name: '关闭' })).not.toBeInTheDocument()
  })

  it('keeps the provider drawer mounted while it slides back closed', () => {
    vi.useFakeTimers()
    useUIStore.setState({ settingsPanelView: 'providers' })

    const { rerender } = render(<SettingsPanel visible />)
    rerender(<SettingsPanel visible={false} />)

    expect(screen.getByTestId('settings-panel')).toHaveAttribute('data-state', 'closing')
    expect(screen.getByTestId('settings-panel-card')).toHaveClass('settings-provider-drawer--closing')

    act(() => vi.advanceTimersByTime(240))
    expect(screen.queryByTestId('settings-panel')).not.toBeInTheDocument()
  })

  it('renders prompt memory inside the shared floating panel', () => {
    useUIStore.setState({ settingsPanelView: 'memory' })

    render(<SettingsPanel visible />)

    expect(screen.getByTestId('settings-panel')).toHaveAttribute('aria-label', '记忆')
    expect(screen.getByTestId('memory-panel')).toBeInTheDocument()
  })

  it('renders token optimization inside the shared floating panel', () => {
    useUIStore.setState({ settingsPanelView: 'tokenOptimization' })

    render(<SettingsPanel visible />)

    expect(screen.getByTestId('settings-panel')).toHaveAttribute('aria-label', 'Token 优化')
    expect(screen.getByTestId('token-optimization-panel')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '关闭' }).closest('header')).toHaveClass('h-[52px]')
    expect(screen.getByTestId('token-optimization-panel').parentElement).toHaveClass('pt-[18px]')
  })

  it('routes both migration views into the unified migration page', () => {
    useUIStore.setState({ settingsPanelView: 'agentMigration' })

    const { rerender } = render(<SettingsPanel visible />)

    expect(screen.getByTestId('settings-panel')).toHaveAttribute('aria-label', '数据迁移')
    expect(screen.getByTestId('data-migration-panel')).toHaveAttribute('data-initial-tab', 'agent')

    act(() => {
      useUIStore.setState({ settingsPanelView: 'usbMigration' })
    })
    rerender(<SettingsPanel visible />)

    expect(screen.getByTestId('settings-panel')).toHaveAttribute('aria-label', '数据迁移')
    expect(screen.getByTestId('data-migration-panel')).toHaveAttribute('data-initial-tab', 'usb')
  })

  it('routes the Code Graph rail entry directly into graph view', () => {
    useUIStore.setState({ settingsPanelView: 'codeGraph' })

    render(<SettingsPanel visible />)

    expect(screen.getByTestId('settings-panel')).toHaveAttribute('aria-label', '知识空间')
    expect(screen.getByTestId('knowledge-space-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('token-optimization-panel')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '关闭' }).closest('header')).toHaveClass('h-[48px]')
    expect(screen.getByTestId('knowledge-space-panel').parentElement).not.toHaveClass('pt-[18px]')
  })

  it('opens source control as a right-side workspace drawer', () => {
    useUIStore.setState({ settingsPanelView: 'git' })

    render(<SettingsPanel visible reserveRightRail />)

    const panel = screen.getByTestId('settings-panel')
    const card = screen.getByTestId('settings-panel-card')
    expect(panel).toHaveAttribute('aria-label', '本地更改')
    expect(panel).toHaveAttribute('data-layout', 'workspace-drawer')
    expect(panel).toHaveClass('git-workspace-shell', 'fixed', 'right-[var(--chat-mode-sidebar-width)]', 'z-[94]')
    expect(panel).not.toHaveClass('settings-panel-overlay', 'bg-black/10')
    expect(card).toHaveClass('git-workspace-drawer', 'h-full')
    expect(screen.getByTestId('git-workspace-panel')).toBeInTheDocument()
  })
})
