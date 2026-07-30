import { createHash, randomBytes } from 'node:crypto'
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  statfs,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'
import { homedir } from 'node:os'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import type {
  PortableProjectEntry,
  PortableProjectRegistry,
} from '../../utils/portablePaths.js'
import { sessionService } from './sessionService.js'

export const USB_PORTABLE_DIRECTORY_NAME = 'CyberCode-Portable'
export const USB_PORTABLE_MARKER = '.cybercode-portable'

export type UsbMigrationPlatform =
  | 'macos-arm64'
  | 'macos-x64'
  | 'windows-x64'
  | 'linux-x64'

export type PortableArchiveType = 'app-tar-gz' | 'zip' | 'appimage'

export type PortableReleaseAsset = {
  filename: string
  size: number
  sha256: string
  archiveType: PortableArchiveType
  urls?: string[]
}

export type PortableReleaseManifest = {
  schemaVersion: 1
  version: string
  generatedAt: string
  platforms: Record<UsbMigrationPlatform, PortableReleaseAsset>
}

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
      archiveType: PortableArchiveType
    }>>
  } | null
  releaseError: string | null
}

export type UsbMigrationStage =
  | 'queued'
  | 'preparing'
  | 'config'
  | 'projects'
  | 'applications'
  | 'launchers'
  | 'finalizing'
  | 'cleanup'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type UsbMigrationJob = {
  id: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  stage: UsbMigrationStage
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

export type StartUsbMigrationInput = {
  destinationPath: string
  projectIds?: string[]
  platforms?: UsbMigrationPlatform[]
  includeApplications?: boolean
  replaceExisting?: boolean
}

type ResolvedPortableRelease = {
  manifest: PortableReleaseManifest
  sourceUrl: string
}

export type UsbMigrationServiceOptions = {
  configDir?: string
  discoverProjects?: () => Promise<Array<{
    path: string
    modifiedAt?: string
    sessionCount?: number
  }>>
  fetchImpl?: typeof fetch
  manifestUrls?: string[]
  resolveRelease?: () => Promise<ResolvedPortableRelease | null>
  availableBytes?: (path: string) => Promise<number | null>
  downloadStallTimeoutMs?: number
  now?: () => Date
  idFactory?: () => string
}

type InternalJob = UsbMigrationJob & {
  controller: AbortController
}

type CopyContext = {
  job: InternalJob
  signal: AbortSignal
  advance: (bytes: number) => void
  setCurrentItem: (item: string) => void
}

type TreeCopyScope = 'config' | 'project'

type CopyEntryMetadata = {
  source: string
  destination: string
  mode: number
  atime: Date
  mtime: Date
}

type CopyPlan = {
  directories: CopyEntryMetadata[]
  files: Array<CopyEntryMetadata & { size: number }>
  symlinks: Array<{ source: string; destination: string }>
}

const DEFAULT_MANIFEST_URLS = [
  'https://github.com/wk42worldworld/cybercode/releases/latest/download/portable.json',
  'https://gh-proxy.com/https://github.com/wk42worldworld/cybercode/releases/latest/download/portable.json',
  'https://ghfast.top/https://github.com/wk42worldworld/cybercode/releases/latest/download/portable.json',
]
const MANIFEST_TIMEOUT_MS = 8_000
const DOWNLOAD_STALL_TIMEOUT_MS = 30_000
const SCAN_CACHE_TTL_MS = 20_000
const MIN_FREE_SPACE_RESERVE_BYTES = 256 * 1024 * 1024
const COPY_CONCURRENCY = 4
const CONFIG_CACHE_DIRECTORIES = new Set([
  '.runtime',
  'cache',
  'indexes',
  'logs',
  'shell-snapshots',
  'telemetry',
  'tmp',
])
const PROJECT_GENERATED_DIRECTORIES = new Set([
  '.angular',
  '.cache',
  '.codegraph',
  '.gradle',
  '.mypy_cache',
  '.next',
  '.nuxt',
  '.parcel-cache',
  '.playwright-cli',
  '.pytest_cache',
  '.ruff_cache',
  '.svelte-kit',
  '.tox',
  '.turbo',
  '.venv',
  '__pycache__',
  'build',
  'cmake-build-debug',
  'cmake-build-release',
  'coverage',
  'deriveddata',
  'dist',
  'node_modules',
  'out',
  'pods',
  'target',
  'venv',
])
const VALID_PLATFORMS = new Set<UsbMigrationPlatform>([
  'macos-arm64',
  'macos-x64',
  'windows-x64',
  'linux-x64',
])

export class UsbMigrationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'UsbMigrationError'
  }
}

export class UsbMigrationService {
  private readonly configDir: string
  private readonly discoverProjectsImpl: UsbMigrationServiceOptions['discoverProjects']
  private readonly fetchImpl: typeof fetch
  private readonly manifestUrls: string[]
  private readonly resolveReleaseImpl?: UsbMigrationServiceOptions['resolveRelease']
  private readonly availableBytesImpl: (path: string) => Promise<number | null>
  private readonly downloadStallTimeoutMs: number
  private readonly now: () => Date
  private readonly idFactory: () => string
  private readonly jobs = new Map<string, InternalJob>()
  private scanCache: { at: number; value: UsbMigrationScan; release: ResolvedPortableRelease | null } | null = null

