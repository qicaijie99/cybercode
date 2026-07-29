import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { subscribeToViewportChanges } from '../../lib/viewportEvents'
import { Icon } from './Icon'

type DropdownItem<T extends string> = {
  value: T
  label: string
  description?: string
  icon?: ReactNode
}

type DropdownProps<T extends string> = {
  items: DropdownItem<T>[]
  value: T
  onChange: (value: T) => void
  trigger: ReactNode
  width?: CSSProperties['width']
  align?: 'left' | 'right'
  className?: string
}

type DropdownPosition = {
  top: number
  left: number
  width: number
  maxHeight: number
  direction: 'up' | 'down'
}

const VIEWPORT_MARGIN = 12
const MENU_GAP = 6
const MENU_MAX_HEIGHT = 360

function resolveMenuWidth(width: CSSProperties['width'], triggerWidth: number): number {
  if (typeof width === 'number') return width
  if (typeof width === 'string' && width.trim().endsWith('px')) {
    const parsed = Number.parseFloat(width)
    if (Number.isFinite(parsed)) return parsed
  }
  return triggerWidth
}

export function Dropdown<T extends string>({
  items,
  value,
  onChange,
  trigger,
  width = 320,
  align = 'left',
  className = '',
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<DropdownPosition | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const updatePosition = useCallback(() => {
    const trigger = ref.current
    if (!trigger) return

    const rect = trigger.getBoundingClientRect()
    const availableWidth = Math.max(1, window.innerWidth - VIEWPORT_MARGIN * 2)
    const menuWidth = Math.min(
      Math.max(1, resolveMenuWidth(width, rect.width)),
      availableWidth,
    )
    const maxLeft = Math.max(
      VIEWPORT_MARGIN,
      window.innerWidth - menuWidth - VIEWPORT_MARGIN,
    )
    const desiredLeft = align === 'right' ? rect.right - menuWidth : rect.left
    const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP - VIEWPORT_MARGIN
    const spaceAbove = rect.top - MENU_GAP - VIEWPORT_MARGIN
    const estimatedHeight = Math.min(MENU_MAX_HEIGHT, Math.max(96, items.length * 58))
    const direction = (
      spaceBelow >= estimatedHeight ||
      spaceBelow >= spaceAbove
    ) ? 'down' : 'up'
    const availableHeight = direction === 'down' ? spaceBelow : spaceAbove

    setPosition({
      top: direction === 'down' ? rect.bottom + MENU_GAP : rect.top - MENU_GAP,
      left: Math.min(Math.max(desiredLeft, VIEWPORT_MARGIN), maxLeft),
      width: menuWidth,
      maxHeight: Math.max(48, Math.min(MENU_MAX_HEIGHT, availableHeight)),
      direction,
    })
  }, [align, items.length, width])

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
      setPosition(null)
      return
    }

    updatePosition()
    return subscribeToViewportChanges(updatePosition)
  }, [open, updatePosition])

  return (
    <div ref={ref} className={`relative ${className || 'inline-block'}`}>
      <div onClick={() => setOpen((value) => !value)} className="cursor-pointer">
        {trigger}
      </div>

      {open && position && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          className={`
            settings-ui native-ui-text fixed z-[9999] overflow-y-auto overscroll-contain rounded-xl
            bg-[var(--color-background)] border border-[var(--color-border-separator)]
            shadow-[var(--shadow-dropdown)] animate-slide-down
          `}
          style={{
            left: position.left,
            width: position.width,
            maxHeight: position.maxHeight,
            ...(position.direction === 'down'
              ? { top: position.top }
              : { bottom: window.innerHeight - position.top }),
          }}
        >
          {items.map((item, i) => (
            <button
              key={item.value}
              type="button"
              role="option"
              aria-selected={item.value === value}
              onClick={() => { onChange(item.value); setOpen(false) }}
              className={`
                w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors
                hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:bg-[var(--color-surface-hover)]
                ${item.value === value ? 'bg-[var(--color-surface-selected)]' : ''}
                ${i > 0 ? 'border-t border-[var(--color-border-separator)]' : ''}
              `}
            >
              {item.icon && <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-[var(--color-text-tertiary)]">{item.icon}</span>}
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold tracking-[-0.01em] text-[var(--color-text-primary)]">{item.label}</div>
                {item.description && (
                  <div className="text-[11px] text-[var(--color-text-tertiary)] mt-0.5">{item.description}</div>
                )}
              </div>
              {item.value === value && (
                <Icon name="check" size={14} className="shrink-0 text-[var(--color-text-tertiary)]" />
              )}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
