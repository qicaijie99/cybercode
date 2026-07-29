import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  FileText,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  LoaderCircle,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  X,
} from 'lucide-react'
import {
  sessionsApi,
  type GitBranchInfo,
  type GitCommitInfo,
  type GitDiffScope,
  type GitFileChange,
  type GitFileDiff,
  type GitWorkspaceStatus,
} from '../api/sessions'
import { DiffViewer } from '../components/chat/DiffViewer'
import { Button } from '../components/shared/Button'
import { ConfirmDialog } from '../components/shared/ConfirmDialog'
import { useTranslation } from '../i18n'
import { useChatStore } from '../stores/chatStore'
import { useTabStore } from '../stores/tabStore'
import { useUIStore } from '../stores/uiStore'

type Selection = {
  path: string
  scope: GitDiffScope
}

type RefreshOptions = {
  silent?: boolean
  refreshDiff?: boolean
}

type WorkspaceView = 'changes' | 'history'

function firstSelection(status: GitWorkspaceStatus): Selection | null {
  const unstaged = status.changes.find((change) => change.unstaged)
  if (unstaged) return { path: unstaged.path, scope: 'unstaged' }
  const staged = status.changes.find((change) => change.staged)
  return staged ? { path: staged.path, scope: 'staged' } : null
}

function validSelection(
  status: GitWorkspaceStatus,
  selection: Selection | null,
): selection is Selection {
  if (!selection) return false
  const change = status.changes.find((candidate) => candidate.path === selection.path)
  return Boolean(change && (selection.scope === 'staged' ? change.staged : change.unstaged))
}

function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath
}

function parentPath(filePath: string): string {
  const parts = filePath.split(/[\\/]/)
  return parts.length > 1 ? parts.slice(0, -1).join('/') : ''
}

function statusCode(change: GitFileChange, scope: GitDiffScope): string {
  if (change.kind === 'untracked') return 'U'
  const code = scope === 'staged' ? change.indexStatus : change.worktreeStatus
  return code.trim() || 'M'
}

