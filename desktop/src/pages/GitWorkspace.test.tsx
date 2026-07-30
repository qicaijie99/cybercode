import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sessionsApi, type GitWorkspaceStatus } from '../api/sessions'
import { useChatStore } from '../stores/chatStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useTabStore } from '../stores/tabStore'
import { useUIStore } from '../stores/uiStore'
import { GitWorkspace } from './GitWorkspace'

vi.mock('../api/sessions', () => ({
  sessionsApi: {
    getGitStatus: vi.fn(),
    getGitDiff: vi.fn(),
    getGitBranches: vi.fn(),
    getGitHistory: vi.fn(),
    initializeGit: vi.fn(),
    stageGitFiles: vi.fn(),
    unstageGitFiles: vi.fn(),
    discardGitFiles: vi.fn(),
    commitGit: vi.fn(),
    switchGitBranch: vi.fn(),
    createGitBranch: vi.fn(),
  },
}))

vi.mock('../components/chat/DiffViewer', () => ({
  DiffViewer: ({ filePath }: { filePath: string }) => (
    <div data-testid="git-diff-viewer">{filePath}</div>
  ),
}))

function gitStatus(overrides: Partial<GitWorkspaceStatus> = {}): GitWorkspaceStatus {
  return {
    gitAvailable: true,
    isRepository: true,
    workDir: '/tmp/project',
    repoRoot: '/tmp/project',
    repoName: 'project',
    branch: 'feature/local-git',
    detached: false,
    headCommit: 'abc1234',
    upstream: 'origin/feature/local-git',
    ahead: 1,
    behind: 0,
    stagedCount: 1,
    unstagedCount: 1,
    conflictedCount: 0,
    changes: [
      {
        path: 'src/staged.ts',
        indexStatus: 'M',
        worktreeStatus: ' ',
        kind: 'modified',
        staged: true,
        unstaged: false,
        conflicted: false,
      },
      {
        path: 'src/app.ts',
        indexStatus: ' ',
        worktreeStatus: 'M',
        kind: 'modified',
        staged: false,
        unstaged: true,
        conflicted: false,
      },
    ],
    ...overrides,
  }
}

const originalChatActions = {
  getSession: useChatStore.getState().getSession,
  sendMessage: useChatStore.getState().sendMessage,
  queuePendingSteer: useChatStore.getState().queuePendingSteer,
  sendPendingSteers: useChatStore.getState().sendPendingSteers,
}