  constructor(options: UsbMigrationServiceOptions = {}) {
    this.configDir = options.configDir ?? getClaudeConfigHomeDir()
    this.discoverProjectsImpl = options.discoverProjects
    this.fetchImpl = options.fetchImpl ?? fetch
    this.manifestUrls = options.manifestUrls ?? DEFAULT_MANIFEST_URLS
    this.resolveReleaseImpl = options.resolveRelease
    this.availableBytesImpl = options.availableBytes ?? availableBytes
    this.downloadStallTimeoutMs = Math.max(
      1,
      options.downloadStallTimeoutMs ?? DOWNLOAD_STALL_TIMEOUT_MS,
    )
    this.now = options.now ?? (() => new Date())
    this.idFactory = options.idFactory ?? (() => randomBytes(12).toString('hex'))
  }

  async scan(force = false): Promise<UsbMigrationScan> {
    if (
      !force
      && this.scanCache
      && Date.now() - this.scanCache.at < SCAN_CACHE_TTL_MS
    ) {
      return this.scanCache.value
    }

    const [configSizeBytes, projects, releaseResult] = await Promise.all([
      measureTree(this.configDir, 'config').catch(() => 0),
      this.discoverProjects(),
      this.resolveRelease()
        .then(release => ({ release, error: null as string | null }))
        .catch(error => ({
          release: null,
          error: error instanceof Error ? error.message : String(error),
        })),
    ])

    const value: UsbMigrationScan = {
      scannedAt: this.now().toISOString(),
      configPath: this.configDir,
      configSizeBytes,
      projects,
      currentPlatform: currentPlatformKey(),
      release: releaseResult.release
        ? releaseSummary(releaseResult.release.manifest)
        : null,
      releaseError: releaseResult.error,
    }
    this.scanCache = {
      at: Date.now(),
      value,
      release: releaseResult.release,
    }
    return value
  }

  async start(input: StartUsbMigrationInput): Promise<UsbMigrationJob> {
    const destinationPath = await this.validateDestination(input.destinationPath)
    const portablePath = resolvePortablePath(destinationPath)
    const scan = await this.scan()
    const selectedProjects = selectProjects(scan.projects, input.projectIds)
    const includeApplications = input.includeApplications !== false
    const selectedPlatforms = includeApplications
      ? normalizePlatforms(input.platforms)
      : []
    const release = includeApplications ? this.scanCache?.release ?? null : null

    if (includeApplications && !release) {
      throw new UsbMigrationError(
        'PORTABLE_RELEASE_UNAVAILABLE',
        '当前 Release 尚未提供跨平台便携运行包，请稍后重试或暂时关闭“包含应用本体”。',
        503,
      )
    }

    const assets = selectedPlatforms.map(platform => {
      const asset = release?.manifest.platforms[platform]
      if (!asset) {
        throw new UsbMigrationError(
          'PLATFORM_ASSET_UNAVAILABLE',
          `当前 Release 缺少 ${platform} 便携运行包。`,
          503,
        )
      }
      return { platform, asset }
    })

    await this.validateSourceBoundaries(destinationPath, portablePath, selectedProjects)
    const exists = await pathExists(portablePath)
    if (exists && !(await isRecognizedPortableBundle(portablePath))) {
      throw new UsbMigrationError(
        'DESTINATION_CONFLICT',
        `${portablePath} 已存在且不是 CyberCode 便携包。`,
        409,
      )
    }
    if (exists && input.replaceExisting !== true) {
      throw new UsbMigrationError(
        'PORTABLE_BUNDLE_EXISTS',
        '目标位置已有 CyberCode 便携包，请确认更新后重试。',
        409,
      )
    }

    const totalBytes = scan.configSizeBytes
      + selectedProjects.reduce((sum, project) => sum + project.sizeBytes, 0)
      + assets.reduce((sum, item) => sum + item.asset.size, 0)
    const freeBytes = await this.availableBytesImpl(destinationPath)
    const requiredBytes = totalBytes + MIN_FREE_SPACE_RESERVE_BYTES
    if (freeBytes !== null && freeBytes < requiredBytes) {
      throw new UsbMigrationError(
        'INSUFFICIENT_SPACE',
        `目标磁盘空间不足，需要至少 ${requiredBytes} 字节，可用 ${freeBytes} 字节。`,
        409,
      )
    }

    const timestamp = this.now().toISOString()
    const job: InternalJob = {
      id: this.idFactory(),
      status: 'queued',
      stage: 'queued',
      destinationPath,
      portablePath,
      currentItem: null,
      processedBytes: 0,
      totalBytes,
      progressPercent: 0,
      warnings: [],
      error: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
      controller: new AbortController(),
    }
    this.jobs.set(job.id, job)
    void this.runJob(job, {
      projects: selectedProjects,
      assets,
      release,
      replaceExisting: input.replaceExisting === true,
    })
    return publicJob(job)
  }

