import { afterEach, describe, expect, it, vi } from 'vitest'
import { subscribeToViewportChanges } from './viewportEvents'

const originalVisualViewport = window.visualViewport

describe('subscribeToViewportChanges', () => {
  afterEach(() => {
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: originalVisualViewport,
    })
  })

  it('tracks both layout and visual viewport changes', () => {
    const addEventListener = vi.fn()
    const removeEventListener = vi.fn()
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: {
        addEventListener,
        removeEventListener,
      },
    })

    const listener = vi.fn()
    const unsubscribe = subscribeToViewportChanges(listener)

    expect(addEventListener).toHaveBeenCalledWith('resize', listener)
    expect(addEventListener).toHaveBeenCalledWith('scroll', listener)

    unsubscribe()

    expect(removeEventListener).toHaveBeenCalledWith('resize', listener)
    expect(removeEventListener).toHaveBeenCalledWith('scroll', listener)
  })
})
