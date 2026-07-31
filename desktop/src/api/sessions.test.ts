import { afterEach, describe, expect, it, vi } from 'vitest'
import { sessionsApi } from './sessions'

describe('sessionsApi', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('limits local history requests to twelve seconds by default', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    vi.stubGlobal('fetch', fetchMock)

    const request = sessionsApi.getMessages('slow-session', { limit: 80 })
    const rejection = expect(request).rejects.toThrow('Request timed out after 12s')
    await vi.advanceTimersByTimeAsync(12_000)

    await rejection
  })

  it('loads the lightweight cumulative usage endpoint with the project locator', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ usage: null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await sessionsApi.getUsage('session-1', { projectPath: '/tmp/my project' })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3456/api/sessions/session-1/usage?projectPath=%2Ftmp%2Fmy%20project',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('coalesces concurrent session list requests with the same query', async () => {
    let resolveFetch: ((response: Response) => void) | undefined
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve
    }))
    vi.stubGlobal('fetch', fetchMock)

    const first = sessionsApi.list({ limit: 100 })
    const second = sessionsApi.list({ limit: 100 })

    expect(fetchMock).toHaveBeenCalledOnce()
    resolveFetch?.(new Response(JSON.stringify({ sessions: [], total: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await expect(Promise.all([first, second])).resolves.toEqual([
      { sessions: [], total: 0 },
      { sessions: [], total: 0 },
    ])

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ sessions: [], total: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    await sessionsApi.list({ limit: 100 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
