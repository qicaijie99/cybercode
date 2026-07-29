import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { useAdapterStore } from '../stores/adapterStore'
import { adaptersApi } from '../api/adapters'
import type { AdapterFileConfig, AdapterLoginState, ImPlatform } from '../types/adapter'
import { useTranslation } from '../i18n'
import { Input } from '../components/shared/Input'
import { Button } from '../components/shared/Button'
import { DirectoryPicker } from '../components/shared/DirectoryPicker'
import { ConfirmDialog } from '../components/shared/ConfirmDialog'
import { Modal } from '../components/shared/Modal'
import { SettingsPage, SettingsSection, SettingsRow, Switch } from '../components/settings/SettingsLayout'
import { ImPlatformIcon } from '../components/adapters/ImPlatformIcon'
import { Icon } from '../components/shared/Icon'

type ImTab = Exclude<ImPlatform, 'feishu'>

type AdapterGuideStep = {
  title: string
  body: ReactNode
  items?: string[]
  command?: string
}

type AdapterGuide = {
  title: string
  summary: string
  steps: AdapterGuideStep[]
  checks: string[]
}

const ADAPTER_GUIDES: Record<ImTab, AdapterGuide> = {
  weixin: {
    title: '微信连接教程',
    summary: '使用腾讯官方 iLink 通道连接个人微信。无需公网地址、反向代理或额外安装服务。',
    steps: [
      {
        title: '在 CyberCode 发起连接',
        body: '打开 设置 -> IM 接入 -> 微信，点击“扫码连接”。CyberCode 会直接向微信官方服务申请二维码。',
      },
      {
        title: '使用手机微信扫码',
        body: '用手机微信扫描桌面端显示的二维码，并在手机上确认。若手机显示校验数字，请回到桌面弹窗中输入。',
      },
      {
        title: '等待通道自动启动',
        body: '连接成功后凭据只写入本机配置，桌面端会自动重启 IM sidecar 并建立长轮询，不需要公网回调。',
      },
      {
        title: '在微信中开始对话',
        body: '直接发送消息即可使用 CyberCode。发送 /projects 选择项目，或发送 /new 新建会话。',
      },
    ],
    checks: [
      '二维码仅用于本次连接，过期后桌面端会自动刷新。',
      '退出 CyberCode 后不会有云端中转；重新打开桌面端会自动恢复通道。',
      '连接账号会自动成为首个已配对用户，其他用户仍需使用配对码。',
    ],
  },
  qq: {
    title: 'QQ 机器人连接教程',
    summary: '使用 QQ 官方机器人 Agent 通道，通过 WebSocket 主动连接，无需配置公网回调。',
    steps: [
      {
        title: '优先使用扫码绑定',
        body: '打开 设置 -> IM 接入 -> QQ，点击“扫码连接”，再用手机 QQ 扫描二维码。AppID 与 App Secret 会由官方连接流程自动返回并保存在本机。',
      },
      {
        title: '需要时手动填写凭据',
        body: (
          <>
            如果扫码不可用，可前往{' '}
            <a className="font-semibold text-[var(--color-text-accent)] hover:underline" href="https://q.qq.com/" target="_blank" rel="noreferrer">
              QQ 开放平台
            </a>
            {' '}创建机器人，然后在本页填写 AppID 和 App Secret。
          </>
        ),
      },
      {
        title: '保存并自动连接',
        body: '保存后 CyberCode 会自动重启 IM sidecar，通过官方 WebSocket Gateway 建立长连接，不需要公网服务器。',
      },
      {
        title: '完成身份配对',
        body: '扫码用户会自动配对。手动凭据模式下，请在桌面端生成配对码，并在 QQ 私聊中发送给机器人。',
      },
    ],
    checks: [
      '默认支持私聊；开启群聊后，机器人只处理 QQ 官方推送给它的群消息。',
      'QQ 机器人需遵守开放平台的审核、消息额度和主动消息规则。',
      '可发送 /status 检查会话，也可用权限按钮批准或拒绝工具调用。',
    ],
  },
  dingtalk: {
    title: '钉钉机器人连接教程',
    summary: '使用钉钉官方 Stream 模式建立出站长连接，不需要公网地址、反向代理或额外服务。',
    steps: [
      {
        title: '创建企业内部应用',
        body: (
          <>
            前往{' '}
            <a className="font-semibold text-[var(--color-text-accent)] hover:underline" href="https://open-dev.dingtalk.com/" target="_blank" rel="noreferrer">
              钉钉开放平台
            </a>
            {' '}创建企业内部应用，并记下应用凭证中的 Client ID 和 Client Secret。
          </>
        ),
      },
      {
        title: '添加机器人能力',
        body: '进入“应用能力 -> 添加应用能力 -> 机器人”，完善机器人信息，将消息接收模式选为 Stream 模式，然后创建版本并发布。',
      },
      {
        title: '填写凭据并保存',
        body: '回到 设置 -> IM 接入 -> 钉钉，填写 Client ID 与 Client Secret。保存后 CyberCode 会自动重启本地 IM sidecar 并建立长连接。',
      },
      {
        title: '生成配对码',
        body: '在本页顶部生成 6 位配对码，然后私聊机器人并发送该配对码。看到“配对成功”后即可开始使用。',
      },
    ],
    checks: [
      '私聊机器人无需 @；群聊中需要 @机器人 才会触发 CyberCode。',
      '钉钉凭据只保存在本机配置中，桌面端不会要求公网回调地址。',
      '可发送 /status 检查会话；工具权限可通过 /allow 和 /deny 处理。',
    ],
  },
  telegram: {
    title: 'Telegram 连接教程',
    summary: '适合个人通过 Telegram 私聊远程使用 CyberCode。当前只处理 private chat，不处理群聊。',
    steps: [
      {
        title: '创建 Telegram 机器人',
        body: '在 Telegram 搜索官方账号 @BotFather，发送 /newbot，按提示填写机器人名称和用户名。用户名必须以 _bot 结尾。',
      },
      {
        title: '复制 Bot Token',
        body: '机器人创建成功后，BotFather 会返回一串 Bot Token。复制这串 Token，后面要填到桌面端。',
      },
      {
        title: '回到桌面端填写配置',
        body: '在 设置 -> IM 接入 -> Telegram 中粘贴 Bot Token。允许的用户可以先留空，通过配对码绑定；默认项目可选。',
      },
      {
        title: '保存并生成配对码',
        body: '点击保存，再点击生成配对码。配对码有效期 60 分钟，重新生成后旧码立即失效。',
      },
      {
        title: '在 Telegram 私聊中完成配对',
        body: '打开刚创建的机器人私聊，发送 /start 或任意消息，然后按提示发送 6 位配对码。成功后即可远程对话。',
      },
    ],
    checks: [
      '确认 Token 来自 @BotFather，且没有多余空格。',
      '请在机器人私聊里配对，不要在群聊里测试。',
      '桌面发布版会自动拉起 adapter；本地开发时可手动运行：cd adapters && bun run telegram。',
      '配对成功后可发送 /status 验证连接。',
    ],
  },
}

