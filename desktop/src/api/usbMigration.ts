import { api } from './client'

export type UsbMigrationPlatform =
  | 'macos-arm64'
  | 'macos-x64'
  | 'windows-x64'
  | 'linux-x64'

export type UsbMigrationProject = {
  id: string
  name: string
  path: string
  sizeBytes: number
  modifiedAt: string
  sessionCount: number
}

export type UsbMigrationScan = {
  scannedAt: string
  configPath: string
  configSizeBytes: number
  projects: UsbMigrationProject[]
  currentPlatform: UsbMigrationPlatform | null
  release: {
    version: string
    generatedAt: string
    platforms: Partial<Record<UsbMigrationPlatform, {
      filename: string
      sizeBytes: number
      archiveType: 'app-tar-gz' | 'zip' | 'appimage'
    }>>
  } | null
  releaseError: string | null
}

export type UsbMigrationJob = {
  id: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  stage:
    | 'queued'
    | 'preparing'
    | 'config'
    | 'projects'
    | 'applications'
    | 'launchers'
    | 'finalizing'
    | 'completed'
    | 'failed'
    | 'cancelled'
  destinationPath: string
  portablePath: string
  currentItem: string | null
  processedBytes: number
  totalBytes: number
  progressPercent: number
  warnings: string[]
  error: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export const usbMigrationApi = {
  scan: (force = false) =>
    api.get<UsbMigrationScan>(
      `/api/usb-migration/scan${force ? '?force=true' : ''}`,
      { timeout: 120_000 },
    ),

  start: (input: {
    destinationPath: string
    projectIds: string[]
    platforms: UsbMigrationPlatform[]
    includeApplications: boolean
    replaceExisting?: boolean
  }) =>
    api.post<UsbMigrationJob>(
      '/api/usb-migration/start',
      input,
      { timeout: 120_000 },
    ),

  getJob: (jobId: string) =>
    api.get<UsbMigrationJob>(
      `/api/usb-migration/jobs/${encodeURIComponent(jobId)}`,
    ),

  cancel: (jobId: string) =>
    api.post<UsbMigrationJob>(
      `/api/usb-migration/jobs/${encodeURIComponent(jobId)}/cancel`,
    ),
}
