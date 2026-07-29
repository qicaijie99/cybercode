import { randomUUID } from 'node:crypto'
import QRCode from 'qrcode'
import { startQQQrConnect } from '../../../adapters/qq/qr-connector.js'
import {
  IlinkClient,
  normalizeIlinkBaseUrl,
  type WeixinQrStatusResponse,
} from '../../../adapters/weixin/ilink-client.js'
import { adapterService, type PairedUser } from './adapterService.js'

export type AdapterLoginPlatform = 'weixin' | 'qq'
export type AdapterLoginStatus =
  | 'preparing'
  | 'waiting'
  | 'scanned'
  | 'verification_required'
  | 'connected'
  | 'expired'
  | 'cancelled'
  | 'error'

export type AdapterLoginView = {
  sessionId: string
  platform: AdapterLoginPlatform
  status: AdapterLoginStatus
  message: string
  qrDataUrl?: string
  qrUrl?: string
  updatedAt: number
}

type LoginSession = AdapterLoginView & {
  createdAt: number
  qrCode?: string
  verifyCode?: string
  verifySubmitted?: boolean
  pollingBaseUrl?: string
  refreshCount: number
  abortController: AbortController
  dispose?: () => void
}

const SESSION_TTL_MS = 10 * 60_000
const TERMINAL_STATUSES = new Set<AdapterLoginStatus>([
  'connected',
  'expired',
  'cancelled',
  'error',
])

export class AdapterLoginService {
  private readonly sessions = new Map<string, LoginSession>()

  async start(platform: AdapterLoginPlatform): Promise<AdapterLoginView> {
    this.purgeExpired()
    const session: LoginSession = {
      sessionId: randomUUID(),
      platform,
      status: 'preparing',
      message: '正在向官方服务申请二维码…',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      refreshCount: 0,
      abortController: new AbortController(),
    }
    this.sessions.set(session.sessionId, session)

    if (platform === 'weixin') void this.startWeixin(session)
    else void this.startQQ(session)
    return this.toView(session)
  }

  get(sessionId: string): AdapterLoginView | null {
    this.purgeExpired()
    const session = this.sessions.get(sessionId)
    return session ? this.toView(session) : null
  }

  submitVerification(sessionId: string, code: string): AdapterLoginView | null {
    const session = this.sessions.get(sessionId)
    if (!session || session.platform !== 'weixin') return null
    if (session.status !== 'verification_required' && session.status !== 'scanned') return null
    const normalized = code.replace(/\s+/g, '')
    if (!/^\d{1,8}$/.test(normalized)) {
      throw new Error('请输入手机微信显示的数字')
    }
    session.verifyCode = normalized
    session.verifySubmitted = true
    this.update(session, 'scanned', '校验数字已提交，正在等待微信确认…')
    return this.toView(session)
  }

  cancel(sessionId: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    this.update(session, 'cancelled', '连接已取消')
    session.abortController.abort()
    session.dispose?.()
    return true
  }

  private async startWeixin(session: LoginSession): Promise<void> {
    try {
      const current = await adapterService.getRawConfig()
      const client = new IlinkClient()
      const qr = await client.fetchQrCode(current.weixin?.botToken ? [current.weixin.botToken] : [])
      session.qrCode = qr.qrcode
      session.pollingBaseUrl = 'https://ilinkai.weixin.qq.com'
      await this.setQr(session, qr.qrcode_img_content)
      this.update(session, 'waiting', '请使用手机微信扫码连接')
      void this.pollWeixin(session, client)
    } catch (error) {
      this.fail(session, error)
    }
  }

  private async pollWeixin(session: LoginSession, client: IlinkClient): Promise<void> {
    while (!session.abortController.signal.aborted && !TERMINAL_STATUSES.has(session.status)) {
      try {
        const response = await client.pollQrStatus(
          session.qrCode!,
          session.verifyCode,
          session.pollingBaseUrl,
          session.abortController.signal,
        )
        if (session.abortController.signal.aborted) return
        if (await this.handleWeixinStatus(session, client, response)) return
      } catch (error) {
        if (session.abortController.signal.aborted) return
        this.fail(session, error)
        return
      }
    }
  }

  private async handleWeixinStatus(
    session: LoginSession,
    client: IlinkClient,
    response: WeixinQrStatusResponse,
  ): Promise<boolean> {
    switch (response.status) {
      case 'wait':
        if (session.status !== 'verification_required') {
          this.update(session, 'waiting', '请使用手机微信扫码连接')
        }
        return false
      case 'scaned':
        session.verifyCode = undefined
        session.verifySubmitted = false
        this.update(session, 'scanned', '已扫码，请在手机微信中确认')
        return false
      case 'need_verifycode':
        this.update(
          session,
          'verification_required',
          session.verifySubmitted ? '数字不匹配，请重新输入手机微信显示的数字' : '请输入手机微信显示的数字',
        )
        session.verifyCode = undefined
        session.verifySubmitted = false
        return false
      case 'scaned_but_redirect':
        if (response.redirect_host) {
          session.pollingBaseUrl = normalizeIlinkBaseUrl(response.redirect_host)
        }
        this.update(session, 'scanned', '已扫码，正在切换到微信服务节点…')
        return false
      case 'expired':
        return await this.refreshWeixinQr(session, client)
      case 'verify_code_blocked':
        this.update(session, 'error', '校验数字错误次数过多，请稍后重新连接')
        return true
      case 'binded_redirect': {
        const current = await adapterService.getRawConfig()
        if (current.weixin?.botToken && current.weixin.accountId) {
          await adapterService.updateConfig({ weixin: { enabled: true } })
          this.update(session, 'connected', '此微信账号已经连接到 CyberCode')
        } else {
          this.update(session, 'error', '微信返回“已绑定”，但本机没有可用凭据，请重新生成二维码')
        }
        return true
      }
      case 'confirmed':
        if (!response.bot_token || !response.ilink_bot_id) {
          this.update(session, 'error', '微信确认成功，但未返回完整的机器人凭据')
          return true
        }
        await this.saveWeixinCredentials(response)
        this.update(session, 'connected', '微信已连接，CyberCode 正在启动消息通道')
        return true
    }
  }

