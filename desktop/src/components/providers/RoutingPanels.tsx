import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  Check,
  ChevronDown,
  Code2,
  Gauge,
  Gift,
  Minus,
  Plus,
  RefreshCw,
  Route,
  Scale,
  SlidersHorizontal,
  ShieldCheck,
  Zap,
} from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useRoutingStore } from '../../stores/routingStore'
import type {
  RouteHealthSnapshot,
  RouteProfile,
  RoutingSource,
  RoutingStrategy,
  SourceAuthClass,
  SourceCostClass,
  SourceRiskClass,
} from '../../types/routing'
import { Button } from '../shared/Button'
import { SettingsRow, SettingsSection, Switch } from '../settings/SettingsLayout'
import { ProviderLogo } from './ProviderLogo'

const PROFILE_ICONS = {
  balanced: Scale,
  'coding-first': Code2,
  'free-first': Gift,
  fastest: Zap,
  stable: ShieldCheck,
} as const

const STRATEGY_GROUPS = [
  {
    id: 'recommended',
    icon: Route,
    strategies: ['auto', 'priority', 'cost-optimized', 'weighted'],
  },
  {
    id: 'loadBalance',
    icon: Scale,
    strategies: ['round-robin', 'p2c', 'least-used', 'random', 'strict-random'],
  },
  {
    id: 'reliability',
    icon: ShieldCheck,
    strategies: ['fill-first', 'reset-aware', 'reset-window', 'lkgp'],
  },
  {
    id: 'context',
    icon: Gauge,
    strategies: ['context-relay', 'headroom', 'context-optimized'],
  },
] as const

type StrategyGroupId = (typeof STRATEGY_GROUPS)[number]['id']

type CostPolicy = 'free-only' | 'prefer-free' | 'allow-paid'

function profileTranslationKey(id: string, suffix: 'name' | 'description') {
  return `settings.routing.profile.${id}.${suffix}` as never
}

function strategyTranslationKey(strategy: RoutingStrategy, suffix: 'name' | 'description') {
  return `settings.routing.strategy.${strategy}.${suffix}` as never
}

