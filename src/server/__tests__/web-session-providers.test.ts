import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { handleWebSessionProvidersApi } from '../api/web-session-providers.js'
import { ProviderService } from '../services/providerService.js'

let tmpDir: string
let originalConfigDir: string | undefined

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'web-session-provider-test-'))
  originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = tmpDir
})

afterEach(async () => {
  if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function makeRequest(
  method: string,
  pathname: string,
  body?: Record<string, unknown>,
): { req: Request; url: URL; segments: string[] } {
  const url = new URL(pathname, 'http://localhost:3456')
  const req = new Request(url, {
    method,
    ...(body
      ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  })
  return {
    req,
    url,
    segments: url.pathname.split('/').filter(Boolean),
  }
}

async function request(
  method: string,
  pathname: string,
  body?: Record<string, unknown>,
): Promise<Response> {
  const input = makeRequest(method, pathname, body)
  return handleWebSessionProvidersApi(input.req, input.url, input.segments)
}

async function readStoredProviders() {
  const raw = await fs.readFile(
    path.join(tmpDir, 'cybercode', 'providers.json'),
    'utf-8',
  )
  return JSON.parse(raw) as {
    activeId: string | null
    providers: Array<{
      id: string
      presetId: string
      apiKey: string
      models: { main: string }
    }>
  }
}

describe('Web Cookie providers API', () => {
  test('returns the full empty catalog without credential fields', async () => {
    const response = await request('GET', '/api/web-session-providers')
    const body = await response.json() as {
      total: number
      configured: number
      statuses: Array<Record<string, unknown>>
    }

    expect(response.status).toBe(200)
    expect(body.total).toBe(24)
    expect(body.configured).toBe(0)
    expect(body.statuses).toHaveLength(24)
    expect(body.statuses[0]).toMatchObject({
      providerId: 'chatgpt-web',
      connected: false,
      active: false,
    })
    expect(JSON.stringify(body)).not.toContain('apiKey')
    expect(JSON.stringify(body)).not.toContain('credential')
  })

  test('stores, updates, activates, and removes a web session without returning its secret', async () => {
    const secret = 'kimi-auth=top-secret-session'
    const saveResponse = await request(
      'PUT',
      '/api/web-session-providers/kimi-web',
      { credential: secret, modelId: 'k2d6' },
    )
    const saveBody = await saveResponse.text()

    expect(saveResponse.status).toBe(200)
    expect(saveBody).not.toContain(secret)

    let stored = await readStoredProviders()
    expect(stored.providers).toHaveLength(1)
    expect(stored.providers[0]).toMatchObject({
      presetId: 'web-session:kimi-web',
      apiKey: secret,
      models: { main: 'k2d6' },
    })

    const updateResponse = await request(
      'PUT',
      '/api/web-session-providers/kimi-web',
      { modelId: 'k2d6-thinking' },
    )
    expect(updateResponse.status).toBe(200)
    stored = await readStoredProviders()
    expect(stored.providers[0]?.apiKey).toBe(secret)
    expect(stored.providers[0]?.models.main).toBe('k2d6-thinking')

    const activateResponse = await request(
      'POST',
      '/api/web-session-providers/kimi-web/activate',
    )
    expect(activateResponse.status).toBe(200)
    stored = await readStoredProviders()
    expect(stored.activeId).toBe(stored.providers[0]?.id)

    const catalogResponse = await request('GET', '/api/web-session-providers')
    const catalogText = await catalogResponse.text()
    expect(catalogText).not.toContain(secret)
    expect(JSON.parse(catalogText)).toMatchObject({
      total: 24,
      configured: 1,
    })
    expect(JSON.parse(catalogText).statuses).toContainEqual(expect.objectContaining({
      providerId: 'kimi-web',
      connected: true,
      active: true,
      modelId: 'k2d6-thinking',
    }))

    const deleteResponse = await request(
      'DELETE',
      '/api/web-session-providers/kimi-web',
    )
    expect(deleteResponse.status).toBe(200)
    stored = await readStoredProviders()
    expect(stored.activeId).toBeNull()
    expect(stored.providers).toEqual([])
  })

  test('rejects unknown providers and model ids', async () => {
    const unknownProvider = await request(
      'PUT',
      '/api/web-session-providers/not-real',
      { credential: 'secret', modelId: 'whatever' },
    )
    expect(unknownProvider.status).toBe(404)

    const unknownModel = await request(
      'PUT',
      '/api/web-session-providers/kimi-web',
      { credential: 'secret', modelId: 'not-a-kimi-model' },
    )
    expect(unknownModel.status).toBe(400)
  })

  test('persists a rotated session credential without resurrecting a removed provider', async () => {
    await request(
      'PUT',
      '/api/web-session-providers/chatgpt-web',
      {
        credential: '__Secure-next-auth.session-token=old-session',
        modelId: 'gpt-5.6-thinking',
      },
    )
    let stored = await readStoredProviders()
    const providerRecordId = stored.providers[0]!.id
    const providerService = new ProviderService()

    expect(await providerService.refreshWebSessionCredential(
      providerRecordId,
      '__Secure-next-auth.session-token=new-session',
    )).toBe(true)
    stored = await readStoredProviders()
    expect(stored.providers[0]?.apiKey).toBe(
      '__Secure-next-auth.session-token=new-session',
    )

    await request('DELETE', '/api/web-session-providers/chatgpt-web')
    expect(await providerService.refreshWebSessionCredential(
      providerRecordId,
      '__Secure-next-auth.session-token=stale-session',
    )).toBe(false)
    stored = await readStoredProviders()
    expect(stored.providers).toEqual([])
  })

  test('test-all finishes without network access when no session is configured', async () => {
    const response = await request('POST', '/api/web-session-providers/test-all')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ results: [] })
  })
})
