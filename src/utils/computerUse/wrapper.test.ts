import { describe, expect, test } from 'bun:test'
import type {
  CuPermissionRequest,
  CuPermissionResponse,
} from '../../vendor/computer-use-mcp/index.js'
import { runDesktopPermissionDialog } from './wrapper.js'

describe('Computer Use desktop approval bridge', () => {
  test('authenticates the approval request with the desktop server token', async () => {
    const expected: CuPermissionResponse = {
      granted: [],
      denied: [],
      flags: {
        clipboardRead: false,
        clipboardWrite: false,
        systemKeyCombos: false,
      },
    }
    let requestUrl = ''
    let requestInit: RequestInit | undefined
    const permissionRequest: CuPermissionRequest = {
      requestId: 'test-request',
      reason: 'Verify the desktop bridge',
      apps: [],
      requestedFlags: {},
      screenshotFiltering: 'native',
    }
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      requestUrl = String(input)
      requestInit = init
      return Response.json(expected)
    }) as typeof fetch

    const result = await runDesktopPermissionDialog(
      permissionRequest,
      new AbortController().signal,
      {
        serverUrl: 'http://127.0.0.1:3456',
        serverAuthToken: 'desktop-server-token',
        sessionId: 'test-session',
        fetchImpl,
      },
    )

    expect(requestUrl).toBe(
      'http://127.0.0.1:3456/api/computer-use/request-access',
    )
    expect(new Headers(requestInit?.headers).get('Authorization')).toBe(
      'Bearer desktop-server-token',
    )
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      sessionId: 'test-session',
      request: permissionRequest,
    })
    expect(result).toEqual(expected)
  })
})
