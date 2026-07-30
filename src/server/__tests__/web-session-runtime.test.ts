import { describe, expect, test } from 'bun:test'
import {
  solveDeepSeekPowAsync,
} from '../proxy/webSession/vendor/omniroute/open-sse/lib/deepseek-pow.js'
import {
  sanitizeErrorMessage,
} from '../proxy/webSession/vendor/omniroute/open-sse/utils/error.js'

describe('Web Cookie provider runtime support', () => {
  test('loads the embedded DeepSeek PoW runtime', async () => {
    const result = await solveDeepSeekPowAsync(
      'DeepSeekHashV1',
      '000000000000',
      'cybercode-smoke',
      1,
      1,
    )

    expect(result).toBe(-1)
  })

  test('redacts session secrets before they reach logs or API errors', () => {
    const message = [
      'cookie=secret-cookie',
      'sessionKey=secret-session',
      'access_token=secret-token',
      'Bearer secret-bearer',
    ].join(' ')
    const sanitized = sanitizeErrorMessage(message)

    expect(sanitized).not.toContain('secret-cookie')
    expect(sanitized).not.toContain('secret-session')
    expect(sanitized).not.toContain('secret-token')
    expect(sanitized).not.toContain('secret-bearer')
    expect(sanitized).toContain('cookie=<redacted>')
    expect(sanitized).toContain('sessionKey=<redacted>')
    expect(sanitized).toContain('access_token=<redacted>')
  })
})
