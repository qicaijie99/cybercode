import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ExternalLink,
  KeyRound,
  Link2Off,
  Play,
  Star,
} from 'lucide-react'
import {
  getWebSessionProviderName,
  type WebSessionProviderDefinition,
} from '../../../../src/shared/webSessionProviders'
import {
  webSessionProvidersApi,
  type WebSessionProviderStatus,
  type WebSessionProviderTestResult,
} from '../../api/webSessionProviders'
import { useSettingsStore } from '../../stores/settingsStore'
import { openExternalUrl } from '../../lib/openExternalUrl'
import { Button } from '../shared/Button'
import { Modal } from '../shared/Modal'
import { Textarea } from '../shared/Textarea'
import { ProviderLogo } from './ProviderLogo'

type Props = {
  provider: WebSessionProviderDefinition | null
  status?: WebSessionProviderStatus
  onClose: () => void
  onChanged: () => Promise<void> | void
  onTestResult: (result: WebSessionProviderTestResult) => void
  labels: {
    connected: string
    notConfigured: string
    credential: string
    credentialSaved: string
    model: string
    openWebsite: string
    save: string
    test: string
    setDefault: string
    defaultProvider: string
    disconnect: string
    riskTitle: string
    riskBody: string
    compatibilityNote: string
    saveFailed: string
    testPassed: string
  }
}

export function WebSessionProviderDialog({
  provider,
  status,
  onClose,
  onChanged,
  onTestResult,
  labels,
}: Props) {
  const locale = useSettingsStore((state) => state.locale)
  const [credential, setCredential] = useState('')
  const [modelId, setModelId] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [isActivating, setIsActivating] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    setCredential('')
    setModelId(status?.modelId ?? provider?.defaultModel ?? '')
    setError(null)
    setSuccess(null)
  }, [provider?.id, provider?.defaultModel, status?.modelId])

  if (!provider) return null

  const displayName = getWebSessionProviderName(provider, locale)

  const save = async () => {
    setIsSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await webSessionProvidersApi.save(provider.id, {
        ...(credential.trim() && { credential }),
        modelId,
      })
      setCredential('')
      await onChanged()
      setSuccess(labels.connected)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : labels.saveFailed)
    } finally {
      setIsSaving(false)
    }
  }

  const test = async () => {
    setIsTesting(true)
    setError(null)
    setSuccess(null)
    try {
      const { result } = await webSessionProvidersApi.test(provider.id)
      onTestResult(result)
      if (result.success) setSuccess(labels.testPassed.replace('{latency}', String(result.latencyMs)))
      else setError(result.error ?? labels.saveFailed)
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : labels.saveFailed)
    } finally {
      setIsTesting(false)
    }
  }

  const activate = async () => {
    setIsActivating(true)
    setError(null)
    try {
      await webSessionProvidersApi.activate(provider.id)
      await onChanged()
    } catch (activateError) {
      setError(activateError instanceof Error ? activateError.message : labels.saveFailed)
    } finally {
      setIsActivating(false)
    }
  }

  const disconnect = async () => {
    setIsDisconnecting(true)
    setError(null)
    try {
      await webSessionProvidersApi.disconnect(provider.id)
      await onChanged()
      onClose()
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : labels.saveFailed)
    } finally {
      setIsDisconnecting(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={displayName} width={520}>
      <div className="flex flex-col gap-[18px]">
        <div className="flex items-center gap-[12px]">
          <ProviderLogo
            name={displayName}
            providerId={provider.logoProviderId}
            baseUrl={provider.website}
            size="md"
            active={status?.connected}
            decorative
          />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-bold text-[var(--color-text-primary)]">
              {displayName}
            </div>
            <div className={`mt-[2px] text-[11px] font-medium ${
              status?.connected
                ? 'text-[#1473e6] dark:text-[#68adff]'
                : 'text-[var(--color-text-secondary)]'
            }`}>
              {status?.active
                ? labels.defaultProvider
                : status?.connected
                  ? labels.connected
                  : labels.notConfigured}
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon={<ExternalLink size={15} />}
            onClick={() => void openExternalUrl(provider.website)}
          >
            {labels.openWebsite}
          </Button>
        </div>

        <div className="rounded-[8px] border border-amber-500/30 bg-amber-500/[0.07] px-[14px] py-[12px]">
          <div className="flex items-start gap-[9px]">
            <AlertTriangle
              size={17}
              className="mt-[1px] shrink-0 text-amber-600 dark:text-amber-400"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <div className="text-[12px] font-bold text-[var(--color-text-primary)]">
                {labels.riskTitle}
              </div>
              <p className="mt-[4px] text-[11px] leading-[1.6] text-[var(--color-text-secondary)]">
                {labels.riskBody}
              </p>
              <p className="mt-[6px] text-[10px] leading-[1.55] text-amber-700 dark:text-amber-300">
                {labels.compatibilityNote}
              </p>
            </div>
          </div>
        </div>

        <label className="flex flex-col gap-[6px]">
          <span className="text-[12px] font-bold text-[var(--color-text-primary)]">
            {labels.model}
          </span>
          <select
            value={modelId}
            onChange={(event) => setModelId(event.target.value)}
            className="h-[40px] rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-[11px] text-[12px] font-medium text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)] focus:shadow-[var(--shadow-focus-ring)]"
          >
            {provider.models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
        </label>

        <Textarea
          label={`${labels.credential} · ${provider.credentialName}`}
          value={credential}
          onChange={(event) => setCredential(event.target.value)}
          placeholder={status?.connected
            ? labels.credentialSaved
            : provider.credentialPlaceholder}
          autoComplete="off"
          spellCheck={false}
          className="min-h-[112px] font-mono text-[11px]"
        />

        {error && (
          <div role="alert" className="text-[11px] font-medium leading-[1.55] text-[var(--color-error)]">
            {error}
          </div>
        )}
        {success && (
          <div className="flex items-center gap-[6px] text-[11px] font-medium text-[var(--color-success)]">
            <Check size={14} />
            {success}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-[10px] border-t border-[var(--color-border-separator)] pt-[16px]">
          <div>
            {status?.connected && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                loading={isDisconnecting}
                icon={<Link2Off size={15} />}
                onClick={() => void disconnect()}
              >
                {labels.disconnect}
              </Button>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-[8px]">
            {status?.connected && (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={isTesting}
                  icon={<Play size={14} />}
                  onClick={() => void test()}
                >
                  {labels.test}
                </Button>
                {!status.active && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    loading={isActivating}
                    icon={<Star size={14} />}
                    onClick={() => void activate()}
                  >
                    {labels.setDefault}
                  </Button>
                )}
              </>
            )}
            <Button
              type="button"
              size="sm"
              loading={isSaving}
              disabled={!status?.connected && !credential.trim()}
              icon={<KeyRound size={14} />}
              onClick={() => void save()}
            >
              {labels.save}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
