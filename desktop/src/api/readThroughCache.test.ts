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

  it('does not let an invalidated in-flight request overwrite a newer read', async () => {
    let resolveFirst: ((value: string) => void) | undefined
    let resolveSecond: ((value: string) => void) | undefined
    const loader = vi.fn()
      .mockImplementationOnce(() => new Promise<string>((resolve) => {
        resolveFirst = resolve
      }))
      .mockImplementationOnce(() => new Promise<string>((resolve) => {
        resolveSecond = resolve
      }))
    const cache = createReadThroughCache(loader)

    const staleRead = cache.read()
    cache.invalidate()
    const freshRead = cache.read()

    expect(loader).toHaveBeenCalledTimes(2)
    resolveSecond?.('fresh')
    await expect(freshRead).resolves.toBe('fresh')
    resolveFirst?.('stale')
    await expect(staleRead).resolves.toBe('stale')
    expect(cache.peek()).toBe('fresh')
  })

  it('does not let an in-flight request overwrite a primed mutation result', async () => {
    let resolveLoad: ((value: string) => void) | undefined
    const loader = vi.fn(() => new Promise<string>((resolve) => {
      resolveLoad = resolve
    }))
    const cache = createReadThroughCache(loader)

    const staleRead = cache.read()
    cache.prime('saved')
    resolveLoad?.('stale')

    await expect(staleRead).resolves.toBe('stale')
    await expect(cache.read()).resolves.toBe('saved')
    expect(cache.peek()).toBe('saved')
    expect(loader).toHaveBeenCalledTimes(1)
  })
})
