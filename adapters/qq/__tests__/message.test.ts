import { describe, expect, test } from 'bun:test'
import type { QQBotInboundMessage } from '@tencent-connect/qqbot-nodejs'
import { buildQQChatKey, shouldHandleQQMessage, withoutQQMention } from '../message.js'

function message(patch: Partial<QQBotInboundMessage> = {}): QQBotInboundMessage {
  return {
    rawEventType: 'C2C_MESSAGE_CREATE',
    kind: 'c2c',
    senderId: 'user-1',
    content: 'hello',
    messageId: 'msg-1',
    timestamp: new Date().toISOString(),
    raw: {} as QQBotInboundMessage['raw'],
    replyTarget: { scope: 'c2c', targetId: 'user-1', msgId: 'msg-1' },
    ...patch,
  }
}

describe('QQ inbound routing', () => {
  test('namespaces direct and group chats', () => {
    expect(buildQQChatKey(message())).toBe('qq:c2c:user-1')
    expect(buildQQChatKey(message({ kind: 'group', groupOpenid: 'group-1' }))).toBe('qq:group:group-1')
  })

  test('requires the group feature and handles bot mentions', () => {
    const group = message({ kind: 'group', groupOpenid: 'group-1', mentions: [{ is_you: true }] })
    expect(shouldHandleQQMessage(group, false)).toBe(false)
    expect(shouldHandleQQMessage(group, true)).toBe(true)
  })

  test('removes QQ mention markup from prompts', () => {
    expect(withoutQQMention('<@!bot-id>  帮我检查代码')).toBe('帮我检查代码')
  })
})
