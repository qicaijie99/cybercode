import {
  isAllowedDingTalkWebhook,
  type DingTalkReplyTarget,
} from './message.js'

const ACCESS_TOKEN_CACHE_MS = 55 * 60 * 1000

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

type DingTalkReplyClientOptions = {
  getAccessToken: () => Promise<string>
  fetchImpl?: FetchLike
  now?: () => number
}

export class DingTalkReplyClient {
  private readonly fetchImpl: FetchLike
  private readonly now: () => number
  private accessToken: { value: string; expiresAt: number } | null = null
  private tokenRequest: Promise<string> | null = null

  constructor(private readonly options: DingTalkReplyClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.now = options.now ?? Date.now
  }

  async sendText(target: DingTalkReplyTarget, text: string): Promise<void> {
    if (!isAllowedDingTalkWebhook(target.sessionWebhook)) {
      throw new Error('DingTalk rejected an untrusted session webhook')
    }
    if (target.expiresAt && target.expiresAt <= this.now()) {
      throw new Error('DingTalk session webhook has expired; send the bot a new message')
    }

    let token = await this.getAccessToken()
    let response = await this.postMessage(target, text, token)
    if (response.status === 401 || response.status === 403) {
      token = await this.getAccessToken(true)
      response = await this.postMessage(target, text, token)
    }
    await assertDingTalkSuccess(response)
  }

  private async postMessage(
    target: DingTalkReplyTarget,
    text: string,
    accessToken: string,
  ): Promise<Response> {
    return this.fetchImpl(target.sessionWebhook, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-acs-dingtalk-access-token': accessToken,
      },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: {
          title: 'CyberCode',
          text,
        },
        at: {
          atUserIds: target.isGroup && target.senderStaffId ? [target.senderStaffId] : [],
          isAtAll: false,
        },
      }),
    })
  }

  private async getAccessToken(forceRefresh = false): Promise<string> {
    if (forceRefresh) this.accessToken = null
    if (this.accessToken && this.accessToken.expiresAt > this.now()) {
      return this.accessToken.value
    }
    if (this.tokenRequest) return this.tokenRequest

    const request = this.options.getAccessToken().then((token) => {
      const value = token.trim()
      if (!value) throw new Error('DingTalk returned an empty access token')
      this.accessToken = {
        value,
        expiresAt: this.now() + ACCESS_TOKEN_CACHE_MS,
      }
      return value
    })
    this.tokenRequest = request
    try {
      return await request
    } finally {
      if (this.tokenRequest === request) this.tokenRequest = null
    }
  }
}

async function assertDingTalkSuccess(response: Response): Promise<void> {
  const raw = await response.text()
  let body: Record<string, unknown> | null = null
  if (raw) {
    try {
      body = JSON.parse(raw) as Record<string, unknown>
    } catch {
      body = null
    }
  }

  if (!response.ok) {
    throw new Error(`DingTalk reply failed with HTTP ${response.status}${formatDetail(body, raw)}`)
  }
  if (typeof body?.errcode === 'number' && body.errcode !== 0) {
    throw new Error(`DingTalk reply failed with error ${body.errcode}${formatDetail(body, raw)}`)
  }
}

function formatDetail(body: Record<string, unknown> | null, raw: string): string {
  const message = typeof body?.errmsg === 'string' ? body.errmsg : raw
  return message ? `: ${message.slice(0, 200)}` : ''
}
