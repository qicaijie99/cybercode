import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  access,
  chmod,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { execFileNoThrow } from '../execFileNoThrow.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'

export type ComputerUseRuntimePhase =
  | 'not-installed'
  | 'checking'
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'ready'
  | 'paused'
  | 'error'

export type ComputerUseRuntimeSource = 'managed' | 'legacy' | null

export type ComputerUseRuntimeStatus = {
  phase: ComputerUseRuntimePhase
  ready: boolean
  version: string | null
  platformKey: string | null
  source: ComputerUseRuntimeSource
  downloadedBytes: number
  totalBytes: number | null
  progressPercent: number
  error: string | null
  canPause: boolean
}

export type ComputerUseRuntimeAsset = {
  filename: string
  sha256: string
  size: number
  pythonPath: string
}

export type ComputerUseRuntimeManifest = {
  schemaVersion: 1
  runtimeVersion: string
  assets: Record<string, ComputerUseRuntimeAsset>
}

type ActiveRuntimePointer = {
  runtimeVersion: string
  platformKey: string
  pythonPath: string
  sha256: string
  installedAt: string
}

type RuntimeManagerOptions = {
  runtimeRoot?: string
  platform?: NodeJS.Platform
  arch?: string
  manifestUrls?: string[]
  fetchImpl?: typeof fetch
  extractArchive?: (archivePath: string, destination: string) => Promise<void>
  validatePython?: (pythonPath: string, platform: NodeJS.Platform) => Promise<string>
}

const RUNTIME_RELEASE_TAG = 'computer-use-runtime-v1'
const RUNTIME_MANIFEST_FILENAME = 'computer-use-runtime-manifest.json'
const GITHUB_RELEASE_ROOT =
  `https://github.com/wk42worldworld/cybercode/releases/download/${RUNTIME_RELEASE_TAG}`
const DEFAULT_MANIFEST_URLS = [
  `${GITHUB_RELEASE_ROOT}/${RUNTIME_MANIFEST_FILENAME}`,
  `https://gh-proxy.com/${GITHUB_RELEASE_ROOT}/${RUNTIME_MANIFEST_FILENAME}`,
  `https://ghfast.top/${GITHUB_RELEASE_ROOT}/${RUNTIME_MANIFEST_FILENAME}`,
]
const MANIFEST_TIMEOUT_MS = 15_000
const DOWNLOAD_STALL_TIMEOUT_MS = 45_000

class RuntimeManagerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'RuntimeManagerError'
  }
}

function runtimePlatformKey(platform: NodeJS.Platform, arch: string): string | null {
  if (platform === 'win32' && arch === 'x64') return 'win32-x64'
  if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64'
  if (platform === 'darwin' && arch === 'x64') return 'darwin-x64'
  if (platform === 'linux' && arch === 'x64') return 'linux-x64'
  return null
}

function getManifestUrls(): string[] {
  const override = process.env.CYBERCODE_COMPUTER_USE_RUNTIME_MANIFEST_URLS
  if (!override) return DEFAULT_MANIFEST_URLS
  return override
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
}

function cloneStatus(status: ComputerUseRuntimeStatus): ComputerUseRuntimeStatus {
  return { ...status }
}

function isBusyPhase(phase: ComputerUseRuntimePhase): boolean {
  return ['checking', 'downloading', 'verifying', 'installing'].includes(phase)
}

function assertSafeManifest(manifest: unknown): asserts manifest is ComputerUseRuntimeManifest {
  if (!manifest || typeof manifest !== 'object') {
    throw new RuntimeManagerError('INVALID_MANIFEST', '运行组件清单格式无效')
  }

  const candidate = manifest as Partial<ComputerUseRuntimeManifest>
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.runtimeVersion !== 'string' ||
    !/^[a-zA-Z0-9._-]+$/.test(candidate.runtimeVersion) ||
    !candidate.assets ||
    typeof candidate.assets !== 'object'
  ) {
    throw new RuntimeManagerError('INVALID_MANIFEST', '运行组件清单缺少必要字段')
  }

  for (const asset of Object.values(candidate.assets)) {
    if (
      !asset ||
      typeof asset.filename !== 'string' ||
      path.basename(asset.filename) !== asset.filename ||
      !/^[a-f0-9]{64}$/i.test(asset.sha256) ||
      typeof asset.size !== 'number' ||
      asset.size <= 0 ||
      typeof asset.pythonPath !== 'string' ||
      asset.pythonPath.length === 0 ||
      path.isAbsolute(asset.pythonPath) ||
      asset.pythonPath.split(/[\\/]+/).includes('..')
    ) {
      throw new RuntimeManagerError('INVALID_MANIFEST', '运行组件资源信息无效')
    }
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
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
      hash.update(chunk as Buffer)
    }
  } finally {
    stream.destroy()
  }
  return hash.digest('hex')
}