export function AdapterSettings() {
  const t = useTranslation()
  const {
    config,
    isLoading,
    fetchConfig,
    updateConfig,
    generatePairingCode,
    removePairedUser,
    restartAdapters,
  } = useAdapterStore()

  const [activeIm, setActiveIm] = useState<ImTab>('weixin')
  const [guidePlatform, setGuidePlatform] = useState<ImTab | null>(null)

  // Server —— serverUrl 不再暴露在 UI 里（见下方 Server URL 注释），
  // 桌面端用 Tauri env var 注入动态端口。
  const [defaultProjectDir, setDefaultProjectDir] = useState('')

  // Telegram
  const [tgBotToken, setTgBotToken] = useState('')
  const [tgAllowedUsers, setTgAllowedUsers] = useState('')

  // Weixin
  const [wxEnabled, setWxEnabled] = useState(false)
  const [wxAllowedUsers, setWxAllowedUsers] = useState('')

  // QQ
  const [qqEnabled, setQqEnabled] = useState(false)
  const [qqAppId, setQqAppId] = useState('')
  const [qqAppSecret, setQqAppSecret] = useState('')
  const [qqAllowedUsers, setQqAllowedUsers] = useState('')
  const [qqGroupEnabled, setQqGroupEnabled] = useState(true)

  // DingTalk
  const [dtClientId, setDtClientId] = useState('')
  const [dtClientSecret, setDtClientSecret] = useState('')
  const [dtAllowedUsers, setDtAllowedUsers] = useState('')

  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState('')
  const saveResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Pairing
  const [pairingCode, setPairingCode] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [pendingUnbind, setPendingUnbind] = useState<{ platform: ImPlatform; userId: string | number } | null>(null)
  const [isUnbinding, setIsUnbinding] = useState(false)

  // Official QR connection flow
  const [loginState, setLoginState] = useState<AdapterLoginState | null>(null)
  const [startingPlatform, setStartingPlatform] = useState<'weixin' | 'qq' | null>(null)
  const [disconnectingPlatform, setDisconnectingPlatform] = useState<'weixin' | 'qq' | null>(null)
  const [verificationCode, setVerificationCode] = useState('')
  const [isSubmittingVerification, setIsSubmittingVerification] = useState(false)
  const completedLoginRef = useRef<string | null>(null)
  const loginLaunchRef = useRef(0)

  useEffect(() => {
    fetchConfig()
  }, [])

  useEffect(() => () => {
    if (saveResetTimerRef.current) clearTimeout(saveResetTimerRef.current)
  }, [])

  // Sync form state when config is loaded
  useEffect(() => {
    setDefaultProjectDir(config.defaultProjectDir ?? '')
    setTgBotToken(config.telegram?.botToken ?? '')
    setTgAllowedUsers(config.telegram?.allowedUsers?.join(', ') ?? '')
    setWxEnabled(config.weixin?.enabled ?? false)
    setWxAllowedUsers(config.weixin?.allowedUsers?.join(', ') ?? '')
    setQqEnabled(config.qq?.enabled ?? false)
    setQqAppId(config.qq?.appId ?? '')
    setQqAppSecret(config.qq?.appSecret ?? '')
    setQqAllowedUsers(config.qq?.allowedUsers?.join(', ') ?? '')
    setQqGroupEnabled(config.qq?.groupEnabled ?? true)
    setDtClientId(config.dingtalk?.clientId ?? '')
    setDtClientSecret(config.dingtalk?.clientSecret ?? '')
    setDtAllowedUsers(config.dingtalk?.allowedUsers?.join(', ') ?? '')
  }, [config])

  useEffect(() => {
    const sessionId = loginState?.sessionId
    if (!sessionId) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const poll = async () => {
      try {
        const next = await adaptersApi.getLoginStatus(sessionId)
        if (stopped) return
        setLoginState(next)
        if (next.status === 'connected') {
          if (completedLoginRef.current !== sessionId) {
            completedLoginRef.current = sessionId
            await fetchConfig()
            await restartAdapters()
          }
          return
        }
        if (['error', 'expired', 'cancelled'].includes(next.status)) return
      } catch (error) {
        if (!stopped) {
          setLoginState((current) => current ? {
            ...current,
            status: 'error',
            message: error instanceof Error ? error.message : '连接状态读取失败',
          } : current)
        }
        return
      }
      timer = setTimeout(poll, 1200)
    }

    timer = setTimeout(poll, 800)
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [loginState?.sessionId, fetchConfig, restartAdapters])

  async function handleSave() {
    setIsSaving(true)
    setSaveStatus('idle')
    setSaveError('')
    try {
      const patch: Partial<AdapterFileConfig> = {}

      patch.defaultProjectDir = defaultProjectDir

      const tgUsers = tgAllowedUsers
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number)
        .filter((n) => !isNaN(n))

      patch.telegram = {
        botToken: tgBotToken || undefined,
        allowedUsers: tgUsers.length ? tgUsers : [],
      }

      patch.weixin = {
        enabled: wxEnabled,
        allowedUsers: parseStringList(wxAllowedUsers),
      }

      patch.qq = {
        enabled: qqEnabled || (!isQQConnected && Boolean(qqAppId.trim() && qqAppSecret.trim())),
        appId: qqAppId || undefined,
        appSecret: qqAppSecret || undefined,
        allowedUsers: parseStringList(qqAllowedUsers),
        groupEnabled: qqGroupEnabled,
      }

      patch.dingtalk = {
        clientId: dtClientId.trim() || undefined,
        clientSecret: dtClientSecret.trim() || undefined,
        allowedUsers: parseStringList(dtAllowedUsers),
      }

      await updateConfig(patch)
      setSaveStatus('saved')
      if (saveResetTimerRef.current) clearTimeout(saveResetTimerRef.current)
      saveResetTimerRef.current = setTimeout(() => {
        saveResetTimerRef.current = null
        setSaveStatus('idle')
      }, 2000)
    } catch (err) {
      setSaveStatus('error')
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setIsSaving(false)
    }
  }

  const handleGenerateCode = useCallback(async () => {
    setIsGenerating(true)
    try {
      const code = await generatePairingCode()
      setPairingCode(code)
    } catch (err) {
      console.error('Failed to generate pairing code:', err)
    } finally {
      setIsGenerating(false)
    }
  }, [generatePairingCode])

  const handleUnbind = useCallback(async (platform: ImPlatform, userId: string | number) => {
    setPendingUnbind({ platform, userId })
  }, [])

  const confirmUnbind = useCallback(async () => {
    if (!pendingUnbind) return
    setIsUnbinding(true)
    try {
      await removePairedUser(pendingUnbind.platform, pendingUnbind.userId)
      await fetchConfig()
      setPendingUnbind(null)
    } finally {
      setIsUnbinding(false)
    }
  }, [pendingUnbind, removePairedUser, fetchConfig])

  const handleStartLogin = useCallback(async (platform: 'weixin' | 'qq') => {
    const launchId = loginLaunchRef.current + 1
    loginLaunchRef.current = launchId
    setActiveIm(platform)
    setStartingPlatform(platform)
    setVerificationCode('')
    completedLoginRef.current = null
    setLoginState({
      sessionId: '',
      platform,
      status: 'preparing',
      message: t('settings.adapters.login.preparing'),
      updatedAt: Date.now(),
    })
    try {
      const next = await adaptersApi.startLogin(platform)
      if (loginLaunchRef.current !== launchId) {
        void adaptersApi.cancelLogin(next.sessionId).catch(() => {})
        return
      }
      setLoginState(next)
    } catch (error) {
      if (loginLaunchRef.current !== launchId) return
      setLoginState({
        sessionId: '',
        platform,
        status: 'error',
        message: error instanceof Error ? error.message : t('settings.adapters.login.startError'),
        updatedAt: Date.now(),
      })
    } finally {
      if (loginLaunchRef.current === launchId) setStartingPlatform(null)
    }
  }, [t])

  const closeLogin = useCallback(() => {
    const current = loginState
    loginLaunchRef.current += 1
    setStartingPlatform(null)
    setLoginState(null)
    setVerificationCode('')
    if (current?.sessionId && !['connected', 'error', 'expired', 'cancelled'].includes(current.status)) {
      void adaptersApi.cancelLogin(current.sessionId).catch(() => {})
    }
  }, [loginState])

  const submitVerification = useCallback(async () => {
    if (!loginState?.sessionId || !verificationCode.trim()) return
    setIsSubmittingVerification(true)
    try {
      setLoginState(await adaptersApi.submitWeixinVerification(loginState.sessionId, verificationCode))
      setVerificationCode('')
    } catch (error) {
      setLoginState((current) => current ? {
        ...current,
        message: error instanceof Error ? error.message : '校验数字提交失败',
      } : current)
    } finally {
      setIsSubmittingVerification(false)
    }
  }, [loginState, verificationCode])

  const disconnectPlatform = useCallback(async (platform: 'weixin' | 'qq') => {
    setDisconnectingPlatform(platform)
    try {
      if (platform === 'weixin') {
        await updateConfig({
          weixin: {
            enabled: false,
            accountId: '',
            botToken: '',
            baseUrl: '',
            userId: '',
            pairedUsers: [],
          },
        })
      } else {
        await updateConfig({
          qq: {
            enabled: false,
            appId: '',
            appSecret: '',
            pairedUsers: [],
          },
        })
      }
      await fetchConfig()
    } finally {
      setDisconnectingPlatform(null)
    }
  }, [fetchConfig, updateConfig])

  // Collect all paired users across platforms
  const allPairedUsers = [
    ...(config.telegram?.pairedUsers ?? []).map((u) => ({ ...u, platform: 'telegram' as const })),
    ...(config.weixin?.pairedUsers ?? []).map((u) => ({ ...u, platform: 'weixin' as const })),
    ...(config.qq?.pairedUsers ?? []).map((u) => ({ ...u, platform: 'qq' as const })),
    ...(config.dingtalk?.pairedUsers ?? []).map((u) => ({ ...u, platform: 'dingtalk' as const })),
  ]

  // Check pairing expiry
  const pairingExpiry = config.pairing?.expiresAt
  const isPairingActive = pairingExpiry ? Date.now() < pairingExpiry : false
  const minutesLeft = pairingExpiry ? Math.max(0, Math.ceil((pairingExpiry - Date.now()) / 60000)) : 0
  const imTabs: Array<{ value: ImTab; label: string }> = [
    { value: 'weixin', label: t('settings.adapters.weixin') },
    { value: 'qq', label: t('settings.adapters.qq') },
    { value: 'dingtalk', label: t('settings.adapters.dingtalk') },
    { value: 'telegram', label: t('settings.adapters.telegram') },
  ]
  const activeImLabel = imTabs.find((tab) => tab.value === activeIm)?.label ?? activeIm
  const isWeixinConnected = Boolean(config.weixin?.accountId && config.weixin?.botToken)
  const isQQConnected = Boolean(config.qq?.appId && config.qq?.appSecret)

  const openGuide = useCallback((platform: ImTab) => {
    setActiveIm(platform)
    setGuidePlatform(platform)
  }, [])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-[var(--color-text-tertiary)]">
        <Icon name="progress_activity" size={18} className="animate-spin text-[20px] mr-2" />
        {t('common.loading')}
      </div>
    )
  }

  return (
    <SettingsPage icon="chat" title={t('settings.tab.adapters')} description={t('settings.adapters.description')}>
      <div className="space-y-5">
        {/* Pairing */}
        <SettingsSection
          title={t('settings.adapters.pairing')}
          description={t('settings.adapters.pairingDesc')}
          action={(
            <Button variant="secondary" size="sm" onClick={handleGenerateCode} loading={isGenerating}>
              {pairingCode || isPairingActive
                ? t('settings.adapters.regenerateCode')
                : t('settings.adapters.generateCode')}
            </Button>
          )}
        >
          <div className="px-5 py-4 space-y-4">
            {(pairingCode || isPairingActive) && (
              <div className="flex flex-wrap items-center gap-2.5">
                {pairingCode && (
                  <span className="font-mono text-[24px] font-semibold tracking-[0.32em] text-[var(--color-text-primary)]">
                    {pairingCode}
                  </span>
                )}
                <span className="rounded-full border border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-text-tertiary)]">
                  {t('settings.adapters.codeExpiresIn')} {pairingCode ? 60 : minutesLeft} {t('settings.adapters.minutes')}
                </span>
              </div>
            )}
            {pairingCode && (
              <p className="text-[12px] leading-[1.6] text-[var(--color-text-tertiary)]">
                {t('settings.adapters.pairingCodeHint')}
              </p>
            )}

            <div>
              <h4 className="mb-2 text-[13px] font-semibold tracking-tight text-[var(--color-text-primary)]">
                {t('settings.adapters.pairedUsers')}
              </h4>
              {allPairedUsers.length === 0 ? (
                <p className="rounded-[12px] border border-dashed border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] px-4 py-5 text-center text-[13px] text-[var(--color-text-tertiary)]">
                  {t('settings.adapters.noPairedUsers')}
                </p>
              ) : (
                <div className="space-y-2">
                  {allPairedUsers.map((user) => (
                    <div
                      key={`${user.platform}-${user.userId}`}
                      className="flex items-center justify-between gap-3 rounded-[12px] border border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] px-3 py-2.5"
                    >
                      <div className="min-w-0 flex items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded bg-[var(--color-surface-container)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-text-secondary)]">
                          <ImPlatformIcon platform={user.platform} size={14} />
                          {t(`settings.adapters.platform.${user.platform}`)}
                        </span>
                        <span className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">{user.displayName}</span>
                        <span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">
                          {new Date(user.pairedAt).toLocaleDateString()}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleUnbind(user.platform, user.userId)}
                        className="shrink-0 rounded-md px-2 py-1 text-[12px] font-medium text-[var(--color-error)] transition-colors hover:bg-[var(--color-error)]/10"
                      >
                        {t('settings.adapters.unbind')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </SettingsSection>

      {/* Server URL —— 之前是个手填字段，但桌面端 Tauri 启动 adapter sidecar
          时已经把 server 的动态端口通过 ADAPTER_SERVER_URL env var 注进去了，
          loadConfig() 里 env 优先级高于这里的 file value，所以这个字段在桌面
          运行时完全不会被读到。用户也根本不知道该填什么端口（每次启动随机）。
          Standalone 模式（直接 bun run adapters/...）保留 file 字段兜底就够了。 */}

        {/* Default Project */}
        <SettingsSection>
          <SettingsRow
            label={t('settings.adapters.defaultProject')}
            hint={t('settings.adapters.defaultProjectHint')}
            align="start"
          >
            <div className="min-w-[220px]">
              <DirectoryPicker value={defaultProjectDir} onChange={setDefaultProjectDir} />
            </div>
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title={activeImLabel}>
          <div className="px-5 pt-4">
            <div
              className="grid grid-cols-2 gap-1 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-1 sm:grid-cols-4"
              role="tablist"
              aria-label={t('settings.adapters.channelTabs')}
            >
              {imTabs.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  role="tab"
                  aria-selected={activeIm === tab.value}
                  onClick={() => setActiveIm(tab.value)}
                  className={`flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-[6px] px-1.5 text-[12px] font-semibold transition-colors ${
                    activeIm === tab.value
                      ? 'bg-[var(--color-background)] text-[var(--color-text-primary)] shadow-sm'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
                  }`}
                >
                  <ImPlatformIcon platform={tab.value} size={17} />
                  <span className="min-w-0 truncate">{tab.label}</span>
                </button>
              ))}
            </div>
          </div>

          {activeIm === 'weixin' && (
            <div className="space-y-4 px-5 py-4">
              <PlatformGuidePrompt
                platform="weixin"
                title={t('settings.adapters.weixinGuideTitle')}
                description={t('settings.adapters.weixinGuideDesc')}
                buttonLabel={t('settings.adapters.openFullGuide')}
                onOpen={() => openGuide('weixin')}
              />
              <OfficialConnectionRow
                platform="weixin"
                connected={isWeixinConnected}
                enabled={wxEnabled}
                title={isWeixinConnected ? t('settings.adapters.weixinConnected') : t('settings.adapters.weixinNotConnected')}
                detail={isWeixinConnected
                  ? `${t('settings.adapters.account')}: ${config.weixin?.accountId}`
                  : t('settings.adapters.weixinQrHint')}
                onToggle={isWeixinConnected ? setWxEnabled : undefined}
                onConnect={() => handleStartLogin('weixin')}
                onDisconnect={() => void disconnectPlatform('weixin')}
                connecting={startingPlatform === 'weixin'}
                disconnecting={disconnectingPlatform === 'weixin'}
                connectLabel={t('settings.adapters.scanToConnect')}
                disconnectLabel={t('settings.adapters.disconnect')}
              />
              <Input
                label={t('settings.adapters.allowedUsers')}
                value={wxAllowedUsers}
                onChange={(event) => setWxAllowedUsers(event.target.value)}
                placeholder={t('settings.adapters.wxAllowedUsersPlaceholder')}
              />
              <p className="text-[12px] text-[var(--color-text-tertiary)]">{t('settings.adapters.pairedUsersHint')}</p>
            </div>
          )}

          {activeIm === 'qq' && (
            <div className="space-y-4 px-5 py-4">
              <PlatformGuidePrompt
                platform="qq"
                title={t('settings.adapters.qqGuideTitle')}
                description={t('settings.adapters.qqGuideDesc')}
                buttonLabel={t('settings.adapters.openFullGuide')}
                onOpen={() => openGuide('qq')}
              />
              <OfficialConnectionRow
                platform="qq"
                connected={isQQConnected}
                enabled={qqEnabled}
                title={isQQConnected ? t('settings.adapters.qqConnected') : t('settings.adapters.qqNotConnected')}
                detail={isQQConnected
                  ? `${t('settings.adapters.appId')}: ${config.qq?.appId}`
                  : t('settings.adapters.qqQrHint')}
                onToggle={isQQConnected ? setQqEnabled : undefined}
                onConnect={() => handleStartLogin('qq')}
                onDisconnect={() => void disconnectPlatform('qq')}
                connecting={startingPlatform === 'qq'}
                disconnecting={disconnectingPlatform === 'qq'}
                connectLabel={t('settings.adapters.scanToConnect')}
                disconnectLabel={t('settings.adapters.disconnect')}
              />
              <div className="flex items-center gap-3 pt-1">
                <div className="h-px flex-1 bg-[var(--color-border-separator)]" />
                <span className="text-[11px] font-medium text-[var(--color-text-tertiary)]">
                  {t('settings.adapters.manualCredentials')}
                </span>
                <div className="h-px flex-1 bg-[var(--color-border-separator)]" />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  label={t('settings.adapters.appId')}
                  value={qqAppId}
                  onChange={(event) => setQqAppId(event.target.value)}
                  placeholder={t('settings.adapters.qqAppIdPlaceholder')}
                />
                <Input
                  label={t('settings.adapters.appSecret')}
                  type="password"
                  value={qqAppSecret}
                  onChange={(event) => setQqAppSecret(event.target.value)}
                  placeholder={t('settings.adapters.qqAppSecretPlaceholder')}
                />
              </div>
              <Input
                label={t('settings.adapters.allowedUsers')}
                value={qqAllowedUsers}
                onChange={(event) => setQqAllowedUsers(event.target.value)}
                placeholder={t('settings.adapters.qqAllowedUsersPlaceholder')}
              />
              <SettingsRow
                label={t('settings.adapters.qqGroups')}
                hint={t('settings.adapters.qqGroupsHint')}
              >
                <Switch
                  checked={qqGroupEnabled}
                  onChange={setQqGroupEnabled}
                  ariaLabel={t('settings.adapters.qqGroups')}
                />
              </SettingsRow>
            </div>
          )}

          {activeIm === 'dingtalk' && (
            <div className="space-y-4 px-5 py-4">
              <PlatformGuidePrompt
                platform="dingtalk"
                title={t('settings.adapters.dingtalkGuideTitle')}
                description={t('settings.adapters.dingtalkGuideDesc')}
                buttonLabel={t('settings.adapters.openFullGuide')}
                onOpen={() => openGuide('dingtalk')}
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  label={t('settings.adapters.clientId')}
                  value={dtClientId}
                  onChange={(event) => setDtClientId(event.target.value)}
                  placeholder={t('settings.adapters.dingtalkClientIdPlaceholder')}
                />
                <Input
                  label={t('settings.adapters.clientSecret')}
                  type="password"
                  value={dtClientSecret}
                  onChange={(event) => setDtClientSecret(event.target.value)}
                  placeholder={t('settings.adapters.dingtalkClientSecretPlaceholder')}
                />
              </div>
              <Input
                label={t('settings.adapters.allowedUsers')}
                value={dtAllowedUsers}
                onChange={(event) => setDtAllowedUsers(event.target.value)}
                placeholder={t('settings.adapters.dtAllowedUsersPlaceholder')}
              />
              <p className="text-[12px] text-[var(--color-text-tertiary)]">{t('settings.adapters.allowedUsersHint')}</p>
            </div>
          )}

          {activeIm === 'telegram' && (
            <div className="space-y-4 px-5 py-4">
              <PlatformGuidePrompt
                platform="telegram"
                title={t('settings.adapters.telegramGuideTitle')}
                description={t('settings.adapters.telegramGuideDesc')}
                buttonLabel={t('settings.adapters.openFullGuide')}
                onOpen={() => openGuide('telegram')}
              />
              <Input
                label={t('settings.adapters.botToken')}
                type="password"
                value={tgBotToken}
                onChange={(e) => setTgBotToken(e.target.value)}
                placeholder={t('settings.adapters.botTokenPlaceholder')}
              />
              <Input
                label={t('settings.adapters.allowedUsers')}
                value={tgAllowedUsers}
                onChange={(e) => setTgAllowedUsers(e.target.value)}
                placeholder={t('settings.adapters.tgAllowedUsersPlaceholder')}
              />
              <p className="text-[12px] text-[var(--color-text-tertiary)]">{t('settings.adapters.allowedUsersHint')}</p>
            </div>
          )}
        </SettingsSection>

      {/* Save */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} loading={isSaving}>
          {saveStatus === 'saved' ? t('settings.adapters.saved') : t('settings.adapters.save')}
        </Button>
        {saveStatus === 'saved' && (
          <span className="text-[14px] text-[var(--color-success)]">
            <Icon name="check_circle" size={16} className="align-middle mr-1" />
            {t('settings.adapters.saved')}
          </span>
        )}
        {saveStatus === 'error' && (
          <span className="text-[14px] text-[var(--color-error)]">
            <Icon name="error" size={16} className="align-middle mr-1" />
            {saveError}
          </span>
        )}
      </div>

        <ConfirmDialog
          open={pendingUnbind !== null}
          onClose={() => {
            if (isUnbinding) return
            setPendingUnbind(null)
          }}
          onConfirm={confirmUnbind}
          title={t('settings.adapters.unbind')}
          body={t('settings.adapters.unbindConfirm')}
          confirmLabel={t('settings.adapters.unbind')}
          cancelLabel={t('common.cancel')}
          confirmVariant="danger"
          loading={isUnbinding}
        />
        <AdapterGuideModal
          platform={guidePlatform}
          onClose={() => setGuidePlatform(null)}
          closeLabel={t('common.close')}
        />
        <AdapterLoginModal
          state={loginState}
          verificationCode={verificationCode}
          submittingVerification={isSubmittingVerification}
          onVerificationCodeChange={setVerificationCode}
          onSubmitVerification={submitVerification}
          onRetry={() => {
            if (loginState) void handleStartLogin(loginState.platform)
          }}
          onClose={closeLogin}
        />
      </div>
    </SettingsPage>
  )
}

function parseStringList(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function OfficialConnectionRow({
  platform,
  connected,
  enabled,
  title,
  detail,
  connecting,
  disconnecting,
  connectLabel,
  disconnectLabel,
  onToggle,
  onConnect,
  onDisconnect,
}: {
  platform: ImPlatform
  connected: boolean
  enabled: boolean
  title: string
  detail: string
  connecting: boolean
  disconnecting: boolean
  connectLabel: string
  disconnectLabel: string
  onToggle?: (enabled: boolean) => void
  onConnect: () => void
  onDisconnect: () => void
}) {
  return (
    <div className="flex flex-col gap-3 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <ImPlatformIcon platform={platform} size={26} className="mt-0.5" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${connected && enabled ? 'bg-[var(--color-success)]' : 'bg-[var(--color-text-tertiary)]'}`} />
            <span className="truncate text-[13px] font-semibold text-[var(--color-text-primary)]">{title}</span>
          </div>
          <p className="mt-1 truncate text-[12px] text-[var(--color-text-tertiary)]">{detail}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {connected && onToggle && (
          <Switch checked={enabled} onChange={onToggle} ariaLabel={title} />
        )}
        {connected ? (
          <Button type="button" variant="ghost" size="sm" onClick={onDisconnect} loading={disconnecting}>
            {disconnectLabel}
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            onClick={onConnect}
            loading={connecting}
            icon={<Icon name="link" size={14} />}
          >
            {connectLabel}
          </Button>
        )}
      </div>
    </div>
  )
}

function AdapterLoginModal({
  state,
  verificationCode,
  submittingVerification,
  onVerificationCodeChange,
  onSubmitVerification,
  onRetry,
  onClose,
}: {
  state: AdapterLoginState | null
  verificationCode: string
  submittingVerification: boolean
  onVerificationCodeChange: (value: string) => void
  onSubmitVerification: () => void
  onRetry: () => void
  onClose: () => void
}) {
  const t = useTranslation()
  const terminal = state && ['connected', 'error', 'expired', 'cancelled'].includes(state.status)
  const success = state?.status === 'connected'
  const isPreparingQr = Boolean(state && !terminal && !state.qrDataUrl)
  const title = state?.platform === 'qq'
    ? t('settings.adapters.login.qqTitle')
    : t('settings.adapters.login.weixinTitle')

  return (
    <Modal
      open={Boolean(state)}
      onClose={onClose}
      title={title}
      width={440}
      footer={(
        <Button type="button" variant={success ? 'primary' : 'secondary'} onClick={onClose}>
          {success ? t('settings.adapters.login.done') : t('settings.adapters.login.close')}
        </Button>
      )}
    >
      {state && (
        <div className="flex flex-col items-center text-center">
          {state.qrDataUrl && !success ? (
            <div className="h-[260px] w-[260px] overflow-hidden rounded-[8px] border border-[var(--color-border-separator)] bg-white p-2">
              <img
                src={state.qrDataUrl}
                alt={`${title}二维码`}
                className="h-full w-full object-contain"
                draggable={false}
              />
            </div>
          ) : (
            <div className={`flex h-[96px] w-[96px] items-center justify-center rounded-full ${
              success
                ? 'bg-[var(--color-success)]/12 text-[var(--color-success)]'
                : state.status === 'error' || state.status === 'expired'
                  ? 'bg-[var(--color-error)]/10 text-[var(--color-error)]'
                  : 'bg-[var(--color-surface-container-low)] text-[var(--color-text-secondary)]'
            }`}>
              <Icon
                name={success ? 'check' : state.status === 'error' || state.status === 'expired' ? 'error' : 'progress_activity'}
                size={success ? 38 : 30}
                className={!terminal ? 'animate-spin' : undefined}
              />
            </div>
          )}

          <div
            className="mt-4 flex items-center gap-2 text-[13px] font-semibold text-[var(--color-text-primary)]"
            role="status"
            aria-live="polite"
          >
            <ImPlatformIcon platform={state.platform} size={18} />
            {!terminal && <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-text-accent)]" />}
            {state.message}
          </div>

          {isPreparingQr && (
            <div className="mt-5 w-full max-w-[320px]">
              <div
                className="h-[5px] overflow-hidden rounded-full bg-[var(--color-surface-container-high)]"
                role="progressbar"
                aria-label={t('settings.adapters.login.progressLabel')}
              >
                <div className="im-connection-progress h-full w-[36%] rounded-full bg-[var(--color-text-accent)]" />
              </div>
              <p className="mt-2 text-[11px] leading-5 text-[var(--color-text-tertiary)]">
                {t('settings.adapters.login.preparingHint')}
              </p>
            </div>
          )}

          {state.status === 'verification_required' && (
            <div className="mt-4 flex w-full items-end gap-2 text-left">
              <div className="min-w-0 flex-1">
                <Input
                  label={t('settings.adapters.login.verificationLabel')}
                  value={verificationCode}
                  onChange={(event) => onVerificationCodeChange(event.target.value.replace(/\D/g, '').slice(0, 8))}
                  placeholder={t('settings.adapters.login.verificationPlaceholder')}
                  inputMode="numeric"
                  autoFocus
                />
              </div>
              <Button
                type="button"
                size="md"
                onClick={onSubmitVerification}
                loading={submittingVerification}
                disabled={!verificationCode.trim()}
              >
                {t('settings.adapters.login.submit')}
              </Button>
            </div>
          )}

          {state.qrUrl && !terminal && (
            <a
              href={state.qrUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-[var(--color-text-accent)] hover:underline"
            >
              {t('settings.adapters.login.openLink')}
              <Icon name="open_in_new" size={12} />
            </a>
          )}

          {(state.status === 'error' || state.status === 'expired') && (
            <Button type="button" className="mt-4" onClick={onRetry} icon={<Icon name="refresh" size={14} />}>
              {t('settings.adapters.login.retry')}
            </Button>
          )}

          {!terminal && (
            <p className="mt-4 text-[11px] leading-5 text-[var(--color-text-tertiary)]">
              {t('settings.adapters.login.privacy')}
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}

function PlatformGuidePrompt({
  platform,
  title,
  description,
  buttonLabel,
  onOpen,
}: {
  platform: ImPlatform
  title: string
  description: string
  buttonLabel: string
  onOpen: () => void
}) {
  return (
    <div className="flex flex-col gap-3 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-[var(--color-border)] bg-[var(--color-background)] shadow-sm">
          <ImPlatformIcon platform={platform} size={22} />
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-bold text-[var(--color-text-primary)]">
            {title}
          </div>
          <p className="mt-1 text-[12px] leading-5 text-[var(--color-text-secondary)]">
            {description}
          </p>
        </div>
      </div>
      <Button
        type="button"
        variant="primary"
        size="md"
        onClick={onOpen}
        icon={<Icon name="article" size={14} />}
        className="w-full shrink-0 sm:w-auto"
      >
        {buttonLabel}
      </Button>
    </div>
  )
}

function AdapterGuideModal({
  platform,
  onClose,
  closeLabel,
}: {
  platform: ImTab | null
  onClose: () => void
  closeLabel: string
}) {
  const guide = platform ? ADAPTER_GUIDES[platform] : null

  return (
    <Modal
      open={Boolean(guide)}
      onClose={onClose}
      title={guide?.title}
      width={760}
      footer={(
        <Button type="button" variant="secondary" onClick={onClose}>
          {closeLabel}
        </Button>
      )}
    >
      {guide && (
        <div className="space-y-6">
          <p className="text-[13px] leading-6 text-[var(--color-text-secondary)]">
            {guide.summary}
          </p>

          <div className="space-y-5">
            {guide.steps.map((step, index) => (
              <section key={step.title} className="grid grid-cols-[32px_minmax(0,1fr)] gap-3">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-black text-[12px] font-bold text-white dark:bg-white dark:text-black">
                  {index + 1}
                </div>
                <div className="min-w-0">
                  <h3 className="text-[14px] font-bold text-[var(--color-text-primary)]">
                    {step.title}
                  </h3>
                  <div className="mt-1 text-[13px] leading-6 text-[var(--color-text-secondary)]">
                    {step.body}
                  </div>
                  {step.items && (
                    <ul className="mt-2 space-y-1 text-[12px] leading-5 text-[var(--color-text-tertiary)]">
                      {step.items.map((item) => (
                        <li key={item} className="flex gap-2">
                          <span className="mt-[8px] h-1 w-1 shrink-0 rounded-full bg-[var(--color-text-tertiary)]" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {step.command && (
                    <pre className="mt-2 overflow-x-auto rounded-[8px] bg-[var(--color-surface-container-low)] px-3 py-2 text-[12px] text-[var(--color-text-primary)]">
                      {step.command}
                    </pre>
                  )}
                </div>
              </section>
            ))}
          </div>

          <section className="rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3">
            <h3 className="text-[13px] font-bold text-[var(--color-text-primary)]">连接前检查</h3>
            <ul className="mt-2 space-y-1.5 text-[12px] leading-5 text-[var(--color-text-secondary)]">
              {guide.checks.map((check) => (
                <li key={check} className="flex gap-2">
                  <Icon name="check" size={13} className="mt-[3px] shrink-0 text-[var(--color-success)]" />
                  <span>{check}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </Modal>
  )
}
