import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  access,
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { execFileNoThrow, execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

const QODER_RUNTIME_VERSION = '1.1.5'
const QODER_RELEASE_ROOT =
  `https://qoder-ide.oss-accelerate.aliyuncs.com/qodercli/releases/${QODER_RUNTIME_VERSION}`
const DOWNLOAD_STALL_TIMEOUT_MS = 45_000

export type QoderRuntimeAsset = {
  archiveName: string
  sha256: string
  binaryName: 'qodercli' | 'qodercli.exe'
}

export type ResolvedQoderRuntimeAsset = QoderRuntimeAsset & {
  platformKey: string
  downloadUrl: string
}

type QoderRuntimeOptions = {
  runtimeRoot?: string
  platform?: NodeJS.Platform
  arch?: string
  fetchImpl?: typeof fetch
  extractArchive?: (
    archivePath: string,
    destination: string,
    platform: NodeJS.Platform,
  ) => Promise<void>
  validateBinary?: (binaryPath: string) => Promise<string>
}

export type QoderCliResult = {
  stdout: string
  stderr: string
  code: number
  error?: string
}

export type QoderCliRunOptions = {
  token: string
  args: string[]
  input?: string
  cwd?: string
  signal?: AbortSignal
  timeoutMs?: number
}

const QODER_RUNTIME_ASSETS: Record<string, QoderRuntimeAsset> = {
  'darwin-arm64': {
    archiveName: 'qodercli-darwin-arm64.tar.gz',
    sha256: '48b220d90ba69462b24fb214a5cf1ecc9e3d4785e7d8e32e63ceb9ca739b9d8a',
    binaryName: 'qodercli',
  },
  'darwin-x64': {
    archiveName: 'qodercli-darwin-x64.tar.gz',
    sha256: '9c72803f4c883af971b43c968023b925f8c085e79672ac2c66d8a65e80a571d4',
    binaryName: 'qodercli',
  },
  'linux-arm64': {
    archiveName: 'qodercli-linux-arm64.tar.gz',
    sha256: 'ad5ed775e8719781df40add6b815f7c823bbe1640dcba45d846145b8c8d8b88d',
    binaryName: 'qodercli',
  },
  'linux-x64': {
    // The baseline build works on older x64 CPUs that cannot run Bun's
    // optimized AVX2/BMI/FMA target.
    archiveName: 'qodercli-linux-x64-baseline.tar.gz',
    sha256: '2ee5797c634dc2277a16b64cc5f1faf855c3d2ee497bb86c18e449803a4d3328',
    binaryName: 'qodercli',
  },
  'win32-x64': {
    // Prefer Qoder's Node SEA fallback. It avoids the same illegal-instruction
    // failure that optimized Bun executables can hit on otherwise valid PCs.
    archiveName: 'qodercli-windows-x64-legacy.zip',
    sha256: 'ed160f0075a8ac048ea34a6e92ed047739957c4bca8020821cb2bfe3c521fc9e',
    binaryName: 'qodercli.exe',
  },
}

function platformKey(platform: NodeJS.Platform, arch: string): string | null {
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) {
    return `${platform}-${arch}`
  }
  if (platform === 'linux' && (arch === 'arm64' || arch === 'x64')) {
    return `${platform}-${arch}`
  }
  if (platform === 'win32' && arch === 'x64') return 'win32-x64'
  return null
}