  getJob(jobId: string): UsbMigrationJob {
    const job = this.jobs.get(jobId)
    if (!job) {
      throw new UsbMigrationError('JOB_NOT_FOUND', '迁移任务不存在。', 404)
    }
    return publicJob(job)
  }

  cancel(jobId: string): UsbMigrationJob {
    const job = this.jobs.get(jobId)
    if (!job) {
      throw new UsbMigrationError('JOB_NOT_FOUND', '迁移任务不存在。', 404)
    }
    if (job.status === 'queued' || job.status === 'running') {
      job.controller.abort(new DOMException('Migration cancelled', 'AbortError'))
    }
    return publicJob(job)
  }

  private async discoverProjects(): Promise<UsbMigrationProject[]> {
    const rawProjects = this.discoverProjectsImpl
      ? await this.discoverProjectsImpl()
      : await discoverSessionProjects()
    const [canonicalConfigDir, canonicalHomeDir] = await Promise.all([
      realpath(this.configDir).catch(() => resolve(this.configDir)),
      realpath(homedir()).catch(() => resolve(homedir())),
    ])
    const deduped = new Map<string, {
      path: string
      modifiedAt: string
      sessionCount: number
    }>()

    for (const project of rawProjects) {
      let canonicalPath: string
      try {
        canonicalPath = await realpath(project.path)
        if (!(await stat(canonicalPath)).isDirectory()) continue
      } catch {
        continue
      }
      if (isUnsafeProjectRoot(
        canonicalPath,
        canonicalConfigDir,
        canonicalHomeDir,
      )) continue
      const existing = deduped.get(canonicalPath)
      const modifiedAt = project.modifiedAt ?? ''
      if (!existing) {
        deduped.set(canonicalPath, {
          path: canonicalPath,
          modifiedAt,
          sessionCount: project.sessionCount ?? 1,
        })
      } else {
        existing.sessionCount += project.sessionCount ?? 1
        if (modifiedAt > existing.modifiedAt) existing.modifiedAt = modifiedAt
      }
    }

    const measured = await mapWithConcurrency(
      [...deduped.values()],
      2,
      async project => ({
        id: projectId(project.path),
        name: basename(project.path) || 'project',
        path: project.path,
        sizeBytes: await measureTree(project.path, 'project').catch(() => 0),
        modifiedAt: project.modifiedAt,
        sessionCount: project.sessionCount,
      }),
    )
    return measured.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
  }

