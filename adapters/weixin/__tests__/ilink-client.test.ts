import { afterEach, describe, expect, mock, test } from 'bun:test'
import { IlinkClient, normalizeIlinkBaseUrl } from '../ilink-client.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('IlinkClient', () => {
  test('normalizes hosts returned by QR confirmation', () => {
    expect(normalizeIlinkBaseUrl('ilink.example.com/')).toBe('https://ilink.example.com')
    expect(normalizeIlinkBaseUrl('https://ilink.example.com/')).toBe('https://ilink.example.com')
  })

  test('sends the official QR endpoint and iLink headers', async () => {
    globalThis.fetch = mock(async (_input, init) => new Response(JSON.stringify({
      qrcode: 'secret-code',
      qrcode_img_content: 'https://example.com/qr',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch

    const result = await new IlinkClient().fetchQrCode()
    const [input, init] = (globalThis.fetch as any).mock.calls[0]!
    expect(String(input)).toContain('/ilink/bot/get_bot_qrcode?bot_type=3')
    expect((init as RequestInit).headers).toMatchObject({
      'iLink-App-Id': 'bot',
      AuthorizationType: 'ilink_bot_token',
    })
    expect(result.qrcode).toBe('secret-code')
  })
})
