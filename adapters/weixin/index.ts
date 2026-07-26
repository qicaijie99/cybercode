import { loadConfig } from '../common/config.js'
import { AttachmentStore } from '../common/attachment/attachment-store.js'
import { CyberCodeChannelRuntime } from '../common/cybercode-channel-runtime.js'
import { IlinkClient } from './ilink-client.js'
import { WeixinStateStore } from './state-store.js'
import { describeUnsupportedWeixinItems, extractWeixinText } from './message.js'
import { collectWeixinAttachments } from './media.js'

const config = loadConfig()
if (!config.weixin.enabled || !config.weixin.accountId || !config.weixin.botToken) {
  console.error('[Weixin] Missing an enabled iLink account. Connect Weixin in CyberCode settings first.')
  process.exit(1)
}

const client = new IlinkClient(config.weixin.baseUrl)
const state = new WeixinStateStore(config.weixin.accountId)
const attachmentStore = new AttachmentStore()
const targets = new Map<string, string>()
const abortController = new AbortController()

const runtime = new CyberCodeChannelRuntime({
  platform: 'weixin',
  serverUrl: config.serverUrl,
  defaultProjectDir: config.defaultProjectDir,
  transport: {
    textLimit: 1800,
    sendText: async (chatKey, text) => {
      const userId = targets.get(chatKey)
      if (!userId) throw new Error(`No Weixin target registered for ${chatKey}`)
      await client.sendText({
        token: config.weixin.botToken,
        toUserId: userId,
        text,
        contextToken: state.getContextToken(userId),
      })
    },
  },
})

async function monitor(): Promise<void> {
  let timeoutMs = 35_000
  let failures = 0
  while (!abortController.signal.aborted) {
    try {
      const response = await client.getUpdates({
        token: config.weixin.botToken,
        getUpdatesBuf: state.getUpdatesBuf(),
        timeoutMs,
        signal: abortController.signal,
      })
      if (response.longpolling_timeout_ms && response.longpolling_timeout_ms > 0) {
        timeoutMs = response.longpolling_timeout_ms
      }
      if ((response.ret && response.ret !== 0) || (response.errcode && response.errcode !== 0)) {
        const code = response.errcode || response.ret
        console.error(`[Weixin] getupdates failed (${code}): ${response.errmsg || 'unknown error'}`)
        await sleep(code === -14 ? 60_000 : 2_000, abortController.signal)
        continue
      }
      failures = 0
      if (response.get_updates_buf) state.setUpdatesBuf(response.get_updates_buf)

      for (const message of response.msgs ?? []) {
        if (message.message_type !== undefined && message.message_type !== 1) continue
        const userId = message.from_user_id?.trim()
        if (!userId) continue
        if (message.context_token) state.setContextToken(userId, message.context_token)
        const chatKey = `weixin:${config.weixin.accountId}:${userId}`
        targets.set(chatKey, userId)
        const media = await collectWeixinAttachments(message, chatKey, attachmentStore)
        for (const rejection of media.rejections) {
          await client.sendText({
            token: config.weixin.botToken,
            toUserId: userId,
            text: rejection,
            contextToken: state.getContextToken(userId),
          }).catch(() => {})
        }
        const text = extractWeixinText(message)
        if (!text && media.attachments.length === 0) {
          const unsupported = describeUnsupportedWeixinItems(message)
          if (unsupported && media.rejections.length === 0) {
            await client.sendText({
              token: config.weixin.botToken,
              toUserId: userId,
              text: unsupported,
              contextToken: state.getContextToken(userId),
            }).catch(() => {})
          }
          continue
        }
        await runtime.handleIncoming({
          messageId: String(message.message_id ?? `${userId}-${message.create_time_ms ?? Date.now()}`),
          chatKey,
          userId,
          displayName: '微信用户',
          text,
          attachments: media.attachments,
        })
      }
    } catch (error) {
      if (abortController.signal.aborted) break
      failures += 1
      console.error('[Weixin] monitor error:', error instanceof Error ? error.message : error)
      await sleep(failures >= 3 ? 30_000 : 2_000, abortController.signal)
      if (failures >= 3) failures = 0
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', stop)
      resolve()
    }, ms)
    const stop = () => {
      clearTimeout(timer)
      resolve()
    }
    signal.addEventListener('abort', stop, { once: true })
  })
}

function shutdown(): void {
  abortController.abort()
  runtime.destroy()
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)

attachmentStore.gc().catch((error) => {
  console.warn('[Weixin] AttachmentStore.gc failed:', error instanceof Error ? error.message : error)
})
console.log(`[Weixin] iLink adapter started (${config.weixin.accountId})`)
void monitor()
