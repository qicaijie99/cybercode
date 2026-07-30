import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  CircleDollarSign,
  ListOrdered,
  Plus,
  Route,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useTranslation } from '../../i18n'
import type {
  RouteProfile,
  RouteTarget,
  RoutingSource,
  RoutingStrategy,
} from '../../types/routing'
import {
  createRouteId,
  routeBuilderModeFor,
  type RouteBuilderMode,
} from '../../utils/routingRoutes'
import { formatContextWindowInput } from '../../utils/modelContextWindows'
import {
  ProviderModelBrowser,
  type ProviderModelBrowserGroup,
} from '../controls/ProviderModelBrowser'
import { Button } from '../shared/Button'
import { Modal } from '../shared/Modal'
import { ProviderLogo } from './ProviderLogo'

const MODE_STRATEGIES: Record<RouteBuilderMode, RoutingStrategy> = {
  balanced: 'auto',
  reliable: 'lkgp',
  economy: 'cost-optimized',
  ordered: 'priority',
}

const MODE_ICONS = {
  balanced: Sparkles,
  reliable: ShieldCheck,
  economy: CircleDollarSign,
  ordered: ListOrdered,
} as const

const BUILDER_MODES = Object.keys(MODE_STRATEGIES) as RouteBuilderMode[]

type RouteBuilderDialogProps = {
  open: boolean
  route: RouteProfile | null
  sources: RoutingSource[]
  existingRouteIds: string[]
  saving: boolean
  onClose: () => void
  onSave: (route: RouteProfile) => void | Promise<void>
  onOpenSources?: () => void
}

