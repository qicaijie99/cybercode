import { fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '../../stores/settingsStore'
import { PermissionModeSelector } from './PermissionModeSelector'

describe('PermissionModeSelector responsive surfaces', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      locale: 'en',
      permissionMode: 'default',
    })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 })
  })

  it('keeps the options and bypass confirmation inside the viewport', () => {
    const onChange = vi.fn()
    const { container } = render(
      <PermissionModeSelector
        value="default"
        onChange={onChange}
        workDir="/workspace/project"
        variant="icon"
      />,
    )

    const trigger = container.querySelector('button')
    expect(trigger).not.toBeNull()
    vi.spyOn(trigger!, 'getBoundingClientRect').mockReturnValue({
      x: 320,
      y: 250,
      top: 250,
      right: 354,
      bottom: 284,
      left: 320,
      width: 34,
      height: 34,
      toJSON: () => ({}),
    })

    fireEvent.click(trigger!)

    const options = screen.getByTestId('permission-mode-options')
    const menu = options.parentElement
    expect(menu).toHaveStyle({
      left: '28px',
      width: '320px',
      maxHeight: '228px',
      bottom: '60px',
    })

    const optionButtons = within(options).getAllByRole('button')
    fireEvent.click(optionButtons[optionButtons.length - 1]!)

    const dialog = screen.getByRole('dialog', { name: 'Enable bypass permissions?' })
    expect(dialog.parentElement).toHaveClass('viewport-overlay', 'z-[10000]')
    expect(dialog.parentElement).not.toHaveClass('pl-[var(--sidebar-width)]')
    expect(dialog).toHaveClass(
      'viewport-overlay-surface',
      'w-full',
      'max-w-[420px]',
      'max-h-[calc(100dvh-24px)]',
    )
  })
})