  private async refreshWeixinQr(session: LoginSession, client: IlinkClient): Promise<boolean> {
    session.refreshCount += 1
    if (session.refreshCount > 3) {
      this.update(session, 'expired', '二维码多次过期，请重新发起连接')
      return true
    }
    const current = await adapterService.getRawConfig()
    const qr = await client.fetchQrCode(current.weixin?.botToken ? [current.weixin.botToken] : [])
    session.qrCode = qr.qrcode
    session.pollingBaseUrl = 'https://ilinkai.weixin.qq.com'
    session.verifyCode = undefined
    await this.setQr(session, qr.qrcode_img_content)
    this.update(session, 'waiting', '二维码已刷新，请重新扫码')
    return false
  }

  private async saveWeixinCredentials(response: WeixinQrStatusResponse): Promise<void> {
    const current = await adapterService.getRawConfig()
    await adapterService.updateConfig({
      weixin: {
        enabled: true,
        accountId: response.ilink_bot_id,
        botToken: response.bot_token,
        baseUrl: normalizeIlinkBaseUrl(response.baseurl),
        userId: response.ilink_user_id || '',
        pairedUsers: upsertPairedUser(
          current.weixin?.pairedUsers,
          response.ilink_user_id,
          '微信扫码用户',
        ),
      },
    })
  }

  private async startQQ(session: LoginSession): Promise<void> {
    let qrReady!: () => void
    const ready = new Promise<void>((resolve) => { qrReady = resolve })
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      session.dispose = startQQQrConnect({
        onQrDisplayed: (url) => {
          if (TERMINAL_STATUSES.has(session.status)) return
          void this.setQr(session, url).then(() => {
            if (TERMINAL_STATUSES.has(session.status)) return
            this.update(session, 'waiting', '请使用手机 QQ 扫码绑定机器人')
            qrReady()
          }).catch((error) => this.fail(session, error))
        },
        onQrExpired: () => {
          if (!TERMINAL_STATUSES.has(session.status)) {
            this.update(session, 'preparing', '二维码已过期，正在自动刷新…')
          }
        },
        onSuccess: (credentials) => {
          void this.completeQQ(session, credentials[0])
        },
        onFailure: (error) => {
          if (!TERMINAL_STATUSES.has(session.status)) this.fail(session, error)
          qrReady()
        },
      }, {
        displayQrCodeToConsole: false,
        signal: session.abortController.signal,
        source: 'cybercode',
      })

      await Promise.race([
        ready,
        new Promise<void>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('QQ 二维码生成超时')), 20_000)
        }),
      ])
    } catch (error) {
      session.dispose?.()
      this.fail(session, error)
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  private async completeQQ(
    session: LoginSession,
    credentials?: { appId: string; appSecret: string; userOpenid?: string },
  ): Promise<void> {
    if (TERMINAL_STATUSES.has(session.status)) return
    if (!credentials?.appId || !credentials.appSecret) {
      this.update(session, 'error', 'QQ 扫码成功，但未返回完整的机器人凭据')
      return
    }
    try {
      const current = await adapterService.getRawConfig()
      await adapterService.updateConfig({
        qq: {
          enabled: true,
          appId: credentials.appId,
          appSecret: credentials.appSecret,
          pairedUsers: upsertPairedUser(
            current.qq?.pairedUsers,
            credentials.userOpenid,
            'QQ 扫码用户',
          ),
        },
      })
      this.update(session, 'connected', 'QQ 机器人已连接，CyberCode 正在启动 WebSocket 通道')
      session.dispose?.()
    } catch (error) {
      this.fail(session, error)
    }
  }

  private async setQr(session: LoginSession, url: string): Promise<void> {
    session.qrUrl = url
    session.qrDataUrl = await QRCode.toDataURL(url, {
      width: 260,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#111111', light: '#ffffff' },
    })
    session.updatedAt = Date.now()
  }

  private update(session: LoginSession, status: AdapterLoginStatus, message: string): void {
    session.status = status
    session.message = message
    session.updatedAt = Date.now()
  }

  private fail(session: LoginSession, error: unknown): void {
    if (TERMINAL_STATUSES.has(session.status)) return
    this.update(session, 'error', error instanceof Error ? error.message : String(error))
    session.abortController.abort()
    session.dispose?.()
  }

  private toView(session: LoginSession): AdapterLoginView {
    return {
      sessionId: session.sessionId,
      platform: session.platform,
      status: session.status,
      message: session.message,
      qrDataUrl: session.qrDataUrl,
      qrUrl: session.qrUrl,
      updatedAt: session.updatedAt,
    }
  }

  private purgeExpired(): void {
    const now = Date.now()
    for (const [sessionId, session] of this.sessions) {
      if (now - session.createdAt <= SESSION_TTL_MS) continue
      session.abortController.abort()
      session.dispose?.()
      this.sessions.delete(sessionId)
    }
  }
}

function upsertPairedUser(
  current: PairedUser[] | undefined,
  userId: string | undefined,
  displayName: string,
): PairedUser[] {
  const users = [...(current ?? [])]
  if (!userId || users.some((user) => String(user.userId) === userId)) return users
  users.push({ userId, displayName, pairedAt: Date.now() })
  return users
}

export const adapterLoginService = new AdapterLoginService()
