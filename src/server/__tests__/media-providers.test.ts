import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import {
  getMediaProvidersByKind,
} from '../../shared/mediaProviders.js'
import { handleMediaProvidersApi } from '../api/media-providers.js'
import { ProviderService } from '../services/providerService.js'

let tmpDir: string
let originalConfigDir: string | undefined
const originalFetch = globalThis.fetch

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-provider-test-'))
  originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = tmpDir
})

afterEach(async () => {
  globalThis.fetch = originalFetch
  if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function request(
  method: string,
  pathname: string,
  body?: Record<string, unknown>,
): Promise<Response> {
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
  return handleMediaProvidersApi(
    req,
    url,
    url.pathname.split('/').filter(Boolean),
  )
}

async function readStoredMediaProviders() {
  const raw = await fs.readFile(
    path.join(tmpDir, 'cybercode', 'media-providers.json'),
    'utf-8',
  )
  return JSON.parse(raw) as {
    credentials: Array<{
      groupId: string
      values: Record<string, string>
    }>
    selections: Array<{
      key: string
      modelId: string
    }>
  }
}

describe('Media providers API', () => {
  test('returns the complete catalog with Chinese video services first', async () => {
    const response = await request('GET', '/api/media-providers')
    const body = await response.json() as {
      total: number
      configured: number
      totalsByKind: Record<string, number>
      statuses: Array<Record<string, unknown>>
    }

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      total: 61,
      configured: 0,
      totalsByKind: {
        image: 26,
        video: 15,
        audio: 20,
      },
    })
    expect(body.statuses).toHaveLength(61)
    expect(getMediaProvidersByKind('video').slice(0, 5).map((provider) => provider.id))
      .toEqual([
        'kie',
        'volcengine-seedance',
        'minimax',
        'alibaba',
        'tencent-mps',
      ])
  })

  test('stores a media key once and reuses it across image, video, and audio', async () => {
    const secret = 'kie-secret-for-media-tests'
    const saveResponse = await request(
      'PUT',
      '/api/media-providers/video/kie',
      {
        credentials: { apiKey: secret },
        modelId: 'bytedance/seedance-2',
      },
    )
    const saveText = await saveResponse.text()

    expect(saveResponse.status).toBe(200)
    expect(saveText).not.toContain(secret)

    const stored = await readStoredMediaProviders()
    expect(stored.credentials).toEqual([
      expect.objectContaining({
        groupId: 'kie',
        values: { apiKey: secret },
      }),
    ])
    expect(stored.selections).toContainEqual(expect.objectContaining({
      key: 'video:kie',
      modelId: 'bytedance/seedance-2',
    }))

    const catalogResponse = await request('GET', '/api/media-providers')
    const catalogText = await catalogResponse.text()
    const catalog = JSON.parse(catalogText) as {
      configured: number
      statuses: Array<{
        key: string
        connected: boolean
        configured: boolean
        credentialSource: string
      }>
    }

    expect(catalogText).not.toContain(secret)
    expect(catalog.configured).toBe(3)
    for (const key of ['image:kie', 'video:kie', 'audio:kie']) {
      expect(catalog.statuses).toContainEqual(expect.objectContaining({
        key,
        connected: true,
        configured: true,
        credentialSource: 'media',
      }))
    }

    expect((await request('DELETE', '/api/media-providers/video/kie')).status).toBe(200)
    const disconnected = await (await request('GET', '/api/media-providers')).json() as {
      statuses: Array<{
        key: string
        connected: boolean
      }>
    }
    for (const key of ['image:kie', 'video:kie', 'audio:kie']) {
      expect(disconnected.statuses).toContainEqual(expect.objectContaining({
        key,
        connected: false,
      }))
    }
  })

  test('reuses an existing chat provider key without copying it into media storage', async () => {
    const providerService = new ProviderService()
    await providerService.addProvider({
      presetId: 'minimax',
      name: 'MiniMax',
      baseUrl: 'https://api.minimaxi.com/anthropic',
      apiKey: 'minimax-shared-key',
      models: {
        main: 'MiniMax-M2.7-highspeed',
        haiku: 'MiniMax-M2.7-highspeed',
        sonnet: 'MiniMax-M2.7-highspeed',
        opus: 'MiniMax-M2.7-highspeed',
      },
    })

    const response = await request('GET', '/api/media-providers')
    const body = await response.json() as {
      configured: number
      statuses: Array<Record<string, unknown>>
    }

    expect(response.status).toBe(200)
    expect(body.configured).toBe(2)
    expect(body.statuses).toContainEqual(expect.objectContaining({
      key: 'video:minimax',
      connected: true,
      configured: true,
      credentialSource: 'provider',
    }))
    expect(body.statuses).toContainEqual(expect.objectContaining({
      key: 'audio:minimax',
      connected: true,
      configured: true,
      credentialSource: 'provider',
    }))
    await expect(
      fs.access(path.join(tmpDir, 'cybercode', 'media-providers.json')),
    ).rejects.toThrow()
  })

  test('rejects unknown kinds, providers, credential fields, and model ids', async () => {
    expect((await request(
      'PUT',
      '/api/media-providers/document/kie',
      { credentials: { apiKey: 'secret' } },
    )).status).toBe(404)
    expect((await request(
      'PUT',
      '/api/media-providers/video/not-real',
      { credentials: { apiKey: 'secret' } },
    )).status).toBe(404)
    expect((await request(
      'PUT',
      '/api/media-providers/video/kie',
      {
        credentials: { unknownSecret: 'secret' },
        modelId: 'bytedance/seedance-2',
      },
    )).status).toBe(400)
    expect((await request(
      'PUT',
      '/api/media-providers/video/kie',
      {
        credentials: { apiKey: 'secret' },
        modelId: 'not-a-video-model',
      },
    )).status).toBe(400)
  })

  test('does not make a network request when the provider is unconfigured', async () => {
    let fetchCalls = 0
    globalThis.fetch = (async () => {
      fetchCalls += 1
      return new Response(null, { status: 200 })
    }) as typeof fetch

    const response = await request('POST', '/api/media-providers/video/kie/test')
    const body = await response.json() as {
      result: {
        success: boolean
        error?: string
      }
    }

    expect(response.status).toBe(200)
    expect(body.result).toMatchObject({
      success: false,
      error: 'Media provider is not configured',
    })
    expect(fetchCalls).toBe(0)
  })
})