function archiveUrl(manifestUrl: string, filename: string): string {
  const separator = manifestUrl.lastIndexOf('/')
  if (separator < 0) throw new RuntimeManagerError('INVALID_URL', '运行组件下载地址无效')
  return `${manifestUrl.slice(0, separator + 1)}${encodeURIComponent(filename)}`
}

function safeArchiveEntries(listing: string): boolean {
  return listing
    .split(/\r?\n/)
    .map(value => value.trim())
    .filter(Boolean)
    .every(entry => {
      const normalized = entry.replace(/\\/g, '/')
      return (
        !normalized.startsWith('/') &&
        !/^[a-zA-Z]:\//.test(normalized) &&
        !normalized.split('/').includes('..')
      )
    })
}

async function extractTarGz(archivePath: string, destination: string): Promise<void> {
  const listing = await execFileNoThrow('tar', ['-tzf', archivePath], { useCwd: false })
  if (listing.code !== 0) {
    throw new RuntimeManagerError(
      'EXTRACT_FAILED',
      `无法读取运行组件压缩包：${listing.stderr || listing.stdout}`,
    )
  }
  if (!safeArchiveEntries(listing.stdout)) {
    throw new RuntimeManagerError('UNSAFE_ARCHIVE', '运行组件压缩包包含不安全路径')
  }

  const extracted = await execFileNoThrow(
    'tar',
    ['-xzf', archivePath, '-C', destination],
    { useCwd: false },
  )
  if (extracted.code !== 0) {
    throw new RuntimeManagerError(
      'EXTRACT_FAILED',
      `解压运行组件失败：${extracted.stderr || extracted.stdout}`,
    )
  }
}

async function validateRuntimePython(
  pythonPath: string,
  platform: NodeJS.Platform,
): Promise<string> {
  const versionResult = await execFileNoThrow(pythonPath, ['--version'], { useCwd: false })
  if (versionResult.code !== 0) {
    throw new RuntimeManagerError(
      'RUNTIME_INVALID',
      `专用运行组件无法启动：${versionResult.stderr || versionResult.stdout}`,
    )
  }

  const imports = platform === 'win32'
    ? 'import mss; from PIL import Image; import pyautogui, win32api, psutil, pyperclip, screeninfo'
    : platform === 'linux'
      ? 'import mss; from PIL import Image; import psutil, pyperclip, screeninfo'
      : 'import mss; from PIL import Image; import pyautogui, Quartz, AppKit'
  const importResult = await execFileNoThrow(pythonPath, ['-c', imports], { useCwd: false })
  if (importResult.code !== 0) {
    throw new RuntimeManagerError(
      'RUNTIME_INVALID',
      `专用运行组件依赖不完整：${importResult.stderr || importResult.stdout}`,
    )
  }

  return `${versionResult.stdout}\n${versionResult.stderr}`.trim()
}

export class ComputerUseRuntimeManager {
  private readonly runtimeRoot: string
  private readonly managedRoot: string
  private readonly downloadsRoot: string
  private readonly activePointerPath: string
  private readonly platform: NodeJS.Platform
  private readonly arch: string
  private readonly platformKey: string | null
  private readonly manifestUrls: string[]
  private readonly fetchImpl: typeof fetch
  private readonly extractArchive: (archivePath: string, destination: string) => Promise<void>
  private readonly validatePython: (pythonPath: string, platform: NodeJS.Platform) => Promise<string>
  private preparePromise: Promise<string> | null = null
  private abortController: AbortController | null = null
  private activePythonPath: string | null = null
  private status: ComputerUseRuntimeStatus

