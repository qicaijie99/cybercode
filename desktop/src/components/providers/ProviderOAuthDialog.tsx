import { useEffect, useRef, useState } from 'react'
import {
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Link2Off,
  LoaderCircle,
  Search,
} from 'lucide-react'
import {
  providerOAuthApi,
  type ProviderOAuthCapability,
  type ProviderOAuthImportInput,
  type ProviderOAuthStart,
  type ProviderOAuthStatus,
} from '../../api/providerOAuth'
import { useTranslation } from '../../i18n'
import { openExternalUrl } from '../../lib/openExternalUrl'
import { Button } from '../shared/Button'
import { Input } from '../shared/Input'
import { Modal } from '../shared/Modal'
import { OAuthRiskNotice } from './OAuthRiskNotice'
import { ProviderLogo } from './ProviderLogo'
import type { OAuthProviderCatalogItem } from './OAuthProviderCatalog'

type Props = {
  provider: OAuthProviderCatalogItem | null
  capability?: ProviderOAuthCapability
  status?: ProviderOAuthStatus
  onClose: () => void
  onChanged: () => Promise<void> | void
}

export function ProviderOAuthDialog({
  provider,
  capability,
  status,
  onClose,
  onChanged,
}: Props) {
  const t = useTranslation()
  const [loginFlow, setLoginFlow] = useState<ProviderOAuthStart | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [isDetecting, setIsDetecting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [detection, setDetection] = useState<{
    found: boolean
    source?: string
  } | null>(null)
  const [accessToken, setAccessToken] = useState('')
  const [machineId, setMachineId] = useState('')
  const [gitLabBaseUrl, setGitLabBaseUrl] = useState('https://gitlab.com')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [showTraeDetails, setShowTraeDetails] = useState(false)
  const [traeDetails, setTraeDetails] = useState({
    webId: '',
    bizUserId: '',
    userUniqueId: '',
    scope: 'marscode-us',
    tenant: 'marscode',
    region: 'US-East',
  })
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stopPolling = () => {
    if (pollTimer.current) clearTimeout(pollTimer.current)
    pollTimer.current = null
  }

  useEffect(() => {
    setLoginFlow(null)
    setError(null)
    setCopied(false)
    setDetection(null)
    setAccessToken('')
    setMachineId('')
    setGitLabBaseUrl('https://gitlab.com')
    setClientId('')
    setClientSecret('')
    setShowTraeDetails(false)
    setTraeDetails({
      webId: '',
      bizUserId: '',
      userUniqueId: '',
      scope: 'marscode-us',
      tenant: 'marscode',
      region: 'US-East',
    })
    stopPolling()
    return stopPolling
  }, [provider?.id])

  useEffect(() => {
    if (!provider || !capability?.canAutoDetect || status?.connected) return
    let active = true
    setIsDetecting(true)
    setError(null)
    void providerOAuthApi.detect(provider.id)
      .then((result) => {
        if (active) setDetection({ found: result.found, source: result.source })
      })
      .catch((detectError) => {
        if (active) {
          setDetection({ found: false })
          setError(detectError instanceof Error ? detectError.message : String(detectError))
        }
      })
      .finally(() => {
        if (active) setIsDetecting(false)
      })
    return () => {
      active = false
    }
  }, [capability?.canAutoDetect, provider, status?.connected])

  const schedulePoll = (
    providerId: string,
    sessionId: string,
    intervalMs: number,
  ) => {
    stopPolling()
    pollTimer.current = setTimeout(async () => {
      try {
        const result = await providerOAuthApi.poll(providerId, sessionId)
        if (result.status === 'connected') {
          setLoginFlow(null)
          await onChanged()
          return
        }
        schedulePoll(providerId, sessionId, result.intervalMs)
      } catch (pollError) {
        setError(pollError instanceof Error ? pollError.message : String(pollError))
        setLoginFlow(null)
      }
    }, intervalMs)
  }

  const openLoginPage = async (flow: ProviderOAuthStart | null = loginFlow) => {
    if (!flow) return
    try {
      await openExternalUrl(
        flow.flowType === 'device_code'
          ? flow.verificationUriComplete || flow.verificationUri
          : flow.authorizeUrl,
      )
    } catch {
      throw new Error(t('settings.routing.oauthDialog.openBrowserFailed'))
    }
  }

  const startLogin = async () => {
    if (!provider || !capability) return
    setIsStarting(true)
    setError(null)
    try {
      const flow = await providerOAuthApi.start(
        provider.id,
        capability.setupMode === 'configured_browser'
          ? {
              baseUrl: gitLabBaseUrl,
              clientId,
              clientSecret,
            }
          : undefined,
      )
      setLoginFlow(flow)
      schedulePoll(provider.id, flow.sessionId, flow.intervalMs)
      await openLoginPage(flow)
    } catch (startError) {
      setLoginFlow(null)
      stopPolling()
      setError(startError instanceof Error ? startError.message : String(startError))
    } finally {
      setIsStarting(false)
    }
  }

  const importCredential = async (autoDetect = false) => {
    if (!provider) return
    setIsImporting(true)
    setError(null)
    try {
      const input: ProviderOAuthImportInput = autoDetect
        ? { autoDetect: true }
        : {
            accessToken,
            ...(provider.id === 'cursor' && machineId.trim() && { machineId }),
            ...(provider.id === 'trae' && {
              webId: traeDetails.webId,
              bizUserId: traeDetails.bizUserId,
              userUniqueId: traeDetails.userUniqueId,
              scope: traeDetails.scope,
              tenant: traeDetails.tenant,
              region: traeDetails.region,
            }),
          }
      await providerOAuthApi.importConnection(provider.id, input)
      setAccessToken('')
      await onChanged()
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError))
    } finally {
      setIsImporting(false)
    }
  }

  const disconnect = async () => {
    if (!provider) return
    setIsDisconnecting(true)
    setError(null)
    try {
      await providerOAuthApi.disconnect(provider.id)
      setLoginFlow(null)
      stopPolling()
      await onChanged()
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : String(disconnectError))
    } finally {
      setIsDisconnecting(false)
    }
  }

  const copyCode = async () => {
    if (!loginFlow || loginFlow.flowType !== 'device_code') return
    await navigator.clipboard.writeText(loginFlow.userCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 1_500)
  }

  const openHelp = async () => {
    if (!capability?.helpUrl) return
    try {
      await openExternalUrl(capability.helpUrl)
    } catch {
      setError(t('settings.routing.oauthDialog.openBrowserFailed'))
    }
  }

  const setupSummary = capability?.setupMode === 'device_code'
    ? t('settings.routing.oauthDialog.deviceFlow')
    : capability?.setupMode === 'browser' ||
        capability?.setupMode === 'configured_browser'
      ? t('settings.routing.oauthDialog.browserFlow')
      : capability?.setupMode === 'local_import'
        ? t('settings.routing.oauthDialog.localImportFlow')
        : t('settings.routing.oauthDialog.tokenImportFlow')

  const isImportMode = capability?.setupMode === 'local_import' ||
    capability?.setupMode === 'token_import'

  return (
    <Modal
      open={provider !== null}
      onClose={onClose}
      title={provider?.name}
      width={480}
    >
      {provider && (
        <div className="flex flex-col gap-[18px]">
          <div className="flex items-center gap-[12px]">
            <ProviderLogo
              providerId={provider.id}
              name={provider.name}
              size="md"
              active={status?.connected}
              decorative
            />
            <div className="min-w-0">
              <div className="text-[14px] font-bold text-[var(--color-text-primary)]">
                {provider.name}
              </div>
              <div className="mt-[2px] text-[11px] text-[var(--color-text-secondary)]">
                {status?.connected
                  ? t('settings.routing.oauthDialog.connected')
                  : setupSummary}
              </div>
            </div>
          </div>

          {!status?.connected && (
            <OAuthRiskNotice providerName={provider.name} />
          )}

          {status?.connected ? (
            <div className="rounded-[8px] border border-[var(--color-success)]/25 bg-[var(--color-success)]/[0.06] px-[14px] py-[12px]">
              <div className="flex items-center gap-[7px] text-[12px] font-semibold text-[var(--color-success)]">
                <Check size={15} />
                {t('settings.routing.oauthDialog.connected')}
              </div>
              {status.accountLabel && (
                <div className="mt-[5px] text-[11px] text-[var(--color-text-secondary)]">
                  {status.accountLabel}
                </div>
              )}
            </div>
          ) : loginFlow?.flowType === 'device_code' ? (
            <div className="rounded-[8px] border border-[#1473e6]/25 bg-[#1473e6]/[0.05] p-[14px] dark:border-[#68adff]/25 dark:bg-[#68adff]/[0.06]">
              <div className="text-[11px] leading-[1.6] text-[var(--color-text-secondary)]">
                {t('settings.routing.oauthDialog.enterCode')}
              </div>
              <button
                type="button"
                onClick={copyCode}
                className="mt-[10px] flex h-[48px] w-full items-center justify-center gap-[9px] rounded-[7px] border border-[var(--color-border)] bg-[var(--color-background)] font-mono text-[18px] font-bold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                title={t('settings.routing.oauthDialog.copyCode')}
              >
                {loginFlow.userCode}
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
              <div className="mt-[10px] flex items-center gap-[6px] text-[10px] text-[#1473e6] dark:text-[#68adff]">
                <span className="h-[6px] w-[6px] animate-pulse rounded-full bg-current" />
                {t('settings.routing.oauthDialog.waiting')}
              </div>
            </div>
          ) : loginFlow ? (
            <div className="rounded-[8px] border border-[#1473e6]/25 bg-[#1473e6]/[0.05] px-[14px] py-[13px] dark:border-[#68adff]/25 dark:bg-[#68adff]/[0.06]">
              <div className="flex items-center gap-[8px] text-[11px] font-medium text-[#1473e6] dark:text-[#68adff]">
                <span className="h-[7px] w-[7px] animate-pulse rounded-full bg-current" />
                {t('settings.routing.oauthDialog.browserWaiting', {
                  provider: provider.name,
                })}
              </div>
              <p className="mt-[7px] text-[10px] leading-[1.6] text-[var(--color-text-secondary)]">
                {t('settings.routing.oauthDialog.browserReturn')}
              </p>
            </div>
          ) : capability?.setupMode === 'configured_browser' ? (
            <div className="flex flex-col gap-[12px]">
              <p className="text-[12px] leading-[1.65] text-[var(--color-text-secondary)]">
                {t('settings.routing.oauthDialog.gitlabDescription')}
              </p>
              <Input
                label={t('settings.routing.oauthDialog.gitlabBaseUrl')}
                value={gitLabBaseUrl}
                onChange={(event) => setGitLabBaseUrl(event.target.value)}
                placeholder="https://gitlab.com"
              />
              <Input
                label={t('settings.routing.oauthDialog.clientId')}
                required
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                autoComplete="off"
              />
              <Input
                label={t('settings.routing.oauthDialog.clientSecret')}
                value={clientSecret}
                onChange={(event) => setClientSecret(event.target.value)}
                type="password"
                autoComplete="off"
              />
              <button
                type="button"
                className="flex w-fit items-center gap-[5px] text-[11px] font-semibold text-[#1473e6] hover:underline dark:text-[#68adff]"
                onClick={() => void openHelp()}
              >
                <ExternalLink size={13} />
                {t('settings.routing.oauthDialog.registrationHelp')}
              </button>
            </div>
          ) : isImportMode ? (
            <div className="flex flex-col gap-[12px]">
              {capability.setupMode === 'local_import' && (
                <div className="min-h-[54px] rounded-[8px] border border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] px-[13px] py-[11px]">
                  {isDetecting ? (
                    <div className="flex items-center gap-[8px] text-[11px] text-[var(--color-text-secondary)]">
                      <LoaderCircle size={15} className="animate-spin" />
                      {t('settings.routing.oauthDialog.detecting')}
                    </div>
                  ) : detection?.found ? (
                    <div>
                      <div className="flex items-center gap-[7px] text-[11px] font-semibold text-[var(--color-success)]">
                        <Check size={14} />
                        {t('settings.routing.oauthDialog.detected')}
                      </div>
                      {detection.source && (
                        <div
                          className="mt-[4px] truncate font-mono text-[10px] text-[var(--color-text-tertiary)]"
                          title={detection.source}
                        >
                          {detection.source}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-[11px] leading-[1.55] text-[var(--color-text-secondary)]">
                      {t('settings.routing.oauthDialog.notDetected')}
                    </div>
                  )}
                </div>
              )}

              <p className="text-[11px] leading-[1.65] text-[var(--color-text-secondary)]">
                {t(
                  provider.id === 'windsurf'
                    ? 'settings.routing.oauthDialog.windsurfHint'
                    : provider.id === 'trae'
                      ? 'settings.routing.oauthDialog.traeHint'
                      : provider.id === 'qoder'
                        ? 'settings.routing.oauthDialog.qoderHint'
                        : 'settings.routing.oauthDialog.importHint',
                )}
              </p>

              <div className="flex flex-col gap-[6px]">
                <label
                  htmlFor="provider-oauth-token"
                  className="text-[12px] font-bold text-[var(--color-text-primary)]"
                >
                  {t('settings.routing.oauthDialog.accessToken')}
                </label>
                <textarea
                  id="provider-oauth-token"
                  rows={3}
                  value={accessToken}
                  onChange={(event) => setAccessToken(event.target.value)}
                  placeholder={t('settings.routing.oauthDialog.accessTokenPlaceholder')}
                  className="w-full resize-none rounded-[8px] border border-[var(--color-border)] bg-white px-[12px] py-[9px] font-mono text-[12px] text-[var(--color-text-primary)] outline-none transition-shadow placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)] focus:shadow-[var(--shadow-focus-ring)] dark:bg-[var(--color-surface-container-low)]"
                />
              </div>

              {provider.id === 'cursor' && (
                <Input
                  label={t('settings.routing.oauthDialog.machineId')}
                  value={machineId}
                  onChange={(event) => setMachineId(event.target.value)}
                  placeholder={t('settings.routing.oauthDialog.optional')}
                />
              )}

              {provider.id === 'trae' && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowTraeDetails((shown) => !shown)}
                    className="text-[11px] font-semibold text-[#1473e6] hover:underline dark:text-[#68adff]"
                  >
                    {showTraeDetails
                      ? t('settings.routing.oauthDialog.hideAdvanced')
                      : t('settings.routing.oauthDialog.showAdvanced')}
                  </button>
                  {showTraeDetails && (
                    <div className="mt-[10px] grid grid-cols-2 gap-[9px]">
                      {([
                        ['webId', 'Web ID'],
                        ['bizUserId', 'Biz User ID'],
                        ['userUniqueId', 'User Unique ID'],
                        ['scope', 'Scope'],
                        ['tenant', 'Tenant'],
                        ['region', 'Region'],
                      ] as const).map(([key, label]) => (
                        <Input
                          key={key}
                          label={label}
                          value={traeDetails[key]}
                          onChange={(event) => setTraeDetails((details) => ({
                            ...details,
                            [key]: event.target.value,
                          }))}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {capability.helpUrl && (
                <button
                  type="button"
                  className="flex w-fit items-center gap-[5px] text-[11px] font-semibold text-[#1473e6] hover:underline dark:text-[#68adff]"
                  onClick={() => void openHelp()}
                >
                  <ExternalLink size={13} />
                  {t('settings.routing.oauthDialog.openInstructions')}
                </button>
              )}
            </div>
          ) : capability ? (
            <p className="text-[12px] leading-[1.65] text-[var(--color-text-secondary)]">
              {t('settings.routing.oauthDialog.description')}
            </p>
          ) : (
            <div className="rounded-[8px] border border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] px-[14px] py-[13px] text-[11px] leading-[1.65] text-[var(--color-text-secondary)]">
              {t('settings.routing.oauthDialog.loadingCapability')}
            </div>
          )}

          {error && (
            <div className="rounded-[7px] bg-[var(--color-error)]/10 px-[12px] py-[9px] text-[11px] text-[var(--color-error)]">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-[8px]">
            {status?.connected ? (
              <Button
                type="button"
                variant="secondary"
                loading={isDisconnecting}
                icon={<Link2Off size={14} />}
                onClick={disconnect}
              >
                {t('settings.routing.oauthDialog.disconnect')}
              </Button>
            ) : loginFlow ? (
              <Button
                type="button"
                variant="secondary"
                icon={<ExternalLink size={14} />}
                onClick={() => {
                  setError(null)
                  void openLoginPage().catch((openError) => {
                    setError(openError instanceof Error ? openError.message : String(openError))
                  })
                }}
              >
                {t('settings.routing.oauthDialog.openPage')}
              </Button>
            ) : isImportMode ? (
              <>
                {detection?.found && capability?.canAutoDetect && (
                  <Button
                    type="button"
                    variant="secondary"
                    loading={isImporting}
                    icon={<Search size={14} />}
                    onClick={() => void importCredential(true)}
                  >
                    {t('settings.routing.oauthDialog.useDetected')}
                  </Button>
                )}
                <Button
                  type="button"
                  loading={isImporting}
                  disabled={!accessToken.trim()}
                  icon={<KeyRound size={14} />}
                  onClick={() => void importCredential(false)}
                >
                  {t('settings.routing.oauthDialog.importToken')}
                </Button>
              </>
            ) : capability ? (
              <Button
                type="button"
                loading={isStarting}
                disabled={
                  capability.setupMode === 'configured_browser' &&
                  (!gitLabBaseUrl.trim() || !clientId.trim())
                }
                icon={<ExternalLink size={14} />}
                onClick={() => void startLogin()}
              >
                {t('settings.routing.oauthDialog.connect')}
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </Modal>
  )
}
