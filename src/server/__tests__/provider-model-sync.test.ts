import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { handleProvidersApi } from '../api/providers.js'
import { gatewayService } from '../gateway/gatewayService.js'
import { routingService } from '../routing/routingService.js'
import {
  syncProviderModels,
} from '../services/providerModelSyncService.js'
import {
  OAUTH_PROVIDER_RUNTIME_DEFINITIONS,
  providerOAuthService,
} from '../services/providerOAuthService.js'
import { ProviderService } from '../services/providerService.js'

let temporaryConfigDir = ''
let originalConfigDir: string | undefined
let originalFetch: typeof fetch

function request(method: string, pathname: string, body?: Record<string, unknown>) {
  const url = new URL(pathname, 'http://127.0.0.1:3456')
  const req = new Request(url, {
    method,
    ...(body && {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  })
  return {
    req,
    url,
    segments: url.pathname.split('/').filter(Boolean),
  }
}

describe('provider model synchronization', () => {
  beforeEach(async () => {
    temporaryConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-model-sync-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = temporaryConfigDir
    originalFetch = globalThis.fetch
    providerOAuthService.clearSessions()
  })

  afterEach(async () => {
    globalThis.fetch = originalFetch
    providerOAuthService.clearSessions()
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    await fs.rm(temporaryConfigDir, { recursive: true, force: true })
  })

  test('replaces only previously synchronized models and preserves manual entries', async () => {
    const service = new ProviderService()
    const provider = await service.addProvider({
      presetId: 'custom',
      name: 'Sync Provider',
      baseUrl: 'https://sync-models.example.com/v1',
      apiKey: 'sk-sync',
      apiFormat: 'openai_chat',
      models: {
        main: 'manual-model',
        haiku: 'manual-model',
        sonnet: 'manual-model',
        opus: 'manual-model',
      },
      modelCatalog: [
        { id: 'manual-model', label: 'My manual model' },
        { id: 'old-synced-model', contextWindow: 32_000 },
      ],
    })
    await service.updateProviderModelSync(provider.id, {
      modelCatalog: provider.modelCatalog,
      modelSync: {
        enabled: false,
        syncedModelIds: ['old-synced-model'],
      },
    })
    globalThis.fetch = (async () => Response.json({
      data: [
        { id: 'new-synced-model', context_window: 128_000 },
        { id: 'manual-model', context_window: 999_000 },
      ],
    })) as typeof fetch

    const result = await syncProviderModels(provider.id, { force: true })

    expect(result.added).toBe(1)
    expect(result.removed).toBe(1)
    expect(result.provider.modelCatalog).toEqual([
      { id: 'manual-model', label: 'My manual model' },
      { id: 'new-synced-model', contextWindow: 128_000 },
    ])
    expect(result.provider.modelSync?.syncedModelIds).toEqual(['new-synced-model'])
    expect(typeof result.provider.modelSync?.lastSyncedAt).toBe('string')
    expect(result.provider.modelSync?.lastSyncError).toBeUndefined()

    const dashboard = await routingService.getDashboard()
    expect(
      dashboard.sources
        .find((source) => source.providerId === provider.id)
        ?.models.map((model) => model.id),
    ).toEqual(['manual-model', 'new-synced-model'])
    const gatewayStatus = await gatewayService.getStatus()
    expect(
      gatewayStatus.targets
        .filter((target) => target.providerId === provider.id)
        .map((target) => target.modelId),
    ).toEqual(['manual-model', 'new-synced-model'])
  })

  test('keeps the last good catalog when a refresh fails', async () => {
    const service = new ProviderService()
    const provider = await service.addProvider({
      presetId: 'custom',
      name: 'Offline Provider',
      baseUrl: 'https://offline-models.example.com/v1',
      apiKey: 'sk-offline',
      apiFormat: 'openai_chat',
      models: {
        main: 'stable-model',
        haiku: 'stable-model',
        sonnet: 'stable-model',
        opus: 'stable-model',
      },
      modelCatalog: [{ id: 'stable-model', contextWindow: 64_000 }],
    })
    globalThis.fetch = (async () => new Response('offline', { status: 503 })) as typeof fetch

    await expect(syncProviderModels(provider.id, { force: true })).rejects.toThrow()

    const saved = await service.getProvider(provider.id)
    expect(saved.modelCatalog).toEqual([{ id: 'stable-model', contextWindow: 64_000 }])
    expect(saved.modelSync?.lastSyncError).toContain('HTTP 503')
  })

  test('enables automatic sync through the provider API and performs an initial refresh', async () => {
    const service = new ProviderService()
    const provider = await service.addProvider({
      presetId: 'custom',
      name: 'Auto Sync Provider',
      baseUrl: 'https://auto-sync.example.com/v1',
      apiKey: 'sk-auto',
      apiFormat: 'openai_chat',
      models: {
        main: 'auto-model',
        haiku: 'auto-model',
        sonnet: 'auto-model',
        opus: 'auto-model',
      },
    })
    globalThis.fetch = (async () => Response.json({
      data: [{ id: 'auto-model', context_window: 256_000 }],
    })) as typeof fetch
    const call = request(
      'PUT',
      `/api/providers/${provider.id}/models/auto-sync`,
      { enabled: true },
    )

    const response = await handleProvidersApi(call.req, call.url, call.segments)
    const body = await response.json() as {
      provider: {
        modelCatalog: Array<{ id: string }>
        modelSync: { enabled: boolean; supported: boolean }
      }
      result: { total: number }
    }

    expect(response.status).toBe(200)
    expect(body.provider.modelSync).toMatchObject({ enabled: true, supported: true })
    expect(body.provider.modelCatalog).toEqual([
      { id: 'auto-model', contextWindow: 256_000 },
    ])
    expect(body.result.total).toBe(1)
  })

  test('keeps Codex OAuth models current from the signed-in account catalog', async () => {
    const oauthDirectory = path.join(
      temporaryConfigDir,
      'cybercode',
      'provider-oauth',
    )
    await fs.mkdir(oauthDirectory, { recursive: true })
    await fs.writeFile(
      path.join(oauthDirectory, 'codex.json'),
      JSON.stringify({
        providerId: 'codex',
        accessToken: 'codex-access-token',
        refreshToken: null,
        idToken: null,
        expiresAt: Date.now() + 60 * 60 * 1000,
        scopes: ['openid'],
        accountLabel: 'developer@example.com',
        providerSpecificData: { workspaceId: 'workspace-123' },
      }),
    )

    const service = new ProviderService()
    const provider = await service.upsertOAuthProvider(
      'codex',
      OAUTH_PROVIDER_RUNTIME_DEFINITIONS.codex,
    )
    let requestedUrl = ''
    let requestedHeaders = new Headers()
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input)
      requestedHeaders = new Headers(init?.headers)
      return Response.json({
        models: [
          {
            slug: 'gpt-5.6-sol',
            display_name: 'GPT-5.6 Sol',
            context_window: 272_000,
            input_modalities: ['text', 'image'],
          },
          {
            slug: 'gpt-5.6-terra',
            display_name: 'GPT-5.6 Terra',
            context_window: 272_000,
            input_modalities: ['text', 'image'],
          },
          {
            slug: 'gpt-5.6-luna',
            display_name: 'GPT-5.6 Luna',
            context_window: 272_000,
            input_modalities: ['text', 'image'],
          },
        ],
      })
    }) as typeof fetch

    const result = await syncProviderModels(provider.id, { force: true })

    expect(requestedUrl).toContain(
      '/backend-api/codex/models?client_version=0.144.1',
    )
    expect(requestedHeaders.get('authorization')).toBe(
      'Bearer codex-access-token',
    )
    expect(requestedHeaders.get('chatgpt-account-id')).toBe('workspace-123')
    expect(result.provider.modelCatalog?.map((model) => model.id)).toEqual([
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
    ])
    expect(result.provider.modelSync).toMatchObject({
      enabled: true,
      syncedModelIds: [
        'gpt-5.6-sol',
        'gpt-5.6-terra',
        'gpt-5.6-luna',
      ],
    })
  })

  test('migrates only generated Codex defaults and preserves user-selected models', async () => {
    const providerDirectory = path.join(temporaryConfigDir, 'cybercode')
    await fs.mkdir(providerDirectory, { recursive: true })
    await fs.writeFile(
      path.join(providerDirectory, 'providers.json'),
      JSON.stringify({
        activeId: null,
        providers: [
          {
            id: 'legacy-codex',
            presetId: 'openai-codex',
            name: 'OpenAI Codex',
            apiKey: '',
            oauthProviderId: 'codex',
            baseUrl: 'https://chatgpt.com/backend-api/codex',
            apiFormat: 'openai_responses',
            models: {
              main: 'gpt-5.5',
              haiku: 'gpt-5.5-low',
              sonnet: 'gpt-5.5',
              opus: 'gpt-5.5-high',
            },
            modelContextWindows: {
              main: 400_000,
              haiku: 400_000,
              sonnet: 400_000,
              opus: 400_000,
            },
          },
          {
            id: 'custom-codex',
            presetId: 'openai-codex',
            name: 'My Codex',
            apiKey: '',
            oauthProviderId: 'codex',
            baseUrl: 'https://chatgpt.com/backend-api/codex',
            apiFormat: 'openai_responses',
            models: {
              main: 'gpt-5.4',
              haiku: 'gpt-5.4-mini',
              sonnet: 'gpt-5.4',
              opus: 'gpt-5.5',
            },
            modelContextWindows: {
              main: 333_000,
              haiku: 222_000,
              sonnet: 333_000,
              opus: 333_000,
            },
          },
          {
            id: 'openai-api',
            presetId: 'openai',
            name: 'OpenAI API',
            apiKey: 'sk-test',
            baseUrl: 'https://api.openai.com',
            apiFormat: 'openai_responses',
            models: {
              main: 'gpt-5.5',
              haiku: 'gpt-5.4-mini',
              sonnet: 'gpt-5.5',
              opus: 'gpt-5.5',
            },
          },
        ],
      }),
    )

    const { providers } = await new ProviderService().listProviders()
    const migrated = providers.find((provider) => provider.id === 'legacy-codex')
    const customized = providers.find((provider) => provider.id === 'custom-codex')
    const openaiApi = providers.find((provider) => provider.id === 'openai-api')

    expect(migrated?.models).toEqual({
      main: 'gpt-5.6-sol',
      haiku: 'gpt-5.6-luna',
      sonnet: 'gpt-5.6-terra',
      opus: 'gpt-5.6-sol',
    })
    expect(migrated?.modelContextWindows).toEqual({
      main: 272_000,
      haiku: 272_000,
      sonnet: 272_000,
      opus: 272_000,
    })
    expect(migrated?.modelSync?.enabled).toBe(true)
    expect(migrated?.modelCatalog?.[0]?.id).toBe('gpt-5.6-sol')

    expect(customized?.models).toEqual({
      main: 'gpt-5.4',
      haiku: 'gpt-5.4-mini',
      sonnet: 'gpt-5.4',
      opus: 'gpt-5.5',
    })
    expect(customized?.modelContextWindows).toEqual({
      main: 333_000,
      haiku: 222_000,
      sonnet: 333_000,
      opus: 333_000,
    })
    expect(openaiApi?.models.main).toBe('gpt-5.5')
    expect(openaiApi?.modelSync?.enabled).toBe(true)
  })

  test('enables generic catalog sync without overriding an existing opt-out or model choice', async () => {
    const providerDirectory = path.join(temporaryConfigDir, 'cybercode')
    await fs.mkdir(providerDirectory, { recursive: true })
    await fs.writeFile(
      path.join(providerDirectory, 'providers.json'),
      JSON.stringify({
        activeId: null,
        providers: [
          {
            id: 'legacy-deepseek',
            presetId: 'deepseek',
            name: 'DeepSeek',
            apiKey: 'deepseek-key',
            baseUrl: 'https://api.deepseek.com',
            apiFormat: 'openai_chat',
            models: {
              main: 'my-deepseek-model',
              haiku: 'my-fast-model',
              sonnet: 'my-deepseek-model',
              opus: 'my-deepseek-model',
            },
          },
          {
            id: 'google-opt-out',
            presetId: 'google',
            name: 'Google',
            apiKey: 'google-key',
            baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
            apiFormat: 'openai_chat',
            models: {
              main: 'my-gemini-model',
              haiku: 'my-gemini-model',
              sonnet: 'my-gemini-model',
              opus: 'my-gemini-model',
            },
            modelSync: {
              enabled: false,
              syncedModelIds: [],
            },
          },
        ],
      }),
    )

    const { providers } = await new ProviderService().listProviders()
    const deepseek = providers.find((provider) => provider.id === 'legacy-deepseek')
    const google = providers.find((provider) => provider.id === 'google-opt-out')

    expect(deepseek?.modelSync).toMatchObject({
      enabled: true,
      syncedModelIds: [],
    })
    expect(deepseek?.models.main).toBe('my-deepseek-model')
    expect(google?.modelSync).toMatchObject({
      enabled: false,
      syncedModelIds: [],
    })
    expect(google?.models.main).toBe('my-gemini-model')
  })
})
