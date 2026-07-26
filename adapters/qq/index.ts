import {
  QQBot,
  type InlineKeyboard,
  type QQBotInboundMessage,
  type ReplyTarget,
} from '@tencent-connect/qqbot-nodejs'
import { AttachmentStore } from '../common/attachment/attachment-store.js'
import { loadConfig } from '../common/config.js'
import { CyberCodeChannelRuntime } from '../common/cybercode-channel-runtime.js'
import { isAllowedUser } from '../common/pairing.js'
import { collectQQAttachments } from './media.js'
import { buildQQChatKey, shouldHandleQQMessage, withoutQQMention } from './message.js'

const config = loadConfig()
if (!config.qq.enabled || !config.qq.appId || !config.qq.appSecret) {
  console.error('[QQ] Missing an enabled QQ Bot account. Connect QQ in CyberCode settings first.')
  process.exit(1)
}

const targets = new Map<string, ReplyTarget>()
const attachmentStore = new AttachmentStore()
const bot = new QQBot({
  appId: config.qq.appId,
  appSecret: config.qq.appSecret,
  accountId: config.qq.appId,
  transport: 'websocket',
  markdownSupport: false,
  userAgent: 'CyberCode/1.1.6',
  logger: {
    info: (message) => console.log(`[QQ] ${message}`),
    warn: (message) => console.warn(`[QQ] ${message}`),
    error: (message) => console.error(`[QQ] ${message}`),
  },
})

const runtime = new CyberCodeChannelRuntime({
  platform: 'qq',
  serverUrl: config.serverUrl,
  defaultProjectDir: config.defaultProjectDir,
  transport: {
    textLimit: 1800,
    sendText: async (chatKey, text) => {
      const target = targets.get(chatKey)
      if (!target) throw new Error(`No QQ target registered for ${chatKey}`)
      await bot.sendText(target, text)
    },
    sendTyping: async (chatKey) => {
      const target = targets.get(chatKey)
      if (target?.scope === 'c2c') await bot.sendTyping(target, 30)
    },
    sendPermissionRequest: async (chatKey, text, requestId) => {
      const target = targets.get(chatKey)
      if (!target) throw new Error(`No QQ target registered for ${chatKey}`)
      await bot.sendTextWithKeyboard(target, text, permissionKeyboard(requestId))
    },
  },
})

bot.on('message', async (_context, message) => {
  if (!shouldHandleQQMessage(message, config.qq.groupEnabled)) return
  const chatKey = buildQQChatKey(message)
  if (!chatKey || (message.replyTarget.scope !== 'c2c' && message.replyTarget.scope !== 'group')) return
  targets.set(chatKey, message.replyTarget)

  const media = await collectQQAttachments(message, chatKey, attachmentStore)
  for (const rejection of media.rejections) {
    await bot.sendText(message.replyTarget, rejection).catch(() => {})
  }
  const baseText = withoutQQMention(message.content)
  const voiceText = media.voiceText.map((text) => `[语音转写] ${text}`).join('\n')
  const text = [baseText, voiceText].filter(Boolean).join('\n')
  if (!text && media.attachments.length === 0) return

  await runtime.handleIncoming({
    messageId: message.messageId,
    chatKey,
    userId: message.senderId,
    displayName: message.senderName || 'QQ 用户',
    text,
    attachments: media.attachments,
  })
})

bot.on('interaction', async (_context, event) => {
  const data = event.data?.resolved?.button_data
  if (!data?.startsWith('cybercode-permit:')) return
  const operatorId = event.user_openid || event.group_member_openid || event.data.resolved.user_id
  if (!operatorId || !isAllowedUser('qq', operatorId)) {
    await bot.acknowledgeInteraction(event.id, 4)
    return
  }

  const parts = data.split(':')
  const requestId = parts[1]
  const decision = parts[2]
  const chatKey = event.group_openid
    ? `qq:group:${event.group_openid}`
    : `qq:c2c:${event.user_openid || operatorId}`
  const resolved = Boolean(requestId) && await runtime.resolvePermission(
    chatKey,
    requestId!,
    decision === 'yes' || decision === 'always',
    decision === 'always',
  )
  await bot.acknowledgeInteraction(event.id, resolved ? 0 : 3)
})

function permissionKeyboard(requestId: string): InlineKeyboard {
  const button = (id: string, label: string, decision: string, style: number) => ({
    id,
    render_data: { label, visited_label: label, style },
    action: {
      type: 2,
      permission: { type: 2 },
      data: `cybercode-permit:${requestId}:${decision}`,
      click_limit: 1,
    },
  })
  return {
    content: {
      rows: [
        { buttons: [
          button(`allow-${requestId}`, '允许一次', 'yes', 1),
          button(`always-${requestId}`, '始终允许', 'always', 1),
        ] },
        { buttons: [button(`deny-${requestId}`, '拒绝', 'no', 0)] },
      ],
    },
  }
}

function shutdown(): void {
  bot.stop()
  runtime.destroy()
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)

attachmentStore.gc().catch((error) => {
  console.warn('[QQ] AttachmentStore.gc failed:', error instanceof Error ? error.message : error)
})
console.log('[QQ] Starting official WebSocket bot transport...')
void bot.start().catch((error) => {
  console.error('[QQ] startup failed:', error instanceof Error ? error.message : error)
})