  constructor(options: RuntimeManagerOptions = {}) {
    this.runtimeRoot = options.runtimeRoot ?? path.join(getClaudeConfigHomeDir(), '.runtime')
    this.managedRoot = path.join(this.runtimeRoot, 'managed')
    this.downloadsRoot = path.join(this.runtimeRoot, 'downloads')
    this.activePointerPath = path.join(this.managedRoot, 'active.json')
    this.platform = options.platform ?? process.platform
    this.arch = options.arch ?? process.arch
    this.platformKey = runtimePlatformKey(this.platform, this.arch)
    this.manifestUrls = options.manifestUrls ?? getManifestUrls()
    this.fetchImpl = options.fetchImpl ?? fetch
    this.extractArchive = options.extractArchive ?? extractTarGz
    this.validatePython = options.validatePython ?? validateRuntimePython
    this.status = {
      phase: 'not-installed',
      ready: false,
      version: null,
      platformKey: this.platformKey,
      source: null,
      downloadedBytes: 0,
      totalBytes: null,
      progressPercent: 0,
      error: null,
      canPause: false,
    }
  }

  snapshot(): ComputerUseRuntimeStatus {
    return cloneStatus(this.status)
  }

  private update(patch: Partial<ComputerUseRuntimeStatus>): void {
    this.status = { ...this.status, ...patch }
  }

  async refreshFromDisk(): Promise<ComputerUseRuntimeStatus> {
    if (isBusyPhase(this.status.phase)) return this.snapshot()

    try {
      const pointer = JSON.parse(await readFile(this.activePointerPath, 'utf8')) as ActiveRuntimePointer
      if (
        pointer.platformKey === this.platformKey &&
        /^[a-zA-Z0-9._-]+$/.test(pointer.runtimeVersion) &&
        /^[a-f0-9]{64}$/i.test(pointer.sha256) &&
        typeof pointer.pythonPath === 'string' &&
        !path.isAbsolute(pointer.pythonPath) &&
        !pointer.pythonPath.split(/[\\/]+/).includes('..')
      ) {
        const pythonPath = path.join(
          this.managedRoot,
          pointer.runtimeVersion,
          pointer.platformKey,
          ...pointer.pythonPath.split(/[\\/]+/),
        )
        if (await pathExists(pythonPath)) {
          this.activePythonPath = pythonPath
          this.update({
            phase: 'ready',
            ready: true,
            version: pointer.runtimeVersion,
            source: 'managed',
            progressPercent: 100,
            error: null,
            canPause: false,
          })
          return this.snapshot()
        }
      }
    } catch {}

    this.activePythonPath = null
    if (this.status.phase !== 'paused' && this.status.phase !== 'error') {
      this.update({
        phase: 'not-installed',
        ready: false,
        version: null,
        source: null,
        progressPercent: 0,
        error: null,
        canPause: false,
      })
    }
    return this.snapshot()
  }

  async getReadyPythonPath(): Promise<string | null> {
    await this.refreshFromDisk()
    return this.activePythonPath
  }

  startInBackground(): ComputerUseRuntimeStatus {
    if (!this.preparePromise) {
      this.abortController = new AbortController()
      const preparation = this.prepare(this.abortController.signal)
      // prepare() starts by checking the active pointer asynchronously. Expose
      // a busy state immediately so the first API response always starts UI
      // polling instead of briefly rendering another "Prepare" button.
      this.update({
        phase: 'checking',
        ready: false,
        source: null,
        downloadedBytes: 0,
        totalBytes: null,
        progressPercent: 0,
        error: null,
        canPause: true,
      })
      this.preparePromise = preparation
        .catch(error => {
          if (this.abortController?.signal.aborted) {
            this.update({
              phase: 'paused',
              ready: false,
              error: null,
              canPause: false,
            })
          } else {
            this.update({
              phase: 'error',
              ready: false,
              error: error instanceof Error ? error.message : String(error),
              canPause: false,
            })
          }
          throw error
        })
        .finally(() => {
          this.preparePromise = null
          this.abortController = null
        })
      void this.preparePromise.catch(() => {})
    }
    return this.snapshot()
  }

