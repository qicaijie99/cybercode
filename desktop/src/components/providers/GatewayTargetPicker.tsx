import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleOff,
  Route,
  Search,
  Server,
} from 'lucide-react'
import { useTranslation } from '../../i18n'
import type { GatewayTarget } from '../../types/gateway'
import { Button } from '../shared/Button'
import { Modal } from '../shared/Modal'
import { ProviderLogo } from './ProviderLogo'

export type GatewayTargetKind = GatewayTarget['kind']
export type GatewayTargetPickerMode = 'scope' | 'default'

type ProviderTargetGroup = {
  id: string
  name: string
  targets: GatewayTarget[]
}

type VisibleProviderTargetGroup = ProviderTargetGroup & {
  visibleTargets: GatewayTarget[]
}

type GatewayTargetPickerProps = {
  open: boolean
  mode: GatewayTargetPickerMode
  initialKind: GatewayTargetKind
  targets: GatewayTarget[]
  selectedTargets: Set<string>
  defaultTarget: string | null
  disabled: boolean
  onClose: () => void
  onToggleTarget: (target: GatewayTarget) => void
  onToggleGroup: (targets: GatewayTarget[]) => void
  onSelectDefault: (targetId: string | null) => void
}

function providerGroupId(target: GatewayTarget): string {
  return target.providerId || target.description || target.id
}

function groupModels(targets: GatewayTarget[]): ProviderTargetGroup[] {
  const groups = new Map<string, ProviderTargetGroup>()
  for (const target of targets) {
    const id = providerGroupId(target)
    const existing = groups.get(id)
    if (existing) {
      existing.targets.push(target)
      continue
    }
    groups.set(id, {
      id,
      name: target.description || target.providerId || target.label,
      targets: [target],
    })
  }
  return [...groups.values()].sort((left, right) => left.name.localeCompare(right.name))
}

function targetMatchesQuery(target: GatewayTarget, query: string): boolean {
  if (!query) return true
  return [
    target.label,
    target.description,
    target.modelId,
    target.routeId,
  ].some((value) => value?.toLocaleLowerCase().includes(query))
}

function TargetGlyph({ kind }: { kind: GatewayTargetKind }) {
  return (
    <span className={`flex size-[34px] shrink-0 items-center justify-center rounded-[8px] ${
      kind === 'route'
        ? 'bg-[#1473e6]/10 text-[#1473e6] dark:bg-[#68adff]/12 dark:text-[#68adff]'
        : 'bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)]'
    }`}>
      {kind === 'route'
        ? <Route size={17} strokeWidth={1.9} />
        : <Server size={17} strokeWidth={1.9} />}
    </span>
  )
}

