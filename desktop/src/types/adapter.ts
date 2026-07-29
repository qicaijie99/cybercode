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

export type ImPlatform = 'telegram' | 'feishu' | 'weixin' | 'qq' | 'dingtalk'

export type AdapterLoginStatus =
  | 'preparing'
  | 'waiting'
  | 'scanned'
  | 'verification_required'
  | 'connected'
  | 'expired'
  | 'cancelled'
  | 'error'

export type AdapterLoginState = {
  sessionId: string
  platform: 'weixin' | 'qq'
  status: AdapterLoginStatus
  message: string
  qrDataUrl?: string
  qrUrl?: string
  updatedAt: number
}

export type AdapterFileConfig = {
  serverUrl?: string
  defaultProjectDir?: string
  pairing?: PairingState
  telegram?: {
    botToken?: string
    allowedUsers?: number[]
    pairedUsers?: PairedUser[]
    defaultWorkDir?: string
  }
  feishu?: {
    appId?: string
    appSecret?: string
    encryptKey?: string
    verificationToken?: string
    allowedUsers?: string[]
    pairedUsers?: PairedUser[]
    defaultWorkDir?: string
    streamingCard?: boolean
  }
  weixin?: {
    enabled?: boolean
    accountId?: string
    botToken?: string
    baseUrl?: string
    userId?: string
    allowedUsers?: string[]
    pairedUsers?: PairedUser[]
    defaultWorkDir?: string
  }
  qq?: {
    enabled?: boolean
    appId?: string
    appSecret?: string
    allowedUsers?: string[]
    pairedUsers?: PairedUser[]
    defaultWorkDir?: string
    groupEnabled?: boolean
  }
  dingtalk?: {
    clientId?: string
    clientSecret?: string
    allowedUsers?: string[]
    pairedUsers?: PairedUser[]
    defaultWorkDir?: string
  }
}