export function RouteBuilderDialog({
  open,
  route,
  sources,
  existingRouteIds,
  saving,
  onClose,
  onSave,
  onOpenSources,
}: RouteBuilderDialogProps) {
  const t = useTranslation()
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [mode, setMode] = useState<RouteBuilderMode>('balanced')
  const [targets, setTargets] = useState<RouteTarget[]>([])
  const [modelPickerOpen, setModelPickerOpen] = useState(false)

  const availableSources = useMemo(
    () => sources.filter((source) => source.routable && source.providerId && source.models.length > 0),
    [sources],
  )
  const modelGroups = useMemo<ProviderModelBrowserGroup[]>(
    () => availableSources.map((source) => ({
      id: source.providerId!,
      name: source.name,
      logoId: source.presetId,
      modelHint: source.models[0]?.id,
      models: source.models.map((model) => {
        const added = targets.some((target) => (
          target.providerId === source.providerId && target.modelId === model.id
        ))
        return {
          id: model.id,
          context: formatContextWindowInput(model.contextWindow),
          disabled: added,
          disabledLabel: added ? t('model.added') : undefined,
        }
      }),
    })),
    [availableSources, t, targets],
  )
  const availableModelCount = availableSources.reduce(
    (count, source) => count + source.models.length,
    0,
  )

  useEffect(() => {
    if (!open) return
    const initialTargets = route?.targets.map((target, index) => {
      const source = availableSources.find((item) => item.providerId === target.providerId)
      return {
        ...target,
        ...(target.modelId ? {} : source?.models[0]?.id ? { modelId: source.models[0].id } : {}),
        priority: index,
      }
    }) ?? []
    setStep(0)
    setName(route?.name ?? '')
    setMode(route
      ? route.strictFree
        ? 'economy'
        : routeBuilderModeFor(route.strategy)
      : 'balanced')
    setTargets(initialTargets)
    setModelPickerOpen(false)
  }, [availableSources, open, route])

  const addTarget = (providerId: string, modelId: string) => {
    if (targets.length >= 8) return
    if (targets.some((target) => (
      target.providerId === providerId && target.modelId === modelId
    ))) return
    setTargets((current) => [
      ...current,
      { providerId, modelId, priority: current.length },
    ])
    setModelPickerOpen(false)
  }

  const moveTarget = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= targets.length) return
    setTargets((current) => {
      const next = [...current]
      ;[next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!]
      return next.map((target, targetIndex) => ({ ...target, priority: targetIndex }))
    })
  }

  const removeTarget = (index: number) => {
    setTargets((current) => current
      .filter((_, targetIndex) => targetIndex !== index)
      .map((target, targetIndex) => ({ ...target, priority: targetIndex })))
  }

  const canContinue = step === 0
    ? name.trim().length > 0
    : step === 1
      ? targets.length > 0
      : true

  const handleSave = async () => {
    if (!canContinue) return
    const normalizedTargets = targets.map((target, index) => ({
      providerId: target.providerId,
      modelId: target.modelId,
      priority: index,
    }))
    await onSave({
      id: route?.id ?? createRouteId(name, existingRouteIds),
      name: name.trim(),
      ...(route?.description && { description: route.description }),
      enabled: route?.enabled ?? true,
      strategy: MODE_STRATEGIES[mode],
      strictFree: mode === 'economy' ? route?.strictFree ?? false : false,
      allowExperimental: route?.allowExperimental ?? false,
      maxAttempts: Math.min(8, Math.max(1, normalizedTargets.length)),
      targets: normalizedTargets,
    })
  }

  const footer = (
    <>
      <Button
        variant="ghost"
        size="sm"
        disabled={saving}
        onClick={step === 0 ? onClose : () => setStep((current) => current - 1)}
        icon={step > 0 ? <ArrowLeft size={14} /> : undefined}
        className="rounded-[7px]"
      >
        {t(step === 0 ? 'common.cancel' : 'common.back')}
      </Button>
      <Button
        size="sm"
        loading={saving}
        disabled={!canContinue}
        onClick={step === 2 ? () => void handleSave() : () => setStep((current) => current + 1)}
        icon={step < 2 ? <ArrowRight size={14} /> : undefined}
        className="rounded-[7px]"
      >
        {t(step === 2
          ? route ? 'settings.routing.builder.saveChanges' : 'settings.routing.builder.create'
          : 'settings.routing.builder.continue')}
      </Button>
    </>
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t(route ? 'settings.routing.builder.editTitle' : 'settings.routing.builder.createTitle')}
      width={680}
      footer={footer}
    >
      <BuilderProgress step={step} />

      {step === 0 && (
        <div className="mt-[22px]">
          <label
            htmlFor="route-name"
            className="mb-[7px] block text-[12px] font-semibold text-[var(--color-text-secondary)]"
          >
            {t('settings.routing.builder.nameLabel')}
          </label>
          <input
            id="route-name"
            autoFocus
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('settings.routing.builder.namePlaceholder')}
            className="h-[42px] w-full rounded-[7px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-[12px] text-[14px] font-semibold text-[var(--color-text-primary)] outline-none transition-colors placeholder:font-normal placeholder:text-[var(--color-text-tertiary)] focus:border-[#1473e6] focus:shadow-[0_0_0_3px_rgba(20,115,230,0.12)] dark:focus:border-[#64a8ff]"
          />

          <div className="mb-[8px] mt-[22px]">
            <h3 className="text-[13px] font-bold text-[var(--color-text-primary)]">
              {t('settings.routing.builder.goalTitle')}
            </h3>
            <p className="mt-[3px] text-[11px] leading-[17px] text-[var(--color-text-tertiary)]">
              {t('settings.routing.builder.goalHint')}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-[8px] sm:grid-cols-2">
            {BUILDER_MODES.map((item) => {
              const ModeIcon = MODE_ICONS[item]
              const selected = mode === item
              return (
                <button
                  key={item}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setMode(item)}
                  className={`flex min-h-[82px] items-start gap-[11px] rounded-[8px] border px-[13px] py-[12px] text-left transition-colors ${
                    selected
                      ? 'border-[#1473e6]/60 bg-[#1473e6]/[0.07] dark:border-[#64a8ff]/60 dark:bg-[#64a8ff]/[0.08]'
                      : 'border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] hover:border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]'
                  }`}
                >
                  <span className={`flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[7px] ${
                    selected
                      ? 'bg-[#1473e6]/12 text-[#1473e6] dark:bg-[#64a8ff]/12 dark:text-[#64a8ff]'
                      : 'bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)]'
                  }`}>
                    <ModeIcon size={16} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[12px] font-bold text-[var(--color-text-primary)]">
                      {t(`settings.routing.mode.${item}.name` as never)}
                    </span>
                    <span className="mt-[3px] block text-[10px] leading-[15px] text-[var(--color-text-tertiary)]">
                      {t(`settings.routing.mode.${item}.description` as never)}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
          {route?.strictFree && mode === 'economy' && (
            <p className="mt-[9px] rounded-[7px] bg-[var(--color-surface-container-low)] px-[10px] py-[8px] text-[10px] leading-[16px] text-[var(--color-text-secondary)]">
              {t('settings.routing.builder.legacyFreeOnly')}
            </p>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="mt-[22px]">
          <div>
            <h3 className="text-[13px] font-bold text-[var(--color-text-primary)]">
              {t('settings.routing.builder.chainTitle')}
            </h3>
            <p className="mt-[3px] text-[11px] leading-[17px] text-[var(--color-text-tertiary)]">
              {t(mode === 'ordered'
                ? 'settings.routing.builder.chainHint'
                : 'settings.routing.builder.chainHintSmart')}
            </p>
          </div>

          {targets.length > 0 && (
            <div className="mt-[14px] overflow-hidden rounded-[8px] border border-[var(--color-border-separator)]">
              {targets.map((target, index) => (
                <RouteTargetRow
                  key={`${target.providerId}:${target.modelId}`}
                  target={target}
                  index={index}
                  count={targets.length}
                  source={availableSources.find((source) => source.providerId === target.providerId)}
                  ordered={mode === 'ordered'}
                  onMove={moveTarget}
                  onRemove={removeTarget}
                />
              ))}
            </div>
          )}

          {availableSources.length > 0 ? (
            <div className="mt-[14px]">
              <button
                type="button"
                aria-expanded={modelPickerOpen}
                aria-label={t('settings.routing.builder.addModel')}
                disabled={targets.length >= 8}
                onClick={() => setModelPickerOpen((current) => !current)}
                className={`flex min-h-[48px] w-full items-center gap-[10px] rounded-[8px] border px-[11px] text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                  modelPickerOpen
                    ? 'border-[var(--color-border-focus)] bg-[var(--color-surface-container-low)] shadow-[var(--shadow-focus-ring)]'
                    : 'border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] hover:bg-[var(--color-surface-hover)]'
                }`}
              >
                <span className="flex size-[30px] shrink-0 items-center justify-center rounded-[7px] bg-[#1473e6]/10 text-[#1473e6] dark:bg-[#64a8ff]/10 dark:text-[#64a8ff]">
                  <Plus size={15} strokeWidth={2.2} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-semibold text-[var(--color-text-primary)]">
                    {t('settings.routing.builder.addModel')}
                  </span>
                  <span className="mt-[2px] block truncate text-[10px] text-[var(--color-text-tertiary)]">
                    {t('settings.routing.builder.modelPickerHint')}
                  </span>
                </span>
                <span className="shrink-0 text-[10px] font-medium text-[var(--color-text-tertiary)]">
                  {t('model.modelCount', { count: availableModelCount })}
                </span>
                <ChevronDown
                  size={15}
                  className={`shrink-0 text-[var(--color-text-tertiary)] transition-transform ${
                    modelPickerOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {modelPickerOpen && (
                <div className="mt-[8px]">
                  <ProviderModelBrowser
                    groups={modelGroups}
                    searchLabel={t('model.searchModels')}
                    noMatchesLabel={t('model.noMatches')}
                    modelCountLabel={(count) => t('model.modelCount', { count })}
                    resetKey={modelPickerOpen}
                    maxListHeight={272}
                    onSelect={(group, model) => addTarget(group.id, model.id)}
                  />
                </div>
              )}
              {targets.length >= 8 && (
                <p className="mt-[7px] text-[10px] text-[var(--color-text-tertiary)]">
                  {t('settings.routing.builder.limitReached')}
                </p>
              )}
            </div>
          ) : (
            <div className="mt-[16px] flex min-h-[126px] flex-col items-center justify-center rounded-[8px] border border-dashed border-[var(--color-border)] px-[18px] text-center">
              <p className="text-[12px] font-semibold text-[var(--color-text-primary)]">
                {t('settings.routing.builder.noModelsTitle')}
              </p>
              <p className="mt-[4px] text-[10px] leading-[16px] text-[var(--color-text-tertiary)]">
                {t('settings.routing.builder.noModelsHint')}
              </p>
              {onOpenSources && (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Plus size={14} />}
                  onClick={onOpenSources}
                  className="mt-[12px] h-[34px] rounded-[7px] shadow-none"
                >
                  {t('settings.routing.addModelSources')}
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="mt-[22px]">
          <div className="flex items-start gap-[12px] border-b border-[var(--color-border-separator)] pb-[16px]">
            <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[8px] bg-[#1473e6]/10 text-[#1473e6] dark:bg-[#64a8ff]/10 dark:text-[#64a8ff]">
              <Route size={18} />
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-[15px] font-bold text-[var(--color-text-primary)]">
                {name.trim()}
              </h3>
              <p className="mt-[3px] text-[11px] text-[var(--color-text-tertiary)]">
                {t(`settings.routing.mode.${mode}.name` as never)} · {t('settings.routing.builder.modelCount', { count: targets.length })}
              </p>
            </div>
          </div>

          <div className="py-[16px]">
            <h4 className="text-[11px] font-bold text-[var(--color-text-secondary)]">
              {t('settings.routing.builder.behaviorTitle')}
            </h4>
            <p className="mt-[5px] text-[12px] leading-[19px] text-[var(--color-text-primary)]">
              {t(mode === 'ordered'
                ? 'settings.routing.builder.previewOrdered'
                : 'settings.routing.builder.previewSmart', {
                first: targetDisplayName(targets[0]!, availableSources),
                count: targets.length,
                goal: t(`settings.routing.mode.${mode}.name` as never),
              })}
            </p>
          </div>

          <div className="overflow-hidden rounded-[8px] border border-[var(--color-border-separator)]">
            {targets.map((target, index) => {
              const source = availableSources.find((item) => item.providerId === target.providerId)
              return (
                <div
                  key={`${target.providerId}:${target.modelId}`}
                  className="flex min-h-[52px] items-center gap-[10px] border-t border-[var(--color-border-separator)] px-[12px] first:border-t-0"
                >
                  <span className="flex h-[22px] min-w-[22px] items-center justify-center rounded-[5px] bg-[var(--color-surface-container-high)] px-[5px] text-[9px] font-bold text-[var(--color-text-tertiary)]">
                    {index + 1}
                  </span>
                  <ProviderLogo
                    name={source?.name ?? target.providerId}
                    providerId={source?.presetId}
                    size="xs"
                    decorative
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-semibold text-[var(--color-text-primary)]">
                      {target.modelId}
                    </span>
                    <span className="block truncate text-[9px] text-[var(--color-text-tertiary)]">
                      {source?.name ?? target.providerId}
                    </span>
                  </span>
                  <span className="text-[9px] font-semibold text-[var(--color-text-tertiary)]">
                    {mode === 'ordered'
                      ? t(index === 0
                        ? 'settings.routing.builder.primary'
                        : 'settings.routing.builder.fallback', { index })
                      : t('settings.routing.builder.candidateOrder', { index: index + 1 })}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </Modal>
  )
}

function BuilderProgress({ step }: { step: number }) {
  const t = useTranslation()
  return (
    <div
      aria-label={t('settings.routing.builder.progress')}
      className="relative grid grid-cols-3 border-b border-[var(--color-border-separator)] pb-[14px]"
    >
      <span className="absolute left-[16.666%] right-[16.666%] top-[12px] h-px bg-[var(--color-border-separator)]" />
      <span
        className="absolute left-[16.666%] top-[12px] h-px bg-[#1473e6] transition-[width] duration-200 dark:bg-[#64a8ff]"
        style={{ width: `${step * 33.333}%` }}
      />
      {(['purpose', 'models', 'review'] as const).map((item, index) => (
        <div key={item} className="relative flex min-w-0 flex-col items-center gap-[5px]">
          <span className={`relative z-[1] flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
            index <= step
              ? 'bg-[#1473e6] text-white dark:bg-[#64a8ff] dark:text-[#0b1118]'
              : 'bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)]'
          }`}>
            {index + 1}
          </span>
          <span className={`max-w-full truncate px-[4px] text-center text-[10px] font-semibold ${
            index === step ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)]'
          }`}>
            {t(`settings.routing.builder.step.${item}` as never)}
          </span>
        </div>
      ))}
    </div>
  )
}

function RouteTargetRow({
  target,
  index,
  count,
  source,
  ordered,
  onMove,
  onRemove,
}: {
  target: RouteTarget
  index: number
  count: number
  source?: RoutingSource
  ordered: boolean
  onMove: (index: number, direction: -1 | 1) => void
  onRemove: (index: number) => void
}) {
  const t = useTranslation()
  return (
    <div className="flex min-h-[58px] items-center gap-[9px] border-t border-[var(--color-border-separator)] bg-[var(--color-surface-container-lowest)] px-[10px] first:border-t-0">
      <span className="flex h-[24px] min-w-[24px] items-center justify-center rounded-[5px] bg-[var(--color-surface-container-high)] px-[5px] text-[9px] font-bold text-[var(--color-text-tertiary)]">
        {index + 1}
      </span>
      <ProviderLogo
        name={source?.name ?? target.providerId}
        providerId={source?.presetId}
        size="xs"
        decorative
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-semibold text-[var(--color-text-primary)]">
          {target.modelId}
        </span>
        <span className="block truncate text-[9px] text-[var(--color-text-tertiary)]">
          {source?.name ?? target.providerId}
        </span>
      </span>
      <span className="hidden text-[9px] font-semibold text-[var(--color-text-tertiary)] sm:block">
        {ordered
          ? t(index === 0
            ? 'settings.routing.builder.primary'
            : 'settings.routing.builder.fallback', { index })
          : t('settings.routing.builder.candidateOrder', { index: index + 1 })}
      </span>
      <div className="flex shrink-0 items-center gap-[2px]">
        <IconButton
          label={t('settings.routing.builder.moveUp')}
          disabled={index === 0}
          onClick={() => onMove(index, -1)}
        >
          <ArrowUp size={13} />
        </IconButton>
        <IconButton
          label={t('settings.routing.builder.moveDown')}
          disabled={index === count - 1}
          onClick={() => onMove(index, 1)}
        >
          <ArrowDown size={13} />
        </IconButton>
        <IconButton
          label={t('settings.routing.builder.removeModel')}
          onClick={() => onRemove(index)}
          danger
        >
          <Trash2 size={13} />
        </IconButton>
      </div>
    </div>
  )
}

function IconButton({
  label,
  disabled,
  danger = false,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  danger?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-[28px] w-[28px] items-center justify-center rounded-[6px] transition-colors disabled:cursor-not-allowed disabled:opacity-25 ${
        danger
          ? 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-error)]/10 hover:text-[var(--color-error)]'
          : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      {children}
    </button>
  )
}

function targetDisplayName(target: RouteTarget, sources: RoutingSource[]): string {
  const source = sources.find((item) => item.providerId === target.providerId)
  return `${source?.name ?? target.providerId} · ${target.modelId ?? source?.models[0]?.id ?? ''}`
}
