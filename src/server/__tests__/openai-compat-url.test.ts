import { describe, expect, test } from 'bun:test'

import { buildOpenAICompatibleUrl } from '../proxy/openaiCompatUrl.js'

describe('buildOpenAICompatibleUrl', () => {
  test('adds /v1 for provider roots', () => {
    expect(buildOpenAICompatibleUrl('https://api.openai.com', 'responses'))
      .toBe('https://api.openai.com/v1/responses')
    expect(buildOpenAICompatibleUrl('https://api.openai.com/', 'chat/completions'))
      .toBe('https://api.openai.com/v1/chat/completions')
  })

  test('does not duplicate /v1 for already-versioned OpenAI-compatible bases', () => {
    expect(buildOpenAICompatibleUrl('https://api.openai.com/v1', 'responses'))
      .toBe('https://api.openai.com/v1/responses')
    expect(buildOpenAICompatibleUrl('https://api.example.com/v1/', 'chat/completions'))
      .toBe('https://api.example.com/v1/chat/completions')
  })

  test('supports Gemini OpenAI compatibility base URLs', () => {
    expect(buildOpenAICompatibleUrl(
      'https://generativelanguage.googleapis.com/v1beta/openai',
      'chat/completions',
    )).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')
  })

  test('supports GitHub Models inference without inventing a /v1 segment', () => {
    expect(buildOpenAICompatibleUrl(
      'https://models.github.ai/inference',
      'chat/completions',
    )).toBe('https://models.github.ai/inference/chat/completions')
    expect(buildOpenAICompatibleUrl(
      'https://models.github.ai/inference',
      'models',
    )).toBe('https://models.github.ai/inference/models')
  })

  test('supports the ChatGPT Codex Responses root without inventing a /v1 segment', () => {
    expect(buildOpenAICompatibleUrl(
      'https://chatgpt.com/backend-api/codex',
      'responses',
    )).toBe('https://chatgpt.com/backend-api/codex/responses')
  })

  test('uses Perplexity chat and model discovery paths', () => {
    expect(buildOpenAICompatibleUrl(
      'https://api.perplexity.ai',
      'chat/completions',
    )).toBe('https://api.perplexity.ai/chat/completions')
    expect(buildOpenAICompatibleUrl(
      'https://api.perplexity.ai',
      'models',
    )).toBe('https://api.perplexity.ai/v1/models')
  })
})
