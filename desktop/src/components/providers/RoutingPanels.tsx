import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  Check,
  Copy,
  Gauge,
  Pencil,
  Plus,
  RefreshCw,
  Route,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useRoutingStore } from '../../stores/routingStore'
import type {
  RouteHealthSnapshot,
  RouteProfile,
  RoutingSource,
  SourceAuthClass,
  SourceCostClass,
  SourceRiskClass,
} from '../../types/routing'
import {
  createRouteId,
  isUneditedLegacyRouteProfile,
  routeBuilderModeFor,
} from '../../utils/routingRoutes'
import { Button } from '../shared/Button'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { SettingsRow, SettingsSection, Switch } from '../settings/SettingsLayout'
import { ProviderLogo } from './ProviderLogo'
import { RouteBuilderDialog } from './RouteBuilderDialog'

function profileTranslationKey(id: string, suffix: 'name' | 'description') {
  return `settings.routing.profile.${id}.${suffix}` as never
}

function translatedOrFallback(
  t: ReturnType<typeof useTranslation>,
  key: string,
  fallback: string,
): string {
  const translated = t(key as never)
  return translated === key ? fallback : translated
}

export function isRoutingTargetCoolingDown(
  entry: RouteHealthSnapshot,
  now = Date.now(),
): boolean {
  return Boolean(entry.cooldownUntil && Date.parse(entry.cooldownUntil) > now)
}

export function summarizeRoutingHealth(
  health: RouteHealthSnapshot[],
  now = Date.now(),
) {
  const requests = health.reduce((sum, entry) => sum + entry.requests, 0)
  const successes = health.reduce((sum, entry) => sum + entry.successes, 0)
  const latencySamples = health.filter((entry) => (
    entry.averageLatencyMs !== null && entry.successes > 0
  ))
  const latencySuccesses = latencySamples.reduce((sum, entry) => sum + entry.successes, 0)
  const latencyTotal = latencySamples.reduce((sum, entry) => (
    sum + entry.averageLatencyMs! * entry.successes
  ), 0)

  return {
    requests,
    successRate: requests > 0 ? Math.round((successes / requests) * 100) : 0,
    active: health.filter((entry) => !isRoutingTargetCoolingDown(entry, now)).length,
    latency: latencySuccesses > 0 ? Math.round(latencyTotal / latencySuccesses) : 0,
  }
}

export function SourceAccessBadges({ source }: { source?: RoutingSource }) {
  const t = useTranslation()
  if (!source) return null

  const credentialKey = source.auth === 'api-key'
    ? (source.configured ? 'apiKeySaved' : 'apiKeyRequired')
    : source.auth === 'oauth'
      ? 'oauth'
      : source.auth === 'local'
        ? 'local'
        : 'none'
  const credentialTone = source.auth === 'none'
    ? 'positive'
    : source.auth === 'api-key' && !source.configured
      ? 'warning'
      : 'muted'

  return (
    <>
      <AccessBadge tone={source.cost === 'mixed' ? 'warning' : source.cost === 'paid' ? 'neutral' : source.cost === 'unknown' ? 'muted' : 'positive'}>
        {t(`settings.routing.cost.${source.cost}` as never)}
      </AccessBadge>
      <AccessBadge tone={credentialTone}>
        {t(`settings.routing.requirement.${credentialKey}` as never)}
      </AccessBadge>
      {source.risk !== 'stable' && (
        <AccessBadge tone="warning">
          {t(`settings.routing.risk.${source.risk}` as never)}
        </AccessBadge>
      )}
    </>
  )
}

function AccessBadge({
  tone,
  children,
}: {
  tone: 'positive' | 'warning' | 'neutral' | 'muted'
  children: string
}) {
  const toneClass = {
    positive: 'bg-[var(--color-success)]/10 text-[var(--color-success)]',
    warning: 'bg-[var(--color-warning)]/10 text-[var(--color-warning)]',
    neutral: 'bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)]',
    muted: 'bg-[var(--color-surface-container-low)] text-[var(--color-text-tertiary)]',
  }[tone]

  return (
    <span className={`inline-flex h-[20px] items-center rounded-full px-[8px] text-[10px] font-semibold ${toneClass}`}>
      {children}
    </span>
  )
}

