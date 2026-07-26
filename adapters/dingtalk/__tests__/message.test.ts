import { describe, expect, it } from 'bun:test'
import {
  isAllowedDingTalkWebhook,
  parseDingTalkCallback,
} from '../message.js'

function callback(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    conversationId: 'cid-group',
    conversationType: '1',
    isInAtList: true,
    msgId: 'msg-1',
    msgtype: 'text',
    senderId: 'opaque-sender',
    senderNick: '小王',
    senderStaffId: 'staff-42',
    sessionWebhook: 'https://oapi.dingtalk.com/robot/sendBySession?session=abc',
    sessionWebhookExpiredTime: Date.now() + 60_000,
    text: { content: '  帮我看看这个项目  ' },
    ...overrides,
  })
}

describe('parseDingTalkCallback', () => {
  it('normalizes direct text messages', () => {
    const parsed = parseDingTalkCallback(callback())

    expect(parsed?.message).toEqual({
      messageId: 'msg-1',
      chatKey: 'dingtalk:dm:staff-42',
      userId: 'staff-42',
      displayName: '小王',
      text: '帮我看看这个项目',
    })
    expect(parsed?.target.isGroup).toBe(false)
  })

  it('isolates group sessions by conversation and sender', () => {
    const parsed = parseDingTalkCallback(callback({
      conversationType: '2',
      conversationId: 'cid-team',
    }))

    expect(parsed?.message?.chatKey).toBe('dingtalk:group:cid-team:staff-42')
    expect(parsed?.target.isGroup).toBe(true)
  })

  it('ignores group messages that do not mention the bot', () => {
    expect(parseDingTalkCallback(callback({
      conversationType: '2',
      isInAtList: false,
    }))).toBeNull()
  })

  it('reports unsupported message types without forwarding them to the agent', () => {
    const parsed = parseDingTalkCallback(callback({ msgtype: 'audio' }))

    expect(parsed?.message).toBeNull()
    expect(parsed?.unsupportedType).toBe('audio')
  })

  it('rejects callback-controlled webhooks outside DingTalk', () => {
    expect(parseDingTalkCallback(callback({
      sessionWebhook: 'https://example.com/collect',
    }))).toBeNull()
  })
})

describe('isAllowedDingTalkWebhook', () => {
  it('only permits the official HTTPS webhook host', () => {
    expect(isAllowedDingTalkWebhook('https://oapi.dingtalk.com/robot/sendBySession?session=ok')).toBe(true)
    expect(isAllowedDingTalkWebhook('http://oapi.dingtalk.com/robot/sendBySession')).toBe(false)
    expect(isAllowedDingTalkWebhook('https://oapi.dingtalk.com.evil.test/robot/sendBySession')).toBe(false)
  })
})
