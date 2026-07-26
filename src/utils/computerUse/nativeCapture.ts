import { access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileNoThrow } from '../execFileNoThrow.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'

const HELPER_APP_NAME = 'CyberCode Computer Use.app'
const HELPER_EXECUTABLE_NAME = 'CyberCodeComputerUse'
const LINUX_HELPER_EXECUTABLE_NAME = 'cybercode-computer-use'
const NATIVE_CAPTURE_COMMANDS = new Set([
  'list_displays',
  'get_display_size',
  'screenshot',
  'resolve_prepare_capture',
  'zoom',
])

type NativeHelperEnvelope<T> = {
  ok: boolean
  result?: T
  error?: {
    code?: string
    message?: string
  }
}

export class NativeCaptureError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'NativeCaptureError'
    this.code = code
  }
}

function helperExecutableIn(root: string): string {
  return path.join(
    root,
    HELPER_APP_NAME,
    'Contents',
    'MacOS',
    HELPER_EXECUTABLE_NAME,
  )
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

export function isNativeCaptureCommand(command: string): boolean {
  return NATIVE_CAPTURE_COMMANDS.has(command)
}

export function isNativeCaptureSupportedPlatform(
  platform: NodeJS.Platform = process.platform,
): platform is 'darwin' | 'linux' {
  return platform === 'darwin' || platform === 'linux'
}

export function nativeCaptureHelperCandidates(
  platform: NodeJS.Platform,
  {
    configuredPath,
    configHome,
    projectRoot,
  }: {
    configuredPath?: string
    configHome: string
    projectRoot: string
  },
): string[] {
  if (!isNativeCaptureSupportedPlatform(platform)) return []

  const installedRoot = path.join(configHome, 'computer-use')
  const resourceRoot = path.join(
    projectRoot,
    'desktop',
    'src-tauri',
    'resources',
    'computer-use',
  )
  const platformCandidates = platform === 'darwin'
    ? [
        helperExecutableIn(installedRoot),
        helperExecutableIn(resourceRoot),
      ]
    : [
        path.join(installedRoot, LINUX_HELPER_EXECUTABLE_NAME),
        path.join(resourceRoot, LINUX_HELPER_EXECUTABLE_NAME),
      ]

  return [
    configuredPath?.trim(),
    ...platformCandidates,
  ].filter((candidate): candidate is string => Boolean(candidate))
}

export async function resolveNativeCaptureHelperPath(): Promise<string | null> {
  if (!isNativeCaptureSupportedPlatform()) return null

  const configuredPath = process.env.CYBER_COMPUTER_USE_HELPER_PATH?.trim()
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  const projectRoot = path.resolve(moduleDir, '../../..')
  const candidates = nativeCaptureHelperCandidates(process.platform, {
    configuredPath,
    configHome: getClaudeConfigHomeDir(),
    projectRoot,
  })

  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate
  }
  return null
}

export function parseNativeCaptureOutput<T>(
  command: string,
  stdout: string,
  stderr = '',
): T {
  let parsed: NativeHelperEnvelope<T>
  try {
    parsed = JSON.parse(stdout) as NativeHelperEnvelope<T>
  } catch {
    throw new NativeCaptureError(
      'invalid_response',
      stderr || stdout || `Computer Use helper ${command} returned invalid JSON`,
    )
  }

  if (!parsed.ok) {
    throw new NativeCaptureError(
      parsed.error?.code || 'helper_failed',
      parsed.error?.message || `Computer Use helper ${command} failed`,
    )
  }
  return parsed.result as T
}

export async function callNativeCaptureHelper<T>(
  command: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const helperPath = await resolveNativeCaptureHelperPath()
  if (!helperPath) {
    throw new NativeCaptureError(
      'helper_unavailable',
      'CyberCode Computer Use helper is unavailable',
    )
  }

  const { code, stdout, stderr } = await execFileNoThrow(
    helperPath,
    [command, '--payload', JSON.stringify(payload)],
    { useCwd: false },
  )
  if (code !== 0 && !stdout.trim()) {
    throw new NativeCaptureError(
      'helper_launch_failed',
      stderr || `Computer Use helper ${command} exited with code ${code}`,
    )
  }
  return parseNativeCaptureOutput<T>(command, stdout, stderr)
}

export function shouldFallbackFromNativeLinuxCapture(error: unknown): boolean {
  return process.platform === 'linux' &&
    error instanceof NativeCaptureError &&
    [
      'capture_backend_unavailable',
      'portal_unavailable',
      'helper_unavailable',
      'helper_launch_failed',
    ].includes(error.code)
}

export async function readNativeScreenCapturePermission(): Promise<boolean | null> {
  if (!isNativeCaptureSupportedPlatform()) return null
  const helperPath = await resolveNativeCaptureHelperPath()
  if (!helperPath) return null

  if (process.platform === 'darwin') {
    const result = await callNativeCaptureHelper<{
      screenRecording: boolean
    }>('check_screen_recording')
    return result.screenRecording
  }

  const result = await callNativeCaptureHelper<{
    screenCapture?: boolean
    screenRecording?: boolean
  }>('check_screen_capture')
  return result.screenCapture ?? result.screenRecording ?? null
}

export async function requestNativeMacScreenRecordingPermission(): Promise<boolean | null> {
  if (process.platform !== 'darwin') return null
  const helperPath = await resolveNativeCaptureHelperPath()
  if (!helperPath) return null

  const result = await callNativeCaptureHelper<{
    screenRecording: boolean
  }>('request_screen_recording')
  return result.screenRecording
}
