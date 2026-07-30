import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  usbMigrationApi,
  type UsbMigrationJob,
  type UsbMigrationScan,
} from '../api/usbMigration'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'
import { portableFolderPreview } from '../utils/usbMigration'
import { UsbMigration } from './UsbMigration'

vi.mock('../api/usbMigration', () => ({
  usbMigrationApi: {
    scan: vi.fn(),
    start: vi.fn(),
    getJob: vi.fn(),
    cancel: vi.fn(),
  },
}))

function scan(
  patch: Partial<UsbMigrationScan> = {},
): UsbMigrationScan {
  return {
    scannedAt: '2026-07-30T12:00:00.000Z',
    configPath: '/Users/test/.cyber',
    configSizeBytes: 12 * 1024,
    projects: [{
      id: 'a'.repeat(20),
      name: 'cybercode',
      path: '/Users/test/projects/cybercode',
      sizeBytes: 64 * 1024,
      modifiedAt: '2026-07-30T11:00:00.000Z',
      sessionCount: 3,
    }],
    currentPlatform: 'macos-arm64',
    release: {
      version: '1.1.10',
      generatedAt: '2026-07-30T10:00:00.000Z',
      platforms: {
        'macos-arm64': {
          filename: 'CyberCode_macos_arm64.tar.gz',
          sizeBytes: 100 * 1024,
          archiveType: 'app-tar-gz',
        },
        'macos-x64': {
          filename: 'CyberCode_macos_x64.tar.gz',
          sizeBytes: 110 * 1024,
          archiveType: 'app-tar-gz',
        },
        'windows-x64': {
          filename: 'CyberCode_windows_x64.zip',
          sizeBytes: 120 * 1024,
          archiveType: 'zip',
        },
        'linux-x64': {
          filename: 'CyberCode_linux_x64.AppImage',
          sizeBytes: 130 * 1024,
          archiveType: 'appimage',
        },
      },
    },
    releaseError: null,
    ...patch,
  }
}

function job(
  patch: Partial<UsbMigrationJob> = {},
): UsbMigrationJob {
  return {
    id: 'b'.repeat(24),
    status: 'queued',
    stage: 'queued',
    destinationPath: '/Volumes/USB',
    portablePath: '/Volumes/USB/CyberCode-Portable',
    currentItem: null,
    processedBytes: 0,
    totalBytes: 536 * 1024,
    progressPercent: 0,
    warnings: [],
    error: null,
    createdAt: '2026-07-30T12:00:00.000Z',
    updatedAt: '2026-07-30T12:00:00.000Z',
    completedAt: null,
    ...patch,
  }
}

describe('UsbMigration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.setState({ locale: 'zh' })
    useUIStore.setState({ toasts: [] })
    vi.mocked(usbMigrationApi.scan).mockResolvedValue(scan())
    vi.mocked(usbMigrationApi.start).mockResolvedValue(job())
    vi.mocked(usbMigrationApi.getJob).mockResolvedValue(job({
      status: 'running',
      stage: 'config',
      currentItem: '/Users/test/.cyber',
      progressPercent: 10,
      processedBytes: 54 * 1024,
    }))
  })

  it('starts a complete portable migration with all discovered content selected', async () => {
    vi.mocked(usbMigrationApi.start).mockResolvedValue(job({
      status: 'running',
      stage: 'config',
      currentItem: '/Users/test/.cyber',
      progressPercent: 10,
      processedBytes: 54 * 1024,
    }))
    render(<UsbMigration />)

    expect(await screen.findByText('cybercode')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: '包含四平台应用' })).toBeChecked()
    expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(5)

    fireEvent.change(screen.getByRole('textbox', { name: 'U 盘位置' }), {
      target: { value: '/Volumes/USB' },
    })
    fireEvent.click(screen.getByRole('checkbox', {
      name: /我了解便携数据包含账号凭据/,
    }))
    fireEvent.click(screen.getByRole('button', { name: '开始迁移' }))

    await waitFor(() => {
      expect(usbMigrationApi.start).toHaveBeenCalledWith({
        destinationPath: '/Volumes/USB',
        projectIds: ['a'.repeat(20)],
        platforms: [
          'macos-arm64',
          'macos-x64',
          'windows-x64',
          'linux-x64',
        ],
        includeApplications: true,
        replaceExisting: false,
      })
    })
    expect(await screen.findByText('正在复制配置与账号数据')).toBeInTheDocument()
  }, 20_000)

  it('allows a data-only migration when portable release packages are unavailable', async () => {
    vi.mocked(usbMigrationApi.scan).mockResolvedValue(scan({
      release: null,
      releaseError: '当前版本尚未发布便携运行包',
    }))

    render(<UsbMigration />)

    expect(await screen.findByText(
      '当前 Release 暂无完整便携运行包；仍可只迁移数据。',
    )).toBeInTheDocument()
    expect(screen.queryByText('当前版本尚未发布便携运行包')).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: '包含四平台应用' })).toBeDisabled()

    fireEvent.change(screen.getByRole('textbox', { name: 'U 盘位置' }), {
      target: { value: '/Volumes/USB' },
    })
    fireEvent.click(screen.getByRole('checkbox', {
      name: /我了解便携数据包含账号凭据/,
    }))
    fireEvent.click(screen.getByRole('button', { name: '开始迁移' }))

    await waitFor(() => {
      expect(usbMigrationApi.start).toHaveBeenCalledWith({
        destinationPath: '/Volumes/USB',
        projectIds: ['a'.repeat(20)],
        platforms: [],
        includeApplications: false,
        replaceExisting: false,
      })
    })
  })

  it('previews existing portable folders without appending a duplicate directory', async () => {
    render(<UsbMigration />)
    await screen.findByText('cybercode')

    fireEvent.change(screen.getByRole('textbox', { name: 'U 盘位置' }), {
      target: { value: '/Volumes/USB/CyberCode-Portable/' },
    })

    expect(screen.getByText('将创建: /Volumes/USB/CyberCode-Portable')).toBeInTheDocument()
    expect(portableFolderPreview('D:\\CyberCode-Portable\\')).toBe(
      'D:\\CyberCode-Portable',
    )
    expect(portableFolderPreview('D:\\')).toBe('D:\\CyberCode-Portable')
  })
})
