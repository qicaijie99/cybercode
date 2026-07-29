import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  ExternalLink,
  KeyRound,
  Link2Off,
  Play,
} from 'lucide-react'
import {
  getMediaProviderName,
  type MediaProviderDefinition,
  type MediaService,
} from '../../../../src/shared/mediaProviders'
import {
  mediaProvidersApi,
  type MediaProviderStatus,
  type MediaProviderTestResult,
} from '../../api/mediaProviders'
import { openExternalUrl } from '../../lib/openExternalUrl'
import { useSettingsStore } from '../../stores/settingsStore'
import { Button } from '../shared/Button'
import { Input } from '../shared/Input'
import { Modal } from '../shared/Modal'
import { ProviderLogo } from './ProviderLogo'

type Props = {
  provider: MediaProviderDefinition | null
  status?: MediaProviderStatus
  onClose: () => void
  onChanged: () => Promise<void> | void
  onTestResult: (result: MediaProviderTestResult) => void
  labels: {
    connected: string
    inherited: string
    localReady: string
    noAuthReady: string
    notConfigured: string
    model: string
    openWebsite: string
    save: string
    test: string
    disconnect: string
    credentialSaved: string
    connectionNote: string
    inheritedNote: string
    localNote: string
    noAuthNote: string
    saveFailed: string
    testPassed: string
    reachabilityPassed: string
    imageGeneration: string
    imageEdit: string
    videoGeneration: string
    speechToText: string
    textToSpeech: string
    musicGeneration: string
  }
}

export function MediaProviderDialog({
  provider,
  status,
  onClose,
  onChanged,
  onTestResult,
  labels,
}: Props) {
  const locale = useSettingsStore((state) => state.locale)
  const [credentials, setCredentials] = useState<Record<string, string>>({})
  const [modelId, setModelId] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    setCredentials({})
    setModelId(status?.modelId ?? provider?.defaultModel ?? '')
    setError(null)
    setSuccess(null)
  }, [provider?.id, provider?.kind, provider?.defaultModel, status?.modelId])

  const serviceLabels = useMemo<Record<MediaService, string>>(() => ({
    'image-generation': labels.imageGeneration,
    'image-edit': labels.imageEdit,
    'video-generation': labels.videoGeneration,
    'speech-to-text': labels.speechToText,
    'text-to-speech': labels.textToSpeech,
    'music-generation': labels.musicGeneration,
  }), [labels])

  if (!provider) return null

  const displayName = getMediaProviderName(provider, locale)
  const statusLabel = status?.credentialSource === 'provider'
    ? labels.inherited
    : status?.credentialSource === 'local'
      ? labels.localReady
      : status?.credentialSource === 'not-required'
        ? labels.noAuthReady
        : status?.connected
          ? labels.connected
          : labels.notConfigured
  const note = status?.credentialSource === 'provider'
    ? labels.inheritedNote
    : status?.credentialSource === 'local'
      ? labels.localNote
      : status?.credentialSource === 'not-required'
        ? labels.noAuthNote
        : labels.connectionNote
  const requiredCredentialsEntered = provider.credentialFields.every(
    (field) => !field.required || Boolean(credentials[field.id]?.trim()),
  )
  const canSave = (
    status?.connected === true ||
    provider.credentialFields.length === 0 ||
    requiredCredentialsEntered
  )

  const save = async () => {
    setIsSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const enteredCredentials = Object.fromEntries(
        Object.entries(credentials).filter(([, value]) => value.trim()),
      )
      await mediaProvidersApi.save(provider.kind, provider.id, {
        ...(Object.keys(enteredCredentials).length > 0 && {
          credentials: enteredCredentials,
        }),
        modelId,
      })
      setCredentials({})
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
      const { result } = await mediaProvidersApi.test(provider.kind, provider.id)
      onTestResult(result)
      if (result.success) {
        setSuccess(
          (result.verification === 'credential'
            ? labels.testPassed
            : labels.reachabilityPassed
          ).replace('{latency}', String(result.latencyMs)),
        )
      } else {
        setError(result.error ?? labels.saveFailed)
      }
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : labels.saveFailed)
    } finally {
      setIsTesting(false)
    }
  }

  const disconnect = async () => {
    setIsDisconnecting(true)
    setError(null)
    try {
      await mediaProvidersApi.disconnect(provider.kind, provider.id)
      await onChanged()
      onClose()
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : labels.saveFailed)
    } finally {
      setIsDisconnecting(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={displayName} width={540}>
      <div className="flex flex-col gap-[18px]">
        <div className="flex items-center gap-[12px]">
          <ProviderLogo
            name={displayName}
            providerId={provider.logoProviderId}
            baseUrl={provider.baseUrl}
            size="md"
            active={status?.configured}
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
              {statusLabel}
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

        <div className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-[14px] py-[11px] text-[11px] leading-[1.6] text-[var(--color-text-secondary)]">
          {note}
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
                {serviceLabels[model.service]} · {model.label}
              </option>
            ))}
          </select>
        </label>

        {provider.credentialFields.length > 0 && (
          <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
            {provider.credentialFields.map((field) => (
              <Input
                key={field.id}
                label={field.label}
                type={field.secret ? 'password' : 'text'}
                value={credentials[field.id] ?? ''}
                placeholder={status?.connected ? labels.credentialSaved : field.placeholder}
                autoComplete="off"
                spellCheck={false}
                required={!status?.connected && field.required}
                className="rounded-[8px] font-mono text-[11px]"
                onChange={(event) => {
                  const value = event.target.value
                  setCredentials((current) => ({ ...current, [field.id]: value }))
                }}
              />
            ))}
          </div>
        )}

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
            {status?.credentialSource === 'media' && (
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
            )}
            <Button
              type="button"
              size="sm"
              loading={isSaving}
              disabled={!canSave}
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