  async ensureReady(): Promise<string> {
    const existing = await this.getReadyPythonPath()
    if (existing) return existing
    this.startInBackground()
    if (!this.preparePromise) {
      throw new RuntimeManagerError('PREPARE_FAILED', '无法启动运行组件准备任务')
    }
    return this.preparePromise
  }

  async pause(): Promise<ComputerUseRuntimeStatus> {
    let pendingPreparation: Promise<string> | null = null
    if (this.abortController && this.status.canPause) {
      pendingPreparation = this.preparePromise
      this.abortController.abort(new DOMException('Paused', 'AbortError'))
      this.update({
        phase: 'paused',
        ready: false,
        error: null,
        canPause: false,
      })
    }

    // Do not acknowledge the pause until the aborted request has released its
    // file handle and cleared preparePromise. This makes an immediate Resume
    // start a fresh request instead of being swallowed by the old task.
    if (pendingPreparation) await pendingPreparation.catch(() => {})
    return this.snapshot()
  }

  private async prepare(signal: AbortSignal): Promise<string> {
    if (!this.platformKey) {
      throw new RuntimeManagerError(
        'UNSUPPORTED_PLATFORM',
        `当前平台没有可用的 Computer Use 运行组件：${this.platform}-${this.arch}`,
      )
    }

    const existing = await this.getReadyPythonPath()
    if (existing) return existing
    signal.throwIfAborted()

    this.update({
      phase: 'checking',
      ready: false,
      source: null,
      downloadedBytes: 0,
      totalBytes: null,
      progressPercent: 0,
      error: null,
      canPause: true,
    })
    const manifest = await this.fetchManifest(signal)
    const asset = manifest.assets[this.platformKey]
    if (!asset) {
      throw new RuntimeManagerError(
        'NO_RUNTIME_ASSET',
        `运行组件尚未提供 ${this.platformKey} 版本`,
      )
    }

    this.update({
      version: manifest.runtimeVersion,
      totalBytes: asset.size,
    })
    const archivePath = await this.downloadAsset(asset, signal)
    signal.throwIfAborted()

    this.update({
      phase: 'verifying',
      downloadedBytes: asset.size,
      totalBytes: asset.size,
      progressPercent: 100,
      canPause: false,
    })
    const checksum = await sha256File(archivePath, signal)
    if (checksum.toLowerCase() !== asset.sha256.toLowerCase()) {
      await rm(archivePath, { force: true })
      throw new RuntimeManagerError('CHECKSUM_MISMATCH', '运行组件校验失败，请重试下载')
    }

    const pythonPath = await this.installArchive(manifest, asset, archivePath, signal)
    this.activePythonPath = pythonPath
    this.update({
      phase: 'ready',
      ready: true,
      version: manifest.runtimeVersion,
      source: 'managed',
      downloadedBytes: asset.size,
      totalBytes: asset.size,
      progressPercent: 100,
      error: null,
      canPause: false,
    })
    return pythonPath
  }