  private async resolveRelease(): Promise<ResolvedPortableRelease | null> {
    if (this.resolveReleaseImpl) return this.resolveReleaseImpl()
    if (this.manifestUrls.length === 0) return null

    const attempts = this.manifestUrls.map(async sourceUrl => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), MANIFEST_TIMEOUT_MS)
      try {
        const response = await this.fetchImpl(sourceUrl, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const manifest = validateReleaseManifest(await response.json())
        return { manifest, sourceUrl }
      } finally {
        clearTimeout(timer)
      }
    })

    try {
      return await Promise.any(attempts)
    } catch (error) {
      const message = error instanceof AggregateError
        ? error.errors.map(item => item instanceof Error ? item.message : String(item)).join('; ')
        : error instanceof Error ? error.message : String(error)
      throw new UsbMigrationError(
        'PORTABLE_RELEASE_UNAVAILABLE',
        `无法获取便携运行包清单：${message}`,
        503,
      )
    }
  }

  private async validateDestination(value: string): Promise<string> {
    if (!value?.trim()) {
      throw new UsbMigrationError('DESTINATION_REQUIRED', '请选择 U 盘或移动磁盘目录。')
    }
    const destinationPath = resolve(value.trim())
    let stats
    try {
      stats = await stat(destinationPath)
    } catch {
      throw new UsbMigrationError('DESTINATION_MISSING', '所选目录不存在。')
    }
    if (!stats.isDirectory()) {
      throw new UsbMigrationError('DESTINATION_NOT_DIRECTORY', '所选路径不是目录。')
    }
    return realpath(destinationPath)
  }

  private async validateSourceBoundaries(
    destinationPath: string,
    portablePath: string,
    projects: UsbMigrationProject[],
  ): Promise<void> {
    const sources = [this.configDir, ...projects.map(project => project.path)]
    for (const source of sources) {
      const canonicalSource = await realpath(source).catch(() => resolve(source))
      if (isSameOrWithin(destinationPath, canonicalSource)) {
        throw new UsbMigrationError(
          'DESTINATION_INSIDE_SOURCE',
          `目标目录不能位于待迁移目录内：${canonicalSource}`,
          409,
        )
      }
      if (isSameOrWithin(canonicalSource, portablePath)) {
        throw new UsbMigrationError(
          'SOURCE_INSIDE_DESTINATION',
          `待迁移目录不能位于现有便携包内：${canonicalSource}`,
          409,
        )
      }
    }
  }

  private async runJob(
    job: InternalJob,
    input: {
      projects: UsbMigrationProject[]
      assets: Array<{ platform: UsbMigrationPlatform; asset: PortableReleaseAsset }>
      release: ResolvedPortableRelease | null
      replaceExisting: boolean
    },
  ): Promise<void> {
    const signal = job.controller.signal
    const portableParent = dirname(job.portablePath)
    const stagingPath = join(
      portableParent,
      `.${USB_PORTABLE_DIRECTORY_NAME}.tmp-${job.id}`,
    )
    const backupPath = join(
      portableParent,
      `.${USB_PORTABLE_DIRECTORY_NAME}.backup-${job.id}`,
    )
    let lastCurrentItemUpdate = 0
    const context: CopyContext = {
      job,
      signal,
      advance: bytes => this.advanceJob(job, bytes),
      setCurrentItem: item => {
        const timestamp = Date.now()
        if (timestamp - lastCurrentItemUpdate < 100) return
        lastCurrentItemUpdate = timestamp
        this.updateJob(job, { currentItem: item })
      },
    }
    let existingMoved = false

    try {
      this.updateJob(job, {
        status: 'running',
        stage: 'preparing',
        currentItem: null,
      })
      await rm(stagingPath, { recursive: true, force: true })
      await mkdir(stagingPath, { recursive: true })
      signal.throwIfAborted()

      this.updateJob(job, {
        stage: 'config',
        currentItem: this.configDir,
      })
      const portableConfigDir = join(stagingPath, 'data', 'config')
      if (await pathExists(this.configDir)) {
        await copyTree(this.configDir, portableConfigDir, context, 'config')
      } else {
        await mkdir(portableConfigDir, { recursive: true })
      }

      const registryProjects: PortableProjectEntry[] = []
      this.updateJob(job, { stage: 'projects', currentItem: null })
      for (const project of input.projects) {
        signal.throwIfAborted()
        const relativePath = `projects/${projectSlug(project)}`
        this.updateJob(job, { currentItem: project.path })
        await copyTree(
          project.path,
          join(stagingPath, relativePath),
          context,
          'project',
        )
        registryProjects.push({
          id: project.id,
          name: project.name,
          relativePath,
          originalPaths: [project.path],
        })
      }

      const registry: PortableProjectRegistry = {
        schemaVersion: 1,
        createdAt: this.now().toISOString(),
        projects: registryProjects,
      }
      await mkdir(join(stagingPath, 'data', 'config'), { recursive: true })
      await writeFile(
        join(stagingPath, 'data', 'config', 'portable-projects.json'),
        `${JSON.stringify(registry, null, 2)}\n`,
        { mode: 0o600 },
      )

      this.updateJob(job, { stage: 'applications', currentItem: null })
      const checksums: string[] = []
      for (const { platform, asset } of input.assets) {
        signal.throwIfAborted()
        this.updateJob(job, { currentItem: `${platform}: ${asset.filename}` })
        const packageDir = join(stagingPath, 'packages', platform)
        await mkdir(packageDir, { recursive: true })
        const packagePath = join(packageDir, asset.filename)
        await this.downloadAsset(
          input.release!,
          asset,
          packagePath,
          context,
        )
        checksums.push(`${asset.sha256.toLowerCase()}  packages/${platform}/${asset.filename}`)
      }
      if (checksums.length > 0) {
        await writeFile(join(stagingPath, 'checksums.sha256'), `${checksums.join('\n')}\n`)
      }

      this.updateJob(job, { stage: 'launchers', currentItem: null })
      await writePortableLaunchers(stagingPath)
      await writePortableMetadata(stagingPath, {
        createdAt: this.now().toISOString(),
        releaseVersion: input.release?.manifest.version ?? null,
        projects: registryProjects.map(project => ({
          id: project.id,
          name: project.name,
          relativePath: project.relativePath,
        })),
        platforms: input.assets.map(item => item.platform),
      })

      this.updateJob(job, { stage: 'finalizing', currentItem: job.portablePath })
      signal.throwIfAborted()
      if (input.replaceExisting && await pathExists(job.portablePath)) {
        await rm(backupPath, { recursive: true, force: true })
        await rename(job.portablePath, backupPath)
        existingMoved = true
      }
      await rename(stagingPath, job.portablePath)
      if (existingMoved) {
        this.updateJob(job, {
          stage: 'cleanup',
          currentItem: job.portablePath,
        })
        await rm(backupPath, { recursive: true, force: true })
        existingMoved = false
      }

      this.updateJob(job, {
        status: 'completed',
        stage: 'completed',
        currentItem: null,
        processedBytes: job.totalBytes,
        progressPercent: 100,
        completedAt: this.now().toISOString(),
      })
    } catch (error) {
      await rm(stagingPath, { recursive: true, force: true }).catch(() => {})
      if (existingMoved && !(await pathExists(job.portablePath))) {
        await rename(backupPath, job.portablePath).catch(() => {})
      }
      const cancelled = signal.aborted || (
        error instanceof DOMException && error.name === 'AbortError'
      )
      this.updateJob(job, {
        status: cancelled ? 'cancelled' : 'failed',
        stage: cancelled ? 'cancelled' : 'failed',
        currentItem: null,
        error: cancelled
          ? null
          : error instanceof Error ? error.message : String(error),
        completedAt: this.now().toISOString(),
      })
    }
  }

  private async downloadAsset(
    release: ResolvedPortableRelease,
    asset: PortableReleaseAsset,
    destinationPath: string,
    context: CopyContext,
  ): Promise<void> {
    const urls = asset.urls?.length
      ? asset.urls
      : archiveUrls(release.sourceUrl, asset.filename)
    const errors: string[] = []

    for (const url of urls) {
      context.signal.throwIfAborted()
      const partialPath = `${destinationPath}.part`
      await rm(partialPath, { force: true })
      let attemptDownloaded = 0
      const controller = new AbortController()
      const onAbort = () => controller.abort(context.signal.reason)
      context.signal.addEventListener('abort', onAbort, { once: true })
      let stallTimer: ReturnType<typeof setTimeout> | undefined
      const resetStallTimer = () => {
        if (stallTimer) clearTimeout(stallTimer)
        stallTimer = setTimeout(
          () => controller.abort(
            new DOMException('Download stalled', 'TimeoutError'),
          ),
          this.downloadStallTimeoutMs,
        )
      }
      const cleanupRequest = () => {
        if (stallTimer) clearTimeout(stallTimer)
        context.signal.removeEventListener('abort', onAbort)
      }
      try {
        resetStallTimer()
        const response = await this.fetchImpl(url, {
          signal: controller.signal,
          headers: {
            Accept: 'application/octet-stream',
            'Accept-Encoding': 'identity',
          },
        })
        if (!response.ok || !response.body) {
          throw new Error(`HTTP ${response.status}`)
        }

        const hash = createHash('sha256')
        const handle = await open(partialPath, 'w')
        const reader = response.body.getReader()
        let downloaded = 0
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            context.signal.throwIfAborted()
            resetStallTimer()
            await handle.write(value)
            hash.update(value)
            downloaded += value.byteLength
            attemptDownloaded += value.byteLength
            this.advanceJob(context.job, value.byteLength)
          }
        } finally {
          await reader.cancel().catch(() => {})
          await handle.close()
        }

        if (downloaded !== asset.size) {
          throw new Error(`下载大小不一致：${downloaded}/${asset.size}`)
        }
        if (hash.digest('hex').toLowerCase() !== asset.sha256.toLowerCase()) {
          throw new Error('SHA-256 校验失败')
        }
        await rename(partialPath, destinationPath)
        cleanupRequest()
        return
      } catch (error) {
        cleanupRequest()
        this.advanceJob(context.job, -attemptDownloaded)
        await rm(partialPath, { force: true }).catch(() => {})
        if (context.signal.aborted) throw context.signal.reason
        errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    throw new UsbMigrationError(
      'PACKAGE_DOWNLOAD_FAILED',
      `便携运行包下载失败：${errors.join('; ')}`,
      502,
    )
  }

  private advanceJob(job: InternalJob, bytes: number): void {
    const processedBytes = Math.max(
      0,
      Math.min(job.totalBytes, job.processedBytes + bytes),
    )
    this.updateJob(job, {
      processedBytes,
      progressPercent: job.totalBytes > 0
        ? Math.min(99, Math.round((processedBytes / job.totalBytes) * 100))
        : 0,
    })
  }

  private updateJob(job: InternalJob, patch: Partial<UsbMigrationJob>): void {
    Object.assign(job, patch, { updatedAt: this.now().toISOString() })
  }
}

