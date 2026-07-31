import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '../stores/settingsStore'
import { DataMigration } from './DataMigration'

vi.mock('./AgentMigration', () => ({
  AgentMigration: ({ embedded }: { embedded?: boolean }) => (
    <div data-embedded={String(embedded)} data-testid="agent-migration-content" />
  ),
}))

vi.mock('./UsbMigration', () => ({
  UsbMigration: ({ embedded }: { embedded?: boolean }) => (
    <div data-embedded={String(embedded)} data-testid="usb-migration-content" />
  ),
}))

describe('DataMigration', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'zh' })
  })

  it('keeps both migration workflows inside one tabbed page', () => {
    render(<DataMigration />)

    expect(screen.getByRole('heading', { name: '数据迁移' })).toBeInTheDocument()
    const agentTab = screen.getByRole('tab', { name: 'Agent 迁移' })
    const usbTab = screen.getByRole('tab', { name: 'U 盘便携迁移' })
    expect(agentTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('agent-migration-content')).toHaveAttribute('data-embedded', 'true')
    expect(screen.queryByTestId('usb-migration-content')).not.toBeInTheDocument()

    fireEvent.click(usbTab)

    expect(usbTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('usb-migration-content')).toHaveAttribute('data-embedded', 'true')
    expect(screen.getByTestId('agent-migration-tab-panel')).toHaveAttribute('hidden')

    fireEvent.click(agentTab)

    expect(agentTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('usb-migration-tab-panel')).toHaveAttribute('hidden')
    expect(screen.getByTestId('usb-migration-content')).toBeInTheDocument()
  })

  it('opens the unified page on the portable tab for legacy routes', () => {
    render(<DataMigration initialTab="usb" />)

    expect(screen.getByRole('tab', { name: 'U 盘便携迁移' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByTestId('usb-migration-content')).toBeInTheDocument()
    expect(screen.queryByTestId('agent-migration-content')).not.toBeInTheDocument()
  })

  it('syncs the selected tab when React reuses the page for a legacy route', () => {
    const { rerender } = render(<DataMigration />)

    expect(screen.getByRole('tab', { name: 'Agent 迁移' })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    rerender(<DataMigration initialTab="usb" />)

    expect(screen.getByRole('tab', { name: 'U 盘便携迁移' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByTestId('usb-migration-content')).toBeInTheDocument()
    expect(screen.getByTestId('agent-migration-tab-panel')).toHaveAttribute('hidden')
  })

  it('supports keyboard navigation between migration tabs', () => {
    render(<DataMigration />)

    const agentTab = screen.getByRole('tab', { name: 'Agent 迁移' })
    const usbTab = screen.getByRole('tab', { name: 'U 盘便携迁移' })
    agentTab.focus()

    fireEvent.keyDown(agentTab, { key: 'ArrowRight' })

    expect(usbTab).toHaveAttribute('aria-selected', 'true')
    expect(usbTab).toHaveFocus()

    fireEvent.keyDown(usbTab, { key: 'Home' })

    expect(agentTab).toHaveAttribute('aria-selected', 'true')
    expect(agentTab).toHaveFocus()
  })
})
