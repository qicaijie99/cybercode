import { describe, expect, test } from 'bun:test'
import {
  WEB_SESSION_PROVIDERS,
  getWebSessionPresetId,
  getWebSessionProvider,
  getWebSessionProviderIdFromPreset,
  getWebSessionProviderName,
  isWebSessionProviderId,
} from './webSessionProviders.js'

const EXPECTED_POPULARITY_ORDER = [
  'chatgpt-web',
  'claude-web',
  'gemini-web',
  'deepseek-web',
  'grok-web',
  'perplexity-web',
  'copilot-web',
  'kimi-web',
  'qwen-web',
  'yuanbao-web',
  'poe-web',
  'huggingchat',
  'muse-spark-web',
  'lmarena',
  't3-web',
  'blackbox-web',
  'v0-vercel-web',
  'doubao-web',
  'gemini-business',
  'copilot-m365-web',
  'zenmux-free',
  'adapta-web',
  'inner-ai',
  'venice-web',
] as const

describe('Web Cookie provider catalog', () => {
  test('keeps the 24 providers unique and in popularity order', () => {
    const ids = WEB_SESSION_PROVIDERS.map((provider) => provider.id)

    expect(ids).toEqual(EXPECTED_POPULARITY_ORDER)
    expect(new Set(ids).size).toBe(24)
    expect(WEB_SESSION_PROVIDERS).toHaveLength(24)
  })

  test('provides localized names for every supported locale', () => {
    for (const provider of WEB_SESSION_PROVIDERS) {
      for (const locale of ['en', 'zh', 'ja', 'ko'] as const) {
        expect(getWebSessionProviderName(provider, locale).trim()).not.toBe('')
      }
    }

    const qwen = getWebSessionProvider('qwen-web')!
    expect(getWebSessionProviderName(qwen, 'en')).toBe('Qwen Web')
    expect(getWebSessionProviderName(qwen, 'zh')).toBe('通义千问网页版')
    expect(getWebSessionProviderName(qwen, 'ja')).toBe('Qwen Web版')
    expect(getWebSessionProviderName(qwen, 'ko')).toBe('Qwen 웹')
  })

  test('round-trips only namespaced Web Cookie preset ids', () => {
    for (const provider of WEB_SESSION_PROVIDERS) {
      const presetId = getWebSessionPresetId(provider.id)
      expect(getWebSessionProviderIdFromPreset(presetId)).toBe(provider.id)
      expect(isWebSessionProviderId(provider.id)).toBe(true)
    }

    expect(getWebSessionProviderIdFromPreset('kimi')).toBeNull()
    expect(getWebSessionProviderIdFromPreset('kimi-code')).toBeNull()
    expect(getWebSessionProviderIdFromPreset('web-session:not-real')).toBeNull()
    expect(isWebSessionProviderId('not-real')).toBe(false)
  })

  test('defines a selectable default model and credential guidance for every provider', () => {
    for (const provider of WEB_SESSION_PROVIDERS) {
      expect(provider.models.some((model) => model.id === provider.defaultModel)).toBe(true)
      expect(provider.credentialName.trim()).not.toBe('')
      expect(provider.credentialPlaceholder.trim()).not.toBe('')
      expect(provider.website).toMatch(/^https:\/\//)
    }
  })
})