function strategyGroupFor(strategy: RoutingStrategy): StrategyGroupId {
  return STRATEGY_GROUPS.find((group) => (
    (group.strategies as readonly RoutingStrategy[]).includes(strategy)
  ))?.id ?? 'recommended'
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

function RoutingStrategyPicker({
  value,
  disabled,
  onChange,
}: {
  value: RoutingStrategy
  disabled: boolean
  onChange: (strategy: RoutingStrategy) => void
}) {
  const t = useTranslation()
  const pickerRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [groupId, setGroupId] = useState<StrategyGroupId>(() => strategyGroupFor(value))
  const strategyLabel = t(strategyTranslationKey(value, 'name'))
  const activeGroup = STRATEGY_GROUPS.find((group) => group.id === groupId) ?? STRATEGY_GROUPS[0]

  useEffect(() => {
    if (!open) return
    setGroupId(strategyGroupFor(value))

    const handlePointerDown = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, value])

  return (
    <div ref={pickerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${t('settings.routing.strategyLabel')}: ${strategyLabel}`}
        onClick={() => setOpen((current) => !current)}
        className="flex h-[34px] w-[142px] items-center justify-between gap-[8px] rounded-[7px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-[10px] text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="truncate">{strategyLabel}</span>
        <ChevronDown
          size={14}
          className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t('settings.routing.strategyPicker')}
          className="absolute bottom-[calc(100%+6px)] left-0 z-50 flex max-h-[280px] w-[calc(100vw-160px)] flex-col overflow-hidden rounded-[8px] border border-[var(--color-border-separator)] bg-[var(--color-background)] shadow-[var(--shadow-dropdown)] md:w-[520px] xl:left-auto xl:right-0"
        >
          <div
            role="tablist"
            aria-label={t('settings.routing.strategyPicker')}
            className="grid shrink-0 grid-cols-4 gap-[3px] border-b border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] p-[5px]"
          >
            {STRATEGY_GROUPS.map((group) => {
              const GroupIcon = group.icon
              const selected = group.id === groupId
              return (
                <button
                  key={group.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setGroupId(group.id)}
                  className={`flex h-[30px] min-w-0 items-center justify-center gap-[5px] rounded-[5px] px-[6px] text-[10px] font-semibold transition-colors ${
                    selected
                      ? 'bg-[var(--color-background)] text-[var(--color-text-primary)] shadow-[0_1px_3px_rgba(0,0,0,0.08)]'
                      : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]'
                  }`}
                >
                  <GroupIcon size={13} className="shrink-0" />
                  <span className="truncate">
                    {t(`settings.routing.strategyGroup.${group.id}` as never)}
                  </span>
                </button>
              )
            })}
          </div>

          <div
            role="listbox"
            aria-label={t(`settings.routing.strategyGroup.${groupId}` as never)}
            className="grid min-h-0 flex-1 grid-cols-1 gap-[5px] overflow-y-auto p-[7px] sm:grid-cols-2"
          >
            {activeGroup.strategies.map((strategy) => {
              const selected = strategy === value
              return (
                <button
                  key={strategy}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(strategy)
                    setOpen(false)
                  }}
                  className={`relative flex h-[58px] min-w-0 flex-col justify-center rounded-[6px] border px-[10px] text-left transition-colors ${
                    selected
                      ? 'border-[#1473e6]/45 bg-[#1473e6]/[0.07] dark:border-[#64a8ff]/45 dark:bg-[#64a8ff]/[0.08]'
                      : 'border-[var(--color-border-separator)] hover:border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]'
                  }`}
                >
                  <span className="flex items-center gap-[6px] pr-[18px] text-[11px] font-semibold text-[var(--color-text-primary)]">
                    <span className="truncate">{t(strategyTranslationKey(strategy, 'name'))}</span>
                  </span>
                  <span className="mt-[2px] line-clamp-2 text-[9px] leading-[13px] text-[var(--color-text-tertiary)]">
                    {t(strategyTranslationKey(strategy, 'description'))}
                  </span>
                  {selected && (
                    <Check
                      size={13}
                      className="absolute right-[8px] top-[9px] text-[#1473e6] dark:text-[#64a8ff]"
                    />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
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
  const { dashboard, isLoading, isSaving, error, fetchDashboard, updateConfig, updateProfile } = useRoutingStore()
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)

  useEffect(() => {
    void fetchDashboard()
  }, [fetchDashboard])

  useEffect(() => {
    const profiles = dashboard?.config.profiles ?? []
    if (profiles.length === 0) {
      setSelectedProfileId(null)
      return
    }
    if (!selectedProfileId || !profiles.some((profile) => profile.id === selectedProfileId)) {
      setSelectedProfileId(profiles.find((profile) => profile.enabled)?.id ?? profiles[0]!.id)
    }
  }, [dashboard?.config.profiles, selectedProfileId])

  if (isLoading && !dashboard) return <LoadingState />
  if (!dashboard) return <EmptyState text={error || t('settings.routing.loadFailed')} />

  const routableSources = dashboard.sources.filter((source) => source.routable && source.providerId)
  const profiles = dashboard.config.profiles
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0]

  return (
    <div className="flex flex-col gap-[16px]">
      <section className="overflow-hidden rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-container)]">
        <header className="flex min-h-[76px] items-center justify-between gap-[18px] px-[18px] py-[14px] sm:px-[20px]">
          <div className="min-w-0">
            <h2 className="text-[16px] font-bold text-[var(--color-text-primary)]">
              {t('settings.routing.global')}
            </h2>
            <p className="mt-[3px] text-[11px] leading-[17px] text-[var(--color-text-tertiary)]">
              {t('settings.routing.globalHint')}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-[10px]">
            <span className="text-[11px] font-semibold text-[var(--color-text-secondary)]">
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

        {selectedProfile ? (
          <>
            <div className="border-t border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] px-[16px] py-[14px] sm:px-[20px]">
              <div>
                <h3 className="text-[12px] font-bold text-[var(--color-text-primary)]">
                  {t('settings.routing.routeProfiles')}
                </h3>
                <p className="mt-[2px] text-[10px] leading-[16px] text-[var(--color-text-tertiary)]">
                  {t('settings.routing.profileSelectorHint')}
                </p>
              </div>

              <nav
                aria-label={t('settings.routing.routeProfiles')}
                className="mt-[10px] grid grid-cols-2 gap-[6px] sm:grid-cols-3 xl:grid-cols-5"
              >
                {profiles.map((profile) => (
                  <RouteProfileButton
                    key={profile.id}
                    profile={profile}
                    candidateCount={dashboard.routeAvailability[profile.id]?.candidateCount ?? 0}
                    selected={profile.id === selectedProfile.id}
                    onSelect={() => setSelectedProfileId(profile.id)}
                  />
                ))}
              </nav>
            </div>

            <RouteProfileDetail
              profile={selectedProfile}
              sources={routableSources}
              candidateCount={dashboard.routeAvailability[selectedProfile.id]?.candidateCount ?? 0}
              globallyEnabled={dashboard.config.enabled}
              disabled={isSaving}
              onOpenSources={onOpenSources}
              onChange={(next) => void updateProfile(next)}
            />
          </>
        ) : (
          <div className="border-t border-[var(--color-border-separator)] px-[20px] py-[36px] text-center text-[12px] text-[var(--color-text-tertiary)]">
            {t('settings.routing.noProfiles')}
          </div>
        )}
      </section>

      {error && <p className="text-[12px] text-[var(--color-error)]">{error}</p>}
    </div>
  )
}

function RouteProfileButton({
  profile,
  candidateCount,
  selected,
  onSelect,
}: {
  profile: RouteProfile
  candidateCount: number
  selected: boolean
  onSelect: () => void
}) {
  const t = useTranslation()
  const ProfileIcon = PROFILE_ICONS[profile.id as keyof typeof PROFILE_ICONS] ?? Route
  const profileName = translatedOrFallback(
    t,
    profileTranslationKey(profile.id, 'name'),
    profile.name,
  )
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`flex min-h-[58px] min-w-0 items-center gap-[9px] rounded-[7px] border px-[10px] py-[8px] text-left transition-colors duration-150 ${
        selected
          ? 'border-[#1473e6]/50 bg-[#1473e6]/[0.07] dark:border-[#64a8ff]/50 dark:bg-[#64a8ff]/[0.08]'
          : 'border-[var(--color-border-separator)] bg-[var(--color-surface-container-lowest)] hover:border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]'
      } ${
        profile.enabled ? '' : 'opacity-55'
      }`}
    >
      <div className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[6px] ${
        selected
          ? 'bg-[#1473e6]/10 text-[#1473e6] dark:bg-[#64a8ff]/10 dark:text-[#64a8ff]'
          : 'bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)]'
      }`}>
        <ProfileIcon size={15} strokeWidth={1.9} />
      </div>

      <div className="min-w-0 flex-1">
        <span className={`block truncate text-[12px] font-bold ${
          selected ? 'text-[#1473e6] dark:text-[#64a8ff]' : 'text-[var(--color-text-primary)]'
        }`}>
          {profileName}
        </span>
        <span className="mt-[2px] flex items-center gap-[5px] truncate text-[9px] leading-[14px] text-[var(--color-text-tertiary)]">
          <span className={`h-[6px] w-[6px] shrink-0 rounded-full ${
            profile.enabled && candidateCount > 0 ? 'bg-[var(--color-success)]' : 'bg-[var(--color-warning)]'
          }`} />
          {t('settings.routing.readyCount', { count: candidateCount })}
        </span>
      </div>
    </button>
  )
}

