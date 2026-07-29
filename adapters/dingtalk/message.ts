export type DingTalkReplyTarget = {
  sessionWebhook: string
  senderStaffId?: string
  isGroup: boolean
  expiresAt?: number
}

export type DingTalkInboundMessage = {
  messageId: string
  chatKey: string
  userId: string
  displayName: string
  text: string
}

export type ParsedDingTalkCallback = {
  target: DingTalkReplyTarget
  message: DingTalkInboundMessage | null
  unsupportedType?: string
}

type DingTalkRobotPayload = {
  conversationId?: unknown
  conversationType?: unknown
  isInAtList?: unknown
  msgId?: unknown
  msgtype?: unknown
  senderId?: unknown
  senderNick?: unknown
  senderStaffId?: unknown
  sessionWebhook?: unknown
  sessionWebhookExpiredTime?: unknown
  text?: unknown
}

export function isAllowedDingTalkWebhook(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && url.hostname === 'oapi.dingtalk.com'
      && (!url.port || url.port === '443')
      && !url.username
      && !url.password
  } catch {
    return false
  }
}

export function parseDingTalkCallback(data: string): ParsedDingTalkCallback | null {
  let payload: DingTalkRobotPayload
  try {
    payload = JSON.parse(data) as DingTalkRobotPayload
  } catch {
    return null
  }

  const messageId = readString(payload.msgId)
  const senderStaffId = readString(payload.senderStaffId)
  const senderId = senderStaffId || readString(payload.senderId)
  const sessionWebhook = readString(payload.sessionWebhook)
  if (!messageId || !senderId || !isAllowedDingTalkWebhook(sessionWebhook)) return null

  const isGroup = String(payload.conversationType ?? '') === '2'
  if (isGroup && payload.isInAtList === false) return null

  const conversationId = readString(payload.conversationId)
  if (isGroup && !conversationId) return null

  const chatKey = isGroup
    ? `dingtalk:group:${conversationId}:${senderId}`
    : `dingtalk:dm:${senderId}`
  const expiresAt = readPositiveNumber(payload.sessionWebhookExpiredTime)
  const target: DingTalkReplyTarget = {
    sessionWebhook,
    senderStaffId: senderStaffId || undefined,
    isGroup,
    expiresAt,
  }

  const msgtype = readString(payload.msgtype)
  if (msgtype !== 'text') {
    return {
      target,
      message: null,
      unsupportedType: msgtype || 'unknown',
    }
  }

  const text = readTextContent(payload.text)
  if (!text) return { target, message: null }

  return {
    target,
    message: {
      messageId,
      chatKey,
      userId: senderId,
      displayName: readString(payload.senderNick) || '钉钉用户',
      text,
    },
  }
}

function readTextContent(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  return readString((value as Record<string, unknown>).content)
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readPositiveNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}
