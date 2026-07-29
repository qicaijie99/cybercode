import { describe, expect, it } from 'bun:test'
import type { DingTalkReplyTarget } from '../message.js'
import { DingTalkReplyClient } from '../reply.js'

const target: DingTalkReplyTarget = {
  sessionWebhook: 'https://oapi.dingtalk.com/robot/sendBySession?session=test',
  senderStaffId: 'staff-42',
  isGroup: true,
  expiresAt: Date.now() + 60_000,
}

describe('DingTalkReplyClient', () => {
  it('sends Markdown through the official session webhook and caches the token', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    let tokenRequests = 0
    const client = new DingTalkReplyClient({
      getAccessToken: async () => {
        tokenRequests += 1
        return 'access-token'
      },
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init })
        return new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' }), { status: 200 })
      },
    })

    await client.sendText(target, '第一条')
    await client.sendText(target, '第二条')

    expect(tokenRequests).toBe(1)
    expect(requests).toHaveLength(2)
    expect(new Headers(requests[0]!.init?.headers).get('x-acs-dingtalk-access-token')).toBe('access-token')
    expect(JSON.parse(String(requests[0]!.init?.body))).toEqual({
      msgtype: 'markdown',
      markdown: { title: 'CyberCode', text: '第一条' },
      at: { atUserIds: ['staff-42'], isAtAll: false },
    })
  })

  it('refreshes the access token once after an authorization failure', async () => {
    let tokenRequests = 0
    let sends = 0
    const client = new DingTalkReplyClient({
      getAccessToken: async () => `token-${++tokenRequests}`,
      fetchImpl: async () => {
        sends += 1
        return sends === 1
          ? new Response('unauthorized', { status: 401 })
          : new Response(JSON.stringify({ errcode: 0 }), { status: 200 })
      },
    })

    await client.sendText(target, '重试')

    expect(tokenRequests).toBe(2)
    expect(sends).toBe(2)
  })

  it('rejects an expired session webhook before making a request', async () => {
    let sends = 0
    const client = new DingTalkReplyClient({
      getAccessToken: async () => 'token',
      fetchImpl: async () => {
        sends += 1
        return new Response('{}')
      },
      now: () => 10_000,
    })

    await expect(client.sendText({
      ...target,
      expiresAt: 9_999,
    }, 'too late')).rejects.toThrow('expired')
    expect(sends).toBe(0)
  })
})