function statusColor(change: GitFileChange): string {
  if (change.conflicted) return 'text-[var(--color-error)]'
  if (change.kind === 'added' || change.kind === 'untracked') {
    return 'text-[var(--color-success)]'
  }
  if (change.kind === 'deleted') return 'text-[var(--color-error)]'
  if (change.kind === 'renamed' || change.kind === 'copied') {
    return 'text-[var(--color-brand)]'
  }
  return 'text-[var(--color-warning)]'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatCommitDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function isGitWorkspaceStatus(value: unknown): value is GitWorkspaceStatus {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<GitWorkspaceStatus>
  return (
    typeof candidate.gitAvailable === 'boolean'
    && typeof candidate.isRepository === 'boolean'
    && typeof candidate.workDir === 'string'
    && Array.isArray(candidate.changes)
  )
}

export function GitWorkspace() {
  const t = useTranslation()
  const activeTabId = useTabStore((state) => state.activeTabId)
  const activeTab = useTabStore((state) =>
    state.tabs.find((tab) => tab.sessionId === state.activeTabId),
  )
  const closeSettings = useUIStore((state) => state.closeSettings)
  const addToast = useUIStore((state) => state.addToast)
  const chatState = useChatStore((state) =>
    activeTabId ? state.sessions[activeTabId]?.chatState ?? 'idle' : 'idle',
  )
  const sessionId = activeTab?.type === 'session' ? activeTab.sessionId : null
  const projectPath = activeTab?.type === 'session' ? activeTab.projectPath : undefined
  const [status, setStatus] = useState<GitWorkspaceStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [diff, setDiff] = useState<GitFileDiff | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState<string | null>(null)
  const [diffRevision, setDiffRevision] = useState(0)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [discardPaths, setDiscardPaths] = useState<string[]>([])
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('changes')
  const [branches, setBranches] = useState<GitBranchInfo[]>([])
  const [branchesLoading, setBranchesLoading] = useState(false)
  const [branchesError, setBranchesError] = useState<string | null>(null)
  const [history, setHistory] = useState<GitCommitInfo[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [branchMenuOpen, setBranchMenuOpen] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [pendingBranchName, setPendingBranchName] = useState<string | null>(null)
  const statusRequestRef = useRef(0)
  const statusInFlightRef = useRef(false)
  const diffRequestRef = useRef(0)
  const branchRequestRef = useRef(0)
  const historyRequestRef = useRef(0)
  const branchMenuRef = useRef<HTMLDivElement>(null)
  const previousChatStateRef = useRef(chatState)

  const acceptStatus = useCallback((
    nextStatus: GitWorkspaceStatus,
    preferred?: Selection | null,
    refreshDiff = true,
  ) => {
    if (!isGitWorkspaceStatus(nextStatus)) {
      setStatus(null)
      setSelection(null)
      setDiff(null)
      setStatusError(t('git.serviceMismatch'))
      return
    }
    setStatus(nextStatus)
    setStatusError(null)
    setSelection((current) => {
      if (preferred && validSelection(nextStatus, preferred)) return preferred
      if (validSelection(nextStatus, current)) return current
      return firstSelection(nextStatus)
    })
    if (refreshDiff) setDiffRevision((revision) => revision + 1)
  }, [t])

  const refreshStatus = useCallback(async (options: RefreshOptions = {}) => {
    if (!sessionId) {
      setStatus(null)
      setStatusLoading(false)
      return
    }
    if (statusInFlightRef.current) return

    statusInFlightRef.current = true
    const requestId = ++statusRequestRef.current
    if (!options.silent) setStatusLoading(true)
    try {
      const nextStatus = await sessionsApi.getGitStatus(sessionId, { projectPath })
      if (requestId !== statusRequestRef.current) return
      acceptStatus(nextStatus, undefined, options.refreshDiff === true)
    } catch (error) {
      if (requestId !== statusRequestRef.current) return
      setStatusError(errorMessage(error))
    } finally {
      statusInFlightRef.current = false
      if (requestId === statusRequestRef.current) setStatusLoading(false)
    }
  }, [acceptStatus, projectPath, sessionId])

  const loadBranches = useCallback(async () => {
    if (!sessionId) {
      setBranches([])
      setBranchesError(null)
      return
    }
    const requestId = ++branchRequestRef.current
    setBranchesLoading(true)
    setBranchesError(null)
    try {
      const response = await sessionsApi.getGitBranches(sessionId, { projectPath })
      if (requestId !== branchRequestRef.current) return
      if (!Array.isArray(response.branches)) {
        throw new Error(t('git.serviceMismatch'))
      }
      setBranches(response.branches)
    } catch (error) {
      if (requestId !== branchRequestRef.current) return
      setBranchesError(errorMessage(error))
    } finally {
      if (requestId === branchRequestRef.current) setBranchesLoading(false)
    }
  }, [projectPath, sessionId, t])

  const loadHistory = useCallback(async () => {
    if (!sessionId) {
      setHistory([])
      setHistoryError(null)
      return
    }
    const requestId = ++historyRequestRef.current
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const response = await sessionsApi.getGitHistory(sessionId, 40, { projectPath })
      if (requestId !== historyRequestRef.current) return
      if (!Array.isArray(response.commits)) {
        throw new Error(t('git.serviceMismatch'))
      }
      setHistory(response.commits)
    } catch (error) {
      if (requestId !== historyRequestRef.current) return
      setHistoryError(errorMessage(error))
    } finally {
      if (requestId === historyRequestRef.current) setHistoryLoading(false)
    }
  }, [projectPath, sessionId, t])

  useEffect(() => {
    setStatus(null)
    setSelection(null)
    setDiff(null)
    setStatusError(null)
    setStatusLoading(true)
    setWorkspaceView('changes')
    setBranches([])
    setBranchesError(null)
    setHistory([])
    setHistoryError(null)
    setBranchMenuOpen(false)
    setPendingBranchName(null)
    void refreshStatus({ refreshDiff: true })

    const interval = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') {
        void refreshStatus({ silent: true })
      }
    }, 2_500)
    const onFocus = () => void refreshStatus({ silent: true, refreshDiff: true })
    window.addEventListener('focus', onFocus)
    return () => {
      statusRequestRef.current += 1
      branchRequestRef.current += 1
      historyRequestRef.current += 1
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [refreshStatus])

  useEffect(() => {
    if (!status?.isRepository) return
    void loadBranches()
  }, [loadBranches, status?.repoRoot])

  useEffect(() => {
    if (workspaceView !== 'history' || !status?.isRepository) return
    void loadHistory()
  }, [loadHistory, status?.repoRoot, workspaceView])

  useEffect(() => {
    if (!branchMenuOpen) return
    const closeMenu = (event: MouseEvent) => {
      if (branchMenuRef.current?.contains(event.target as Node)) return
      setBranchMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setBranchMenuOpen(false)
    }
    document.addEventListener('mousedown', closeMenu)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeMenu)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [branchMenuOpen])

  useEffect(() => {
    const previous = previousChatStateRef.current
    previousChatStateRef.current = chatState
    if (previous !== 'idle' && chatState === 'idle') {
      void refreshStatus({ silent: true, refreshDiff: true })
    }
  }, [chatState, refreshStatus])

  const selectedPath = selection?.path
  const selectedScope = selection?.scope

  useEffect(() => {
    if (!sessionId || !selectedPath || !selectedScope) {
      setDiff(null)
      setDiffError(null)
      setDiffLoading(false)
      return
    }

    const requestId = ++diffRequestRef.current
    setDiffLoading(true)
    setDiffError(null)
    sessionsApi.getGitDiff(sessionId, selectedScope, selectedPath, { projectPath })
      .then((nextDiff) => {
        if (requestId === diffRequestRef.current) setDiff(nextDiff)
      })
      .catch((error) => {
        if (requestId !== diffRequestRef.current) return
        setDiff(null)
        setDiffError(errorMessage(error))
      })
      .finally(() => {
        if (requestId === diffRequestRef.current) setDiffLoading(false)
      })

    return () => {
      diffRequestRef.current += 1
    }
  }, [diffRevision, projectPath, selectedPath, selectedScope, sessionId])

  const runStatusAction = useCallback(async (
    actionKey: string,
    action: () => Promise<GitWorkspaceStatus>,
    preferred?: Selection | null,
  ) => {
    statusRequestRef.current += 1
    setBusyAction(actionKey)
    try {
      const nextStatus = await action()
      acceptStatus(nextStatus, preferred)
      setStatusLoading(false)
    } catch (error) {
      addToast({
        type: 'error',
        message: t('git.actionFailed', { error: errorMessage(error) }),
      })
    } finally {
      setBusyAction(null)
    }
  }, [acceptStatus, addToast, t])

  const stage = (paths: string[]) => {
    if (!sessionId) return
    const preferred = paths.length === 1 ? { path: paths[0]!, scope: 'staged' as const } : undefined
    void runStatusAction(
      'stage',
      () => sessionsApi.stageGitFiles(sessionId, paths, { projectPath }),
      preferred,
    )
  }

  const unstage = (paths: string[]) => {
    if (!sessionId) return
    const preferred = paths.length === 1 ? { path: paths[0]!, scope: 'unstaged' as const } : undefined
    void runStatusAction(
      'unstage',
      () => sessionsApi.unstageGitFiles(sessionId, paths, { projectPath }),
      preferred,
    )
  }

  const confirmDiscard = async () => {
    if (!sessionId || discardPaths.length === 0) return
    const paths = [...discardPaths]
    statusRequestRef.current += 1
    setBusyAction('discard')
    try {
      const nextStatus = await sessionsApi.discardGitFiles(sessionId, paths, { projectPath })
      setDiscardPaths([])
      acceptStatus(nextStatus)
      setStatusLoading(false)
    } catch (error) {
      addToast({
        type: 'error',
        message: t('git.actionFailed', { error: errorMessage(error) }),
      })
    } finally {
      setBusyAction(null)
    }
  }

  const initializeRepository = () => {
    if (!sessionId) return
    void runStatusAction(
      'init',
      () => sessionsApi.initializeGit(sessionId, { projectPath }),
      null,
    )
  }

  const createCommit = async () => {
    if (!sessionId || !commitMessage.trim()) return
    statusRequestRef.current += 1
    setBusyAction('commit')
    try {
      const result = await sessionsApi.commitGit(sessionId, commitMessage, { projectPath })
      setCommitMessage('')
      acceptStatus(result.status)
      setStatusLoading(false)
      addToast({
        type: 'success',
        message: t('git.commitSuccess', { hash: result.commit || 'HEAD' }),
      })
      void Promise.all([loadBranches(), loadHistory()])
    } catch (error) {
      addToast({
        type: 'error',
        message: t('git.actionFailed', { error: errorMessage(error) }),
      })
    } finally {
      setBusyAction(null)
    }
  }

  const switchBranch = async (branchName: string) => {
    if (!sessionId) return
    statusRequestRef.current += 1
    setBusyAction('switch-branch')
    try {
      const nextStatus = await sessionsApi.switchGitBranch(sessionId, branchName, { projectPath })
      acceptStatus(nextStatus)
      setStatusLoading(false)
      setBranchMenuOpen(false)
      setPendingBranchName(null)
      addToast({
        type: 'success',
        message: t('git.branchSwitched', { branch: branchName }),
      })
      await Promise.all([loadBranches(), loadHistory()])
    } catch (error) {
      addToast({
        type: 'error',
        message: t('git.actionFailed', { error: errorMessage(error) }),
      })
    } finally {
      setBusyAction(null)
    }
  }

  const requestBranchSwitch = (branchName: string) => {
    if (status?.branch === branchName && !status.detached) {
      setBranchMenuOpen(false)
      return
    }
    if ((status?.changes.length ?? 0) > 0) {
      setBranchMenuOpen(false)
      setPendingBranchName(branchName)
      return
    }
    void switchBranch(branchName)
  }

  const createBranch = async () => {
    if (!sessionId || !newBranchName.trim()) return
    const branchName = newBranchName.trim()
    statusRequestRef.current += 1
    setBusyAction('create-branch')
    try {
      const nextStatus = await sessionsApi.createGitBranch(sessionId, branchName, { projectPath })
      acceptStatus(nextStatus)
      setStatusLoading(false)
      setNewBranchName('')
      setBranchMenuOpen(false)
      addToast({
        type: 'success',
        message: t('git.branchCreated', { branch: branchName }),
      })
      await Promise.all([loadBranches(), loadHistory()])
    } catch (error) {
      addToast({
        type: 'error',
        message: t('git.actionFailed', { error: errorMessage(error) }),
      })
    } finally {
      setBusyAction(null)
    }
  }

  const askForReview = () => {
    if (!sessionId) return
    const prompt = t('git.reviewPrompt')
    const displayContent = t('git.reviewRequest')
    const chat = useChatStore.getState()
    if (chat.getSession(sessionId).chatState === 'idle') {
      chat.sendMessage(sessionId, prompt, undefined, { displayContent })
      addToast({ type: 'info', message: t('git.reviewStarted') })
    } else {
      const steerId = chat.queuePendingSteer(sessionId, prompt, undefined, { displayContent })
      chat.sendPendingSteers(sessionId, 'later', [steerId])
      addToast({ type: 'info', message: t('git.reviewQueued') })
    }
    closeSettings()
  }

  const statusChanges = Array.isArray(status?.changes) ? status.changes : []
  const stagedChanges = statusChanges.filter((change) => change.staged)
  const unstagedChanges = statusChanges.filter((change) => change.unstaged)

  return (
    <div className="git-workspace native-ui-text flex h-full w-full min-h-0 min-w-0 max-w-full flex-col overflow-hidden bg-[var(--color-background)]">
      <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-[var(--color-border-separator)] px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <GitBranch size={17} strokeWidth={1.7} className="shrink-0 text-[var(--color-text-secondary)]" />
          <div
            role="heading"
            aria-level={1}
            className="truncate text-[14px] font-semibold leading-5 text-[var(--color-text-primary)]"
          >
            {t('git.title')}
          </div>
          {status?.isRepository && (
            <>
              <span className="truncate text-[12px] text-[var(--color-text-secondary)]">
                {status.repoName}
              </span>
              <div ref={branchMenuRef} className="relative min-w-0">
                <button
                  type="button"
                  aria-label={t('git.branchMenu')}
                  aria-haspopup="menu"
                  aria-expanded={branchMenuOpen}
                  disabled={busyAction !== null}
                  onClick={() => setBranchMenuOpen((open) => !open)}
                  className="flex h-7 max-w-[190px] min-w-0 items-center gap-1 rounded-[5px] bg-[var(--color-surface-container)] px-2 font-[var(--font-mono)] text-[11px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-40"
                >
                  <span className="truncate">
                    {status.detached ? t('git.detached') : status.branch || t('git.noBranch')}
                  </span>
                  {status.ahead > 0 && (
                    <span className="flex shrink-0 items-center text-[var(--color-success)]">
                      <ArrowUp size={10} />{status.ahead}
                    </span>
                  )}
                  {status.behind > 0 && (
                    <span className="flex shrink-0 items-center text-[var(--color-warning)]">
                      <ArrowDown size={10} />{status.behind}
                    </span>
                  )}
                  <ChevronDown size={11} className="shrink-0" />
                </button>

                {branchMenuOpen && (
                  <div
                    role="menu"
                    aria-label={t('git.branchMenuTitle')}
                    className="absolute left-0 top-[calc(100%+7px)] z-[120] flex max-h-[min(420px,calc(100vh-80px))] w-[292px] flex-col overflow-hidden rounded-[7px] border border-[var(--color-border-separator)] bg-[var(--color-background)] shadow-[var(--shadow-dropdown)]"
                  >
                    <div className="flex h-9 shrink-0 items-center border-b border-[var(--color-border-separator)] px-3 text-[11px] font-semibold text-[var(--color-text-secondary)]">
                      {t('git.branchMenuTitle')}
                    </div>
                    <div className="min-h-[42px] flex-1 overflow-y-auto py-1">
                      {branchesLoading && branches.length === 0 ? (
                        <div className="flex h-12 items-center justify-center text-[11px] text-[var(--color-text-tertiary)]">
                          <LoaderCircle size={14} className="mr-2 animate-spin" />
                          {t('common.loading')}
                        </div>
                      ) : branchesError && branches.length === 0 ? (
                        <div className="px-3 py-2 text-[11px] leading-4 text-[var(--color-error)]">
                          {t('git.branchesLoadFailed')}
                        </div>
                      ) : (
                        branches.map((branch) => (
                          <button
                            key={branch.name}
                            type="button"
                            role="menuitem"
                            disabled={busyAction !== null}
                            onClick={() => requestBranchSwitch(branch.name)}
                            className="flex min-h-10 w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-[var(--color-surface-hover)] disabled:opacity-40"
                          >
                            <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--color-text-tertiary)]">
                              {branch.current ? <Check size={13} /> : <GitBranch size={12} />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-[var(--font-mono)] text-[11px] text-[var(--color-text-primary)]">
                                {branch.name}
                              </span>
                              <span className="block truncate text-[10px] text-[var(--color-text-tertiary)]">
                                {branch.upstream || t('git.branchNoUpstream')}
                              </span>
                            </span>
                            {(branch.ahead > 0 || branch.behind > 0 || branch.upstreamGone) && (
                              <span className="flex shrink-0 items-center gap-1 font-[var(--font-mono)] text-[9px]">
                                {branch.ahead > 0 && <span className="text-[var(--color-success)]">↑{branch.ahead}</span>}
                                {branch.behind > 0 && <span className="text-[var(--color-warning)]">↓{branch.behind}</span>}
                                {branch.upstreamGone && <span className="text-[var(--color-error)]">{t('git.branchGone')}</span>}
                              </span>
                            )}
                          </button>
                        ))
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2 border-t border-[var(--color-border-separator)] p-2">
                      <input
                        value={newBranchName}
                        onChange={(event) => setNewBranchName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && newBranchName.trim()) {
                            event.preventDefault()
                            void createBranch()
                          }
                        }}
                        placeholder={t('git.branchCreatePlaceholder')}
                        maxLength={255}
                        className="h-8 min-w-0 flex-1 rounded-[5px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-2.5 font-[var(--font-mono)] text-[11px] text-[var(--color-text-primary)] outline-none placeholder:font-[var(--font-sans)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)]"
                      />
                      <button
                        type="button"
                        aria-label={t('git.branchCreate')}
                        title={t('git.branchCreate')}
                        disabled={!newBranchName.trim() || busyAction !== null}
                        onClick={() => void createBranch()}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[5px] bg-[var(--color-text-primary)] text-[var(--color-background)] transition-opacity disabled:opacity-30"
                      >
                        {busyAction === 'create-branch'
                          ? <LoaderCircle size={14} className="animate-spin" />
                          : <Plus size={14} />}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <HeaderAction
          label={t('git.refresh')}
          disabled={statusLoading}
          onClick={() => void refreshStatus({ refreshDiff: true })}
        >
          <RefreshCw size={15} className={statusLoading ? 'animate-spin' : ''} />
        </HeaderAction>
        <HeaderAction label={t('common.close')} onClick={closeSettings}>
          <X size={16} />
        </HeaderAction>
      </header>

      {status?.isRepository && (
        <div
          role="tablist"
          aria-label={t('git.workspaceViews')}
          className="flex h-9 shrink-0 items-end gap-4 border-b border-[var(--color-border-separator)] px-4"
        >
          <WorkspaceTab
            active={workspaceView === 'changes'}
            label={t('git.tabs.changes')}
            count={status.changes.length}
            onClick={() => setWorkspaceView('changes')}
          />
          <WorkspaceTab
            active={workspaceView === 'history'}
            label={t('git.tabs.history')}
            onClick={() => setWorkspaceView('history')}
          />
        </div>
      )}

      {!sessionId ? (
        <WorkspaceMessage
          icon={<FileText size={24} />}
          title={t('git.noSession')}
        />
      ) : statusLoading && !status ? (
        <WorkspaceMessage
          icon={<LoaderCircle size={24} className="animate-spin" />}
          title={t('common.loading')}
        />
      ) : statusError && !status ? (
        <WorkspaceMessage
          icon={<AlertTriangle size={24} />}
          title={t('git.loadFailed')}
          body={statusError}
          action={(
            <Button size="sm" variant="secondary" onClick={() => void refreshStatus()}>
              {t('common.retry')}
            </Button>
          )}
        />
      ) : status && !status.gitAvailable ? (
        <WorkspaceMessage
          icon={<AlertTriangle size={24} />}
          title={t('git.unavailableTitle')}
          body={t('git.unavailableBody')}
        />
      ) : status && !status.isRepository ? (
        <WorkspaceMessage
          icon={<FolderGit2 size={26} />}
          title={t('git.notRepositoryTitle')}
          body={t('git.notRepositoryBody')}
          action={(
            <Button
              size="sm"
              icon={<GitBranch size={15} />}
              loading={busyAction === 'init'}
              onClick={initializeRepository}
            >
              {t('git.initialize')}
            </Button>
          )}
        />
      ) : status && workspaceView === 'history' ? (
        <GitHistoryView
          commits={history}
          loading={historyLoading}
          error={historyError}
          onRetry={() => void loadHistory()}
        />
      ) : status ? (
        <div className="git-workspace-main flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <aside className="git-workspace-files flex w-[290px] shrink-0 flex-col border-r border-[var(--color-border-separator)]">
            <div className="min-h-0 flex-1 overflow-y-auto py-2">
              {status.changes.length === 0 ? (
                <div className="flex h-full min-h-[180px] flex-col items-center justify-center px-6 text-center">
                  <Check size={24} strokeWidth={1.6} className="text-[var(--color-success)]" />
                  <p className="mt-3 text-[13px] font-semibold text-[var(--color-text-primary)]">
                    {t('git.cleanTitle')}
                  </p>
                  <p className="mt-1 text-[12px] leading-5 text-[var(--color-text-secondary)]">
                    {t('git.cleanBody')}
                  </p>
                </div>
              ) : (
                <>
                  <GitFileGroup
                    title={t('git.staged')}
                    changes={stagedChanges}
                    scope="staged"
                    selection={selection}
                    actionLabel={t('git.unstageAll')}
                    actionIcon={<Minus size={14} />}
                    busy={busyAction !== null}
                    onAction={() => unstage(stagedChanges.map((change) => change.path))}
                    onSelect={setSelection}
                    onFileAction={(path) => unstage([path])}
                    fileActionLabel={t('git.unstage')}
                    fileActionIcon={<Minus size={13} />}
                  />
                  <GitFileGroup
                    title={t('git.changes')}
                    changes={unstagedChanges}
                    scope="unstaged"
                    selection={selection}
                    actionLabel={t('git.stageAll')}
                    actionIcon={<Plus size={14} />}
                    busy={busyAction !== null}
                    onAction={() => stage(unstagedChanges.map((change) => change.path))}
                    onSelect={setSelection}
                    onFileAction={(path) => stage([path])}
                    fileActionLabel={t('git.stage')}
                    fileActionIcon={<Plus size={13} />}
                    onDiscard={(path) => setDiscardPaths([path])}
                    discardLabel={t('git.discard')}
                  />
                </>
              )}
            </div>

            <div className="shrink-0 border-t border-[var(--color-border-separator)] p-3">
              {status.conflictedCount > 0 && (
                <div className="mb-2 flex items-center gap-2 text-[11px] text-[var(--color-error)]">
                  <AlertTriangle size={13} />
                  {t('git.conflicts', { count: status.conflictedCount })}
                </div>
              )}
              <textarea
                value={commitMessage}
                onChange={(event) => setCommitMessage(event.target.value)}
                placeholder={t('git.commitPlaceholder')}
                maxLength={5_000}
                rows={2}
                className="w-full resize-none rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-2.5 py-2 text-[12px] leading-4 text-[var(--color-text-primary)] outline-none transition-colors placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)]"
              />
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  className="h-[32px] flex-1 rounded-[6px] px-3"
                  icon={<GitCommitHorizontal size={14} />}
                  loading={busyAction === 'commit'}
                  disabled={
                    status.stagedCount === 0
                    || status.conflictedCount > 0
                    || !commitMessage.trim()
                    || (busyAction !== null && busyAction !== 'commit')
                  }
                  onClick={() => void createCommit()}
                >
                  {t('git.commit')}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-[32px] rounded-[6px] px-2.5"
                  icon={<Bot size={14} />}
                  disabled={status.changes.length === 0 || busyAction !== null}
                  title={t('git.review')}
                  aria-label={t('git.review')}
                  onClick={askForReview}
                >
                  {t('git.review')}
                </Button>
              </div>
            </div>
          </aside>

          <section className="git-workspace-diff flex min-w-0 flex-1 flex-col overflow-hidden">
            {!selection ? (
              <WorkspaceMessage
                icon={<FileText size={24} />}
                title={t('git.selectFile')}
              />
            ) : (
              <>
                <div className="flex min-h-[48px] shrink-0 items-center gap-3 border-b border-[var(--color-border-separator)] px-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-[var(--font-mono)] text-[12px] text-[var(--color-text-primary)]">
                      {selection.path}
                    </p>
                    {diff?.previousPath && diff.previousPath !== diff.path && (
                      <p className="truncate text-[10px] text-[var(--color-text-tertiary)]">
                        {t('git.renamedFrom', { path: diff.previousPath })}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 rounded-[5px] bg-[var(--color-surface-container)] px-2 py-1 text-[10px] font-semibold text-[var(--color-text-secondary)]">
                    {selection.scope === 'staged' ? t('git.scope.staged') : t('git.scope.unstaged')}
                  </span>
                  {diff && !diff.binary && (
                    <span className="flex shrink-0 gap-2 font-[var(--font-mono)] text-[10px]">
                      <span className="text-[var(--color-diff-added-text)]">+{diff.additions}</span>
                      <span className="text-[var(--color-diff-removed-text)]">-{diff.deletions}</span>
                    </span>
                  )}
                </div>
                <div className="min-h-0 flex-1 overflow-auto bg-[var(--color-code-bg)]">
                  {diffLoading ? (
                    <WorkspaceMessage
                      icon={<LoaderCircle size={22} className="animate-spin" />}
                      title={t('git.loadingDiff')}
                    />
                  ) : diffError ? (
                    <WorkspaceMessage
                      icon={<AlertTriangle size={22} />}
                      title={t('git.diffFailed')}
                      body={diffError}
                    />
                  ) : diff?.binary ? (
                    <WorkspaceMessage
                      icon={<FileText size={24} />}
                      title={t('git.binaryFile')}
                    />
                  ) : diff?.truncated ? (
                    <WorkspaceMessage
                      icon={<AlertTriangle size={24} />}
                      title={t('git.previewTooLarge')}
                      body={t('git.previewTooLargeBody')}
                    />
                  ) : diff && diff.oldText === diff.newText ? (
                    <WorkspaceMessage
                      icon={<FileText size={24} />}
                      title={t('git.noTextChanges')}
                    />
                  ) : diff ? (
                    <DiffViewer
                      filePath={diff.path}
                      oldString={diff.oldText}
                      newString={diff.newText}
                      additions={diff.additions}
                      deletions={diff.deletions}
                      showHeader={false}
                      maxHeightClassName="max-h-none"
                    />
                  ) : null}
                </div>
              </>
            )}
          </section>
        </div>
      ) : null}

      <ConfirmDialog
        open={discardPaths.length > 0}
        onClose={() => {
          if (busyAction !== 'discard') setDiscardPaths([])
        }}
        onConfirm={confirmDiscard}
        title={t('git.discardTitle')}
        body={discardPaths.length === 1
          ? t('git.discardBody', { path: discardPaths[0]! })
          : t('git.discardManyBody', { count: discardPaths.length })}
        confirmLabel={t('git.discardConfirm')}
        cancelLabel={t('common.cancel')}
        confirmVariant="danger"
        loading={busyAction === 'discard'}
      />
      <ConfirmDialog
        open={pendingBranchName !== null}
        onClose={() => {
          if (busyAction !== 'switch-branch') setPendingBranchName(null)
        }}
        onConfirm={() => {
          if (pendingBranchName) void switchBranch(pendingBranchName)
        }}
        title={t('git.branchSwitchTitle')}
        body={t('git.branchSwitchBody', {
          branch: pendingBranchName || '',
          count: status?.changes.length ?? 0,
        })}
        confirmLabel={t('git.branchSwitchConfirm')}
        cancelLabel={t('common.cancel')}
        loading={busyAction === 'switch-branch'}
      />
    </div>
  )
}

function WorkspaceTab({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean
  label: string
  count?: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex h-9 items-center gap-1.5 border-b-2 px-0.5 text-[11px] font-semibold transition-colors ${
        active
          ? 'border-[var(--color-text-primary)] text-[var(--color-text-primary)]'
          : 'border-transparent text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
      }`}
    >
      {label}
      {typeof count === 'number' && (
        <span className="font-[var(--font-mono)] text-[9px] font-normal text-[var(--color-text-tertiary)]">
          {count}
        </span>
      )}
    </button>
  )
}

function GitHistoryView({
  commits,
  loading,
  error,
  onRetry,
}: {
  commits: GitCommitInfo[]
  loading: boolean
  error: string | null
  onRetry: () => void
}) {
  const t = useTranslation()
  if (loading && commits.length === 0) {
    return (
      <WorkspaceMessage
        icon={<LoaderCircle size={23} className="animate-spin" />}
        title={t('git.historyLoading')}
      />
    )
  }
  if (error && commits.length === 0) {
    return (
      <WorkspaceMessage
        icon={<AlertTriangle size={23} />}
        title={t('git.historyLoadFailed')}
        body={error}
        action={(
          <Button size="sm" variant="secondary" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        )}
      />
    )
  }
  if (commits.length === 0) {
    return (
      <WorkspaceMessage
        icon={<Clock3 size={24} />}
        title={t('git.historyEmpty')}
        body={t('git.historyEmptyBody')}
      />
    )
  }

  return (
    <div role="list" aria-label={t('git.tabs.history')} className="min-h-0 flex-1 overflow-y-auto">
      {commits.map((commit) => (
        <div
          key={commit.hash}
          role="listitem"
          className="flex min-h-[66px] items-start gap-3 border-b border-[var(--color-border-separator)] px-4 py-3"
        >
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-container)] text-[var(--color-text-tertiary)]">
            <GitCommitHorizontal size={14} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[var(--color-text-primary)]">
                {commit.subject || t('git.historyUntitled')}
              </p>
              <code className="shrink-0 font-[var(--font-mono)] text-[10px] text-[var(--color-text-tertiary)]">
                {commit.shortHash}
              </code>
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-[var(--color-text-tertiary)]">
              <span className="truncate">{commit.authorName}</span>
              <span>{formatCommitDate(commit.authoredAt)}</span>
              {commit.refs.map((ref) => (
                <span
                  key={ref}
                  className="max-w-[220px] truncate rounded-[4px] bg-[var(--color-surface-container)] px-1.5 py-0.5 font-[var(--font-mono)] text-[9px] text-[var(--color-text-secondary)]"
                >
                  {ref}
                </span>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function WorkspaceMessage({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode
  title: string
  body?: string
  action?: ReactNode
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 py-10 text-center text-[var(--color-text-tertiary)]">
      {icon}
      <p className="mt-3 text-[13px] font-semibold text-[var(--color-text-primary)]">{title}</p>
      {body && (
        <p className="mt-1.5 max-w-[360px] text-[12px] leading-5 text-[var(--color-text-secondary)]">
          {body}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

function HeaderAction({
  children,
  disabled = false,
  label,
  onClick,
}: {
  children: ReactNode
  disabled?: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-[var(--color-text-secondary)] transition-colors duration-100 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-40"
    >
      {children}
    </button>
  )
}

function GitFileGroup({
  title,
  changes,
  scope,
  selection,
  actionLabel,
  actionIcon,
  busy,
  onAction,
  onSelect,
  onFileAction,
  fileActionLabel,
  fileActionIcon,
  onDiscard,
  discardLabel,
}: {
  title: string
  changes: GitFileChange[]
  scope: GitDiffScope
  selection: Selection | null
  actionLabel: string
  actionIcon: ReactNode
  busy: boolean
  onAction: () => void
  onSelect: (selection: Selection) => void
  onFileAction: (path: string) => void
  fileActionLabel: string
  fileActionIcon: ReactNode
  onDiscard?: (path: string) => void
  discardLabel?: string
}) {
  return (
    <section className="mb-2">
      <div className="flex h-8 items-center gap-2 px-3">
        <ChevronRight size={12} className="rotate-90 text-[var(--color-text-tertiary)]" />
        <div
          role="heading"
          aria-level={2}
          className="min-w-0 flex-1 truncate text-[11px] font-semibold leading-4 text-[var(--color-text-secondary)]"
        >
          {title}
        </div>
        <span className="text-[10px] tabular-nums text-[var(--color-text-tertiary)]">
          {changes.length}
        </span>
        {changes.length > 0 && (
          <button
            type="button"
            aria-label={actionLabel}
            title={actionLabel}
            disabled={busy}
            onClick={onAction}
            className="flex h-6 w-6 items-center justify-center rounded-[5px] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-40"
          >
            {actionIcon}
          </button>
        )}
      </div>
      {changes.map((change) => {
        const selected = selection?.path === change.path && selection.scope === scope
        const parent = parentPath(change.path)
        return (
          <div
            key={`${scope}:${change.path}`}
            data-selected={selected ? 'true' : 'false'}
            className={`group flex min-h-[38px] items-center px-2 transition-colors ${
              selected
                ? 'bg-[var(--color-surface-selected)]'
                : 'hover:bg-[var(--color-surface-hover)]'
            }`}
          >
            <button
              type="button"
              title={change.path}
              onClick={() => onSelect({ path: change.path, scope })}
              className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
            >
              <span className={`w-4 shrink-0 text-center font-[var(--font-mono)] text-[11px] font-semibold ${statusColor(change)}`}>
                {statusCode(change, scope)}
              </span>
              <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                <span className="truncate text-[12px] text-[var(--color-text-primary)]">
                  {fileName(change.path)}
                </span>
                {parent && (
                  <span className="truncate text-[10px] text-[var(--color-text-tertiary)]">
                    {parent}
                  </span>
                )}
              </span>
            </button>
            <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              {onDiscard && discardLabel && (
                <button
                  type="button"
                  aria-label={`${discardLabel}: ${change.path}`}
                  title={discardLabel}
                  disabled={busy}
                  onClick={() => onDiscard(change.path)}
                  className="flex h-7 w-7 items-center justify-center rounded-[5px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-container-high)] hover:text-[var(--color-error)] disabled:opacity-40"
                >
                  <RotateCcw size={13} />
                </button>
              )}
              <button
                type="button"
                aria-label={`${fileActionLabel}: ${change.path}`}
                title={fileActionLabel}
                disabled={busy}
                onClick={() => onFileAction(change.path)}
                className="flex h-7 w-7 items-center justify-center rounded-[5px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-container-high)] hover:text-[var(--color-text-primary)] disabled:opacity-40"
              >
                {fileActionIcon}
              </button>
            </div>
          </div>
        )
      })}
    </section>
  )
}
