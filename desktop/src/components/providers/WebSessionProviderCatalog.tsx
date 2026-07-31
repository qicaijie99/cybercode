import {
  WEB_SESSION_PROVIDERS,
  getWebSessionProviderName,
  type WebSessionProviderDefinition,
  type WebSessionProviderId,
} from '../../../../src/shared/webSessionProviders'
import type {
  WebSessionProviderStatus,
  WebSessionProviderTestResult,
} from '../../api/webSessionProviders'
import type { Locale } from '../../i18n'
import { Button } from '../shared/Button'
import { Icon } from '../shared/Icon'
import { ProviderCatalogCard } from './ProviderCatalogCard'

type Props = {
  locale: Locale
  providers?: readonly WebSessionProviderDefinition[]
  statuses: ReadonlyMap<WebSessionProviderId, WebSessionProviderStatus>
  testResults: ReadonlyMap<WebSessionProviderId, WebSessionProviderTestResult>
  testingProviderIds: ReadonlySet<WebSessionProviderId>
  isTestingAll: boolean
  onSelectProvider: (provider: WebSessionProviderDefinition) => void
  onTestAll: () => void
  labels: {
    title: string
    description: string
    configuredCount: string
    testAll: string
    connected: string
    active: string
    notConfigured: string
    testing: string
    testPassed: string
    testFailed: string
    free: string
  }
}

export function WebSessionProviderCatalog({
  locale,
  providers = WEB_SESSION_PROVIDERS,
  statuses,
  testResults,
  testingProviderIds,
  isTestingAll,
  onSelectProvider,
  onTestAll,
  labels,
}: Props) {
  const providerIds = new Set(providers.map((provider) => provider.id))
  const connectedCount = [...statuses.values()].filter(
    (status) => providerIds.has(status.providerId) && status.connected,
  ).length

  return (
    <section
      aria-labelledby="web-session-provider-catalog-title"
      className="border-t border-[var(--color-border-separator)] pt-[18px]"
    >
      <div className="mb-[12px] flex flex-wrap items-end justify-between gap-[10px]">
        <div className="min-w-0">
          <div className="flex items-center gap-[8px]">
            <h2
              id="web-session-provider-catalog-title"
              className="text-[15px] font-semibold text-[var(--color-text-primary)]"
            >
              {labels.title}
            </h2>
            <span className="text-[12px] font-semibold text-[#1473e6] dark:text-[#68adff]">
                {labels.configuredCount
                  .replace('{connected}', String(connectedCount))
                  .replace('{total}', String(providers.length))}
            </span>
          </div>
          <p className="mt-[3px] max-w-[820px] text-[12px] leading-[1.55] text-[var(--color-text-secondary)]">
            {labels.description}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          loading={isTestingAll}
          disabled={connectedCount === 0}
          icon={<Icon name="play_arrow" size={15} />}
          onClick={onTestAll}
        >
          {labels.testAll}
        </Button>
      </div>

      <div
        data-provider-catalog="web-session"
        data-provider-catalog-layout="comfortable"
        className="provider-catalog-grid grid gap-[9px]"
      >
        {providers.map((provider) => {
          const status = statuses.get(provider.id)
          const testResult = testResults.get(provider.id)
          const testing = testingProviderIds.has(provider.id)
          const connected = status?.connected === true
          const active = status?.active === true
          const statusText = testing
            ? labels.testing
            : testResult
              ? testResult.success
                ? labels.testPassed.replace('{latency}', String(testResult.latencyMs))
                : labels.testFailed.replace('{error}', testResult.error ?? '')
              : active
                ? labels.active
                : connected
                  ? labels.connected
                  : labels.notConfigured

          return (
            <ProviderCatalogCard
              key={provider.id}
              name={getWebSessionProviderName(provider, locale)}
              providerId={provider.logoProviderId}
              baseUrl={provider.website}
              modelId={status?.modelId ?? provider.defaultModel}
              status={statusText}
              statusTone={testResult
                ? testResult.success ? 'positive' : 'negative'
                : connected ? 'accent' : 'muted'}
              active={active}
              emphasized={connected}
              badge={provider.freeTier ? labels.free : undefined}
              badgeTone="free"
              ariaLabel={`${getWebSessionProviderName(provider, locale)}: ${statusText}`}
              onClick={() => onSelectProvider(provider)}
            />
          )
        })}
      </div>
    </section>
  )
}