async function discoverSessionProjects(): Promise<Array<{
  path: string
  modifiedAt: string
  sessionCount: number
}>> {
  const { sessions } = await sessionService.listSessions({
    limit: Number.MAX_SAFE_INTEGER,
  })
  const projects = new Map<string, {
    path: string
    modifiedAt: string
    sessionCount: number
  }>()
  for (const session of sessions) {
    if (session.isTemporary || !session.workDirExists || !session.workDir) continue
    const existing = projects.get(session.workDir)
    if (!existing) {
      projects.set(session.workDir, {
        path: session.workDir,
        modifiedAt: session.modifiedAt,
        sessionCount: 1,
      })
    } else {
      existing.sessionCount += 1
      if (session.modifiedAt > existing.modifiedAt) {
        existing.modifiedAt = session.modifiedAt
      }
    }
  }
  return [...projects.values()]
}

async function measureTree(
  root: string,
  scope: TreeCopyScope,
): Promise<number> {
  let total = 0
  const visit = async (target: string, relativePath: string): Promise<void> => {
    const stats = await lstat(target)
    if (
      relativePath
      && shouldSkipTreeEntry(scope, relativePath, stats.isDirectory())
    ) {
      return
    }
    if (stats.isSymbolicLink()) return
    if (stats.isFile()) {
      total += stats.size
      return
    }
    if (!stats.isDirectory()) return
    const entries = await readdir(target, { withFileTypes: true })
    for (const entry of entries) {
      await visit(
        join(target, entry.name),
        relativePath ? join(relativePath, entry.name) : entry.name,
      )
    }
  }
  await visit(root, '')
  return total
}

