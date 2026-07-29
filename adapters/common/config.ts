/**
 * Adapter 配置加载
 *
 * 优先级：环境变量 > ~/.cyber/adapters.json > ~/.claude/adapters.json > 默认值
 */

import * as fs from 'node:fs'
import { getExistingAdapterConfigPath } from './config-home.js'

export type PairedUser = {
  userId: string | number
  displayName: string
  pairedAt: number
}

export type PairingState = {
  code: string | null
  expiresAt: number | null
  createdAt: number | null
}

export type TelegramConfig = {
  botToken: string
  allowedUsers: number[]
  pairedUsers: PairedUser[]
  defaultWorkDir: string
}

export type FeishuConfig = {
  appId: string
  appSecret: string
  encryptKey: string
  verificationToken: string
  allowedUsers: string[]
  pairedUsers: PairedUser[]
  defaultWorkDir: string
  streamingCard: boolean
}

export type WeixinConfig = {
  enabled: boolean
  accountId: string
  botToken: string
  baseUrl: string
  userId: string
  allowedUsers: string[]
  pairedUsers: PairedUser[]
  defaultWorkDir: string
}

export type QQConfig = {
  enabled: boolean
  appId: string
  appSecret: string
  allowedUsers: string[]
  pairedUsers: PairedUser[]
  defaultWorkDir: string
  groupEnabled: boolean
}

export type DingTalkConfig = {
  clientId: string
  clientSecret: string
  allowedUsers: string[]
  pairedUsers: PairedUser[]
  defaultWorkDir: string
}

export type AdapterConfig = {
  serverUrl: string
  defaultProjectDir: string
  pairing: PairingState
  telegram: TelegramConfig
  feishu: FeishuConfig
  weixin: WeixinConfig
  qq: QQConfig
  dingtalk: DingTalkConfig
}

function getConfigPath(): string {
  return getExistingAdapterConfigPath('adapters.json')
}

function loadFile(): Record<string, any> {
  try {
    return JSON.parse(fs.readFileSync(getConfigPath(), 'utf-8'))
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      console.warn(`[Config] Failed to parse ${getConfigPath()}, using defaults`)
    }
    return {}
  }
}

export function loadConfig(): AdapterConfig {
  const file = loadFile()
  const tg = file.telegram ?? {}
  const fs_ = file.feishu ?? {}
  const weixin = file.weixin ?? {}
  const qq = file.qq ?? {}
  const dingtalk = file.dingtalk ?? {}
  const pairing = file.pairing ?? {}
  const weixinAccountId = process.env.WEIXIN_ACCOUNT_ID || weixin.accountId || ''
  const weixinBotToken = process.env.WEIXIN_BOT_TOKEN || weixin.botToken || ''
  const qqAppId = process.env.QQBOT_APP_ID || qq.appId || ''
  const qqAppSecret = process.env.QQBOT_APP_SECRET || qq.appSecret || ''

  return {
    serverUrl: process.env.ADAPTER_SERVER_URL || file.serverUrl || 'ws://127.0.0.1:3456',
    defaultProjectDir: file.defaultProjectDir || '',
    pairing: {
      code: pairing.code ?? null,
      expiresAt: pairing.expiresAt ?? null,
      createdAt: pairing.createdAt ?? null,
    },
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN || tg.botToken || '',
      allowedUsers: tg.allowedUsers ?? [],
      pairedUsers: tg.pairedUsers ?? [],
      defaultWorkDir: tg.defaultWorkDir || process.cwd(),
    },
    feishu: {
      appId: process.env.FEISHU_APP_ID || fs_.appId || '',
      appSecret: process.env.FEISHU_APP_SECRET || fs_.appSecret || '',
      encryptKey: process.env.FEISHU_ENCRYPT_KEY || fs_.encryptKey || '',
      verificationToken: process.env.FEISHU_VERIFICATION_TOKEN || fs_.verificationToken || '',
      allowedUsers: fs_.allowedUsers ?? [],
      pairedUsers: fs_.pairedUsers ?? [],
      defaultWorkDir: fs_.defaultWorkDir || process.cwd(),
      streamingCard: fs_.streamingCard ?? false,
    },
    weixin: {
      enabled: weixin.enabled ?? Boolean(weixinAccountId && weixinBotToken),
      accountId: weixinAccountId,
      botToken: weixinBotToken,
      baseUrl: process.env.WEIXIN_BASE_URL || weixin.baseUrl || 'https://ilinkai.weixin.qq.com',
      userId: weixin.userId || '',
      allowedUsers: weixin.allowedUsers ?? [],
      pairedUsers: weixin.pairedUsers ?? [],
      defaultWorkDir: weixin.defaultWorkDir || process.cwd(),
    },
    qq: {
      enabled: qq.enabled ?? Boolean(qqAppId && qqAppSecret),
      appId: qqAppId,
      appSecret: qqAppSecret,
      allowedUsers: qq.allowedUsers ?? [],
      pairedUsers: qq.pairedUsers ?? [],
      defaultWorkDir: qq.defaultWorkDir || process.cwd(),
      groupEnabled: qq.groupEnabled ?? true,
    },
    dingtalk: {
      clientId: process.env.DINGTALK_CLIENT_ID || dingtalk.clientId || '',
      clientSecret: process.env.DINGTALK_CLIENT_SECRET || dingtalk.clientSecret || '',
      allowedUsers: dingtalk.allowedUsers ?? [],
      pairedUsers: dingtalk.pairedUsers ?? [],
      defaultWorkDir: dingtalk.defaultWorkDir || process.cwd(),
    },
  }
}
