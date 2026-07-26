import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  computerUseApi,
  type ComputerUseRuntimeStatus,
  type ComputerUseStatus,
} from '../api/computerUse'
import { useSettingsStore } from '../stores/settingsStore'
import { ComputerUseSettings } from './ComputerUseSettings'

vi.mock('../api/computerUse', () => ({
  computerUseApi: {
    getStatus: vi.fn(),
    prepareRuntime: vi.fn(),
    pauseRuntime: vi.fn(),
    getInstalledApps: vi.fn(),
    getAuthorizedApps: vi.fn(),
    setAuthorizedApps: vi.fn(),
    openSettings: vi.fn(),
  },
}))

function runtime(
  patch: Partial<ComputerUseRuntimeStatus> = {},
): ComputerUseRuntimeStatus {
  return {
    phase: 'not-installed',
    ready: false,
    version: null,
    platformKey: 'win32-x64',
    source: null,
    downloadedBytes: 0,
    totalBytes: null,
    progressPercent: 0,
    error: null,
    canPause: false,
    ...patch,
  }
}

function status(runtimeStatus = runtime()): ComputerUseStatus {
  return {
    platform: 'win32',
    supported: true,
    runtime: runtimeStatus,
    python: { installed: false, version: null, path: null },
    venv: { created: false, path: 'C:\\Users\\test\\.cyber\\.runtime\\venv' },
    dependencies: { installed: false, requirementsFound: true },
    permissions: { accessibility: null, screenRecording: null },
  }
}

describe('ComputerUseSettings runtime preparation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.setState({ locale: 'zh' })
    vi.mocked(computerUseApi.getStatus).mockResolvedValue(status())
    vi.mocked(computerUseApi.getInstalledApps).mockResolvedValue({ apps: [] })
    vi.mocked(computerUseApi.getAuthorizedApps).mockResolvedValue({
      authorizedApps: [],
      grantFlags: {
        clipboardRead: true,
        clipboardWrite: true,
        systemKeyCombos: true,
      },
    })
    vi.mocked(computerUseApi.setAuthorizedApps).mockResolvedValue({ ok: true })
  })

  it('offers one-click preparation without asking the user to install Python', async () => {
    render(<ComputerUseSettings />)

    expect(await screen.findByText('Computer Use 运行组件')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '自动准备' })).toBeInTheDocument()
    expect(screen.queryByText('下载 Python 3')).not.toBeInTheDocument()
    expect(screen.queryByText('虚拟环境')).not.toBeInTheDocument()
  })

  it('shows live background download progress and a pause action', async () => {
    const downloading = runtime({
      phase: 'downloading',
      downloadedBytes: 10 * 1024 * 1024,
      totalBytes: 40 * 1024 * 1024,
      progressPercent: 25,
      canPause: true,
    })
    vi.mocked(computerUseApi.prepareRuntime).mockResolvedValue(downloading)
    vi.mocked(computerUseApi.getStatus)
      .mockResolvedValueOnce(status())
      .mockResolvedValue(status(downloading))

    render(<ComputerUseSettings />)
    fireEvent.click(await screen.findByRole('button', { name: '自动准备' }))

    expect(await screen.findByText('正在下载 25% · 10.0 MB / 40.0 MB')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '正在准备 25%' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '暂停' })).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25')
    expect(screen.getByText('准备过程在后台继续，你仍可正常使用 CyberCode。')).toBeInTheDocument()
  })

  it('pauses preparation and offers a resumable action', async () => {
    const downloading = runtime({
      phase: 'downloading',
      downloadedBytes: 10 * 1024 * 1024,
      totalBytes: 40 * 1024 * 1024,
      progressPercent: 25,
      canPause: true,
    })
    const paused = runtime({
      phase: 'paused',
      downloadedBytes: 10 * 1024 * 1024,
      totalBytes: 40 * 1024 * 1024,
      progressPercent: 25,
    })
    vi.mocked(computerUseApi.getStatus).mockResolvedValue(status(downloading))
    vi.mocked(computerUseApi.pauseRuntime).mockResolvedValue(paused)

    render(<ComputerUseSettings />)
    fireEvent.click(await screen.findByRole('button', { name: '暂停' }))

    expect(await screen.findByText('已暂停，下次将从当前进度继续。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '继续' })).toBeInTheDocument()
    expect(computerUseApi.pauseRuntime).toHaveBeenCalledOnce()
  })

  it('loads app authorization immediately for an existing legacy environment', async () => {
    vi.mocked(computerUseApi.getStatus).mockResolvedValue(status(runtime({
      phase: 'ready',
      ready: true,
      version: '3.12.11',
      source: 'legacy',
      progressPercent: 100,
    })))

    render(<ComputerUseSettings />)

    expect(await screen.findByText('已就绪 · 沿用现有 CyberCode 环境')).toBeInTheDocument()
    await waitFor(() => expect(computerUseApi.getInstalledApps).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: '自动准备' })).not.toBeInTheDocument()
  })

  it('keeps Wayland screenshots available without claiming full input support', async () => {
    const linuxStatus: ComputerUseStatus = {
      ...status(runtime({
        phase: 'ready',
        ready: true,
        version: '3.12.11',
        platformKey: 'linux-x64',
        source: 'managed',
        progressPercent: 100,
      })),
      platform: 'linux',
      permissions: {
        accessibility: true,
        screenRecording: true,
        inputAvailable: false,
      },
    }
    vi.mocked(computerUseApi.getStatus).mockResolvedValue(linuxStatus)

    render(<ComputerUseSettings />)

    expect(await screen.findByText('屏幕截图')).toBeInTheDocument()
    expect(screen.getByText('已通过 X11 后端或系统 Portal 就绪')).toBeInTheDocument()
    expect(screen.getByText(/原生 Wayland 会阻止静默全局输入/)).toBeInTheDocument()
    expect(screen.queryByText('所有检查通过，Computer Use 已就绪。')).not.toBeInTheDocument()
  })
})