  private async fetchManifest(signal: AbortSignal): Promise<ComputerUseRuntimeManifest> {
    signal.throwIfAborted()
    const errors: string[] = []
    for (const url of this.manifestUrls) {
      signal.throwIfAborted()
      const controller = new AbortController()
      const onAbort = () => controller.abort(signal.reason)
      signal.addEventListener('abort', onAbort, { once: true })
      const timer = setTimeout(
        () => controller.abort(new DOMException('Manifest request timed out', 'TimeoutError')),
        MANIFEST_TIMEOUT_MS,
      )
      try {
        const response = await this.fetchImpl(url, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const manifest: unknown = await response.json()
        assertSafeManifest(manifest)
        return manifest
      } catch (error) {
        if (signal.aborted) throw signal.reason
        errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
      }
    }
    throw new RuntimeManagerError(
      'MANIFEST_UNAVAILABLE',
      `无法获取 Computer Use 运行组件：${errors.join('；')}`,
    )
  }

  private async downloadAsset(
    asset: ComputerUseRuntimeAsset,
    signal: AbortSignal,
  ): Promise<string> {
    signal.throwIfAborted()
    await mkdir(this.downloadsRoot, { recursive: true })
    await this.cleanupStaleDownloads(asset.filename)
    const archivePath = path.join(this.downloadsRoot, asset.filename)
    const partialPath = `${archivePath}.part`

    if (await pathExists(archivePath)) {
      const checksum = await sha256File(archivePath, signal)
      if (checksum.toLowerCase() === asset.sha256.toLowerCase()) return archivePath
      await rm(archivePath, { force: true })
    }

    const urls = this.manifestUrls.map(url => archiveUrl(url, asset.filename))
    const errors: string[] = []
    for (const url of urls) {
      signal.throwIfAborted()
      try {
        await this.downloadFromUrl(url, partialPath, asset.size, signal)
        const checksum = await sha256File(partialPath, signal)
        if (checksum.toLowerCase() !== asset.sha256.toLowerCase()) {
          await rm(partialPath, { force: true })
          throw new RuntimeManagerError('CHECKSUM_MISMATCH', '下载内容校验失败')
        }
        await rm(archivePath, { force: true })
        await rename(partialPath, archivePath)
        return archivePath
      } catch (error) {
        if (signal.aborted) throw signal.reason
        errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    throw new RuntimeManagerError(
      'DOWNLOAD_FAILED',
      `运行组件下载失败：${errors.join('；')}`,
    )
  }

  private async downloadFromUrl(
    url: string,
    partialPath: string,
    expectedSize: number,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted()
    let downloadedBytes = 0
    try {
      downloadedBytes = (await stat(partialPath)).size
    } catch {}
    if (downloadedBytes > expectedSize) {
      await rm(partialPath, { force: true })
      downloadedBytes = 0
    }
    if (downloadedBytes === expectedSize) {
      this.update({
        phase: 'downloading',
        downloadedBytes,
        totalBytes: expectedSize,
        progressPercent: 100,
        canPause: true,
      })
      return
    }

    const controller = new AbortController()
    const onAbort = () => controller.abort(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    let stallTimer: ReturnType<typeof setTimeout> | undefined
    const resetStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer)
      stallTimer = setTimeout(
        () => controller.abort(new DOMException('Download stalled', 'TimeoutError')),
        DOWNLOAD_STALL_TIMEOUT_MS,
      )
    }
    const cleanupRequest = () => {
      if (stallTimer) clearTimeout(stallTimer)
      signal.removeEventListener('abort', onAbort)
    }

    resetStallTimer()
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/octet-stream',
          'Accept-Encoding': 'identity',
          ...(downloadedBytes > 0 ? { Range: `bytes=${downloadedBytes}-` } : {}),
        },
      })
    } catch (error) {
      cleanupRequest()
      if (signal.aborted) throw signal.reason
      throw error
    }

    if (response.status === 416 && downloadedBytes === expectedSize) {
      cleanupRequest()
      return
    }
    if (!response.ok || !response.body) {
      cleanupRequest()
      throw new Error(`HTTP ${response.status}`)
    }

    const resumed = downloadedBytes > 0 && response.status === 206
    if (downloadedBytes > 0 && !resumed) downloadedBytes = 0
    const handle = await open(partialPath, resumed ? 'a' : 'w').catch(error => {
      cleanupRequest()
      throw error
    })
    const reader = response.body.getReader()

    this.update({
      phase: 'downloading',
      downloadedBytes,
      totalBytes: expectedSize,
      progressPercent: Math.min(Math.round((downloadedBytes / expectedSize) * 100), 100),
      canPause: true,
    })

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        signal.throwIfAborted()
        resetStallTimer()
        await handle.write(value)
        downloadedBytes += value.byteLength
        this.update({
          downloadedBytes,
          progressPercent: Math.min(Math.round((downloadedBytes / expectedSize) * 100), 100),
        })
      }
    } finally {
      cleanupRequest()
      await reader.cancel().catch(() => {})
      await handle.close()
    }

    if (downloadedBytes !== expectedSize) {
      throw new RuntimeManagerError(
        'INCOMPLETE_DOWNLOAD',
        `运行组件下载不完整：${downloadedBytes}/${expectedSize}`,
      )
    }
  }

  private async installArchive(
    manifest: ComputerUseRuntimeManifest,
    asset: ComputerUseRuntimeAsset,
    archivePath: string,
    signal: AbortSignal,
  ): Promise<string> {
    this.update({ phase: 'installing', canPause: false })
    await mkdir(this.managedRoot, { recursive: true })

    const versionRoot = path.join(this.managedRoot, manifest.runtimeVersion)
    const finalRoot = path.join(versionRoot, this.platformKey!)
    const stagingRoot = path.join(
      this.managedRoot,
      `.staging-${manifest.runtimeVersion}-${this.platformKey}-${Date.now()}`,
    )
    await rm(stagingRoot, { recursive: true, force: true })
    await mkdir(stagingRoot, { recursive: true })

    try {
      await this.extractArchive(archivePath, stagingRoot)
      signal.throwIfAborted()
      const stagedPython = path.join(stagingRoot, ...asset.pythonPath.split(/[\\/]+/))
      if (!(await pathExists(stagedPython))) {
        throw new RuntimeManagerError('RUNTIME_INVALID', '运行组件中缺少 Python 可执行文件')
      }
      if (this.platform !== 'win32') await chmod(stagedPython, 0o755).catch(() => {})
      await this.validatePython(stagedPython, this.platform)
      signal.throwIfAborted()

      const pointer: ActiveRuntimePointer = {
        runtimeVersion: manifest.runtimeVersion,
        platformKey: this.platformKey!,
        pythonPath: asset.pythonPath,
        sha256: asset.sha256,
        installedAt: new Date().toISOString(),
      }
      await writeFile(
        path.join(stagingRoot, 'runtime.json'),
        `${JSON.stringify(pointer, null, 2)}\n`,
        'utf8',
      )

      await mkdir(versionRoot, { recursive: true })
      await rm(finalRoot, { recursive: true, force: true })
      await rename(stagingRoot, finalRoot)

      const pointerTemp = `${this.activePointerPath}.tmp`
      await writeFile(pointerTemp, `${JSON.stringify(pointer, null, 2)}\n`, 'utf8')
      await rm(this.activePointerPath, { force: true })
      await rename(pointerTemp, this.activePointerPath)
      await rm(archivePath, { force: true })
      await this.cleanupStaleDownloads()
      await this.cleanupOldVersions(manifest.runtimeVersion)

      return path.join(finalRoot, ...asset.pythonPath.split(/[\\/]+/))
    } catch (error) {
      await rm(stagingRoot, { recursive: true, force: true })
      throw error
    }
  }

  private async cleanupOldVersions(activeVersion: string): Promise<void> {
    let entries
    try {
      entries = await readdir(this.managedRoot, { withFileTypes: true })
    } catch {
      return
    }
    await Promise.all(entries.map(async entry => {
      if (!entry.isDirectory()) return
      if (entry.name === activeVersion) return
      await rm(path.join(this.managedRoot, entry.name), { recursive: true, force: true })
    }))
  }

  private async cleanupStaleDownloads(keepFilename?: string): Promise<void> {
    let entries
    try {
      entries = await readdir(this.downloadsRoot, { withFileTypes: true })
    } catch {
      return
    }
    const keep = keepFilename
      ? new Set([keepFilename, `${keepFilename}.part`])
      : new Set<string>()
    await Promise.all(entries.map(async entry => {
      if (!entry.isFile() || keep.has(entry.name)) return
      await rm(path.join(this.downloadsRoot, entry.name), { force: true })
    }))
  }
}

const sharedRuntimeManager = new ComputerUseRuntimeManager()

export function getComputerUseRuntimeStatus(): ComputerUseRuntimeStatus {
  return sharedRuntimeManager.snapshot()
}

export async function refreshComputerUseRuntimeStatus(): Promise<ComputerUseRuntimeStatus> {
  return sharedRuntimeManager.refreshFromDisk()
}

export function startComputerUseRuntimePreparation(): ComputerUseRuntimeStatus {
  return sharedRuntimeManager.startInBackground()
}

export function pauseComputerUseRuntimePreparation(): Promise<ComputerUseRuntimeStatus> {
  return sharedRuntimeManager.pause()
}

export async function ensureComputerUseManagedRuntime(): Promise<string> {
  return sharedRuntimeManager.ensureReady()
}

export async function getManagedComputerUsePythonPath(): Promise<string | null> {
  return sharedRuntimeManager.getReadyPythonPath()
}