async function copyTree(
  source: string,
  destination: string,
  context: CopyContext,
  scope: TreeCopyScope,
): Promise<void> {
  const plan = await createCopyPlan(source, destination, context, scope)
  await mapWithConcurrency(
    plan.directories,
    COPY_CONCURRENCY,
    async entry => {
      context.signal.throwIfAborted()
      await mkdir(entry.destination, { recursive: true })
    },
  )
  await mapWithConcurrency(
    [...plan.files, ...plan.symlinks],
    COPY_CONCURRENCY,
    async entry => {
      context.signal.throwIfAborted()
      context.setCurrentItem(entry.source)
      if ('size' in entry) {
        await copyFile(entry.source, entry.destination)
        await chmod(entry.destination, entry.mode).catch(() => {})
        await utimes(entry.destination, entry.atime, entry.mtime).catch(() => {})
        context.advance(entry.size)
        return
      }

      const target = await readlink(entry.source)
      try {
        await symlink(target, entry.destination)
      } catch (error) {
        context.job.warnings.push(
          `未能复制符号链接 ${entry.source}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    },
  )
  for (const entry of [...plan.directories].reverse()) {
    context.signal.throwIfAborted()
    await chmod(entry.destination, entry.mode).catch(() => {})
    await utimes(entry.destination, entry.atime, entry.mtime).catch(() => {})
  }
}

async function createCopyPlan(
  sourceRoot: string,
  destinationRoot: string,
  context: CopyContext,
  scope: TreeCopyScope,
): Promise<CopyPlan> {
  const plan: CopyPlan = {
    directories: [],
    files: [],
    symlinks: [],
  }
  const visit = async (
    source: string,
    destination: string,
    relativePath: string,
  ): Promise<void> => {
    context.signal.throwIfAborted()
    context.setCurrentItem(source)
    const stats = await lstat(source)
    if (
      relativePath
      && shouldSkipTreeEntry(scope, relativePath, stats.isDirectory())
    ) {
      return
    }
    if (stats.isSymbolicLink()) {
      plan.symlinks.push({ source, destination })
      return
    }
    if (stats.isFile()) {
      plan.files.push({
        source,
        destination,
        size: stats.size,
        mode: stats.mode,
        atime: stats.atime,
        mtime: stats.mtime,
      })
      return
    }
    if (!stats.isDirectory()) {
      context.job.warnings.push(`已跳过不支持的文件类型：${source}`)
      return
    }

    plan.directories.push({
      source,
      destination,
      mode: stats.mode,
      atime: stats.atime,
      mtime: stats.mtime,
    })
    const entries = await readdir(source, { withFileTypes: true })
    for (const entry of entries) {
      await visit(
        join(source, entry.name),
        join(destination, entry.name),
        relativePath ? join(relativePath, entry.name) : entry.name,
      )
    }
  }
  await visit(sourceRoot, destinationRoot, '')
  return plan
}

function shouldSkipTreeEntry(
  scope: TreeCopyScope,
  relativePath: string,
  isDirectory: boolean,
): boolean {
  if (!isDirectory) return false
  const segments = relativePath
    .split(/[\\/]+/)
    .map(segment => segment.toLowerCase())
  if (scope === 'config') {
    return segments.length === 1 && CONFIG_CACHE_DIRECTORIES.has(segments[0]!)
  }
  return segments.some(segment => PROJECT_GENERATED_DIRECTORIES.has(segment))
}

function publicJob(job: InternalJob): UsbMigrationJob {
  const { controller: _controller, ...snapshot } = job
  return {
    ...snapshot,
    warnings: [...snapshot.warnings],
  }
}

function projectId(projectPath: string): string {
  return createHash('sha256').update(projectPath).digest('hex').slice(0, 20)
}

function projectSlug(project: UsbMigrationProject): string {
  const safeName = project.name
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'project'
  return `${safeName}-${project.id.slice(0, 8)}`
}

function normalizePlatforms(
  values: UsbMigrationPlatform[] | undefined,
): UsbMigrationPlatform[] {
  const defaults: UsbMigrationPlatform[] = [
    'macos-arm64',
    'macos-x64',
    'windows-x64',
    'linux-x64',
  ]
  if (values === undefined) return defaults
  const unique = [...new Set(values)]
  if (unique.length === 0 || unique.some(value => !VALID_PLATFORMS.has(value))) {
    throw new UsbMigrationError('INVALID_PLATFORMS', '请选择至少一个受支持的平台。')
  }
  return unique
}

function selectProjects(
  projects: UsbMigrationProject[],
  projectIds: string[] | undefined,
): UsbMigrationProject[] {
  if (projectIds === undefined) return projects
  const requested = new Set(projectIds)
  const selected = projects.filter(project => requested.has(project.id))
  if (selected.length !== requested.size) {
    throw new UsbMigrationError('UNKNOWN_PROJECT', '所选项目已失效，请重新扫描。')
  }
  return selected
}

function currentPlatformKey(): UsbMigrationPlatform | null {
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'macos-arm64' : 'macos-x64'
  }
  if (process.platform === 'win32' && process.arch === 'x64') return 'windows-x64'
  if (process.platform === 'linux' && process.arch === 'x64') return 'linux-x64'
  return null
}

function resolvePortablePath(destinationPath: string): string {
  return basename(destinationPath).toLowerCase() === USB_PORTABLE_DIRECTORY_NAME.toLowerCase()
    ? destinationPath
    : join(destinationPath, USB_PORTABLE_DIRECTORY_NAME)
}

function isSameOrWithin(candidate: string, parent: string): boolean {
  const result = relative(resolve(parent), resolve(candidate))
  return result === ''
    || (!result.startsWith(`..${sep}`) && result !== '..' && !isAbsolute(result))
}

function isUnsafeProjectRoot(
  projectPath: string,
  configDir: string,
  homeDir: string,
): boolean {
  const normalizedProjectPath = resolve(projectPath)
  return (
    dirname(normalizedProjectPath) === normalizedProjectPath
    || normalizedProjectPath === resolve(homeDir)
    || isSameOrWithin(configDir, normalizedProjectPath)
  )
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

async function isRecognizedPortableBundle(target: string): Promise<boolean> {
  try {
    return (await readFile(join(target, USB_PORTABLE_MARKER), 'utf8')).trim() === 'cybercode-portable-v1'
  } catch {
    return false
  }
}

async function availableBytes(target: string): Promise<number | null> {
  try {
    const stats = await statfs(target)
    return Number(stats.bavail) * Number(stats.bsize)
  } catch {
    return null
  }
}

function releaseSummary(manifest: PortableReleaseManifest): UsbMigrationScan['release'] {
  return {
    version: manifest.version,
    generatedAt: manifest.generatedAt,
    platforms: Object.fromEntries(
      Object.entries(manifest.platforms).map(([platform, asset]) => [
        platform,
        {
          filename: asset.filename,
          sizeBytes: asset.size,
          archiveType: asset.archiveType,
        },
      ]),
    ),
  }
}

function validateReleaseManifest(value: unknown): PortableReleaseManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('便携运行包清单格式无效')
  }
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== 1
    || typeof record.version !== 'string'
    || !record.version.trim()
    || typeof record.generatedAt !== 'string'
    || !record.platforms
    || typeof record.platforms !== 'object'
    || Array.isArray(record.platforms)
  ) {
    throw new Error('便携运行包清单缺少必要字段')
  }

  const platforms = {} as Record<UsbMigrationPlatform, PortableReleaseAsset>
  for (const platform of VALID_PLATFORMS) {
    const candidate = (record.platforms as Record<string, unknown>)[platform]
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error(`便携运行包清单缺少 ${platform}`)
    }
    const asset = candidate as Record<string, unknown>
    const archiveType = asset.archiveType
    if (
      typeof asset.filename !== 'string'
      || !asset.filename
      || basename(asset.filename) !== asset.filename
      || typeof asset.size !== 'number'
      || !Number.isSafeInteger(asset.size)
      || asset.size <= 0
      || typeof asset.sha256 !== 'string'
      || !/^[a-f0-9]{64}$/i.test(asset.sha256)
      || !['app-tar-gz', 'zip', 'appimage'].includes(String(archiveType))
    ) {
      throw new Error(`${platform} 便携运行包字段无效`)
    }
    platforms[platform] = {
      filename: asset.filename,
      size: asset.size,
      sha256: asset.sha256.toLowerCase(),
      archiveType: archiveType as PortableArchiveType,
      urls: Array.isArray(asset.urls)
        ? asset.urls.filter((url): url is string =>
          typeof url === 'string' && /^https:\/\//.test(url))
        : undefined,
    }
  }

  return {
    schemaVersion: 1,
    version: record.version,
    generatedAt: record.generatedAt,
    platforms,
  }
}

function archiveUrls(manifestUrl: string, filename: string): string[] {
  const officialManifest = manifestUrl.includes('/https://')
    ? manifestUrl.slice(manifestUrl.indexOf('/https://') + 1)
    : manifestUrl
  const official = officialManifest.replace(/portable\.json(?:\?.*)?$/, filename)
  return [...new Set([
    official,
    `https://gh-proxy.com/${official}`,
    `https://ghfast.top/${official}`,
  ])]
}

async function writePortableMetadata(
  root: string,
  input: {
    createdAt: string
    releaseVersion: string | null
    projects: Array<{ id: string; name: string; relativePath: string }>
    platforms: UsbMigrationPlatform[]
  },
): Promise<void> {
  await writeFile(join(root, USB_PORTABLE_MARKER), 'cybercode-portable-v1\n')
  await writeFile(
    join(root, 'portable.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      ...input,
    }, null, 2)}\n`,
  )
  await writeFile(
    join(root, 'README.txt'),
    [
      'CyberCode Portable',
      '',
      'macOS: double-click Start-CyberCode.command',
      'Windows: double-click Start-CyberCode.cmd',
      'Linux: run ./Start-CyberCode.sh',
      '',
      'The data/config directory contains account credentials and local settings.',
      'Keep this drive secure and eject it only after CyberCode is closed.',
      '',
      'macOS：双击 Start-CyberCode.command',
      'Windows：双击 Start-CyberCode.cmd',
      'Linux：运行 ./Start-CyberCode.sh',
      '',
      'data/config 中包含账号凭据和本地设置，请妥善保管 U 盘，并在退出 CyberCode 后再弹出。',
      '',
    ].join('\n'),
  )
}

async function writePortableLaunchers(root: string): Promise<void> {
  const shellLauncher = `#!/usr/bin/env bash
set -u

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
export CYBER_CONFIG_DIR="$ROOT/data/config"
export CLAUDE_CONFIG_DIR="$CYBER_CONFIG_DIR"
export CYBER_PORTABLE_ROOT="$ROOT"

OS="$(uname -s)"
ARCH="$(uname -m)"

if [ "$OS" = "Darwin" ]; then
  if [ "$ARCH" = "arm64" ]; then
    PLATFORM="macos-arm64"
  else
    PLATFORM="macos-x64"
  fi
  ARCHIVE="$(find "$ROOT/packages/$PLATFORM" -maxdepth 1 -type f -name '*.tar.gz' -print -quit 2>/dev/null)"
  APP_ROOT="$ROOT/apps/$PLATFORM"
  EXECUTABLE="$(find "$APP_ROOT" -type f -path '*/CyberCode.app/Contents/MacOS/*' -print -quit 2>/dev/null)"
  if [ -z "$EXECUTABLE" ]; then
    if [ -z "$ARCHIVE" ]; then
      echo "CyberCode package for $PLATFORM is missing."
      exit 1
    fi
    mkdir -p "$APP_ROOT"
    tar -xzf "$ARCHIVE" -C "$APP_ROOT" || exit 1
    EXECUTABLE="$(find "$APP_ROOT" -type f -path '*/CyberCode.app/Contents/MacOS/*' -print -quit)"
  fi
  if [ -z "$EXECUTABLE" ]; then
    echo "CyberCode executable was not found after extraction."
    exit 1
  fi
  chmod +x "$EXECUTABLE" 2>/dev/null || true
  exec "$EXECUTABLE" "$@"
fi

if [ "$OS" = "Linux" ]; then
  if [ "$ARCH" != "x86_64" ] && [ "$ARCH" != "amd64" ]; then
    echo "This portable bundle currently supports Linux x64."
    exit 1
  fi
  APPIMAGE="$(find "$ROOT/packages/linux-x64" -maxdepth 1 -type f -name '*.AppImage' -print -quit 2>/dev/null)"
  if [ -z "$APPIMAGE" ]; then
    echo "CyberCode AppImage is missing."
    exit 1
  fi
  chmod +x "$APPIMAGE" || exit 1
  APPIMAGE_EXTRACT_AND_RUN=1 exec "$APPIMAGE" "$@"
fi

echo "Unsupported operating system: $OS"
exit 1
`

  const powerShellLauncher = `$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:CYBER_CONFIG_DIR = Join-Path $Root "data\\config"
$env:CLAUDE_CONFIG_DIR = $env:CYBER_CONFIG_DIR
$env:CYBER_PORTABLE_ROOT = $Root

$Package = Get-ChildItem (Join-Path $Root "packages\\windows-x64") -Filter *.zip -File | Select-Object -First 1
if (-not $Package) {
  throw "CyberCode Windows portable package is missing."
}

$AppRoot = Join-Path $Root "apps\\windows-x64"
$Executable = Get-ChildItem $AppRoot -Recurse -Filter *.exe -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match "CyberCode|cybercode-desktop" -and $_.Name -notmatch "sidecar|uninstall" } |
  Select-Object -First 1

