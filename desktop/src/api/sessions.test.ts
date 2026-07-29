import { afterEach, describe, expect, it, vi } from 'vitest'
import { sessionsApi } from './sessions'

describe('sessionsApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
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
