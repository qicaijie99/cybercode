import { describe, expect, it, vi } from 'vitest'
import { createReadThroughCache } from './readThroughCache'

describe('createReadThroughCache', () => {
  it('coalesces concurrent reads and reuses the fresh value', async () => {
    let resolveLoad: ((value: string) => void) | undefined
    const loader = vi.fn(() => new Promise<string>((resolve) => {
      resolveLoad = resolve
    }))
    const cache = createReadThroughCache(loader)

    const first = cache.read()
    const second = cache.read()

    expect(loader).toHaveBeenCalledTimes(1)
    resolveLoad?.('ready')
    await expect(Promise.all([first, second])).resolves.toEqual(['ready', 'ready'])
    await expect(cache.read()).resolves.toBe('ready')
    expect(loader).toHaveBeenCalledTimes(1)
    expect(cache.peek()).toBe('ready')
  })

  it('refreshes after invalidation or a forced read', async () => {
    const loader = vi.fn()
      .mockResolvedValueOnce('first')
      .mockResolvedValueOnce('second')
      .mockResolvedValueOnce('third')
    const cache = createReadThroughCache<string>(loader)

    await expect(cache.read()).resolves.toBe('first')
    cache.invalidate()
    await expect(cache.read()).resolves.toBe('second')
    await expect(cache.read({ force: true })).resolves.toBe('third')

    expect(loader).toHaveBeenCalledTimes(3)
    expect(cache.peek()).toBe('third')
  })

  it('keeps a primed value available without loading', async () => {
    const loader = vi.fn().mockResolvedValue('network')
    const cache = createReadThroughCache<string>(loader)

    cache.prime('preloaded')

    await expect(cache.read()).resolves.toBe('preloaded')
    expect(loader).not.toHaveBeenCalled()
  })
})
