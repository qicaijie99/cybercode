import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { subscribeToViewportChanges } from '../../lib/viewportEvents'
import { Icon } from '../shared/Icon'
import { ProviderLogo } from './ProviderLogo'

export type ProviderCatalogCardTone = 'accent' | 'muted' | 'positive' | 'negative'
export type ProviderCatalogBadgeTone = 'free' | 'mixed' | 'credit' | 'local'

export type ProviderCatalogAction = {
  id: string
  label: string
  icon: string
  danger?: boolean
  onSelect: () => void
}

type ProviderCatalogCardProps = {
  name: string
  status: string
  statusTone?: ProviderCatalogCardTone
  providerId?: string
  baseUrl?: string
  modelId?: string
  active?: boolean
  emphasized?: boolean
  badge?: string
  badgeTone?: ProviderCatalogBadgeTone
  badgeTitle?: string
  ariaLabel: string
  ariaExpanded?: boolean
  onClick: () => void
  actions?: ProviderCatalogAction[]
  actionsLabel?: string
}

export function ProviderCatalogCard({
  name,
  status,
  statusTone = 'muted',
  providerId,
  baseUrl,
  modelId,
  active = false,
  emphasized = false,
  badge,
  badgeTone = 'free',
  badgeTitle,
  ariaLabel,
  ariaExpanded,
  onClick,
  actions = [],
  actionsLabel,
}: ProviderCatalogCardProps) {
  const statusClassName = {
    accent: 'text-[#1473e6] dark:text-[#68adff]',
    muted: 'text-[var(--color-text-tertiary)]',
    positive: 'text-[var(--color-success)]',
    negative: 'text-[var(--color-error)]',
  }[statusTone]
  const badgeClassName = {
    free: 'border-[#15803d]/20 bg-[#16a34a]/[0.09] text-[#137333] dark:border-[#4ade80]/25 dark:bg-[#4ade80]/[0.11] dark:text-[#86efac]',
    mixed: 'border-[#d97706]/25 bg-[#f59e0b]/[0.10] text-[#a15c00] dark:border-[#fbbf24]/25 dark:bg-[#fbbf24]/[0.10] dark:text-[#fcd34d]',
    credit: 'border-[#1473e6]/20 bg-[#1473e6]/[0.08] text-[#1263c0] dark:border-[#68adff]/25 dark:bg-[#68adff]/[0.10] dark:text-[#8dc2ff]',
    local: 'border-[var(--color-border)] bg-[var(--color-surface-container-low)] text-[var(--color-text-secondary)]',
  }[badgeTone]

  return (
    <div
      data-provider-card-layout="catalog"
      className={`group relative min-h-[104px] min-w-0 rounded-[8px] border transition-[border-color,background-color,transform] duration-150 ${
        emphasized
          ? 'border-[#1473e6]/30 bg-[#1473e6]/[0.045] hover:border-[#1473e6]/55 hover:bg-[#1473e6]/[0.075] dark:border-[#68adff]/30 dark:bg-[#68adff]/[0.055]'
          : 'border-[var(--color-border-separator)] bg-[var(--color-surface-container-lowest)] hover:border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]'
      }`}
    >
      <button
        type="button"
        className={`flex min-h-[102px] w-full min-w-0 items-center gap-[12px] rounded-[7px] px-[14px] py-[16px] text-left outline-none transition-transform active:translate-y-px focus-visible:shadow-[var(--shadow-focus-ring)] ${
          actions.length > 0 ? 'pr-[46px]' : ''
        }`}
        aria-label={ariaLabel}
        {...(ariaExpanded === undefined ? {} : { 'aria-expanded': ariaExpanded })}
        onClick={onClick}
      >
        <ProviderLogo
          name={name}
          providerId={providerId}
          baseUrl={baseUrl}
          modelId={modelId}
          size="md"
          active={active}
          decorative
        />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-[6px]">
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-[18px] text-[var(--color-text-primary)]">
              {name}
            </span>
            {badge && (
              <span
                title={badgeTitle}
                className={`shrink-0 rounded-[5px] border px-[5px] py-px text-[10px] font-semibold leading-[15px] ${badgeClassName}`}
              >
                {badge}
              </span>
            )}
          </span>
          <span
            title={status}
            className={`mt-[4px] block truncate text-[11px] font-medium leading-[16px] ${statusClassName}`}
          >
            {status}
          </span>
        </span>
      </button>

      {actions.length > 0 && actionsLabel && (
        <ProviderCatalogActionMenu
          label={actionsLabel}
          actions={actions}
        />
      )}
    </div>
  )
}

function ProviderCatalogActionMenu({
  label,
  actions,
}: {
  label: string
  actions: ProviderCatalogAction[]
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{
    top: number
    left: number
    width: number
    maxHeight: number
    direction: 'up' | 'down'
  } | null>(null)

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return

    const rect = trigger.getBoundingClientRect()
    const margin = 12
    const gap = 6
    const width = Math.min(164, Math.max(1, window.innerWidth - margin * 2))
    const menuHeight = Math.min(300, actions.length * 36 + 10)
    const spaceBelow = window.innerHeight - rect.bottom - gap - margin
    const spaceAbove = rect.top - gap - margin
    const direction = (
      spaceBelow >= menuHeight ||
      spaceBelow >= spaceAbove
    ) ? 'down' : 'up'
    const availableHeight = direction === 'down' ? spaceBelow : spaceAbove

    setPosition({
      top: direction === 'down' ? rect.bottom + gap : rect.top - gap,
      left: Math.min(
        Math.max(margin, rect.right - width),
        Math.max(margin, window.innerWidth - width - margin),
      ),
      width,
      maxHeight: Math.max(48, Math.min(menuHeight, availableHeight)),
      direction,
    })
  }, [actions.length])

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
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
  }, [open])

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }

    updatePosition()
    return subscribeToViewportChanges(updatePosition)
  }, [open, updatePosition])

  return (
    <div className="absolute right-[8px] top-[8px] z-10">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((current) => !current)}
        className={`flex h-[30px] w-[30px] items-center justify-center rounded-[7px] border text-[var(--color-text-tertiary)] outline-none transition-[opacity,color,background-color,border-color] hover:text-[var(--color-text-primary)] focus-visible:shadow-[var(--shadow-focus-ring)] ${
          open
            ? 'border-[var(--color-border)] bg-[var(--color-background)] opacity-100'
            : 'border-transparent bg-transparent opacity-55 hover:bg-[var(--color-surface-hover)] group-hover:opacity-100 group-focus-within:opacity-100'
        }`}
      >
        <Icon name="more_horiz" size={16} />
      </button>

      {open && position && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          className="settings-ui native-ui-text fixed z-[9999] overflow-y-auto overscroll-contain rounded-[8px] border border-[var(--color-border-separator)] bg-[var(--color-background)] p-[5px] shadow-[var(--shadow-dropdown)]"
          style={{
            left: position.left,
            width: position.width,
            maxHeight: position.maxHeight,
            ...(position.direction === 'down'
              ? { top: position.top }
              : { bottom: window.innerHeight - position.top }),
          }}
        >
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                action.onSelect()
              }}
              className={`flex h-[36px] w-full items-center gap-[9px] rounded-[6px] px-[10px] text-left text-[12px] font-medium transition-colors ${
                action.danger
                  ? 'text-[var(--color-error)] hover:bg-[var(--color-error)]/[0.07]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <Icon name={action.icon} size={14} className="shrink-0" />
              <span className="truncate">{action.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
