import { createHash } from 'node:crypto'
import { readFile, mkdir, access, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileNoThrow } from '../execFileNoThrow.js'
import { logForDebugging } from '../debug.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import {
  ensureComputerUseManagedRuntime,
  getManagedComputerUsePythonPath,
} from './runtimeManager.js'
import {
  callNativeCaptureHelper,
  isNativeCaptureCommand,
  readNativeScreenCapturePermission,
  resolveNativeCaptureHelperPath,
  shouldFallbackFromNativeLinuxCapture,
} from './nativeCapture.js'
// @ts-ignore — Bun text import
import MAC_HELPER_CONTENT from '../../../runtime/mac_helper.py' with { type: 'text' }
// @ts-ignore — Bun text import
import WIN_HELPER_CONTENT from '../../../runtime/win_helper.py' with { type: 'text' }
// @ts-ignore — Bun text import
import LINUX_HELPER_CONTENT from '../../../runtime/linux_helper.py' with { type: 'text' }
// @ts-ignore — Bun text import
import REQUIREMENTS_DARWIN from '../../../runtime/requirements.txt' with { type: 'text' }
// @ts-ignore — Bun text import
import REQUIREMENTS_WIN32 from '../../../runtime/requirements-win.txt' with { type: 'text' }
// @ts-ignore — Bun text import
import REQUIREMENTS_LINUX from '../../../runtime/requirements-linux.txt' with { type: 'text' }

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../../..')

// All runtime state lives in ~/.cyber/.runtime — writable in both dev and
// bundled (Tauri app) modes. Embedded requirements and the platform helper
// are materialized here before the bridge starts.
const runtimeStateRoot = path.join(getClaudeConfigHomeDir(), '.runtime')
const venvRoot = path.join(runtimeStateRoot, 'venv')
const installStampPath = path.join(runtimeStateRoot, 'requirements.sha256')

const PIP_INDEX_URL = 'https://pypi.tuna.tsinghua.edu.cn/simple/'
const PIP_TRUSTED_HOST = 'pypi.tuna.tsinghua.edu.cn'

const isWindows = process.platform === 'win32'
const isLinux = process.platform === 'linux'

// Always read from ~/.cyber/.runtime/ — works in both dev and bundled mode.
const requirementsPath = path.join(runtimeStateRoot, 'requirements.txt')
const helperFileName = isWindows
  ? 'win_helper.py'
  : isLinux
    ? 'linux_helper.py'
    : 'mac_helper.py'
const helperPath = path.join(runtimeStateRoot, helperFileName)
const embeddedRequirements = isWindows
  ? REQUIREMENTS_WIN32
  : isLinux
    ? REQUIREMENTS_LINUX
    : REQUIREMENTS_DARWIN
const embeddedHelper = isWindows
  ? WIN_HELPER_CONTENT
  : isLinux
    ? LINUX_HELPER_CONTENT
    : MAC_HELPER_CONTENT

let bootstrapPromise: Promise<void> | undefined
let activePythonPath: string | undefined

function getPythonCommandEnv(): NodeJS.ProcessEnv | undefined {
  if (!isWindows) return undefined
  return {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
  }
}

