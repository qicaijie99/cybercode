import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  ExternalLink,
  KeyRound,
  Link2Off,
  Play,
  Star,
} from 'lucide-react'
import {
  getWebSessionCredentialSource,
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
import { SelectField } from '../shared/SelectField'
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
    howToGet: string
    hideGuide: string
    exactCredential: string
    credentialExample: string
    stepLogin: string
    stepLoginBody: string
    stepFind: string
    findCookiesBody: string
    findCookieValueBody: string
    findLocalStorageBody: string
    findNetworkBody: string
    stepCopy: string
    copyCookieBody: string
    copyTokenBody: string
    securityNote: string
    importClipboard: string
    clipboardImported: string
    clipboardEmpty: string
    clipboardDenied: string
  }
}

function formatLabel(
  template: string,
  values: Record<string, string>,
): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, value),
    template,
  )
}

function stripMatchingQuotes(value: string): string {
  const first = value[0]
  const last = value[value.length - 1]
  if (value.length >= 2 && first === last && (first === '"' || first === "'")) {
    return value.slice(1, -1).trim()
  }
  return value
}

export function normalizeWebSessionClipboardCredential(
  provider: WebSessionProviderDefinition,
  clipboardText: string,
): string {
  let value = clipboardText.trim()
  if (!value) return ''

  const source = getWebSessionCredentialSource(provider)
  if (source === 'cookies') {
    const headerMatch = value.match(/(?:^|\r?\n)\s*cookie\s*:\s*([^\r\n]+)/i)
    value = headerMatch?.[1]?.trim() ?? value.replace(/^cookie\s*:\s*/i, '').trim()
    return stripMatchingQuotes(value)
  }

  if (provider.id === 'deepseek-web') {
    const assignment = value.match(/^userToken\s*[:=]\s*(.+)$/is)
    if (assignment?.[1]) value = assignment[1].trim()
  }

  return stripMatchingQuotes(value)
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
  const [guideOpen, setGuideOpen] = useState(!status?.connected)

  useEffect(() => {
    setCredential('')
    setModelId(status?.modelId ?? provider?.defaultModel ?? '')
    setError(null)
    setSuccess(null)
  }, [provider?.id, provider?.defaultModel, status?.modelId])

  useEffect(() => {
    setGuideOpen(!status?.connected)
  }, [provider?.id, status?.connected])

  if (!provider) return null

  const displayName = getWebSessionProviderName(provider, locale)
  const credentialSource = getWebSessionCredentialSource(provider)
  const findCredentialBody = credentialSource === 'cookies'
    ? provider.acceptsFullCookieHeader
      ? labels.findCookiesBody
      : labels.findCookieValueBody
    : credentialSource === 'local-storage'
      ? labels.findLocalStorageBody
      : labels.findNetworkBody
  const copyCredentialBody = credentialSource === 'cookies'
    && provider.acceptsFullCookieHeader
    ? labels.copyCookieBody
    : labels.copyTokenBody
  const guideValues = {
    provider: displayName,
    credential: provider.credentialName,
  }

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

  const importFromClipboard = async () => {
    setError(null)
    setSuccess(null)
    if (!navigator.clipboard?.readText) {
      setError(labels.clipboardDenied)
      return
    }
    try {
      const clipboardText = await navigator.clipboard.readText()
      const normalized = normalizeWebSessionClipboardCredential(
        provider,
        clipboardText ?? '',
      )
      if (!normalized) {
        setError(labels.clipboardEmpty)
        return
      }
      setCredential(normalized)
      setSuccess(labels.clipboardImported)
    } catch {
      setError(labels.clipboardDenied)
    }
  }

  return (
    <Modal open onClose={onClose} title={displayName} width={600}>
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

        <section className="border-y border-[var(--color-border-separator)] py-[2px]">
          <button
            type="button"
            aria-expanded={guideOpen}
            aria-label={guideOpen ? labels.hideGuide : labels.howToGet}
            title={guideOpen ? labels.hideGuide : labels.howToGet}
            onClick={() => setGuideOpen((open) => !open)}
            className="flex min-h-[42px] w-full items-center gap-[8px] text-left text-[12px] font-bold text-[var(--color-text-primary)] transition-colors hover:text-[#1473e6] dark:hover:text-[#68adff]"
          >
            {guideOpen
              ? <ChevronDown size={15} aria-hidden="true" />
              : <ChevronRight size={15} aria-hidden="true" />}
            {labels.howToGet}
          </button>

          {guideOpen && (
            <div className="pb-[14px] pl-[23px]">
              <div className="grid gap-[5px] rounded-[6px] bg-[var(--color-surface-container-low)] px-[11px] py-[9px] text-[11px] sm:grid-cols-[auto_1fr]">
                <span className="font-medium text-[var(--color-text-secondary)]">
                  {labels.exactCredential}
                </span>
                <code className="min-w-0 break-all font-mono font-semibold text-[var(--color-text-primary)]">
                  {provider.credentialName}
                </code>
                <span className="font-medium text-[var(--color-text-secondary)]">
                  {labels.credentialExample}
                </span>
                <code className="min-w-0 break-all font-mono text-[var(--color-text-secondary)]">
                  {provider.credentialPlaceholder}
                </code>
              </div>

              <ol className="mt-[12px] grid gap-[10px]">
                <li>
                  <div className="text-[11px] font-bold text-[var(--color-text-primary)]">
                    {labels.stepLogin}
                  </div>
                  <p className="mt-[2px] text-[11px] leading-[1.55] text-[var(--color-text-secondary)]">
                    {formatLabel(labels.stepLoginBody, guideValues)}
                  </p>
                </li>
                <li>
                  <div className="text-[11px] font-bold text-[var(--color-text-primary)]">
                    {labels.stepFind}
                  </div>
                  <p className="mt-[2px] text-[11px] leading-[1.55] text-[var(--color-text-secondary)]">
                    {formatLabel(findCredentialBody, guideValues)}
                  </p>
                </li>
                <li>
                  <div className="text-[11px] font-bold text-[var(--color-text-primary)]">
                    {labels.stepCopy}
                  </div>
                  <p className="mt-[2px] text-[11px] leading-[1.55] text-[var(--color-text-secondary)]">
                    {copyCredentialBody}
                  </p>
                </li>
              </ol>

              <p className="mt-[11px] text-[10px] leading-[1.55] text-[var(--color-text-tertiary)]">
                {labels.securityNote}
              </p>
            </div>
          )}
        </section>

        <SelectField
          label={labels.model}
          value={modelId}
          onChange={setModelId}
          options={provider.models.map((model) => ({
            value: model.id,
            label: model.label,
            ...(model.label !== model.id && { description: model.id }),
          }))}
        />

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

        <div className="-mt-[8px] flex justify-end">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={<ClipboardPaste size={14} />}
            onClick={() => void importFromClipboard()}
          >
            {labels.importClipboard}
          </Button>
        </div>

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