export function GatewayTargetPicker({
  open,
  mode,
  initialKind,
  targets,
  selectedTargets,
  defaultTarget,
  disabled,
  onClose,
  onToggleTarget,
  onToggleGroup,
  onSelectDefault,
}: GatewayTargetPickerProps) {
  const t = useTranslation()
  const [kind, setKind] = useState<GatewayTargetKind>(initialKind)
  const [query, setQuery] = useState('')
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!open) return
    setKind(initialKind)
    setQuery('')
    const activeTarget = targets.find((target) => target.id === defaultTarget)
    setExpandedProviders(new Set(
      activeTarget?.kind === 'model' ? [providerGroupId(activeTarget)] : [],
    ))
  }, [defaultTarget, initialKind, open, targets])

  const selectableTargets = useMemo(
    () => mode === 'default'
      ? targets.filter((target) => selectedTargets.has(target.id))
      : targets,
    [mode, selectedTargets, targets],
  )
  const routeTargets = useMemo(
    () => selectableTargets.filter((target) => target.kind === 'route'),
    [selectableTargets],
  )
  const modelTargets = useMemo(
    () => selectableTargets.filter((target) => target.kind === 'model'),
    [selectableTargets],
  )
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleRoutes = useMemo(
    () => routeTargets.filter((target) => targetMatchesQuery(target, normalizedQuery)),
    [normalizedQuery, routeTargets],
  )
  const modelGroups = useMemo<VisibleProviderTargetGroup[]>(
    () => groupModels(modelTargets)
      .map((group) => ({
        ...group,
        visibleTargets: group.targets.filter((target) => targetMatchesQuery(target, normalizedQuery)),
      }))
      .filter((group) => group.visibleTargets.length > 0),
    [modelTargets, normalizedQuery],
  )
  const currentKindTargets = kind === 'route' ? routeTargets : modelTargets
  const allCurrentSelected = currentKindTargets.length > 0 &&
    currentKindTargets.every((target) => selectedTargets.has(target.id))
  const selectedCount = selectableTargets.filter((target) => selectedTargets.has(target.id)).length

  const setTargetKind = (next: GatewayTargetKind) => {
    setKind(next)
    setQuery('')
  }

  const selectDefault = (targetId: string | null) => {
    onSelectDefault(targetId)
    onClose()
  }

  const toggleProvider = (providerId: string) => {
    setExpandedProviders((current) => {
      const next = new Set(current)
      if (next.has(providerId)) next.delete(providerId)
      else next.add(providerId)
      return next
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'default'
        ? t('settings.gateway.defaultPickerTitle')
        : t('settings.gateway.targetPickerTitle')}
      width={680}
      footer={(
        <div className="flex w-full items-center justify-between gap-[12px]">
          <span className="text-[11px] font-medium text-[var(--color-text-tertiary)]">
            {mode === 'scope'
              ? t('settings.gateway.selectedTotal', { count: selectedCount })
              : t('settings.gateway.defaultPickerHint')}
          </span>
          <Button size="sm" onClick={onClose}>{t('settings.gateway.done')}</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[14px]">
        <div
          role="tablist"
          aria-label={t('settings.gateway.targetType')}
          className="grid grid-cols-2 rounded-[8px] bg-[var(--color-surface-container)] p-[3px]"
        >
          {([
            ['route', t('settings.gateway.routes'), routeTargets.length],
            ['model', t('settings.gateway.directModels'), modelTargets.length],
          ] as const).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={kind === value}
              onClick={() => setTargetKind(value)}
              className={`flex h-[38px] min-w-0 items-center justify-center gap-[7px] rounded-[6px] px-[10px] text-[12px] font-semibold transition-[background-color,color,box-shadow] ${
                kind === value
                  ? 'bg-[var(--color-surface-container-lowest)] text-[var(--color-text-primary)] shadow-[var(--shadow-sm)]'
                  : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {value === 'route'
                ? <Route size={15} strokeWidth={1.9} />
                : <Server size={15} strokeWidth={1.9} />}
              <span className="truncate">{label}</span>
              <span className="text-[10px] font-semibold text-[var(--color-text-tertiary)]">{count}</span>
            </button>
          ))}
        </div>

        <div className="relative">
          <Search
            size={15}
            strokeWidth={1.9}
            className="pointer-events-none absolute left-[12px] top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={kind === 'route'
              ? t('settings.gateway.searchRoutes')
              : t('settings.gateway.searchModels')}
            placeholder={kind === 'route'
              ? t('settings.gateway.searchRoutes')
              : t('settings.gateway.searchModels')}
            className="h-[40px] w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] pl-[36px] pr-[12px] text-[12px] font-medium text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)] focus:shadow-[var(--shadow-focus-ring)]"
          />
        </div>

        {mode === 'scope' && currentKindTargets.length > 0 && (
          <div className="flex items-center justify-between gap-[12px]">
            <span className="text-[11px] leading-[17px] text-[var(--color-text-tertiary)]">
              {kind === 'route'
                ? t('settings.gateway.routeAccessHint')
                : t('settings.gateway.modelAccessHint')}
            </span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onToggleGroup(currentKindTargets)}
              className="shrink-0 text-[11px] font-semibold text-[#1473e6] transition-colors hover:text-[var(--color-text-primary)] disabled:opacity-40 dark:text-[#68adff]"
            >
              {allCurrentSelected
                ? t('settings.gateway.clearGroup')
                : t('settings.gateway.selectGroup')}
            </button>
          </div>
        )}

        {mode === 'default' && (
          <TargetRow
            label={t('settings.gateway.noDefault')}
            description={t('settings.gateway.noDefaultHint')}
            kind="route"
            selected={defaultTarget === null}
            mode={mode}
            disabled={disabled}
            customIcon={<CircleOff size={17} strokeWidth={1.8} />}
            onClick={() => selectDefault(null)}
          />
        )}

        <div className="overflow-hidden rounded-[8px] border border-[var(--color-border-separator)] bg-[var(--color-surface-container-lowest)]">
          {kind === 'route' ? (
            visibleRoutes.length > 0 ? (
              <div className="divide-y divide-[var(--color-border-separator)]">
                {visibleRoutes.map((target) => (
                  <TargetRow
                    key={target.id}
                    label={target.label}
                    description={target.description}
                    kind={target.kind}
                    selected={mode === 'default'
                      ? defaultTarget === target.id
                      : selectedTargets.has(target.id)}
                    mode={mode}
                    disabled={disabled}
                    onClick={() => mode === 'default'
                      ? selectDefault(target.id)
                      : onToggleTarget(target)}
                  />
                ))}
              </div>
            ) : (
              <PickerEmptyState
                text={mode === 'default' && routeTargets.length === 0
                  ? t('settings.gateway.noAllowedRoutes')
                  : t('settings.gateway.noMatchingTargets')}
              />
            )
          ) : modelGroups.length > 0 ? (
            <div className="divide-y divide-[var(--color-border-separator)]">
              {modelGroups.map((group) => {
                const isExpanded = normalizedQuery.length > 0 || expandedProviders.has(group.id)
                const groupSelectedCount = group.targets.filter((target) => selectedTargets.has(target.id)).length
                const allGroupSelected = group.targets.length > 0 && groupSelectedCount === group.targets.length
                return (
                  <section key={group.id}>
                    <div className="flex min-h-[58px] items-center gap-[7px] px-[10px]">
                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        onClick={() => toggleProvider(group.id)}
                        className="flex min-w-0 flex-1 items-center gap-[10px] rounded-[7px] px-[4px] py-[7px] text-left hover:bg-[var(--color-surface-hover)]"
                      >
                        <ProviderLogo
                          name={group.name}
                        modelId={group.targets[0]?.modelId}
                          size="sm"
                          decorative
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-semibold text-[var(--color-text-primary)]">
                            {group.name}
                          </span>
                          <span className="mt-[2px] block text-[10px] font-medium text-[var(--color-text-tertiary)]">
                            {mode === 'scope'
                              ? t('settings.gateway.providerSelectionCount', {
                                  selected: groupSelectedCount,
                                  total: group.targets.length,
                                })
                              : t('settings.gateway.providerModelCount', { count: group.targets.length })}
                          </span>
                        </span>
                        {isExpanded
                          ? <ChevronDown size={15} className="shrink-0 text-[var(--color-text-tertiary)]" />
                          : <ChevronRight size={15} className="shrink-0 text-[var(--color-text-tertiary)]" />}
                      </button>
                      {mode === 'scope' && (
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={allGroupSelected}
                          aria-label={allGroupSelected
                            ? t('settings.gateway.clearProvider', { provider: group.name })
                            : t('settings.gateway.selectProvider', { provider: group.name })}
                          title={allGroupSelected
                            ? t('settings.gateway.clearProvider', { provider: group.name })
                            : t('settings.gateway.selectProvider', { provider: group.name })}
                          disabled={disabled}
                          onClick={() => onToggleGroup(group.targets)}
                          className={`flex size-[30px] shrink-0 items-center justify-center rounded-[7px] border transition-colors disabled:opacity-40 ${
                            allGroupSelected
                              ? 'border-[#1473e6] bg-[#1473e6] text-white dark:border-[#68adff] dark:bg-[#68adff] dark:text-[#111315]'
                              : 'border-[var(--color-border)] text-transparent hover:border-[var(--color-border-focus)]'
                          }`}
                        >
                          <Check size={14} strokeWidth={2.4} />
                        </button>
                      )}
                    </div>
                    {isExpanded && (
                      <div className="border-t border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)]">
                        {group.visibleTargets.map((target) => (
                          <TargetRow
                            key={target.id}
                            label={target.label}
                            description={t('settings.gateway.directModel')}
                            kind={target.kind}
                            selected={mode === 'default'
                              ? defaultTarget === target.id
                              : selectedTargets.has(target.id)}
                            mode={mode}
                            disabled={disabled}
                            compact
                            onClick={() => mode === 'default'
                              ? selectDefault(target.id)
                              : onToggleTarget(target)}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                )
              })}
            </div>
          ) : (
            <PickerEmptyState
              text={mode === 'default' && modelTargets.length === 0
                ? t('settings.gateway.noAllowedModels')
                : t('settings.gateway.noMatchingTargets')}
            />
          )}
        </div>
      </div>
    </Modal>
  )
}

function TargetRow({
  label,
  description,
  kind,
  selected,
  mode,
  disabled,
  compact = false,
  customIcon,
  onClick,
}: {
  label: string
  description: string
  kind: GatewayTargetKind
  selected: boolean
  mode: GatewayTargetPickerMode
  disabled: boolean
  compact?: boolean
  customIcon?: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role={mode === 'default' ? 'radio' : 'checkbox'}
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={`group flex w-full items-center gap-[11px] px-[13px] text-left transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50 ${
        compact ? 'min-h-[50px] pl-[24px]' : 'min-h-[58px]'
      } ${selected ? 'bg-[var(--color-surface-selected)]' : ''}`}
    >
      {customIcon ? (
        <span className="flex size-[34px] shrink-0 items-center justify-center rounded-[8px] bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)]">
          {customIcon}
        </span>
      ) : compact ? (
        <span className="flex size-[26px] shrink-0 items-center justify-center text-[var(--color-text-tertiary)]">
          <Server size={15} strokeWidth={1.8} />
        </span>
      ) : (
        <TargetGlyph kind={kind} />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-semibold text-[var(--color-text-primary)]">{label}</span>
        <span className="mt-[2px] block truncate text-[10px] leading-[15px] text-[var(--color-text-tertiary)]">{description}</span>
      </span>
      <span className={`flex size-[21px] shrink-0 items-center justify-center border transition-colors ${
        mode === 'default' ? 'rounded-full' : 'rounded-[6px]'
      } ${
        selected
          ? 'border-[#1473e6] bg-[#1473e6] text-white dark:border-[#68adff] dark:bg-[#68adff] dark:text-[#111315]'
          : 'border-[var(--color-border)] text-transparent group-hover:border-[var(--color-border-focus)]'
      }`}>
        <Check size={12} strokeWidth={2.5} />
      </span>
    </button>
  )
}

function PickerEmptyState({ text }: { text: string }) {
  return (
    <div className="flex min-h-[128px] flex-col items-center justify-center gap-[8px] px-[24px] py-[28px] text-center">
      <Search size={18} strokeWidth={1.7} className="text-[var(--color-text-tertiary)]" />
      <p className="max-w-[340px] text-[11px] leading-[17px] text-[var(--color-text-tertiary)]">{text}</p>
    </div>
  )
}
