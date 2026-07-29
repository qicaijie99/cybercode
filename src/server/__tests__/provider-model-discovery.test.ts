import { beforeEach, describe, expect, test } from 'bun:test'

import {
  clearProviderModelDiscoveryCache,
  discoverProviderModels,
} from '../services/providerModelDiscovery.js'

describe('provider model discovery', () => {
  beforeEach(() => {
    clearProviderModelDiscoveryCache()
  })

  test('discovers OpenAI-compatible model IDs and metadata', async () => {
    const urls: string[] = []
    const headers: Headers[] = []
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(input))
      headers.push(new Headers(init?.headers))
      return Response.json({
        data: [
          {
            id: 'vision-model',
            display_name: 'Vision Model',
            context_window: 262144,
            capabilities: ['tools', 'vision'],
          },
          { id: 'text-model' },
        ],
      })
    }) as typeof fetch

    const result = await discoverProviderModels({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'secret-key',
      apiFormat: 'openai_chat',
    }, { fetchImpl })

    expect(urls).toEqual(['https://api.example.com/v1/models'])
    expect(headers[0]?.get('authorization')).toBe('Bearer secret-key')
    expect(headers[0]?.has('x-api-key')).toBe(false)
    expect(result.models).toEqual([
      { id: 'text-model' },
      {
        id: 'vision-model',
        label: 'Vision Model',
        contextWindow: 262144,
        supportsImages: true,
      },
    ])
  })

  test('uses the GitHub Models catalog endpoint and reads its metadata', async () => {
    const urls: string[] = []
    const fetchImpl = (async (input: RequestInfo | URL) => {
      urls.push(String(input))
      return Response.json([{
        id: 'openai/gpt-4.1',
        name: 'OpenAI GPT-4.1',
        limits: { max_input_tokens: 1_048_576 },
        supported_input_modalities: ['text', 'image'],
      }])
    }) as typeof fetch

    const result = await discoverProviderModels({
      baseUrl: 'https://models.github.ai/inference',
      apiKey: 'github-token',
      apiFormat: 'openai_chat',
      presetId: 'github-models',
    }, { fetchImpl })

    expect(urls).toEqual(['https://models.github.ai/catalog/models'])
    expect(result.models).toEqual([{
      id: 'openai/gpt-4.1',
      label: 'OpenAI GPT-4.1',
      contextWindow: 1_048_576,
      supportsImages: true,
    }])
  })

  test('keeps Anthropic-compatible discovery credentials out of bearer auth', async () => {
    let headers = new Headers()
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      headers = new Headers(init?.headers)
      return Response.json({ data: [{ id: 'anthropic-compatible-model' }] })
    }) as typeof fetch

    await discoverProviderModels({
      baseUrl: 'https://anthropic.example.com',
      apiKey: 'anthropic-key',
      apiFormat: 'anthropic',
    }, { fetchImpl })

    expect(headers.get('x-api-key')).toBe('anthropic-key')
    expect(headers.has('authorization')).toBe(false)
    expect(headers.get('anthropic-version')).toBe('2023-06-01')
  })

  test('keeps OpenCode no-auth discovery limited to verified anonymous models', async () => {
    let headers = new Headers()
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      headers = new Headers(init?.headers)
      return Response.json({
        data: [
          { id: 'gpt-5.5' },
          { id: 'north-mini-code-free' },
          { id: 'mimo-v2.5-free' },
          { id: 'ling-3.0-flash-free' },
          { id: 'unverified-model-free' },
        ],
      })
    }) as typeof fetch

    const result = await discoverProviderModels({
      baseUrl: 'https://opencode.ai/zen/v1',
      apiFormat: 'openai_chat',
      presetId: 'opencode-free',
    }, { fetchImpl })

    expect(headers.has('authorization')).toBe(false)
    expect(result.models.map((model) => model.id)).toEqual([
      'ling-3.0-flash-free',
      'mimo-v2.5-free',
      'north-mini-code-free',
    ])
  })

  test('uses Ollama tags and show metadata without requiring an API key', async () => {
    const urls: string[] = []
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      urls.push(url)
      if (url.endsWith('/api/tags')) {
        return Response.json({ models: [{ name: 'qwen3.5:0.8b' }] })
      }
      return Response.json({
        capabilities: ['completion', 'tools', 'vision'],
        model_info: { 'qwen3.context_length': 131072 },
      })
    }) as typeof fetch

    const result = await discoverProviderModels({
      baseUrl: 'http://localhost:11434',
      apiFormat: 'anthropic',
      presetId: 'ollama',
    }, { fetchImpl })

    expect(urls).toEqual([
      'http://localhost:11434/api/tags',
      'http://localhost:11434/api/show',
    ])
    expect(result.models).toEqual([{
      id: 'qwen3.5:0.8b',
      contextWindow: 131072,
      supportsImages: true,
    }])
  })

  test('uses Ollama Cloud catalog endpoints with bearer authentication', async () => {
    const requests: Array<{ url: string; headers: Headers }> = []
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      requests.push({ url, headers: new Headers(init?.headers) })
      if (url.endsWith('/api/tags')) {
        return Response.json({ models: [{ name: 'glm-5.2' }] })
      }
      return Response.json({
        capabilities: ['completion', 'tools'],
        model_info: { 'glm.context_length': 1_000_000 },
      })
    }) as typeof fetch

    const result = await discoverProviderModels({
      baseUrl: 'https://ollama.com',
      apiKey: 'ollama-cloud-key',
      apiFormat: 'openai_chat',
      presetId: 'ollama-cloud',
    }, { fetchImpl })

    expect(requests.map((request) => request.url)).toEqual([
      'https://ollama.com/api/tags',
      'https://ollama.com/api/show',
    ])
    expect(requests.every(
      (request) => request.headers.get('authorization') === 'Bearer ollama-cloud-key',
    )).toBe(true)
    expect(result.models).toEqual([{
      id: 'glm-5.2',
      contextWindow: 1_000_000,
      supportsImages: false,
    }])
  })

  test('uses Cloudflare Workers AI model search for account-scoped endpoints', async () => {
    const urls: string[] = []
    const headers: Headers[] = []
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(input))
      headers.push(new Headers(init?.headers))
      return Response.json({
        result: [{
          id: '@cf/moonshotai/kimi-k2.7-code',
          name: 'Kimi K2.7 Code',
          max_input_tokens: 262_144,
          supported_input_modalities: ['text', 'image'],
        }],
      })
    }) as typeof fetch

    const accountId = '0123456789abcdef0123456789abcdef'
    const result = await discoverProviderModels({
      baseUrl: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`,
      apiKey: 'cloudflare-token',
      apiFormat: 'openai_chat',
      presetId: 'cloudflare-ai',
    }, { fetchImpl })

    expect(urls).toEqual([
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search?task=Text+Generation&per_page=100`,
    ])
    expect(headers[0]?.get('authorization')).toBe('Bearer cloudflare-token')
    expect(result.models).toEqual([{
      id: '@cf/moonshotai/kimi-k2.7-code',
      label: 'Kimi K2.7 Code',
      contextWindow: 262_144,
      supportsImages: true,
    }])
  })

  test('reads image support from common input modality metadata shapes', async () => {
    const fetchImpl = (async () => Response.json({
      data: [
        { id: 'array-vision', input_modalities: ['text', 'image'] },
        { id: 'camel-vision', inputModalities: ['text', 'input_image'] },
        { id: 'nested-vision', modalities: { input: ['text', 'vision'], output: ['text'] } },
        { id: 'explicit-text', capabilities: { completion_chat: true, vision: false } },
      ],
    })) as typeof fetch

    const result = await discoverProviderModels({
      baseUrl: 'https://api.example.com/v1',
      apiFormat: 'openai_chat',
    }, { fetchImpl })

    expect(result.models).toEqual([
      { id: 'array-vision', supportsImages: true },
      { id: 'camel-vision', supportsImages: true },
      { id: 'explicit-text', supportsImages: false },
      { id: 'nested-vision', supportsImages: true },
    ])
  })

  test('caches successful discovery briefly unless force refresh is requested', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return Response.json({ data: [{ id: `model-${calls}` }] })
    }) as typeof fetch
    const input = {
      baseUrl: 'https://cache.example.com',
      apiFormat: 'openai_responses' as const,
    }

    const first = await discoverProviderModels(input, { fetchImpl })
    const cached = await discoverProviderModels(input, { fetchImpl })
    const refreshed = await discoverProviderModels(input, { fetchImpl, force: true })

    expect(first.models[0]?.id).toBe('model-1')
    expect(cached.cached).toBe(true)
    expect(cached.models[0]?.id).toBe('model-1')
    expect(refreshed.models[0]?.id).toBe('model-2')
    expect(calls).toBe(2)
  })
})
