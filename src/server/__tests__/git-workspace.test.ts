import { afterEach, beforeEach, describe, expect, it, setDefaultTimeout } from 'bun:test'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  GitWorkspaceError,
  GitWorkspaceService,
  parseGitStatusPorcelain,
} from '../services/gitWorkspaceService.js'

setDefaultTimeout(30_000)

async function git(cwd: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
    },
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) throw new Error(stderr || `git ${args.join(' ')} failed`)
  return stdout.trim()
}

describe('GitWorkspaceService', () => {
  let root = ''
  let service: GitWorkspaceService

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cybercode-git-workspace-'))
    service = new GitWorkspaceService()
    await git(root, ['init'])
    await git(root, ['config', 'user.name', 'CyberCode Test'])
    await git(root, ['config', 'user.email', 'cybercode@example.test'])
    await writeFile(join(root, 'tracked.txt'), 'version one\n')
    await git(root, ['add', 'tracked.txt'])
    await git(root, ['commit', '-m', 'initial'])
  })

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('parses NUL-delimited paths and rename records without losing spaces', () => {
    const changes = parseGitStatusPorcelain(
      ' M src/space name.ts\0R  新名字.ts\0旧名字.ts\0?? 中文 文件.md\0',
    )

    expect(changes).toHaveLength(3)
    expect(changes.find((change) => change.path === 'src/space name.ts')).toMatchObject({
      staged: false,
      unstaged: true,
    })
    expect(changes.find((change) => change.path === '新名字.ts')).toMatchObject({
      previousPath: '旧名字.ts',
      kind: 'renamed',
      staged: true,
    })
    expect(changes.find((change) => change.path === '中文 文件.md')).toMatchObject({
      kind: 'untracked',
      unstaged: true,
    })
  })

  it('reads diffs and safely stages, unstages, and discards files', async () => {
    await writeFile(join(root, 'tracked.txt'), 'version two\n')
    await writeFile(join(root, 'space file.txt'), 'new file\n')

    let status = await service.getStatus(root)
    expect(status.isRepository).toBe(true)
    expect(status.repoRoot).toBe(await realpath(root))
    expect(status.unstagedCount).toBe(2)

    const workingDiff = await service.getDiff(root, 'unstaged', 'tracked.txt')
    expect(workingDiff).toMatchObject({
      oldText: 'version one\n',
      newText: 'version two\n',
      binary: false,
      truncated: false,
    })

    status = await service.stage(root, ['tracked.txt', 'space file.txt'])
    expect(status.stagedCount).toBe(2)
    expect(status.unstagedCount).toBe(0)

    const stagedDiff = await service.getDiff(root, 'staged', 'space file.txt')
    expect(stagedDiff.oldText).toBe('')
    expect(stagedDiff.newText).toBe('new file\n')

    await writeFile(join(root, 'tracked.txt'), 'version three\n')
    status = await service.getStatus(root)
    expect(status.changes.find((change) => change.path === 'tracked.txt')).toMatchObject({
      staged: true,
      unstaged: true,
    })

    status = await service.discard(root, ['tracked.txt'])
    expect(await readFile(join(root, 'tracked.txt'), 'utf8')).toBe('version two\n')
    expect(status.changes.find((change) => change.path === 'tracked.txt')).toMatchObject({
      staged: true,
      unstaged: false,
    })

    status = await service.unstage(root, ['tracked.txt', 'space file.txt'])
    expect(status.stagedCount).toBe(0)
    expect(status.unstagedCount).toBe(2)

    status = await service.discard(root, ['tracked.txt', 'space file.txt'])
    expect(await readFile(join(root, 'tracked.txt'), 'utf8')).toBe('version one\n')
    expect(status.changes).toHaveLength(0)
    expect(readFile(join(root, 'space file.txt'), 'utf8')).rejects.toThrow()
  })

  it('creates a commit from staged files and returns the new hash', async () => {
    await writeFile(join(root, 'tracked.txt'), 'committed change\n')
    await service.stage(root, ['tracked.txt'])

    const result = await service.commit(root, 'test desktop commit')

    expect(result.commit).toMatch(/^[0-9a-f]+$/)
    expect(result.status.changes).toHaveLength(0)
    expect(await git(root, ['log', '-1', '--pretty=%s'])).toBe('test desktop commit')
  })

  it('lists, creates, switches branches, and reads recent history', async () => {
    const initial = await service.getStatus(root)
    expect(initial.branch).toBeTruthy()
    const baseBranch = initial.branch!

    let branches = await service.listBranches(root)
    expect(branches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: baseBranch,
        current: true,
      }),
    ]))

    let status = await service.createBranch(root, 'feature/local-git')
    expect(status.branch).toBe('feature/local-git')

    await writeFile(join(root, 'tracked.txt'), 'feature branch\n')
    await service.stage(root, ['tracked.txt'])
    await service.commit(root, 'feature history entry')

    const history = await service.listHistory(root, 10)
    expect(history[0]).toMatchObject({
      subject: 'feature history entry',
      authorName: 'CyberCode Test',
    })
    expect(history[0]?.hash).toMatch(/^[0-9a-f]{40}$/)

    status = await service.switchBranch(root, baseBranch)
    expect(status.branch).toBe(baseBranch)
    branches = await service.listBranches(root)
    expect(branches[0]).toMatchObject({
      name: baseBranch,
      current: true,
    })
    expect(branches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'feature/local-git',
        current: false,
      }),
    ]))

    await expect(service.createBranch(root, '../invalid')).rejects.toMatchObject({
      code: 'INVALID_OPERATION',
    } satisfies Partial<GitWorkspaceError>)
  })

  it('initializes a repository and rejects paths outside its root', async () => {
    const plainDirectory = await mkdtemp(join(tmpdir(), 'cybercode-git-init-'))
    try {
      const initial = await service.getStatus(plainDirectory)
      expect(initial.isRepository).toBe(false)

      const initialized = await service.initialize(plainDirectory)
      expect(initialized.isRepository).toBe(true)

      await writeFile(join(plainDirectory, 'inside.txt'), 'inside\n')
      await expect(service.stage(plainDirectory, ['../outside.txt'])).rejects.toMatchObject({
        code: 'INVALID_OPERATION',
      } satisfies Partial<GitWorkspaceError>)
    } finally {
      await rm(plainDirectory, { recursive: true, force: true })
    }
  })
})
