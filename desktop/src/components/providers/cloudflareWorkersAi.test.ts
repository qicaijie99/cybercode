import { describe, expect, it } from 'vitest'

import {
  buildCloudflareWorkersAiBaseUrl,
  extractCloudflareAccountId,
  isValidCloudflareAccountId,
} from './cloudflareWorkersAi'

describe('Cloudflare Workers AI provider URL', () => {
  const accountId = '0123456789abcdef0123456789abcdef'

  it('builds and parses the account-scoped OpenAI-compatible base URL', () => {
    const baseUrl = buildCloudflareWorkersAiBaseUrl(accountId)

    expect(baseUrl).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`,
    )
    expect(extractCloudflareAccountId(baseUrl)).toBe(accountId)
  })

  it('keeps the preset placeholder out of the editable account field', () => {
    expect(buildCloudflareWorkersAiBaseUrl('')).toContain('/ACCOUNT_ID/')
    expect(extractCloudflareAccountId(buildCloudflareWorkersAiBaseUrl(''))).toBe('')
  })

  it('accepts only Cloudflare 32-character hexadecimal account IDs', () => {
    expect(isValidCloudflareAccountId(accountId)).toBe(true)
    expect(isValidCloudflareAccountId('not-an-account-id')).toBe(false)
    expect(isValidCloudflareAccountId(`${accountId}00`)).toBe(false)
  })
})
