import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  clearModelsDevCatalogCache,
  discoverModelsDevModels,
  getModelsDevProviderId,
  hasModelsDevCatalog,
  peekModelsDevModels,
} from '../services/modelsDevCatalog.js'

describe('models.dev catalog', () => {
  beforeEach(() => {
    clearModelsDevCatalogCache()
  })

  afterEach(() => {
    clearModelsDevCatalogCache()
  })

  test('maps presets and keeps usable models in release-date order', async () => {
    const requestedUrls: string[] = []
    const fetchImpl = (async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input))
      return Response.json({
        openai: {
          models: {
            'gpt-older-99': {
              id: 'gpt-older-99',
              name: 'GPT Older',
              tool_call: true,
              release_date: '2025-01-01',
              last_updated: '2025-01-02',
              modalities: {
                input: ['text'],
                output: ['text'],
              },
              limit: { context: 128_000 },
            },
            'gpt-newer-1': {
              id: 'gpt-newer-1',
              name: 'GPT Newer',
              tool_call: true,
              release_date: '2026-07-20',
              last_updated: '2026-07-21',
              modalities: {
                input: ['text', 'image'],
                output: ['text'],
              },
              limit: { context: 1_050_000 },
            },
            deprecated: {
              id: 'deprecated',
              status: 'deprecated',
              tool_call: true,
              modalities: { output: ['text'] },
            },
            'no-tools': {
              id: 'no-tools',
              tool_call: false,
              modalities: { output: ['text'] },
            },
            'image-output-only': {
              id: 'image-output-only',
              tool_call: true,
              modalities: { output: ['image'] },
            },
          },
        },
      })
    }) as typeof fetch

    const result = await discoverModelsDevModels('openai', {
      fetchImpl,
      force: true,
    })

    expect(requestedUrls).toEqual(['https://models.dev/api.json'])
    expect(result?.endpoint).toBe('https://models.dev/api.json#openai')
    expect(result?.models).toEqual([
      {
        id: 'gpt-newer-1',
        label: 'GPT Newer',
        contextWindow: 1_050_000,
        supportsImages: true,
      },
      {
        id: 'gpt-older-99',
        label: 'GPT Older',
        contextWindow: 128_000,
        supportsImages: false,
      },
    ])
    expect(peekModelsDevModels('openai')).toEqual(result?.models)
    expect(getModelsDevProviderId('gemini-cli-oauth')).toBe('google')
    expect(hasModelsDevCatalog('deepseek')).toBe(true)
    expect(hasModelsDevCatalog('custom')).toBe(false)
  })
})
