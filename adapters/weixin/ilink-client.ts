import { randomBytes, randomUUID } from 'node:crypto'

const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com'
const CLIENT_VERSION = (1 << 16) | (1 << 8) | 6
const BASE_INFO = {
  channel_version: '1.1.6',
  bot_agent: 'CyberCode/1.1.6',
}

export type WeixinQrStatus =
  | 'wait'
  | 'scaned'
  | 'confirmed'
  | 'expired'
  | 'scaned_but_redirect'
  | 'need_verifycode'
  | 'verify_code_blocked'
  | 'binded_redirect'

export type WeixinQrStatusResponse = {
  status: WeixinQrStatus
  bot_token?: string
  ilink_bot_id?: string
  baseurl?: string
  ilink_user_id?: string
  redirect_host?: string
}

export type WeixinMessageItem = {
  type?: number
  text_item?: { text?: string }
  image_item?: {
    media?: WeixinCdnMedia
    aeskey?: string
    url?: string
  }
  voice_item?: {
    text?: string
    media?: WeixinCdnMedia
    encode_type?: number
  }
  file_item?: {
    media?: WeixinCdnMedia
    file_name?: string
  }
  video_item?: {
    media?: WeixinCdnMedia
  }
}

export type WeixinCdnMedia = {
  encrypt_query_param?: string
  aes_key?: string
  full_url?: string
}

export type WeixinMessage = {
  message_id?: number
  from_user_id?: string
  message_type?: number
  create_time_ms?: number
  item_list?: WeixinMessageItem[]
  context_token?: string
}

export type WeixinUpdatesResponse = {
  ret?: number
  errcode?: number
  errmsg?: string
  msgs?: WeixinMessage[]
  get_updates_buf?: string
  longpolling_timeout_ms?: number
}

type RequestOptions = {
  method?: 'GET' | 'POST'
  body?: unknown
  token?: string
  timeoutMs?: number
  signal?: AbortSignal
}

export class IlinkClient {
  constructor(private readonly baseUrl = DEFAULT_BASE_URL) {}

  async fetchQrCode(localTokenList: string[] = []): Promise<{ qrcode: string; qrcode_img_content: string }> {
    return await this.request('ilink/bot/get_bot_qrcode?bot_type=3', {
      method: 'POST',
      body: { local_token_list: localTokenList.slice(0, 10) },
      timeoutMs: 15_000,
    })
  }

  async pollQrStatus(
    qrcode: string,
    verifyCode?: string,
    baseUrl = this.baseUrl,
    signal?: AbortSignal,
  ): Promise<WeixinQrStatusResponse> {
    const query = new URLSearchParams({ qrcode })
    if (verifyCode) query.set('verify_code', verifyCode)
    return await this.request(`ilink/bot/get_qrcode_status?${query}`, {
      method: 'GET',
      timeoutMs: 35_000,
      signal,
    }, baseUrl)
  }

  async getUpdates(params: {
    token: string
    getUpdatesBuf: string
    timeoutMs?: number
    signal?: AbortSignal
  }): Promise<WeixinUpdatesResponse> {
    try {
      return await this.request('ilink/bot/getupdates', {
        method: 'POST',
        token: params.token,
        body: {
          get_updates_buf: params.getUpdatesBuf,
          base_info: BASE_INFO,
        },
        timeoutMs: params.timeoutMs ?? 35_000,
        signal: params.signal,
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError' && !params.signal?.aborted) {
        return { ret: 0, msgs: [], get_updates_buf: params.getUpdatesBuf }
      }
      throw error
    }
  }

  async sendText(params: {
    token: string
    toUserId: string
    text: string
    contextToken?: string
  }): Promise<void> {
    const response = await this.request<{ ret?: number; errmsg?: string }>('ilink/bot/sendmessage', {
      method: 'POST',
      token: params.token,
      timeoutMs: 15_000,
      body: {
        msg: {
          from_user_id: '',
          to_user_id: params.toUserId,
          client_id: `cybercode-${randomUUID()}`,
          message_type: 2,
          message_state: 2,
          item_list: [{ type: 1, text_item: { text: params.text } }],
          context_token: params.contextToken,
        },
        base_info: BASE_INFO,
      },
    })
    if (response.ret && response.ret !== 0) {
      throw new Error(`iLink sendmessage ret=${response.ret}: ${response.errmsg || 'unknown error'}`)
    }
  }

  private async request<T>(
    endpoint: string,
    options: RequestOptions,
    baseUrl = this.baseUrl,
  ): Promise<T> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000)
    const abort = () => controller.abort()
    options.signal?.addEventListener('abort', abort, { once: true })
    try {
      const response = await fetch(new URL(endpoint, ensureTrailingSlash(baseUrl)), {
        method: options.method ?? 'POST',
        headers: buildHeaders(options.token),
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      })
      const text = await response.text()
      if (!response.ok) {
        throw new Error(`iLink ${response.status}: ${text.slice(0, 300) || response.statusText}`)
      }
      return JSON.parse(text) as T
    } finally {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', abort)
    }
  }
}

export function normalizeIlinkBaseUrl(value?: string): string {
  const trimmed = value?.trim()
  if (!trimmed) return DEFAULT_BASE_URL
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/$/, '')
  return `https://${trimmed.replace(/^\/+|\/+$/g, '')}`
}

function ensureTrailingSlash(value: string): string {
  return `${normalizeIlinkBaseUrl(value)}/`
}

function buildHeaders(token?: string): Record<string, string> {
  const uint32 = randomBytes(4).readUInt32BE(0)
  return {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'X-WECHAT-UIN': Buffer.from(String(uint32), 'utf8').toString('base64'),
    'iLink-App-Id': 'bot',
    'iLink-App-ClientVersion': String(CLIENT_VERSION),
    ...(token?.trim() ? { Authorization: `Bearer ${token.trim()}` } : {}),
  }
}
