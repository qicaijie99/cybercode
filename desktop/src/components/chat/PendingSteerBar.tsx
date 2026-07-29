import {
  AlertCircle,
  Clock3,
  CornerDownRight,
  GripVertical,
  Loader2,
  PencilLine,
  X,
} from 'lucide-react'
import { useState, type DragEvent, type KeyboardEvent } from 'react'

import { useTranslation } from '../../i18n'
import { useChatStore } from '../../stores/chatStore'
import type { PendingSteer } from '../../stores/chatStore'

type PendingSteerBarProps = {
  sessionId: string
}

const EMPTY_PENDING_STEERS: PendingSteer[] = []

function isReorderableSteer(steer: PendingSteer): boolean {
  return steer.status === 'draft' || steer.status === 'failed'
}

function previewSteer(steer: PendingSteer): string {
  const text = steer.content.trim()
  if (text) return text
  const firstAttachment = steer.attachments?.[0]
  return firstAttachment?.name ?? firstAttachment?.path ?? ''
}

export function PendingSteerBar({ sessionId }: PendingSteerBarProps) {
  const t = useTranslation()
  const pendingSteers = useChatStore((s) => s.sessions[sessionId]?.pendingSteers ?? EMPTY_PENDING_STEERS)
  const sendPendingSteers = useChatStore((s) => s.sendPendingSteers)
  const reorderPendingSteer = useChatStore((s) => s.reorderPendingSteer)
  const editPendingSteer = useChatStore((s) => s.editPendingSteer)
  const cancelPendingSteer = useChatStore((s) => s.cancelPendingSteer)
  const [draggedSteerId, setDraggedSteerId] = useState<string | null>(null)
  const [dropTargetSteerId, setDropTargetSteerId] = useState<string | null>(null)

  const visibleSteers = pendingSteers.filter((steer) => steer.status !== 'cancelled' && steer.status !== 'processed')
  const reorderableSteers = visibleSteers.filter(isReorderableSteer)
  const draggedSteerIndex = visibleSteers.findIndex((steer) => steer.id === draggedSteerId)
  const showReorderHandles = reorderableSteers.length > 1

  const clearDragState = () => {
    setDraggedSteerId(null)
    setDropTargetSteerId(null)
  }

  const handleDragStart = (event: DragEvent<HTMLButtonElement>, steerId: string) => {
    setDraggedSteerId(steerId)
    setDropTargetSteerId(null)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', steerId)
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>, targetSteerId: string) => {
    event.preventDefault()
    const sourceSteerId = event.dataTransfer.getData('text/plain') || draggedSteerId
    if (sourceSteerId && sourceSteerId !== targetSteerId) {
      reorderPendingSteer(sessionId, sourceSteerId, targetSteerId)
    }
    clearDragState()
  }

  const handleReorderKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    steerId: string,
  ) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    event.stopPropagation()

    const currentIndex = reorderableSteers.findIndex((steer) => steer.id === steerId)
    const targetIndex = currentIndex + (event.key === 'ArrowUp' ? -1 : 1)
    const target = reorderableSteers[targetIndex]
    if (target) reorderPendingSteer(sessionId, steerId, target.id)
  }

  if (visibleSteers.length === 0) return null

  return (
    <div className="mb-[-8px] w-full px-[24px]">
      <div data-chat-content-column className="mx-auto flex w-full max-w-[878px] min-w-0 flex-col gap-[6px] rounded-[14px] border border-[var(--color-border-separator)] bg-[var(--color-surface-container-lowest)] p-[6px] shadow-[0_10px_32px_rgba(15,23,42,0.10)]">
        {visibleSteers.map((steer, index) => {
          const canAct = steer.status === 'draft' || steer.status === 'failed'
          const isRunning = steer.status === 'queued' || steer.status === 'processing'
          const canReorder = showReorderHandles && canAct
          const isDropTarget = dropTargetSteerId === steer.id && draggedSteerId !== steer.id
          const dropAfter = draggedSteerIndex >= 0 && draggedSteerIndex < index
          const preview = previewSteer(steer)

          return (
            <div
              key={steer.id}
              data-testid={`pending-steer-row-${steer.id}`}
              onDragOver={(event) => {
                if (!draggedSteerId || !canReorder || draggedSteerId === steer.id) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                setDropTargetSteerId(steer.id)
              }}
              onDrop={(event) => {
                if (!canReorder) return
                handleDrop(event, steer.id)
              }}
              className={`relative flex h-[36px] min-w-0 items-center gap-[8px] rounded-[10px] bg-[var(--color-surface-container-low)] px-[8px] text-[var(--color-text-secondary)] transition-opacity ${
                draggedSteerId === steer.id ? 'opacity-55' : ''
              }`}
            >
              {isDropTarget && (
                <span
                  data-testid="pending-steer-drop-indicator"
                  aria-hidden="true"
                  className={`pointer-events-none absolute left-[8px] right-[8px] z-10 h-[2px] rounded-full bg-[var(--color-brand)] ${
                    dropAfter ? 'bottom-[-4px]' : 'top-[-4px]'
                  }`}
                />
              )}
              {showReorderHandles && (
                <button
                  type="button"
                  draggable={canReorder}
                  disabled={!canReorder}
                  onDragStart={(event) => handleDragStart(event, steer.id)}
                  onDragEnd={clearDragState}
                  onKeyDown={(event) => handleReorderKeyDown(event, steer.id)}
                  aria-label={`${t('chat.pendingSteerReorder')}: ${preview}`}
                  title={t('chat.pendingSteerReorder')}
                  className="inline-flex h-[24px] w-[20px] shrink-0 cursor-grab items-center justify-center rounded-[6px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] active:cursor-grabbing disabled:cursor-default disabled:opacity-30"
                >
                  <GripVertical size={14} strokeWidth={2.2} />
                </button>
              )}
              <span className="flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-[8px] text-[var(--color-text-tertiary)]">
                {steer.status === 'failed' ? (
                  <AlertCircle size={14} strokeWidth={2.35} className="text-[var(--color-error)]" />
                ) : isRunning ? (
                  <Loader2 size={14} strokeWidth={2.35} className="animate-spin" />
                ) : (
                  <Clock3 size={14} strokeWidth={2.35} />
                )}
              </span>
              <div
                className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--color-text-primary)]"
                title={preview}
              >
                {preview}
              </div>
              <div className="flex shrink-0 items-center gap-[4px]">
                {canAct && (
                  <>
                    <button
                      type="button"
                      onClick={() => sendPendingSteers(sessionId, 'next', [steer.id])}
                      aria-label={t('chat.pendingSteerJoin')}
                      title={t('chat.pendingSteerJoin')}
                      className="inline-flex h-[28px] w-[28px] items-center justify-center rounded-[8px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                    >
                      <CornerDownRight size={14} strokeWidth={2.4} />
                    </button>
                    <button
                      type="button"
                      onClick={() => editPendingSteer(sessionId, steer.id)}
                      aria-label={t('chat.pendingSteerEdit')}
                      title={t('chat.pendingSteerEdit')}
                      className="inline-flex h-[28px] w-[28px] items-center justify-center rounded-[8px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                    >
                      <PencilLine size={14} strokeWidth={2.35} />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => cancelPendingSteer(sessionId, steer.id)}
                  aria-label={t('chat.pendingSteerCancel')}
                  title={t('chat.pendingSteerCancel')}
                  className="inline-flex h-[28px] w-[28px] items-center justify-center rounded-[8px] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                >
                  <X size={14} strokeWidth={2.4} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