export function resolveQoderRuntimeAsset(
  platform: NodeJS.Platform,
  arch: string,
): ResolvedQoderRuntimeAsset | null {
  const key = platformKey(platform, arch)
  const asset = key ? QODER_RUNTIME_ASSETS[key] : undefined
  if (!key || !asset) return null
  return {
    ...asset,
    platformKey: key,
    downloadUrl: `${QODER_RELEASE_ROOT}/${asset.archiveName}`,
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

async function sha256File(filePath: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256')
  const stream = createReadStream(filePath)
  try {
    for await (const chunk of stream) {
      signal?.throwIfAborted()
      hash.update(chunk as Buffer)
    }
  } finally {
    stream.destroy()
  }
  return hash.digest('hex')
}

async function extractOfficialArchive(
  archivePath: string,
  destination: string,
  platform: NodeJS.Platform,
): Promise<void> {
  if (platform === 'win32') {
    const result = await execFileNoThrowWithCwd(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$ErrorActionPreference = "Stop"; Expand-Archive -LiteralPath $env:CYBER_QODER_ARCHIVE -DestinationPath $env:CYBER_QODER_DESTINATION -Force',
      ],
      {
        timeout: 120_000,
        env: {
          ...process.env,
          CYBER_QODER_ARCHIVE: archivePath,
          CYBER_QODER_DESTINATION: destination,
        },
      },
    )
    if (result.code !== 0) {
      throw new Error(`Unable to extract the Qoder runtime: ${result.stderr || result.stdout}`)
    }
    return
  }

  const result = await execFileNoThrow(
    'tar',
    ['-xzf', archivePath, '-C', destination],
    { timeout: 120_000, useCwd: false },
  )
  if (result.code !== 0) {
    throw new Error(`Unable to extract the Qoder runtime: ${result.stderr || result.stdout}`)
  }
}

async function validateOfficialBinary(binaryPath: string): Promise<string> {
  const result = await execFileNoThrow(
    binaryPath,
    ['--version'],
    { timeout: 90_000, useCwd: false },
  )
  if (result.code !== 0) {
    throw new Error(`The Qoder runtime could not start: ${result.stderr || result.error || result.stdout}`)
  }
  const version = result.stdout.trim()
  if (!version.includes(QODER_RUNTIME_VERSION)) {
    throw new Error(`Unexpected Qoder runtime version: ${version || 'unknown'}`)
  }
  return version
}

function isAuthenticationFailure(value: string): boolean {
  return [
    'invalid api key',
    'invalid token',
    'invalid personal token',
    'personal token format',
    'not logged in',
    'please run /login',
    'login required',
    'unauthorized',
    'exchangejobtoken failed',
  ].some((fragment) => value.toLowerCase().includes(fragment))
}

export class QoderRuntimeService {
  private readonly runtimeRoot: string
  private readonly downloadsRoot: string
  private readonly configDir: string
  private readonly platform: NodeJS.Platform
  private readonly arch: string
  private readonly platformKey: string | null
  private readonly asset: QoderRuntimeAsset | null
  private readonly fetchImpl: typeof fetch
  private readonly extractArchive: QoderRuntimeOptions['extractArchive']
  private readonly validateBinary: NonNullable<QoderRuntimeOptions['validateBinary']>
  private preparePromise: Promise<string> | null = null
  private readyPath: string | null = null

  constructor(options: QoderRuntimeOptions = {}) {
    this.runtimeRoot = options.runtimeRoot ??
      path.join(getClaudeConfigHomeDir(), '.runtime', 'qoder')
    this.downloadsRoot = path.join(this.runtimeRoot, 'downloads')
    this.configDir = path.join(this.runtimeRoot, 'config')
    this.platform = options.platform ?? process.platform
    this.arch = options.arch ?? process.arch
    const resolvedAsset = resolveQoderRuntimeAsset(this.platform, this.arch)
    this.platformKey = resolvedAsset?.platformKey ?? null
    this.asset = resolvedAsset
    this.fetchImpl = options.fetchImpl ?? fetch
    this.extractArchive = options.extractArchive ?? extractOfficialArchive
    this.validateBinary = options.validateBinary ?? validateOfficialBinary
  }

  getConfigDir(): string {
    return this.configDir
  }

  private managedBinaryPath(): string | null {
    if (!this.platformKey || !this.asset) return null
    return path.join(
      this.runtimeRoot,
      'managed',
      QODER_RUNTIME_VERSION,
      this.platformKey,
      this.asset.binaryName,
    )
  }

  private async explicitBinaryPath(): Promise<string | null> {
    for (const candidate of [
      process.env.CYBER_QODER_PATH,
      process.env.CLI_QODER_BIN,
    ]) {
      const normalized = candidate?.trim()
      if (normalized && await pathExists(normalized)) return normalized
    }
    return null
  }

  async ensureReady(signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    const explicit = await this.explicitBinaryPath()
    if (explicit) return explicit
    if (this.readyPath && await pathExists(this.readyPath)) return this.readyPath

    const managed = this.managedBinaryPath()
    if (!managed || !this.platformKey || !this.asset) {
      throw new Error(
        `Qoder does not provide a compatible runtime for ${this.platform}-${this.arch}`,
      )
    }
    if (await pathExists(managed)) {
      this.readyPath = managed
      return managed
    }

    if (!this.preparePromise) {
      this.preparePromise = this.prepareManagedRuntime(signal)
        .finally(() => {
          this.preparePromise = null
        })
    }
    return this.preparePromise
  }

  private async prepareManagedRuntime(signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    const asset = this.asset!
    const managed = this.managedBinaryPath()!
    const archivePath = path.join(this.downloadsRoot, asset.archiveName)
    const partialPath = `${archivePath}.part`
    await mkdir(this.downloadsRoot, { recursive: true, mode: 0o700 })

    if (await pathExists(archivePath)) {
      const existingChecksum = await sha256File(archivePath, signal)
      if (existingChecksum !== asset.sha256) await rm(archivePath, { force: true })
    }
    if (!(await pathExists(archivePath))) {
      await this.download(`${QODER_RELEASE_ROOT}/${asset.archiveName}`, partialPath, signal)
      const checksum = await sha256File(partialPath, signal)
      if (checksum !== asset.sha256) {
        await rm(partialPath, { force: true })
        throw new Error('Qoder runtime checksum verification failed')
      }
      await rm(archivePath, { force: true })
      await rename(partialPath, archivePath)
    }

    const finalRoot = path.dirname(managed)
    const stagingRoot = `${finalRoot}.preparing-${process.pid}-${Date.now()}`
    await rm(stagingRoot, { recursive: true, force: true })
    await mkdir(stagingRoot, { recursive: true, mode: 0o700 })
    try {
      await this.extractArchive!(archivePath, stagingRoot, this.platform)
      signal?.throwIfAborted()
      const stagedBinary = path.join(stagingRoot, asset.binaryName)
      if (!(await pathExists(stagedBinary))) {
        throw new Error(`Qoder runtime archive did not contain ${asset.binaryName}`)
      }
      if (this.platform !== 'win32') await chmod(stagedBinary, 0o755)
      await this.validateBinary(stagedBinary)
      signal?.throwIfAborted()
      await writeFile(
        path.join(stagingRoot, 'runtime.json'),
        `${JSON.stringify({
          name: 'qodercli',
          version: QODER_RUNTIME_VERSION,
          platform: this.platformKey,
          source: `${QODER_RELEASE_ROOT}/${asset.archiveName}`,
          sha256: asset.sha256,
          license: 'Apache-2.0',
          installedAt: new Date().toISOString(),
        }, null, 2)}\n`,
        { mode: 0o600 },
      )
      await mkdir(path.dirname(finalRoot), { recursive: true, mode: 0o700 })
      await rm(finalRoot, { recursive: true, force: true })
      await rename(stagingRoot, finalRoot)
      await rm(archivePath, { force: true })
      this.readyPath = managed
      return managed
    } catch (error) {
      await rm(stagingRoot, { recursive: true, force: true })
      throw error
    }
  }

  private async download(
    url: string,
    partialPath: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await rm(partialPath, { force: true })
    const controller = new AbortController()
    const onAbort = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', onAbort, { once: true })
    let stallTimer: ReturnType<typeof setTimeout> | undefined
    const resetStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer)
      stallTimer = setTimeout(
        () => controller.abort(new DOMException('Qoder runtime download stalled', 'TimeoutError')),
        DOWNLOAD_STALL_TIMEOUT_MS,
      )
    }

    resetStallTimer()
    try {
      const response = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/octet-stream',
          'Accept-Encoding': 'identity',
          'User-Agent': 'CyberCode/QoderRuntime',
        },
      })
      if (!response.ok || !response.body) {
        throw new Error(`Qoder runtime download failed with HTTP ${response.status}`)
      }
      const handle = await open(partialPath, 'w', 0o600)
      const reader = response.body.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          signal?.throwIfAborted()
          resetStallTimer()
          await handle.write(value)
        }
      } finally {
        await reader.cancel().catch(() => {})
        await handle.close()
      }
    } catch (error) {
      await rm(partialPath, { force: true })
      throw error
    } finally {
      if (stallTimer) clearTimeout(stallTimer)
      signal?.removeEventListener('abort', onAbort)
    }
  }

  private async ensureIsolatedConfig(): Promise<void> {
    await mkdir(this.configDir, { recursive: true, mode: 0o700 })
    const settingsPath = path.join(this.configDir, 'settings.json')
    let settings: Record<string, unknown> = {}
    try {
      settings = JSON.parse(await readFile(settingsPath, 'utf8')) as Record<string, unknown>
    } catch {}
    const general = settings.general &&
      typeof settings.general === 'object' &&
      !Array.isArray(settings.general)
      ? settings.general as Record<string, unknown>
      : {}
    if (general.enableAutoUpdate === false) return
    await writeFile(
      settingsPath,
      `${JSON.stringify({
        ...settings,
        general: { ...general, enableAutoUpdate: false },
      }, null, 2)}\n`,
      { mode: 0o600 },
    )
  }

  async run(options: QoderCliRunOptions): Promise<QoderCliResult> {
    const binary = await this.ensureReady(options.signal)
    await this.ensureIsolatedConfig()
    const result = await execFileNoThrowWithCwd(binary, options.args, {
      abortSignal: options.signal,
      timeout: options.timeoutMs ?? 300_000,
      preserveOutputOnError: true,
      maxBuffer: 24 * 1024 * 1024,
      cwd: options.cwd ?? this.configDir,
      env: {
        ...process.env,
        QODER_PERSONAL_ACCESS_TOKEN: options.token,
        QODER_CONFIG_DIR: this.configDir,
        QODER_CLI_NO_RELAUNCH: '1',
        QODER_INSTALL_SOURCE: 'cybercode',
        NO_BROWSER: '1',
      },
      stdin: 'pipe',
      input: options.input,
    })
    return result
  }

  async validateToken(token: string, signal?: AbortSignal): Promise<string[]> {
    const result = await this.run({
      token,
      args: ['--list-models', '--config-dir', this.configDir],
      signal,
      timeoutMs: 60_000,
    })
    const combined = `${result.stderr}\n${result.stdout}\n${result.error ?? ''}`.trim()
    if (result.code !== 0 || isAuthenticationFailure(combined)) {
      if (isAuthenticationFailure(combined)) {
        throw new Error('Qoder Personal Access Token is invalid or expired')
      }
      throw new Error(`Qoder credential validation failed: ${combined.slice(0, 500)}`)
    }
    const models = result.stdout
      .replaceAll(/\u001b\[[0-9;]*m/g, '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => (
        line.length > 0 &&
        line.toLowerCase() !== 'model' &&
        !/available model keys/i.test(line)
      ))
    if (models.length === 0) {
      throw new Error('Qoder credential validation returned no available models')
    }
    return models
  }
}

export const qoderRuntimeService = new QoderRuntimeService()

export const qoderRuntimeMetadata = {
  version: QODER_RUNTIME_VERSION,
  releaseRoot: QODER_RELEASE_ROOT,
}
