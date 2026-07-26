import type { QQBotInboundMessage, ReplyTarget } from '@tencent-connect/qqbot-nodejs'

export function buildQQChatKey(message: QQBotInboundMessage): string | null {
  if (message.kind === 'c2c') return `qq:c2c:${message.senderId}`
  if (message.kind === 'group' && message.groupOpenid) return `qq:group:${message.groupOpenid}`
  return null
}

export function shouldHandleQQMessage(message: QQBotInboundMessage, groupEnabled: boolean): boolean {
  if (message.senderIsBot) return false
  if (message.kind === 'c2c') return true
  if (message.kind !== 'group' || !groupEnabled) return false
  if (!message.mentions?.length) return true
  return message.mentions.some((mention) => mention.is_you === true)
}

export function withoutQQMention(text: string): string {
  return text
    .replace(/<@!?[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export type StoredQQTarget = ReplyTarget
