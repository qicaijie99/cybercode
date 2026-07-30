import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from '../../i18n'
import { Icon } from './Icon'

type ModalProps = {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  width?: number
  footer?: ReactNode
}

export function Modal({ open, onClose, title, children, width = 560, footer }: ModalProps) {
  const t = useTranslation()

  useEffect(() => {
    if (!open) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      data-testid="modal-overlay"
      className="viewport-overlay settings-ui native-ui-text z-[10000] animate-fade-in"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-[var(--color-overlay-scrim)]"
        onClick={onClose}
      />

      {/* Modal content */}
      <div
        className="viewport-overlay-surface modal-dialog-surface relative flex max-h-[calc(100dvh-24px)] min-h-0 max-w-full flex-col overflow-hidden rounded-[12px] border border-[var(--color-border-separator)] bg-[var(--color-background)] shadow-[var(--shadow-window)] animate-modal-in min-[721px]:max-h-[85dvh] min-[721px]:rounded-[14px]"
        style={{
          width,
          maxWidth: '100%',
        }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {title && (
          <div className="flex min-h-[56px] shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border-separator)] px-4 py-3 min-[721px]:min-h-[64px] min-[721px]:gap-4 min-[721px]:px-6 min-[721px]:py-4">
            <h2 className="text-[15px] font-bold tracking-[-0.01em] text-[var(--color-text-primary)]">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('common.close')}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--color-text-tertiary)] transition-colors duration-200 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1 overscroll-contain overflow-y-auto px-4 py-4 min-[721px]:px-6 min-[721px]:py-5">
          {children}
        </div>

        {footer && (
          <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-[var(--color-border-separator)] px-4 py-3 min-[721px]:px-6 min-[721px]:py-4">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
