import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dropdown } from './Dropdown'

const originalInnerWidth = window.innerWidth
const originalInnerHeight = window.innerHeight

describe('Dropdown viewport positioning', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 240 })
  })

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight })
  })

  it('portals and clamps a menu that opens near the bottom-right corner', () => {
    const onChange = vi.fn()
    const { container } = render(
      <Dropdown
        items={[
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
          { value: 'c', label: 'Gamma' },
        ]}
        value="a"
        onChange={onChange}
        trigger={<button type="button">Choose format</button>}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'Choose format' })
    const root = trigger.parentElement?.parentElement
    expect(root).not.toBeNull()
    vi.spyOn(root!, 'getBoundingClientRect').mockReturnValue({
      x: 300,
      y: 180,
      top: 180,
      right: 340,
      bottom: 220,
      left: 300,
      width: 40,
      height: 40,
      toJSON: () => ({}),
    })

    fireEvent.click(trigger)

    const menu = screen.getByRole('listbox')
    expect(container.contains(menu)).toBe(false)
    expect(document.body.contains(menu)).toBe(true)
    expect(menu).toHaveStyle({
      left: '28px',
      width: '320px',
      maxHeight: '162px',
      bottom: '66px',
    })

    fireEvent.click(screen.getByRole('option', { name: 'Beta' }))
    expect(onChange).toHaveBeenCalledWith('b')
  })
})
