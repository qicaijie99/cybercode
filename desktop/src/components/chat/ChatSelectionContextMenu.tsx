import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from '../../i18n'
import { useUIStore } from '../../stores/uiStore'
import { Icon } from '../shared/Icon'
import { copyTextToClipboard } from './clipboard'

const MENU_WIDTH = 216
const MENU_HEIGHT = 132
const VIEWPORT_MARGIN = 8

type MenuState = {
  left: number
  top: number
  text: string
  bubble: HTMLElement
}

export function ChatSelectionContextMenu() {
  const t = useTranslation()
  const addToast = useUIStore((state) => state.addToast)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return

      const bubble = target.closest<HTMLElement>('[data-message-bubble]')
      const selection = window.getSelection()
      if (
        !bubble
        || !selection
        || selection.isCollapsed
        || !selection.anchorNode
        || !selection.focusNode
        || !bubble.contains(selection.anchorNode)
        || !bubble.contains(selection.focusNode)
      ) {
        setMenu(null)
        return
      }

      const text = selection.toString()
      if (!text.trim()) {
        setMenu(null)
        return
      }

      event.preventDefault()
      setMenu({
        left: Math.max(
          VIEWPORT_MARGIN,
          Math.min(event.clientX, window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN),
        ),
        top: Math.max(
          VIEWPORT_MARGIN,
          Math.min(event.clientY, window.innerHeight - MENU_HEIGHT - VIEWPORT_MARGIN),
        ),
        text,
        bubble,
      })
    }

    document.addEventListener('contextmenu', handleContextMenu, true)
    return () => document.removeEventListener('contextmenu', handleContextMenu, true)
  }, [])

  useEffect(() => {
    if (!menu) return

    const closeOnPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null)
    }
    const closeOnKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null)
    }
    const closeMenu = () => setMenu(null)

    document.addEventListener('pointerdown', closeOnPointerDown)
    document.addEventListener('keydown', closeOnKeyDown)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('scroll', closeMenu, true)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown)
      document.removeEventListener('keydown', closeOnKeyDown)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
    }
  }, [menu])

  if (!menu) return null

  const copySelection = async (text: string) => {
    setMenu(null)
    const copied = await copyTextToClipboard(text)
    addToast({
      type: copied ? 'success' : 'error',
      message: copied
        ? t('chat.selectionMenu.copied')
        : t('chat.selectionMenu.copyFailed'),
      duration: 1600,
    })
  }

  const selectMessage = () => {
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(menu.bubble)
    selection?.removeAllRanges()
    selection?.addRange(range)
    setMenu(null)
  }

  const items = [
    {
      label: t('chat.selectionMenu.copy'),
      icon: 'content_copy',
      action: () => void copySelection(menu.text),
    },
    {
      label: t('chat.selectionMenu.copyQuote'),
      icon: 'format_quote',
      action: () => void copySelection(
        menu.text
          .split(/\r?\n/)
          .map((line) => `> ${line}`)
          .join('\n'),
      ),
    },
    {
      label: t('chat.selectionMenu.selectMessage'),
      icon: 'select_all',
      action: selectMessage,
    },
  ]

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={t('chat.selectionMenu.label')}
      data-testid="chat-selection-context-menu"
      onMouseDown={(event) => event.preventDefault()}
      className="native-ui-text fixed z-[10000] w-[216px] overflow-hidden rounded-[10px] border border-[var(--color-border-separator)] bg-[var(--color-surface-container-lowest)] p-[5px] shadow-[var(--shadow-dropdown)]"
      style={{ left: menu.left, top: menu.top }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          onClick={item.action}
          className="flex h-[40px] w-full items-center gap-[10px] rounded-[7px] px-[10px] text-left text-[13px] font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
        >
          <Icon name={item.icon} size={16} className="shrink-0 text-[var(--color-text-tertiary)]" />
          <span>{item.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  )
}
