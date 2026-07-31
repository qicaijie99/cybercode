import { api } from './client'

export type ComputerUseStatus = {
  platform: string
  supported: boolean
  runtime: ComputerUseRuntimeStatus
  python: {
    installed: boolean
    version: string | null
    path: string | null
  }
  venv: {
    created: boolean
    path: string
  }
  dependencies: {
    installed: boolean
    requirementsFound: boolean
  }
  permissions: {
    accessibility: boolean | null
    screenRecording: boolean | null
    inputAvailable?: boolean | null
  }
}

export type ComputerUseRuntimePhase =
  | 'not-installed'
  | 'checking'
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'ready'
  | 'paused'
  | 'error'

export type ComputerUseRuntimeStatus = {
  phase: ComputerUseRuntimePhase
  ready: boolean
  version: string | null
  platformKey: string | null
  source: 'bundled' | 'managed' | 'legacy' | null
  downloadedBytes: number
  totalBytes: number | null
  progressPercent: number
  error: string | null
  canPause: boolean
}

export type SetupStep = {
  name: string
  ok: boolean
  message: string
}

export type SetupResult = {
  success: boolean
  steps: SetupStep[]
}

export type InstalledApp = {
  bundleId: string
  displayName: string
  path: string
}

export type AuthorizedApp = {
  bundleId: string
  displayName: string
  authorizedAt: string
}

export type ComputerUseConfig = {
  authorizedApps: AuthorizedApp[]
  grantFlags: {
    clipboardRead: boolean
    clipboardWrite: boolean
    systemKeyCombos: boolean
  }
}

export const computerUseApi = {
  getStatus() {
    return api.get<ComputerUseStatus>('/api/computer-use/status')
  },
  runSetup() {
    return api.post<SetupResult>('/api/computer-use/setup', undefined, { timeout: 300_000 })
  },
  prepareRuntime() {
    return api.post<ComputerUseRuntimeStatus>('/api/computer-use/runtime')
  },
  pauseRuntime() {
    return api.delete<ComputerUseRuntimeStatus>('/api/computer-use/runtime')
  },
  getInstalledApps() {
    return api.get<{ apps: InstalledApp[] }>('/api/computer-use/apps')
  },
  getAuthorizedApps() {
    return api.get<ComputerUseConfig>('/api/computer-use/authorized-apps')
  },
  setAuthorizedApps(config: Partial<ComputerUseConfig>) {
    return api.put<{ ok: true }>('/api/computer-use/authorized-apps', config)
  },
  openSettings(pane: 'Privacy_ScreenCapture' | 'Privacy_Accessibility') {
    return api.post<{ ok: true }>('/api/computer-use/open-settings', { pane })
  },
}