function legacyPythonBinPath(): string {
  return isWindows
    ? path.join(venvRoot, 'Scripts', 'python.exe')
    : path.join(venvRoot, 'bin', 'python3')
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

async function runOrThrow(file: string, args: string[], label: string): Promise<string> {
  const { code, stdout, stderr } = await execFileNoThrow(file, args, { useCwd: false })
  if (code !== 0) {
    throw new Error(`${label} failed with code ${code}: ${stderr || stdout || 'unknown error'}`)
  }
  return stdout
}

/**
 * Ensure runtime source files exist in ~/.cyber/.runtime/.
 * Embedded copies make Computer Use available even when the settings page has
 * never been opened. Dev files still win so local helper edits apply instantly.
 */
async function ensureRuntimeFiles(): Promise<void> {
  await mkdir(runtimeStateRoot, { recursive: true })

  const devReqFile = isWindows
    ? 'requirements-win.txt'
    : isLinux
      ? 'requirements-linux.txt'
      : 'requirements.txt'
  const devRequirements = path.join(projectRoot, 'runtime', devReqFile)
  const devHelper = path.join(projectRoot, 'runtime', helperFileName)

  // Always sync from dev runtime/ so source changes are reflected immediately.
  // Previously this only copied when the dest was missing, causing stale files
  // to persist after source updates — breaking mouse/keyboard actions if the
  // cached copy was from an older version.
  await writeFile(
    requirementsPath,
    await pathExists(devRequirements)
      ? await readFile(devRequirements, 'utf8')
      : embeddedRequirements,
    'utf8',
  )
  await writeFile(
    helperPath,
    await pathExists(devHelper) ? await readFile(devHelper, 'utf8') : embeddedHelper,
    'utf8',
  )
}

async function ensureLegacyEnvironment(): Promise<string | null> {
  const pythonPath = legacyPythonBinPath()
  if (!(await pathExists(pythonPath))) return null

  const pipBin = isWindows
    ? path.join(venvRoot, 'Scripts', 'pip.exe')
    : path.join(venvRoot, 'bin', 'pip')
  if (!(await pathExists(pipBin))) {
    logForDebugging('bootstrapping pip with ensurepip', { level: 'debug' })
    await runOrThrow(pythonPath, ['-m', 'ensurepip', '--upgrade'], 'ensurepip')
  }

  const requirements = await readFile(requirementsPath, 'utf8')
  const digest = createHash('sha256').update(requirements).digest('hex')
  let installedDigest = ''
  try {
    installedDigest = (await readFile(installStampPath, 'utf8')).trim()
  } catch {}

  if (installedDigest !== digest) {
    logForDebugging('updating legacy python runtime dependencies', { level: 'debug' })
    await runOrThrow(pythonPath, [
      '-m', 'pip', 'install', '--upgrade', 'pip',
      '-i', PIP_INDEX_URL, '--trusted-host', PIP_TRUSTED_HOST,
    ], 'pip upgrade')
    await runOrThrow(
      pythonPath,
      ['-m', 'pip', 'install', '-r', requirementsPath,
       '-i', PIP_INDEX_URL, '--trusted-host', PIP_TRUSTED_HOST],
      'python dependency install',
    )
    await writeFile(installStampPath, `${digest}\n`, 'utf8')
  }

  return pythonPath
}

export async function ensureBootstrapped(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise
  bootstrapPromise = (async () => {
    await ensureRuntimeFiles()

    const managedPython = await getManagedComputerUsePythonPath()
    if (managedPython) {
      activePythonPath = managedPython
      return
    }

    // Existing users keep their already-created environment. Dependency
    // updates continue to work without needing a system-level Python install.
    const legacyPython = await ensureLegacyEnvironment()
    if (legacyPython) {
      activePythonPath = legacyPython
      return
    }

    // The same managed path is used by desktop, packaged CLI, and source
    // checkouts. A system Python is never a first-run prerequisite.
    activePythonPath = await ensureComputerUseManagedRuntime()
  })()

  try {
    await bootstrapPromise
  } catch (error) {
    bootstrapPromise = undefined
    throw error
  }
}

async function callManagedPythonHelper<T>(
  command: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  await ensureBootstrapped()
  if (!activePythonPath) throw new Error('Computer Use runtime is not ready')
  const { code, stdout, stderr } = await execFileNoThrow(
    activePythonPath,
    [helperPath, command, '--payload', JSON.stringify(payload)],
    { useCwd: false, env: getPythonCommandEnv() },
  )

  if (code !== 0 && !stdout.trim()) {
    throw new Error(stderr || `Python helper ${command} failed with code ${code}`)
  }

  let parsed: { ok: boolean; result?: T; error?: { message?: string } }
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new Error(stderr || stdout || `Python helper ${command} returned invalid JSON`)
  }

  if (!parsed.ok) {
    throw new Error(parsed.error?.message || `Python helper ${command} failed`)
  }

  return parsed.result as T
}

export async function callPythonHelper<T>(
  command: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  if (
    (process.platform === 'darwin' || process.platform === 'linux') &&
    isNativeCaptureCommand(command) &&
    await resolveNativeCaptureHelperPath()
  ) {
    try {
      return await callNativeCaptureHelper<T>(command, payload)
    } catch (error) {
      if (!shouldFallbackFromNativeLinuxCapture(error)) throw error
      logForDebugging('native Linux capture unavailable; using managed fallback', {
        level: 'debug',
      })
    }
  }

  const result = await callManagedPythonHelper<T>(command, payload)
  if (
    (process.platform !== 'darwin' && process.platform !== 'linux') ||
    command !== 'check_permissions'
  ) {
    return result
  }

  const screenRecording = await readNativeScreenCapturePermission().catch(
    () => null,
  )
  if (screenRecording === null || typeof result !== 'object' || result === null) {
    return result
  }
  return {
    ...(result as Record<string, unknown>),
    screenRecording,
  } as T
}

export function getRuntimePaths(): { projectRoot: string; runtimeStateRoot: string; venvRoot: string } {
  return { projectRoot, runtimeStateRoot, venvRoot }
}