if (-not $Executable) {
  New-Item -ItemType Directory -Path $AppRoot -Force | Out-Null
  Expand-Archive -LiteralPath $Package.FullName -DestinationPath $AppRoot -Force
  $Executable = Get-ChildItem $AppRoot -Recurse -Filter *.exe -File |
    Where-Object { $_.Name -match "CyberCode|cybercode-desktop" -and $_.Name -notmatch "sidecar|uninstall" } |
    Select-Object -First 1
}

if (-not $Executable) {
  throw "CyberCode executable was not found after extraction."
}

$LaunchOptions = @{
  FilePath = $Executable.FullName
  WorkingDirectory = $Executable.DirectoryName
}
if ($args.Count -gt 0) {
  $LaunchOptions.ArgumentList = $args
}
Start-Process @LaunchOptions
`

  const cmdLauncher = `@echo off
set SCRIPT_DIR=%~dp0
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%Start-CyberCode.ps1" %*
if errorlevel 1 pause
`

  const shellPath = join(root, 'Start-CyberCode.sh')
  const commandPath = join(root, 'Start-CyberCode.command')
  await writeFile(shellPath, shellLauncher)
  await writeFile(commandPath, shellLauncher)
  await writeFile(join(root, 'Start-CyberCode.ps1'), powerShellLauncher)
  await writeFile(join(root, 'Start-CyberCode.cmd'), cmdLauncher)
  await chmod(shellPath, 0o755).catch(() => {})
  await chmod(commandPath, 0o755).catch(() => {})
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let cursor = 0
  let failed = false
  let failure: unknown
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), values.length) },
    async () => {
      while (cursor < values.length && !failed) {
        const index = cursor
        cursor += 1
        try {
          results[index] = await mapper(values[index]!)
        } catch (error) {
          failed = true
          failure = error
        }
      }
    },
  )
  await Promise.all(workers)
  if (failed) throw failure
  return results
}

export const usbMigrationService = new UsbMigrationService()
