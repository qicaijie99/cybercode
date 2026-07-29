import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { createPortal } from 'react-dom'
import {
  Check,
  ChevronUp,
  ClipboardList,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useChatStore } from '../../stores/chatStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTabStore } from '../../stores/tabStore'
import { useTranslation } from '../../i18n'
import { subscribeToViewportChanges } from '../../lib/viewportEvents'
import type { PermissionMode } from '../../types/settings'
import { Icon } from '../shared/Icon'

const MODE_ICONS: Record<PermissionMode, LucideIcon> = {
  default: Shield,
  acceptEdits: Zap,
  plan: ClipboardList,
  bypassPermissions: ShieldAlert,
  dontAsk: ShieldAlert,
}

type MenuPosition = {
  top: number
  left: number
  width: number
  maxHeight: number
  direction: 'up' | 'down'
}

const MENU_WIDTH = 320
const MENU_HEIGHT = 304
const VIEWPORT_MARGIN = 12
const MENU_GAP = 10

type Props = {
  workDir?: string
  /** Controlled mode: override current value */
  value?: PermissionMode
  /** Controlled mode: called on change instead of updating global store */
  onChange?: (mode: PermissionMode) => void
  variant?: 'pill' | 'icon'
}

export function PermissionModeSelector({ workDir: workDirProp, value, onChange, variant = 'pill' }: Props = {}) {
  const t = useTranslation()
  const { permissionMode: storeMode, setPermissionMode } = useSettingsStore()
  const setSessionPermissionMode = useChatStore((s) => s.setSessionPermissionMode)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const [open, setOpen] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState(false)
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const isControlled = value !== undefined
  const currentMode = isControlled ? value : storeMode
  const isIconVariant = variant === 'icon'
  const permissionSettingsLabel = t('permMode.settings')

  const PERMISSION_ITEMS: Array<{
    value: PermissionMode
    label: string
    description: string
    icon: LucideIcon
    color?: string
  }> = [
    {
      value: 'default',
      label: t('permMode.askPermissions'),
      description: t('permMode.askPermDesc'),
      icon: Shield,
    },
    {
      value: 'acceptEdits',
      label: t('permMode.autoAccept'),
      description: t('permMode.autoAcceptDesc'),
      icon: Zap,
    },
    {
      value: 'plan',
      label: t('permMode.planMode'),
      description: t('permMode.planModeDesc'),
      icon: ClipboardList,
      color: 'text-[var(--color-text-tertiary)]',
    },
    {
      value: 'bypassPermissions',
      label: t('permMode.bypass'),
      description: t('permMode.bypassDesc'),
      icon: ShieldAlert,
      color: 'text-[var(--color-error)]',
    },
  ]

  const MODE_LABELS: Record<PermissionMode, string> = {
    default: t('permMode.label.default'),
    acceptEdits: t('permMode.label.acceptEdits'),
    plan: t('permMode.label.plan'),
    bypassPermissions: t('permMode.label.bypassPermissions'),
    dontAsk: t('permMode.label.dontAsk'),
  }

  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const workDir = workDirProp || activeSession?.workDir || '~'
  const CurrentModeIcon = isIconVariant ? Shield : MODE_ICONS[currentMode] ?? ShieldCheck

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return

    const rect = trigger.getBoundingClientRect()
    const width = Math.min(
      MENU_WIDTH,
      Math.max(1, window.innerWidth - VIEWPORT_MARGIN * 2),
    )
    const maxLeft = Math.max(
      VIEWPORT_MARGIN,
      window.innerWidth - width - VIEWPORT_MARGIN,
    )
    const desiredLeft = isIconVariant ? rect.right - width : rect.left
    const spaceAbove = rect.top - MENU_GAP - VIEWPORT_MARGIN
    const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP - VIEWPORT_MARGIN
    const direction = (
      spaceAbove >= MENU_HEIGHT ||
      spaceAbove >= spaceBelow
    ) ? 'up' : 'down'
    const availableHeight = direction === 'up' ? spaceAbove : spaceBelow

    setMenuPosition({
      top: direction === 'up' ? rect.top - MENU_GAP : rect.bottom + MENU_GAP,
      left: Math.min(Math.max(desiredLeft, VIEWPORT_MARGIN), maxLeft),
      width,
      maxHeight: Math.max(48, Math.min(MENU_HEIGHT, availableHeight)),
      direction,
    })
  }, [isIconVariant])

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (ref.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open) {
      setMenuPosition(null)
      return
    }

    updateMenuPosition()
    return subscribeToViewportChanges(updateMenuPosition)
  }, [open, updateMenuPosition])

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={isIconVariant ? permissionSettingsLabel : MODE_LABELS[currentMode]}
        title={isIconVariant ? permissionSettingsLabel : undefined}
        className={isIconVariant
          ? `group relative flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border transition-colors duration-100 ${
              open
                ? 'border-[var(--color-border-separator)] bg-[var(--color-surface-hover)] text-[var(--color-text-primary)]'
                : 'border-transparent text-[var(--color-text-tertiary)] hover:border-[var(--color-border-separator)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
            }`
          : 'flex h-[36px] items-center gap-[6px] rounded-full border border-[var(--color-border)] bg-[var(--color-surface-container)] px-[14px] text-[13px] font-bold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'}
      >
        <CurrentModeIcon size={isIconVariant ? 18 : 16} strokeWidth={2.15} />
        {isIconVariant ? (
          !open && (
            <span className="pointer-events-none absolute bottom-full left-0 z-50 mb-1.5 whitespace-nowrap rounded-md bg-[var(--color-inverse-surface)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-inverse-on-surface)] opacity-0 shadow-[0_8px_20px_rgba(0,0,0,0.12)] transition-opacity duration-100 group-hover:opacity-100">
              {permissionSettingsLabel}
            </span>
          )
        ) : (
          <>
            <span>{MODE_LABELS[currentMode]}</span>
            <ChevronUp size={14} strokeWidth={2.2} />
          </>
        )}
      </button>

      {open && menuPosition && createPortal(
        <div
          ref={menuRef}
          className="settings-ui native-ui-text fixed z-[9999] overflow-y-auto overscroll-contain rounded-[24px] border-2 border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-[8px] shadow-[var(--shadow-dropdown)]"
          style={{
            left: menuPosition.left,
            width: menuPosition.width,
            maxHeight: menuPosition.maxHeight,
            ...(menuPosition.direction === 'down'
              ? { top: menuPosition.top }
              : { bottom: window.innerHeight - menuPosition.top }),
          }}
        >
          <div data-testid="permission-mode-options" className="space-y-[4px]">
            {PERMISSION_ITEMS.map((item) => {
              const ItemIcon = item.icon
              const isSelected = item.value === currentMode
              return (
                <button
                  key={item.value}
                  onClick={() => {
                    if (item.value === 'bypassPermissions') {
                      setOpen(false)
                      setConfirmDialog(true)
                      return
                    }
                    if (isControlled) {
                      onChange?.(item.value)
                    } else {
                      void setPermissionMode(item.value)
                      if (activeTabId) setSessionPermissionMode(activeTabId, item.value)
                    }
                    setOpen(false)
                  }}
                  className={`
                    group flex min-h-[64px] w-full items-center gap-[10px] rounded-[16px] px-[10px] py-[9px] text-left transition-colors
                    ${isSelected ? 'bg-[var(--color-surface-selected)]' : 'hover:bg-[var(--color-surface-hover)]'}
                  `}
                >
                  <div className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border border-[var(--color-border-separator)] bg-[var(--color-surface-container)] ${item.color || 'text-[var(--color-text-secondary)]'}`}>
                    <ItemIcon size={17} strokeWidth={2.05} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-[13px] ${isSelected ? 'font-semibold text-[var(--color-text-primary)]' : 'font-medium text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]'}`}>
                      {item.label}
                    </div>
                    <div className="mt-[2px] line-clamp-2 text-[11px] font-medium leading-[1.35] text-[var(--color-text-tertiary)]">
                      {item.description}
                    </div>
                  </div>
                  {isSelected && (
                    <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[var(--color-text-primary)] text-[var(--color-background)]">
                      <Check size={13} strokeWidth={2.4} />
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>,
        document.body,
      )}

      {/* Bypass confirmation dialog */}
      {confirmDialog && createPortal(
        <div
          className="viewport-overlay settings-ui native-ui-text z-[10000] bg-[var(--color-overlay-scrim)]"
          onClick={() => setConfirmDialog(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('permMode.enableBypassTitle')}
            className="viewport-overlay-surface flex max-h-[calc(100dvh-24px)] w-full max-w-[420px] flex-col overflow-hidden rounded-[12px] border border-[var(--color-border-separator)] bg-[var(--color-background)] shadow-[var(--shadow-window)] min-[721px]:rounded-[14px]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex shrink-0 items-center gap-3 border-b border-[var(--color-error)]/15 bg-[var(--color-error)]/8 px-4 py-3 min-[721px]:px-5 min-[721px]:py-4">
              <div className="flex items-center justify-center w-10 h-10 rounded-[10px] bg-[var(--color-error)]/12">
                <Icon name="warning" size={22} className="text-[var(--color-error)]" />
              </div>
              <div className="min-w-0">
                <div className="text-[14px] font-bold text-[var(--color-text-primary)]">{t('permMode.enableBypassTitle')}</div>
                <div className="text-[12px] text-[var(--color-text-tertiary)] mt-0.5">{t('permMode.enableBypassSubtitle')}</div>
              </div>
            </div>

            {/* Body */}
            <div className="min-h-0 overflow-y-auto overscroll-contain px-4 py-3 min-[721px]:px-5 min-[721px]:py-4">
              <p className="text-[12px] text-[var(--color-text-secondary)] leading-relaxed mb-3" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(t('permMode.enableBypassBody')) }} />
              <div className="flex items-center gap-2 px-3 py-2 rounded-[10px] bg-[var(--color-surface-container-low)] border border-[var(--color-border-separator)]" title={workDir}>
                <Icon name="folder" size={16} className="text-[var(--color-text-tertiary)] shrink-0" />
                <code className="text-[12px] font-mono text-[var(--color-text-secondary)] truncate">{workDir}</code>
              </div>
              <ul className="mt-3 space-y-1.5 text-[12px] text-[var(--color-text-secondary)]">
                <li className="flex items-start gap-2">
                  <Icon name="check" size={14} className="text-[var(--color-error)] mt-0.5" />
                  {t('permMode.permReadWrite')}
                </li>
                <li className="flex items-start gap-2">
                  <Icon name="check" size={14} className="text-[var(--color-error)] mt-0.5" />
                  {t('permMode.permShell')}
                </li>
                <li className="flex items-start gap-2">
                  <Icon name="check" size={14} className="text-[var(--color-error)] mt-0.5" />
                  {t('permMode.permPackages')}
                </li>
              </ul>
            </div>

            {/* Actions */}
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] px-4 py-3 min-[721px]:px-5">
              <button
                onClick={() => setConfirmDialog(false)}
                className="px-4 py-2 text-[12px] font-bold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] rounded-full transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => {
                  if (isControlled) {
                    onChange?.('bypassPermissions')
                  } else {
                    void setPermissionMode('bypassPermissions')
                    if (activeTabId) setSessionPermissionMode(activeTabId, 'bypassPermissions')
                  }
                  setConfirmDialog(false)
                }}
                className="px-4 py-2 text-[12px] font-bold text-[var(--color-btn-danger-fg)] bg-[var(--color-error)] hover:opacity-90 rounded-full transition-colors"
              >
                {t('permMode.enableBypassBtn')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