export function SmartRoutingPanel({
  onOpenSources,
}: {
  onOpenSources?: () => void
} = {}) {
  const t = useTranslation()
  const {
    dashboard,
    isLoading,
    isSaving,
    error,
    fetchDashboard,
    updateConfig,
    updateProfile,
  } = useRoutingStore()
  const [builderOpen, setBuilderOpen] = useState(false)
  const [editingRoute, setEditingRoute] = useState<RouteProfile | null>(null)
  const [routeToDelete, setRouteToDelete] = useState<RouteProfile | null>(null)

  useEffect(() => {
    void fetchDashboard()
  }, [fetchDashboard])

  if (isLoading && !dashboard) return <LoadingState />
  if (!dashboard) return <EmptyState text={error || t('settings.routing.loadFailed')} />

  const routes = dashboard.config.profiles
  const routableSources = dashboard.sources.filter((source) => (
    source.routable && source.providerId && source.models.length > 0
  ))

  const openCreate = () => {
    setEditingRoute(null)
    setBuilderOpen(true)
  }

  const openEdit = (routeProfile: RouteProfile) => {
    setEditingRoute(routeProfile)
    setBuilderOpen(true)
  }

  const saveRoute = async (routeProfile: RouteProfile) => {
    const profiles = editingRoute
      ? routes.map((entry) => entry.id === editingRoute.id ? routeProfile : entry)
      : [...routes, routeProfile]
    await updateConfig({ ...dashboard.config, profiles })
    if (useRoutingStore.getState().error) return
    setBuilderOpen(false)
    setEditingRoute(null)
  }

  const duplicateRoute = (routeProfile: RouteProfile) => {
    const copyName = t('settings.routing.routeCopyName', { name: routeProfile.name })
    const copy: RouteProfile = {
      ...routeProfile,
      id: createRouteId(copyName, routes.map((entry) => entry.id)),
      name: copyName,
      enabled: false,
      targets: routeProfile.targets.map((target) => ({ ...target })),
    }
    void updateConfig({
      ...dashboard.config,
      profiles: [...routes, copy],
    })
  }

  const deleteRoute = async () => {
    if (!routeToDelete) return
    await updateConfig({
      ...dashboard.config,
      profiles: routes.filter((entry) => entry.id !== routeToDelete.id),
    })
    if (useRoutingStore.getState().error) return
    setRouteToDelete(null)
  }

  return (
    <div className="flex flex-col gap-[14px]">
      <section className="overflow-hidden rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-container)]">
        <header className="flex min-h-[76px] items-center justify-between gap-[18px] px-[18px] py-[14px] sm:px-[20px]">
          <div className="min-w-0">
            <h2 className="text-[16px] font-bold text-[var(--color-text-primary)]">
              {t('settings.routing.global')}
            </h2>
            <p className="mt-[3px] max-w-[560px] text-[11px] leading-[17px] text-[var(--color-text-tertiary)]">
              {t('settings.routing.globalHint')}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-[10px]">
            <span className="hidden text-[11px] font-semibold text-[var(--color-text-secondary)] sm:block">
              {t(dashboard.config.enabled
                ? 'settings.routing.globalEnabled'
                : 'settings.routing.globalDisabled')}
            </span>
            <Switch
              checked={dashboard.config.enabled}
              disabled={isSaving}
              accent
              ariaLabel={t('settings.routing.global')}
              onChange={(enabled) => void updateConfig({ ...dashboard.config, enabled })}
            />
          </div>
        </header>
      </section>

      <section className="overflow-hidden rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-container)]">
        <header className="flex min-h-[68px] items-center justify-between gap-[14px] border-b border-[var(--color-border-separator)] px-[18px] py-[12px] sm:px-[20px]">
          <div className="min-w-0">
            <h3 className="text-[13px] font-bold text-[var(--color-text-primary)]">
              {t('settings.routing.myRoutes')}
            </h3>
            <p className="mt-[3px] text-[10px] leading-[16px] text-[var(--color-text-tertiary)]">
              {t('settings.routing.myRoutesHint')}
            </p>
          </div>
          <Button
            size="sm"
            icon={<Plus size={14} />}
            disabled={isSaving}
            onClick={openCreate}
            className="h-[36px] shrink-0 rounded-[7px] px-[13px] shadow-none"
          >
            {t('settings.routing.createRoute')}
          </Button>
        </header>

        {routes.length > 0 ? (
          <div className="divide-y divide-[var(--color-border-separator)]">
            {routes.map((routeProfile) => (
              <RouteListItem
                key={routeProfile.id}
                profile={routeProfile}
                sources={routableSources}
                candidateCount={dashboard.routeAvailability[routeProfile.id]?.candidateCount ?? 0}
                globallyEnabled={dashboard.config.enabled}
                disabled={isSaving}
                onChange={(next) => void updateProfile(next)}
                onEdit={() => openEdit(routeProfile)}
                onDuplicate={() => duplicateRoute(routeProfile)}
                onDelete={() => setRouteToDelete(routeProfile)}
              />
            ))}
          </div>
        ) : (
          <RouteEmptyState
            hasSources={routableSources.length > 0}
            onCreate={openCreate}
            onOpenSources={onOpenSources}
          />
        )}
      </section>

      {error && <p className="text-[12px] text-[var(--color-error)]">{error}</p>}

      <RouteBuilderDialog
        open={builderOpen}
        route={editingRoute}
        sources={routableSources}
        existingRouteIds={routes.map((routeProfile) => routeProfile.id)}
        saving={isSaving}
        onClose={() => {
          if (isSaving) return
          setBuilderOpen(false)
          setEditingRoute(null)
        }}
        onSave={saveRoute}
        onOpenSources={onOpenSources
          ? () => {
              setBuilderOpen(false)
              onOpenSources()
            }
          : undefined}
      />

      <ConfirmDialog
        open={routeToDelete !== null}
        onClose={() => setRouteToDelete(null)}
        onConfirm={deleteRoute}
        title={t('settings.routing.deleteTitle')}
        body={t('settings.routing.deleteBody', { name: routeToDelete?.name ?? '' })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        confirmVariant="danger"
        loading={isSaving}
      />
    </div>
  )
}

function RouteListItem({
  profile,
  sources,
  candidateCount,
  globallyEnabled,
  disabled,
  onChange,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  profile: RouteProfile
  sources: RoutingSource[]
  candidateCount: number
  globallyEnabled: boolean
  disabled: boolean
  onChange: (profile: RouteProfile) => void
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const t = useTranslation()
  const mode = routeBuilderModeFor(profile.strategy)
  const isLegacyProfile = isUneditedLegacyRouteProfile(profile)
  const profileName = isLegacyProfile
    ? translatedOrFallback(
        t,
        profileTranslationKey(profile.id, 'name'),
        profile.name,
      )
    : profile.name
  const modeDescription = profile.strictFree
    ? t('settings.routing.costPolicy.free-only.description')
    : t(`settings.routing.mode.${mode}.description` as never)
  const routeDescription = isLegacyProfile
    ? translatedOrFallback(
        t,
        profileTranslationKey(profile.id, 'description'),
        modeDescription,
      )
    : modeDescription
  const behaviorName = isLegacyProfile
    ? t(`settings.routing.strategy.${profile.strategy}.name` as never)
    : t(`settings.routing.mode.${mode}.name` as never)
  const configuredTargets = profile.targets.map((target) => {
    const source = sources.find((item) => item.providerId === target.providerId)
    return {
      target,
      source,
      modelId: target.modelId ?? source?.models[0]?.id ?? '',
    }
  })

  return (
    <article className={`px-[16px] py-[15px] sm:px-[20px] ${profile.enabled ? '' : 'opacity-60'}`}>
      <div className="flex flex-col gap-[13px] sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-[11px]">
          <span className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-[8px] bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)]">
            <Route size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-[7px]">
              <h4 className="max-w-full truncate text-[13px] font-bold text-[var(--color-text-primary)]">
                {profileName}
              </h4>
              <AccessBadge tone="neutral">
                {behaviorName}
              </AccessBadge>
              <AccessBadge tone={candidateCount > 0 ? 'positive' : 'warning'}>
                {t('settings.routing.readyCount', { count: candidateCount })}
              </AccessBadge>
            </div>
            <p className="mt-[3px] text-[10px] leading-[16px] text-[var(--color-text-tertiary)]">
              {routeDescription}
            </p>

            <div className="mt-[8px] flex min-w-0 items-center gap-[8px]">
              {configuredTargets.length > 0 ? (
                <>
                  <div className="flex shrink-0 items-center gap-[3px]">
                    {configuredTargets.slice(0, 4).map(({ target, source, modelId }, index) => (
                      <ProviderLogo
                        key={`${target.providerId}:${modelId}:${index}`}
                        name={source?.name ?? target.providerId}
                        providerId={source?.presetId}
                        size="xs"
                        decorative
                      />
                    ))}
                  </div>
                  <span className="min-w-0 truncate text-[10px] font-medium text-[var(--color-text-secondary)]">
                    {configuredTargets
                      .slice(0, 3)
                      .map(({ modelId }) => modelId)
                      .filter(Boolean)
                      .join(' → ')}
                    {configuredTargets.length > 3
                      ? t('settings.routing.moreModels', { count: configuredTargets.length - 3 })
                      : ''}
                  </span>
                </>
              ) : (
                <span className="text-[10px] font-medium text-[var(--color-text-secondary)]">
                  {t('settings.routing.legacyAllModels')}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-[8px] border-t border-[var(--color-border-separator)] pt-[10px] sm:justify-end sm:border-t-0 sm:pt-0">
          <div className="flex items-center gap-[2px]">
            <RouteActionButton label={t('settings.routing.editRoute')} onClick={onEdit}>
              <Pencil size={14} />
            </RouteActionButton>
            <RouteActionButton label={t('settings.routing.duplicateRoute')} onClick={onDuplicate}>
              <Copy size={14} />
            </RouteActionButton>
            <RouteActionButton label={t('settings.routing.deleteRoute')} onClick={onDelete} danger>
              <Trash2 size={14} />
            </RouteActionButton>
          </div>
          <div className="ml-[4px] border-l border-[var(--color-border-separator)] pl-[12px]">
            <Switch
              checked={profile.enabled}
              disabled={disabled || !globallyEnabled}
              accent
              ariaLabel={profileName}
              onChange={(enabled) => onChange({ ...profile, enabled })}
            />
          </div>
        </div>
      </div>
    </article>
  )
}

function RouteActionButton({
  label,
  danger = false,
  onClick,
  children,
}: {
  label: string
  danger?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`flex h-[32px] w-[32px] items-center justify-center rounded-[6px] transition-colors ${
        danger
          ? 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-error)]/10 hover:text-[var(--color-error)]'
          : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      {children}
    </button>
  )
}

function RouteEmptyState({
  hasSources,
  onCreate,
  onOpenSources,
}: {
  hasSources: boolean
  onCreate: () => void
  onOpenSources?: () => void
}) {
  const t = useTranslation()
  return (
    <div className="flex min-h-[236px] flex-col items-center justify-center px-[24px] py-[32px] text-center">
      <span className="flex h-[44px] w-[44px] items-center justify-center rounded-[9px] bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)]">
        <Route size={20} />
      </span>
      <h4 className="mt-[13px] text-[14px] font-bold text-[var(--color-text-primary)]">
        {t(hasSources
          ? 'settings.routing.emptyTitle'
          : 'settings.routing.emptyNoSourcesTitle')}
      </h4>
      <p className="mt-[5px] max-w-[390px] text-[11px] leading-[18px] text-[var(--color-text-tertiary)]">
        {t(hasSources
          ? 'settings.routing.emptyHint'
          : 'settings.routing.emptyNoSourcesHint')}
      </p>
      <Button
        size="sm"
        icon={<Plus size={14} />}
        onClick={hasSources || !onOpenSources ? onCreate : onOpenSources}
        className="mt-[16px] h-[36px] rounded-[7px] px-[14px] shadow-none"
      >
        {t(hasSources || !onOpenSources
          ? 'settings.routing.createFirstRoute'
          : 'settings.routing.addModelSources')}
      </Button>
    </div>
  )
}

export function RoutingStatusPanel() {
  const t = useTranslation()
  const { dashboard, isLoading, isSaving, error, fetchDashboard, resetHealth } = useRoutingStore()

  useEffect(() => {
    void fetchDashboard()
    const timer = window.setInterval(() => void fetchDashboard({ quiet: true }), 5000)
    return () => window.clearInterval(timer)
  }, [fetchDashboard])

  const summary = useMemo(
    () => summarizeRoutingHealth(dashboard?.health ?? []),
    [dashboard?.health],
  )

  if (isLoading && !dashboard) return <LoadingState />
  if (!dashboard) return <EmptyState text={error || t('settings.routing.loadFailed')} />

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="grid grid-cols-2 overflow-hidden rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container)] md:grid-cols-4">
        <Metric icon={Activity} label={t('settings.routing.metric.requests')} value={String(summary.requests)} />
        <Metric icon={Check} label={t('settings.routing.metric.success')} value={`${summary.successRate}%`} divided />
        <Metric icon={Gauge} label={t('settings.routing.metric.latency')} value={summary.latency ? `${summary.latency} ms` : '-'} divided />
        <Metric icon={ShieldCheck} label={t('settings.routing.metric.available')} value={String(summary.active)} divided />
      </div>

      <SettingsSection
        title={t('settings.routing.healthTitle')}
        action={(
          <Button
            variant="ghost"
            size="sm"
            disabled={isSaving}
            onClick={() => void resetHealth()}
          >
            <RefreshCw size={14} />
            {t('settings.routing.resetHealth')}
          </Button>
        )}
      >
        {dashboard.health.length === 0 ? (
          <SettingsRow><span className="text-[12px] text-[var(--color-text-tertiary)]">{t('settings.routing.noHealth')}</span></SettingsRow>
        ) : dashboard.health.map((entry) => {
          const coolingDown = isRoutingTargetCoolingDown(entry)
          return (
            <SettingsRow
              key={`${entry.providerId}:${entry.modelId}`}
              label={`${entry.providerName} · ${entry.modelId}`}
              hint={entry.lastError || t('settings.routing.healthSummary', {
                success: entry.successes,
                requests: entry.requests,
                latency: entry.averageLatencyMs ?? '-',
              })}
            >
              <AccessBadge tone={coolingDown ? 'warning' : 'positive'}>
                {coolingDown ? t('settings.routing.cooldown') : t('settings.routing.healthy')}
              </AccessBadge>
            </SettingsRow>
          )
        })}
      </SettingsSection>

      <SettingsSection title={t('settings.routing.eventsTitle')}>
        {dashboard.events.length === 0 ? (
          <SettingsRow><span className="text-[12px] text-[var(--color-text-tertiary)]">{t('settings.routing.noEvents')}</span></SettingsRow>
        ) : dashboard.events.slice(0, 20).map((event) => (
          <SettingsRow
            key={event.id}
            label={`${event.providerName} · ${event.modelId}`}
            hint={`${translatedOrFallback(
              t,
              profileTranslationKey(event.routeId, 'name'),
              dashboard.config.profiles.find((profile) => profile.id === event.routeId)?.name ?? event.routeId,
            )} · ${new Date(event.timestamp).toLocaleTimeString()}${event.error ? ` · ${event.error}` : ''}`}
          >
            <AccessBadge tone={event.status === 'success' ? 'positive' : 'warning'}>
              {event.status === 'success'
                ? `${event.latencyMs} ms`
                : t('settings.routing.failedAttempt', { attempt: event.attempt })}
            </AccessBadge>
          </SettingsRow>
        ))}
      </SettingsSection>
    </div>
  )
}

function Metric({
  icon: MetricIcon,
  label,
  value,
  divided,
}: {
  icon: typeof Activity
  label: string
  value: string
  divided?: boolean
}) {
  return (
    <div className={`flex min-h-[82px] items-center gap-[12px] px-[16px] ${divided ? 'border-l border-[var(--color-border-separator)]' : ''}`}>
      <MetricIcon size={17} className="shrink-0 text-[var(--color-text-tertiary)]" />
      <div className="min-w-0">
        <div className="text-[18px] font-bold text-[var(--color-text-primary)]">{value}</div>
        <div className="truncate text-[10px] font-semibold text-[var(--color-text-tertiary)]">{label}</div>
      </div>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="flex justify-center py-[48px]">
      <RefreshCw size={20} className="animate-spin text-[var(--color-text-tertiary)]" />
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-[8px] border border-[var(--color-border)] px-[18px] py-[28px] text-center text-[12px] text-[var(--color-text-tertiary)]">
      {text}
    </div>
  )
}

export function findRoutingSource(
  sources: RoutingSource[] | undefined,
  providerId: string | undefined,
  presetId: string,
): RoutingSource | undefined {
  if (providerId) return sources?.find((source) => source.providerId === providerId)
  return sources?.find((source) => source.id === `preset:${presetId}`)
}

// Exported unions keep translation maps exhaustive at callsites.
export type RoutingAccessClasses = SourceCostClass | SourceAuthClass | SourceRiskClass
