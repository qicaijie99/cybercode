import { useEffect, useState } from 'react'
import { open as shellOpen } from '@tauri-apps/plugin-shell'
import { Check, ExternalLink, Link2Off } from 'lucide-react'
import { useCybercodeOAuthStore } from '../../stores/cybercodeOAuthStore'
import { useTranslation } from '../../i18n'
import { Button } from '../shared/Button'
import { Modal } from '../shared/Modal'
import { ProviderLogo } from '../providers/ProviderLogo'

type Props = {
  open: boolean
  onClose: () => void
  isDefault: boolean
  onSetDefault: () => Promise<void> | void
}

export function ClaudeOAuthDialog({
  open,
  onClose,
  isDefault,
  onSetDefault,
}: Props) {
  const t = useTranslation()
  const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(null)
  const [isSettingDefault, setIsSettingDefault] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const {
    status,
    isLoading,
    error,
    fetchStatus,
    login,
    logout,
    startPolling,
    stopPolling,
  } = useCybercodeOAuthStore()

  useEffect(() => {
    if (!open) {
      setAuthorizeUrl(null)
      setActionError(null)
      return
    }

    void fetchStatus()
    return () => stopPolling()
  }, [fetchStatus, open, stopPolling])

  useEffect(() => {
    if (status?.loggedIn) setAuthorizeUrl(null)
  }, [status])

  const openAuthorizationPage = async (url = authorizeUrl) => {
    if (!url) return
    try {
      await shellOpen(url)
      startPolling()
    } catch (openError) {
      console.error('[ClaudeOAuthDialog] shellOpen failed:', openError)
      setActionError(t('settings.claudeOfficialLogin.openBrowserFailed'))
    }
  }

  const handleLogin = async () => {
    setActionError(null)
    try {
      const result = await login()
      setAuthorizeUrl(result.authorizeUrl)
      await openAuthorizationPage(result.authorizeUrl)
    } catch {
      // Store errors are rendered below.
    }
  }

  const handleLogout = async () => {
    setActionError(null)
    try {
      await logout()
      setAuthorizeUrl(null)
    } catch {
      // Store errors are rendered below.
    }
  }

  const handleSetDefault = async () => {
    setIsSettingDefault(true)
    setActionError(null)
    try {
      await onSetDefault()
    } catch (setDefaultError) {
      setActionError(
        setDefaultError instanceof Error
          ? setDefaultError.message
          : String(setDefaultError),
      )
    } finally {
      setIsSettingDefault(false)
    }
  }

  const handleClose = () => {
    stopPolling()
    setAuthorizeUrl(null)
    setActionError(null)
    onClose()
  }

  const subscriptionLabel = status?.loggedIn && status.subscriptionType
    ? `Claude ${status.subscriptionType.toUpperCase()}`
    : 'Claude'
  const displayError = actionError || error

  return (
    <Modal open={open} onClose={handleClose} title="Claude Code" width={480}>
      <div className="flex flex-col gap-[18px]">
        <div className="flex items-center gap-[12px]">
          <ProviderLogo
            providerId="claude"
            name="Claude Code"
            size="md"
            active={status?.loggedIn === true}
            decorative
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-[7px]">
              <div className="text-[14px] font-bold text-[var(--color-text-primary)]">
                Claude Code
              </div>
              {isDefault && (
                <span className="rounded-full bg-[#1473e6]/10 px-[7px] py-[2px] text-[10px] font-semibold text-[#1473e6] dark:bg-[#68adff]/10 dark:text-[#68adff]">
                  {t('settings.providers.default')}
                </span>
              )}
            </div>
            <div className="mt-[2px] text-[11px] text-[var(--color-text-secondary)]">
              {status?.loggedIn
                ? t('settings.routing.oauthDialog.connected')
                : t('settings.routing.oauthDialog.browserFlow')}
            </div>
          </div>
        </div>

        {status?.loggedIn ? (
          <div className="rounded-[8px] border border-[var(--color-success)]/25 bg-[var(--color-success)]/[0.06] px-[14px] py-[12px]">
            <div className="flex items-center gap-[7px] text-[12px] font-semibold text-[var(--color-success)]">
              <Check size={15} />
              {t('settings.routing.oauthDialog.connected')}
            </div>
            <div className="mt-[5px] text-[11px] text-[var(--color-text-secondary)]">
              {subscriptionLabel}
            </div>
          </div>
        ) : authorizeUrl ? (
          <div className="rounded-[8px] border border-[#1473e6]/25 bg-[#1473e6]/[0.05] px-[14px] py-[13px] dark:border-[#68adff]/25 dark:bg-[#68adff]/[0.06]">
            <div className="flex items-center gap-[8px] text-[11px] font-medium text-[#1473e6] dark:text-[#68adff]">
              <span className="h-[7px] w-[7px] animate-pulse rounded-full bg-current" />
              {t('settings.routing.oauthDialog.browserWaiting', {
                provider: 'Claude Code',
              })}
            </div>
            <p className="mt-[7px] text-[10px] leading-[1.6] text-[var(--color-text-secondary)]">
              {t('settings.routing.oauthDialog.browserReturn')}
            </p>
          </div>
        ) : (
          <p className="text-[12px] leading-[1.65] text-[var(--color-text-secondary)]">
            {t('settings.routing.oauthDialog.description')}
          </p>
        )}

        {displayError && (
          <div className="rounded-[7px] bg-[var(--color-error)]/10 px-[12px] py-[9px] text-[11px] text-[var(--color-error)]">
            {displayError}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-[8px]">
          {!isDefault && (
            <Button
              type="button"
              variant="secondary"
              loading={isSettingDefault}
              onClick={() => void handleSetDefault()}
            >
              {t('settings.providers.setDefault')}
            </Button>
          )}
          {status?.loggedIn ? (
            <Button
              type="button"
              variant="secondary"
              loading={isLoading}
              icon={<Link2Off size={14} />}
              onClick={() => void handleLogout()}
            >
              {t('settings.routing.oauthDialog.disconnect')}
            </Button>
          ) : authorizeUrl ? (
            <Button
              type="button"
              variant="secondary"
              icon={<ExternalLink size={14} />}
              onClick={() => void openAuthorizationPage()}
            >
              {t('settings.routing.oauthDialog.openPage')}
            </Button>
          ) : (
            <Button
              type="button"
              loading={isLoading}
              icon={<ExternalLink size={14} />}
              onClick={() => void handleLogin()}
            >
              {t('settings.routing.oauthDialog.connect')}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