function RouteProfileDetail({
  profile,
  sources,
  candidateCount,
  globallyEnabled,
  disabled,
  onOpenSources,
  onChange,
}: {
  profile: RouteProfile
  sources: RoutingSource[]
  candidateCount: number
  globallyEnabled: boolean
  disabled: boolean
  onOpenSources?: () => void
  onChange: (profile: RouteProfile) => void
}) {
  const t = useTranslation()
  const [showSources, setShowSources] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const profileName = translatedOrFallback(
    t,
    profileTranslationKey(profile.id, 'name'),
    profile.name,
  )
  const profileDescription = translatedOrFallback(
    t,
    profileTranslationKey(profile.id, 'description'),
    profile.description || '',
  )
  const explicitIds = new Set(profile.targets.map((target) => target.providerId))
  const usesAllSources = profile.targets.length === 0
  const selectedSources = sources.filter((source) => (
    usesAllSources || explicitIds.has(source.providerId!)
  ))
  const unselectedSources = sources.filter((source) => (
    !usesAllSources && !explicitIds.has(source.providerId!)
  ))
  const costPolicy = getCostPolicy(profile)

  useEffect(() => {
    setShowSources(false)
    setShowAdvanced(false)
  }, [profile.id])

  const toggleSource = (providerId: string, checked: boolean) => {
    const allIds = sources.map((source) => source.providerId!).filter(Boolean)
    const selectedIds = usesAllSources ? new Set(allIds) : new Set(explicitIds)
    if (checked) selectedIds.add(providerId)
    else selectedIds.delete(providerId)
    const targets = selectedIds.size === allIds.length
      ? []
      : allIds.filter((id) => selectedIds.has(id)).map((id) => ({ providerId: id }))
    onChange({ ...profile, targets })
  }

  const changeCostPolicy = (policy: CostPolicy) => {
    if (policy === 'free-only') {
      onChange({ ...profile, strictFree: true })
      return
    }
    if (policy === 'prefer-free') {
      onChange({ ...profile, strictFree: false, strategy: 'cost-optimized' })
      return
    }
    onChange({
      ...profile,
      strictFree: false,
      strategy: profile.strategy === 'cost-optimized' ? 'auto' : profile.strategy,
    })
  }

  return (
    <div className="min-w-0 border-t border-[var(--color-border-separator)] bg-[var(--color-surface-container-lowest)]">
      <div className="flex flex-col gap-[14px] px-[16px] py-[16px] sm:flex-row sm:items-center sm:justify-between sm:px-[20px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-[8px]">
            <h3 className="text-[16px] font-bold text-[var(--color-text-primary)]">{profileName}</h3>
            <AccessBadge tone={candidateCount > 0 ? 'positive' : 'warning'}>
              {t('settings.routing.candidates', { count: candidateCount })}
            </AccessBadge>
          </div>
          {profileDescription && (
            <p className="mt-[4px] max-w-[430px] text-[11px] leading-[17px] text-[var(--color-text-tertiary)]">
              {profileDescription}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-[10px]">
          <span className="text-[10px] font-semibold text-[var(--color-text-secondary)]">
            {t('settings.routing.profileMenuVisibility')}
          </span>
          <Switch
            checked={profile.enabled}
            disabled={disabled || !globallyEnabled}
            accent
            ariaLabel={profileName}
            onChange={(enabled) => onChange({ ...profile, enabled })}
          />
        </div>
      </div>

      <section className="border-t border-[var(--color-border-separator)] px-[16px] py-[16px] sm:px-[20px]">
        <div className="flex flex-col gap-[10px] sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h4 className="text-[12px] font-bold text-[var(--color-text-primary)]">
              {t('settings.routing.costBoundary')}
            </h4>
            <p className="mt-[3px] text-[10px] leading-[16px] text-[var(--color-text-tertiary)]">
              {t(`settings.routing.costPolicy.${costPolicy}.description` as never)}
            </p>
          </div>

          <div className="grid min-w-0 grid-cols-3 overflow-hidden rounded-[7px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] sm:w-[420px]">
            {(['free-only', 'prefer-free', 'allow-paid'] as CostPolicy[]).map((policy, index) => {
              const active = costPolicy === policy
              return (
                <button
                  key={policy}
                  type="button"
                  disabled={disabled}
                  aria-pressed={active}
                  onClick={() => changeCostPolicy(policy)}
                  className={`min-h-[36px] min-w-0 px-[7px] text-[10px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                    index > 0 ? 'border-l border-[var(--color-border-separator)]' : ''
                  } ${
                    active
                      ? 'bg-[#1473e6]/10 text-[#1473e6] shadow-[inset_0_0_0_1px_#1473e6] dark:bg-[#64a8ff]/10 dark:text-[#64a8ff] dark:shadow-[inset_0_0_0_1px_#64a8ff]'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                  }`}
                >
                  <span className="block truncate">
                    {t(`settings.routing.costPolicy.${policy}.label` as never)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--color-border-separator)] px-[16px] py-[16px] sm:px-[20px]">
        <div className="flex flex-col gap-[12px] sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h4 className="text-[12px] font-bold text-[var(--color-text-primary)]">
              {t('settings.routing.routeSources')}
            </h4>
            {selectedSources.length > 0 ? (
              <div className="mt-[7px] flex min-w-0 items-center gap-[9px]">
                <div className="flex shrink-0 items-center gap-[4px]">
                  {selectedSources.slice(0, 4).map((source) => (
                    <ProviderLogo
                      key={source.id}
                      name={source.name}
                      providerId={source.presetId}
                      size="xs"
                      decorative
                    />
                  ))}
                </div>
                <span className="truncate text-[10px] text-[var(--color-text-secondary)]">
                  {t(usesAllSources
                    ? 'settings.routing.sourceSummaryAll'
                    : 'settings.routing.sourceSummarySelected', {
                    count: selectedSources.length,
                  })}
                </span>
              </div>
            ) : (
              <p className="mt-[4px] text-[10px] leading-[16px] text-[var(--color-warning)]">
                {t('settings.routing.noConfiguredSources')}
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-[8px]">
            {sources.length > 0 && (
              <button
                type="button"
                aria-expanded={showSources}
                onClick={() => {
                  setShowSources((current) => !current)
                  setShowAdvanced(false)
                }}
                className="h-[32px] rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-[11px] text-[10px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
              >
                {t(showSources
                  ? 'settings.routing.doneManagingSources'
                  : 'settings.routing.manageSources')}
              </button>
            )}
            {onOpenSources && (
              <button
                type="button"
                onClick={onOpenSources}
                className="inline-flex h-[32px] items-center gap-[5px] rounded-[6px] px-[8px] text-[10px] font-semibold text-[#1473e6] hover:bg-[#1473e6]/[0.07] dark:text-[#64a8ff] dark:hover:bg-[#64a8ff]/[0.08]"
              >
                <Plus size={12} />
                {t('settings.routing.addModelSources')}
              </button>
            )}
          </div>
        </div>

        {showSources && (
          <div className="mt-[14px] overflow-hidden border-y border-[var(--color-border-separator)]">
            <p className="bg-[var(--color-surface-container-low)] px-[10px] py-[8px] text-[9px] leading-[14px] text-[var(--color-text-tertiary)]">
              {t('settings.routing.sourceManagerHint')}
            </p>
            {[...selectedSources, ...unselectedSources].map((source) => {
              const checked = usesAllSources || explicitIds.has(source.providerId!)
              return (
                <RoutingSourceChoice
                  key={source.id}
                  source={source}
                  checked={checked}
                  disabled={disabled || (checked && selectedSources.length <= 1)}
                  onChange={(next) => toggleSource(source.providerId!, next)}
                />
              )
            })}
          </div>
        )}
      </section>

      <section className="border-t border-[var(--color-border-separator)]">
        <button
          type="button"
          aria-expanded={showAdvanced}
          onClick={() => {
            setShowAdvanced((current) => !current)
            setShowSources(false)
          }}
          className="flex min-h-[50px] w-full items-center gap-[9px] px-[16px] text-left hover:bg-[var(--color-surface-hover)] sm:px-[20px]"
        >
          <SlidersHorizontal size={14} className="shrink-0 text-[var(--color-text-tertiary)]" />
          <span className="text-[11px] font-bold text-[var(--color-text-primary)]">
            {t('settings.routing.advancedSettings')}
          </span>
          <span className="min-w-0 flex-1 truncate text-[10px] text-[var(--color-text-tertiary)]">
            {t('settings.routing.advancedSummary', {
              strategy: t(strategyTranslationKey(profile.strategy, 'name')),
              count: profile.maxAttempts,
            })}
          </span>
          <ChevronDown
            size={14}
            className={`shrink-0 text-[var(--color-text-tertiary)] transition-transform ${
              showAdvanced ? 'rotate-180' : ''
            }`}
          />
        </button>

        {showAdvanced && (
          <div className="grid gap-[14px] border-t border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] px-[16px] py-[14px] sm:grid-cols-3 sm:px-[20px]">
            <div>
              <span className="mb-[5px] block text-[10px] font-semibold text-[var(--color-text-tertiary)]">
                {t('settings.routing.strategyLabel')}
              </span>
              <RoutingStrategyPicker
                value={profile.strategy}
                disabled={disabled}
                onChange={(strategy) => onChange({ ...profile, strategy })}
              />
            </div>

            <div>
              <span className="mb-[5px] block text-[10px] font-semibold text-[var(--color-text-tertiary)]">
                {t('settings.routing.maxAttempts')}
              </span>
              <div className="flex h-[34px] w-fit overflow-hidden rounded-[7px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)]">
                <button
                  type="button"
                  aria-label={t('settings.routing.decreaseAttempts')}
                  disabled={disabled || profile.maxAttempts <= 1}
                  onClick={() => onChange({ ...profile, maxAttempts: Math.max(1, profile.maxAttempts - 1) })}
                  className="flex w-[32px] items-center justify-center text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-35"
                >
                  <Minus size={13} />
                </button>
                <span className="flex w-[34px] items-center justify-center border-x border-[var(--color-border-separator)] text-[11px] font-bold text-[var(--color-text-primary)]">
                  {profile.maxAttempts}
                </span>
                <button
                  type="button"
                  aria-label={t('settings.routing.increaseAttempts')}
                  disabled={disabled || profile.maxAttempts >= 3}
                  onClick={() => onChange({ ...profile, maxAttempts: Math.min(3, profile.maxAttempts + 1) })}
                  className="flex w-[32px] items-center justify-center text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-35"
                >
                  <Plus size={13} />
                </button>
              </div>
            </div>

            <div className="flex items-end justify-between gap-[10px] sm:justify-start">
              <span className="pb-[8px] text-[10px] font-semibold text-[var(--color-text-secondary)]">
                {t('settings.routing.experimental')}
              </span>
              <div className="pb-[4px]">
                <Switch
                  checked={profile.allowExperimental}
                  disabled={disabled}
                  accent
                  ariaLabel={t('settings.routing.experimental')}
                  onChange={(allowExperimental) => onChange({ ...profile, allowExperimental })}
                />
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function RoutingSourceChoice({
  source,
  checked,
  disabled,
  onChange,
}: {
  source: RoutingSource
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}) {
  const t = useTranslation()

  return (
    <div className="flex min-h-[48px] items-center gap-[9px] border-t border-[var(--color-border-separator)] px-[10px] first:border-t-0">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={t('settings.routing.toggleSource', { source: source.name })}
        className="h-[15px] w-[15px] shrink-0 accent-[#1473e6] disabled:opacity-45 dark:accent-[#64a8ff]"
      />
      <ProviderLogo name={source.name} providerId={source.presetId} size="xs" decorative />
      <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-[var(--color-text-primary)]">
        {source.name}
      </span>
      <SourceCostBadge source={source} />
    </div>
  )
}

function SourceCostBadge({ source }: { source: RoutingSource }) {
  const t = useTranslation()
  const tone = source.cost === 'paid'
    ? 'bg-[var(--color-error)]/8 text-[var(--color-error)]'
    : source.cost === 'mixed' || source.cost === 'signup-credit'
      ? 'bg-[var(--color-warning)]/12 text-[var(--color-text-secondary)]'
      : source.cost === 'unknown'
        ? 'bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)]'
        : 'bg-[#22a447]/10 text-[#168438] dark:text-[#62c97e]'

  return (
    <span className={`inline-flex max-w-full items-center rounded-[5px] px-[6px] py-[3px] text-[9px] font-semibold ${tone}`}>
      <span className="truncate">{t(`settings.routing.cost.${source.cost}` as never)}</span>
    </span>
  )
}

function getCostPolicy(profile: RouteProfile): CostPolicy {
  if (profile.strictFree) return 'free-only'
  if (profile.strategy === 'cost-optimized') return 'prefer-free'
  return 'allow-paid'
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
