import {
  DWClient,
  TOPIC_ROBOT,
  type DWClientDownStream,
} from 'dingtalk-stream'
import { loadConfig } from '../common/config.js'
import { CyberCodeChannelRuntime } from '../common/cybercode-channel-runtime.js'
import { parseDingTalkCallback, type DingTalkReplyTarget } from './message.js'
import { DingTalkReplyClient } from './reply.js'

const config = loadConfig()
if (!config.dingtalk.clientId || !config.dingtalk.clientSecret) {
  console.error('[DingTalk] Missing Client ID or Client Secret. Configure DingTalk in CyberCode settings first.')
  process.exit(1)
}

const client = new DWClient({
  clientId: config.dingtalk.clientId,
  clientSecret: config.dingtalk.clientSecret,
  keepAlive: true,
  ua: 'CyberCode/1.1.6',
})
const targets = new Map<string, DingTalkReplyTarget>()
const replies = new DingTalkReplyClient({
  getAccessToken: async () => String(await client.getAccessToken()),
})
const runtime = new CyberCodeChannelRuntime({
  platform: 'dingtalk',
  serverUrl: config.serverUrl,
  defaultProjectDir: config.defaultProjectDir,
  transport: {
    textLimit: 3500,
    sendText: async (chatKey, text) => {
      const target = targets.get(chatKey)
      if (!target) throw new Error(`No DingTalk reply target registered for ${chatKey}`)
      await replies.sendText(target, text)
    },
  },
})

client.registerCallbackListener(TOPIC_ROBOT, (downstream) => {
  acknowledge(downstream)
  void handleRobotMessage(downstream).catch((error) => {
    console.error(
      '[DingTalk] message handling failed:',
      error instanceof Error ? error.message : error,
    )
  })
})

async function handleRobotMessage(downstream: DWClientDownStream): Promise<void> {
  const parsed = parseDingTalkCallback(downstream.data)
  if (!parsed) return

  if (!parsed.message) {
    if (parsed.unsupportedType) {
      await replies.sendText(
        parsed.target,
        `当前钉钉通道暂时只支持文字消息，收到的类型是 ${parsed.unsupportedType}。`,
      )
    }
    return
  }

  targets.set(parsed.message.chatKey, parsed.target)
  await runtime.handleIncoming(parsed.message)
}

function acknowledge(downstream: DWClientDownStream): void {
  try {
    client.socketCallBackResponse(downstream.headers.messageId, null)
  } catch (error) {
    console.warn(
      '[DingTalk] failed to acknowledge callback:',
      error instanceof Error ? error.message : error,
    )
  }
}

function shutdown(): void {
  client.disconnect()
  runtime.destroy()
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)

console.log('[DingTalk] Starting official Stream connection...')
void client.connect()