describe('GitWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.setState({ locale: 'zh' })
    useTabStore.setState({
      tabs: [{
        sessionId: 'session-1',
        projectPath: '-tmp-project',
        title: 'Project',
        type: 'session',
        status: 'idle',
      }],
      activeTabId: 'session-1',
    })
    useUIStore.setState({
      settingsOpen: true,
      settingsPanelView: 'git',
      toasts: [],
    })
    vi.mocked(sessionsApi.getGitStatus).mockResolvedValue(gitStatus())
    vi.mocked(sessionsApi.getGitDiff).mockResolvedValue({
      path: 'src/app.ts',
      scope: 'unstaged',
      oldText: 'old\n',
      newText: 'new\n',
      additions: 1,
      deletions: 1,
      binary: false,
      truncated: false,
    })
    vi.mocked(sessionsApi.getGitBranches).mockResolvedValue({
      branches: [
        {
          name: 'feature/local-git',
          commit: 'abc1234',
          upstream: 'origin/feature/local-git',
          current: true,
          ahead: 1,
          behind: 0,
          upstreamGone: false,
        },
        {
          name: 'main',
          commit: 'def5678',
          upstream: null,
          current: false,
          ahead: 0,
          behind: 0,
          upstreamGone: false,
        },
      ],
    })
    vi.mocked(sessionsApi.getGitHistory).mockResolvedValue({
      commits: [{
        hash: 'abc1234567890abc1234567890abc1234567890a',
        shortHash: 'abc1234',
        subject: 'Add local Git workspace',
        authorName: 'CyberCode Test',
        authoredAt: '2026-07-29T01:30:00+08:00',
        refs: ['HEAD -> feature/local-git'],
      }],
    })
  })

  afterEach(() => {
    useChatStore.setState(originalChatActions)
  })

  it('shows the branch, staged files, working changes, and selected diff', async () => {
    render(<GitWorkspace />)

    expect(await screen.findByText('feature/local-git')).toBeInTheDocument()
    expect(screen.getByText('staged.ts')).toBeInTheDocument()
    expect(screen.getByText('app.ts')).toBeInTheDocument()
    expect(await screen.findByTestId('git-diff-viewer')).toHaveTextContent('src/app.ts')
    expect(sessionsApi.getGitStatus).toHaveBeenCalledWith('session-1', {
      projectPath: '-tmp-project',
    })
    expect(sessionsApi.getGitDiff).toHaveBeenCalledWith(
      'session-1',
      'unstaged',
      'src/app.ts',
      { projectPath: '-tmp-project' },
    )
  })

  it('shows a version mismatch instead of crashing on an invalid Git response', async () => {
    vi.mocked(sessionsApi.getGitStatus).mockResolvedValueOnce({
      id: 'session-1',
      workDir: '/tmp/project',
    } as unknown as GitWorkspaceStatus)

    render(<GitWorkspace />)

    expect(await screen.findByText('无法读取 Git 状态')).toBeInTheDocument()
    expect(screen.getByText(/本地 Git 服务与当前界面版本不匹配/)).toBeInTheDocument()
  })

  it('stages a file through the structured Git API', async () => {
    const staged = gitStatus({
      stagedCount: 2,
      unstagedCount: 0,
      changes: gitStatus().changes.map((change) => ({
        ...change,
        indexStatus: 'M',
        worktreeStatus: ' ',
        staged: true,
        unstaged: false,
      })),
    })
    vi.mocked(sessionsApi.stageGitFiles).mockResolvedValue(staged)
    render(<GitWorkspace />)

    fireEvent.click(await screen.findByRole('button', { name: '暂存文件: src/app.ts' }))

    await waitFor(() => {
      expect(sessionsApi.stageGitFiles).toHaveBeenCalledWith(
        'session-1',
        ['src/app.ts'],
        { projectPath: '-tmp-project' },
      )
    })
  })

  it('requires confirmation before discarding a local file', async () => {
    vi.mocked(sessionsApi.discardGitFiles).mockResolvedValue(gitStatus({
      unstagedCount: 0,
      changes: [gitStatus().changes[0]!],
    }))
    render(<GitWorkspace />)

    fireEvent.click(await screen.findByRole('button', { name: '丢弃更改: src/app.ts' }))
    expect(screen.getByRole('dialog', { name: '丢弃本地更改？' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认丢弃' }))

    await waitFor(() => {
      expect(sessionsApi.discardGitFiles).toHaveBeenCalledWith(
        'session-1',
        ['src/app.ts'],
        { projectPath: '-tmp-project' },
      )
    })
  })

  it('creates a branch from the branch menu', async () => {
    vi.mocked(sessionsApi.createGitBranch).mockResolvedValue(gitStatus({
      branch: 'feature/new-branch',
      upstream: null,
      ahead: 0,
    }))
    render(<GitWorkspace />)

    fireEvent.click(await screen.findByRole('button', { name: '打开分支菜单' }))
    fireEvent.change(screen.getByPlaceholderText('新建分支名称'), {
      target: { value: 'feature/new-branch' },
    })
    fireEvent.click(screen.getByRole('button', { name: '新建并切换分支' }))

    await waitFor(() => {
      expect(sessionsApi.createGitBranch).toHaveBeenCalledWith(
        'session-1',
        'feature/new-branch',
        { projectPath: '-tmp-project' },
      )
    })
  })

  it('confirms before switching branches with local changes', async () => {
    vi.mocked(sessionsApi.switchGitBranch).mockResolvedValue(gitStatus({
      branch: 'main',
      upstream: null,
      ahead: 0,
    }))
    render(<GitWorkspace />)

    fireEvent.click(await screen.findByRole('button', { name: '打开分支菜单' }))
    fireEvent.click(await screen.findByText('main', { exact: true }))
    expect(screen.getByRole('dialog', { name: '切换分支？' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '继续切换' }))

    await waitFor(() => {
      expect(sessionsApi.switchGitBranch).toHaveBeenCalledWith(
        'session-1',
        'main',
        { projectPath: '-tmp-project' },
      )
    })
  })

  it('loads recent commits in the history tab', async () => {
    render(<GitWorkspace />)

    fireEvent.click(await screen.findByRole('tab', { name: '历史' }))

    expect(await screen.findByText('Add local Git workspace')).toBeInTheDocument()
    expect(screen.getByText('abc1234')).toBeInTheDocument()
    expect(sessionsApi.getGitHistory).toHaveBeenCalledWith(
      'session-1',
      40,
      { projectPath: '-tmp-project' },
    )
  })

  it('creates a commit from staged files', async () => {
    vi.mocked(sessionsApi.commitGit).mockResolvedValue({
      status: gitStatus({
        stagedCount: 0,
        unstagedCount: 1,
        changes: [gitStatus().changes[1]!],
      }),
      commit: 'def5678',
      output: '[feature/local-git def5678] fix local git',
    })
    render(<GitWorkspace />)

    fireEvent.change(await screen.findByPlaceholderText('填写提交说明'), {
      target: { value: 'fix local git' },
    })
    fireEvent.click(screen.getByRole('button', { name: '提交' }))

    await waitFor(() => {
      expect(sessionsApi.commitGit).toHaveBeenCalledWith(
        'session-1',
        'fix local git',
        { projectPath: '-tmp-project' },
      )
    })
    expect(useUIStore.getState().toasts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'success',
        message: '已创建提交 def5678',
      }),
    ]))
  })

  it('starts an AI review and closes the drawer', async () => {
    const sendMessage = vi.fn()
    useChatStore.setState({
      getSession: vi.fn(() => ({ chatState: 'idle' })) as unknown as typeof originalChatActions.getSession,
      sendMessage,
    })
    render(<GitWorkspace />)

    fireEvent.click(await screen.findByRole('button', { name: 'AI 审查' }))

    expect(sendMessage).toHaveBeenCalledWith(
      'session-1',
      expect.stringContaining('审查当前尚未提交的 Git 更改'),
      undefined,
      { displayContent: '审查我当前的 Git 更改' },
    )
    expect(useUIStore.getState().settingsOpen).toBe(false)
  })
})
