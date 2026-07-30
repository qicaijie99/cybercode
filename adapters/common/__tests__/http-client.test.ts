import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { AdapterHttpClient } from '../http-client.js'

describe('AdapterHttpClient', () => {
  let client: AdapterHttpClient
  const originalFetch = globalThis.fetch
  const originalServerAuthToken = process.env.SERVER_AUTH_TOKEN

  beforeEach(() => {
    delete process.env.SERVER_AUTH_TOKEN
    client = new AdapterHttpClient('ws://127.0.0.1:3456')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalServerAuthToken === undefined) {
      delete process.env.SERVER_AUTH_TOKEN
    } else {
      process.env.SERVER_AUTH_TOKEN = originalServerAuthToken
    }
  })

  it('derives HTTP URL from WS URL', () => {
    expect(client.httpBaseUrl).toBe('http://127.0.0.1:3456')

    const secure = new AdapterHttpClient('wss://example.com:443')
    expect(secure.httpBaseUrl).toBe('https://example.com:443')
  })

  it('createSession calls POST /api/sessions', async () => {
    const mockSessionId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ sessionId: mockSessionId }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }))
    ) as any

    const sessionId = await client.createSession('/path/to/project')
    expect(sessionId).toBe(mockSessionId)

    const call = (globalThis.fetch as any).mock.calls[0]
    expect(call[0]).toBe('http://127.0.0.1:3456/api/sessions')
    const body = JSON.parse(call[1].body)
    expect(body.workDir).toBe('/path/to/project')
  })

  it('listRecentProjects calls GET /api/sessions/recent-projects', async () => {
    const mockProjects = [
      { projectName: 'my-app', realPath: '/home/user/my-app', sessionCount: 3 },
    ]
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ projects: mockProjects }), {
        headers: { 'Content-Type': 'application/json' },
      }))
    ) as any

    const projects = await client.listRecentProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0].projectName).toBe('my-app')
  })

  it('createSession throws on server error', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ error: 'BAD_REQUEST', message: 'workDir required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }))
    ) as any

    expect(client.createSession('')).rejects.toThrow()
  })

  it('getGitInfo calls GET /api/sessions/:id/git-info', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({
        branch: 'main',
        repoName: 'cybercode',
        workDir: '/repo/cybercode',
        changedFiles: 2,
      }), {
        headers: { 'Content-Type': 'application/json' },
      }))
    ) as any

    const gitInfo = await client.getGitInfo('session-123')
    expect(gitInfo.repoName).toBe('cybercode')
    expect((globalThis.fetch as any).mock.calls[0][0]).toBe(
      'http://127.0.0.1:3456/api/sessions/session-123/git-info',
    )
  })

  it('getTasksForSession calls GET /api/tasks/lists/:id', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({
        tasks: [
          { id: '1', subject: 'Fix bug', status: 'in_progress' },
          { id: '2', subject: 'Write docs', status: 'pending' },
        ],
      }), {
        headers: { 'Content-Type': 'application/json' },
      }))
    ) as any

    const tasks = await client.getTasksForSession('session-123')
    expect(tasks).toHaveLength(2)
    expect(tasks[0]?.status).toBe('in_progress')
    expect((globalThis.fetch as any).mock.calls[0][0]).toBe(
      'http://127.0.0.1:3456/api/tasks/lists/session-123',
    )
  })

  it('authenticates every HTTP helper with the desktop server token', async () => {
    process.env.SERVER_AUTH_TOKEN = ' desktop-secret '
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/sessions')) {
        return Promise.resolve(Response.json({ sessionId: 'session-123' }, { status: 201 }))
      }
      if (url.endsWith('/recent-projects')) {
        return Promise.resolve(Response.json({ projects: [] }))
      }
      if (url.endsWith('/git-info')) {
        return Promise.resolve(Response.json({
          branch: 'main',
          repoName: 'cybercode',
          workDir: '/repo/cybercode',
          changedFiles: 0,
        }))
      }
      return Promise.resolve(Response.json({ tasks: [] }))
    }) as any

    await client.createSession('/repo/cybercode')
    await client.listRecentProjects()
    await client.getGitInfo('session-123')
    await client.getTasksForSession('session-123')

    const calls = (globalThis.fetch as any).mock.calls
    expect(calls).toHaveLength(4)
    for (const call of calls) {
      expect(new Headers(call[1]?.headers).get('Authorization')).toBe('Bearer desktop-secret')
    }
  })

  it('does not add authorization when desktop server auth is disabled', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(Response.json({ projects: [] }))
    ) as any

    await client.listRecentProjects()

    const call = (globalThis.fetch as any).mock.calls[0]
    expect(new Headers(call[1]?.headers).get('Authorization')).toBeNull()
  })
})
