import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, expect, it, vi } from 'vitest'
import { ProviderCatalogCard } from './ProviderCatalogCard'

describe('ProviderCatalogCard action menu', () => {
  it('portals the action menu so settings scrolling cannot clip it', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 })
    const onSelect = vi.fn()
    const { container } = render(
      <ProviderCatalogCard
        name="Kimi"
        status="Configured"
        ariaLabel="Edit Kimi"
        onClick={vi.fn()}
        actionsLabel="More actions for Kimi"
        actions={[
          { id: 'edit', label: 'Edit', icon: 'edit', onSelect },
        ]}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'More actions for Kimi' })
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      x: 744,
      y: 552,
      top: 552,
      right: 774,
      bottom: 582,
      left: 744,
      width: 30,
      height: 30,
      toJSON: () => ({}),
    })

    fireEvent.click(trigger)

    const menu = screen.getByRole('menu', { name: 'More actions for Kimi' })
    expect(container.contains(menu)).toBe(false)
    expect(menu).toHaveStyle({
      left: '610px',
      width: '164px',
      bottom: '54px',
    })

    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })
})
