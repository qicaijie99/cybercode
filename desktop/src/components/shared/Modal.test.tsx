import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, expect, it, vi } from 'vitest'
import { Modal } from './Modal'

describe('Modal', () => {
  it('portals the dialog to body so the scrim covers the full app shell', () => {
    const onClose = vi.fn()
    const { container } = render(
      <div data-testid="stacking-parent" className="relative z-10">
        <Modal open onClose={onClose} title="Provider">
          <span>Provider form</span>
        </Modal>
      </div>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Provider' })

    expect(container.contains(dialog)).toBe(false)
    expect(document.body.contains(dialog)).toBe(true)
    expect(dialog.parentElement).toHaveClass('viewport-overlay', 'z-[10000]')
    expect(dialog).toHaveClass(
      'viewport-overlay-surface',
      'modal-dialog-surface',
      'max-h-[calc(100dvh-24px)]',
      'max-w-full',
      'min-[721px]:max-h-[85dvh]',
    )
    expect(dialog).toHaveStyle({ maxWidth: '100%' })
  })

  it('closes when the backdrop is clicked', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose}>
        <span>Provider form</span>
      </Modal>,
    )

    const backdrop = screen.getByRole('dialog').previousElementSibling
    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop!)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('consumes Escape so a parent panel does not close from the same key press', () => {
    const onClose = vi.fn()
    const onWindowKeyDown = vi.fn()
    window.addEventListener('keydown', onWindowKeyDown)
    render(
      <Modal open onClose={onClose} title="Preview">
        <span>Preview content</span>
      </Modal>,
    )

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onWindowKeyDown).not.toHaveBeenCalled()
    window.removeEventListener('keydown', onWindowKeyDown)
  })
})
