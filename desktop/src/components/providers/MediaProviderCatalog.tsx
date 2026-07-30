import { AudioLines, Image, Video } from 'lucide-react'
import {
  MEDIA_PROVIDERS,
  getMediaProviderKey,
  getMediaProviderName,
  type MediaProviderDefinition,
  type MediaProviderKind,
} from '../../../../src/shared/mediaProviders'
import type {
  MediaProviderStatus,
  MediaProviderTestResult,
} from '../../api/mediaProviders'
import type { Locale } from '../../i18n'
import { ProviderCatalogCard } from './ProviderCatalogCard'

type Props = {
  locale: Locale
  providers?: readonly MediaProviderDefinition[]
  activeKind: MediaProviderKind
  onKindChange: (kind: MediaProviderKind) => void
  statuses: ReadonlyMap<string, MediaProviderStatus>
  testResults: ReadonlyMap<string, MediaProviderTestResult>
  testingKeys: ReadonlySet<string>
  onSelectProvider: (provider: MediaProviderDefinition) => void
  labels: {
    title: string
    description: string
    configuredCount: string
    image: string
    video: string
    audio: string
    connectedWithModel: string
    inheritedWithModel: string
    localWithModel: string
    noAuthWithModel: string
    notConfiguredWithModel: string
    testing: string
    testPassed: string
    reachabilityPassed: string
    testFailed: string
    chinaFirst: string
  }
}

const KIND_ICONS = {
  image: Image,
  video: Video,
  audio: AudioLines,
} as const

export function MediaProviderCatalog({
  locale,
  providers: providerCatalog = MEDIA_PROVIDERS,
  activeKind,
  onKindChange,
  statuses,
  testResults,
  testingKeys,
  onSelectProvider,
  labels,
}: Props) {
  const providers = providerCatalog.filter((provider) => provider.kind === activeKind)
  const providerKeys = new Set(
    providerCatalog.map((provider) => getMediaProviderKey(provider.kind, provider.id)),
  )
  const configuredCount = [...statuses.entries()].filter(
    ([key, status]) => providerKeys.has(key) && status.configured,
  ).length
  const totalCount = providerCatalog.length

  return (
    <section
      aria-labelledby="media-provider-catalog-title"
      className="border-t border-[var(--color-border-separator)] pt-[18px]"
    >
      <div className="mb-[12px] flex flex-col gap-[12px]">
        <div className="flex flex-wrap items-end justify-between gap-[12px]">
          <div className="min-w-0">
            <div className="flex items-center gap-[8px]">
              <h2
                id="media-provider-catalog-title"
                className="text-[15px] font-semibold text-[var(--color-text-primary)]"
              >
                {labels.title}
              </h2>
              <span className="text-[12px] font-semibold text-[#1473e6] dark:text-[#68adff]">
                {labels.configuredCount
                  .replace('{connected}', String(configuredCount))
                  .replace('{total}', String(totalCount))}
              </span>
            </div>
            <p className="mt-[3px] max-w-[820px] text-[12px] leading-[1.55] text-[var(--color-text-secondary)]">
              {labels.description}
            </p>
          </div>

          <div
            role="tablist"
            aria-label={labels.title}
            className="inline-flex h-[36px] max-w-full items-center rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-[3px]"
          >
            {(['image', 'video', 'audio'] as const).map((kind) => {
              const KindIcon = KIND_ICONS[kind]
              const selected = activeKind === kind
              const label = labels[kind]
              const count = providerCatalog.filter((provider) => provider.kind === kind).length
              return (
                <button
                  key={kind}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  disabled={count === 0}
                  title={label}
                  onClick={() => onKindChange(kind)}
                  className={`flex h-[28px] min-w-[82px] items-center justify-center gap-[6px] rounded-[6px] px-[10px] text-[12px] font-semibold transition-colors ${
                    selected
                      ? 'bg-[var(--color-surface-container-lowest)] text-[var(--color-text-primary)] shadow-[0_1px_4px_rgba(15,23,42,0.10)]'
                      : count === 0
                        ? 'cursor-default text-[var(--color-text-tertiary)] opacity-40'
                        : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
                  }`}
                >
                  <KindIcon size={14} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div
        data-provider-catalog="media"
        data-provider-catalog-kind={activeKind}
        data-provider-catalog-layout="comfortable"
        className="grid grid-cols-1 gap-[9px] sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
      >
        {providers.map((provider) => {
          const key = getMediaProviderKey(provider.kind, provider.id)
          const status = statuses.get(key)
          const testResult = testResults.get(key)
          const testing = testingKeys.has(key)
          const modelId = status?.modelId ?? provider.defaultModel
          const modelLabel = provider.models.find((model) => model.id === modelId)?.label ?? modelId
          const statusText = testing
            ? labels.testing
            : testResult
              ? testResult.success
                ? testResult.verification === 'credential'
                  ? labels.testPassed.replace('{latency}', String(testResult.latencyMs))
                  : labels.reachabilityPassed.replace('{latency}', String(testResult.latencyMs))
                : labels.testFailed.replace('{error}', testResult.error ?? '')
              : status?.connected
                ? status.credentialSource === 'provider'
                  ? labels.inheritedWithModel.replace('{model}', modelLabel)
                  : status.credentialSource === 'local'
                    ? labels.localWithModel.replace('{model}', modelLabel)
                    : status.credentialSource === 'not-required'
                      ? labels.noAuthWithModel.replace('{model}', modelLabel)
                      : labels.connectedWithModel.replace('{model}', modelLabel)
                : labels.notConfiguredWithModel.replace('{model}', modelLabel)
          const displayName = getMediaProviderName(provider, locale)

          return (
            <ProviderCatalogCard
              key={key}
              name={displayName}
              providerId={provider.logoProviderId}
              baseUrl={provider.baseUrl}
              modelId={modelId}
              status={statusText}
              statusTone={testResult
                ? testResult.success ? 'positive' : 'negative'
                : status?.connected ? 'accent' : 'muted'}
              active={status?.configured === true}
              emphasized={status?.configured === true}
              badge={provider.chinaPriority ? labels.chinaFirst : undefined}
              badgeTone="credit"
              ariaLabel={`${displayName}: ${statusText}`}
              onClick={() => onSelectProvider(provider)}
            />
          )
        })}
      </div>
    </section>
  )
}
