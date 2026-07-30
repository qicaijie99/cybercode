import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

type RuntimeAsset = {
  filename: string
  sha256: string
  size: number
  pythonPath: string
}

type RuntimeManifest = {
  schemaVersion: 1
  runtimeVersion: string
  assets: Record<string, RuntimeAsset>
}

const RUNTIME_RELEASE_TAG =
  process.env.CYBERCODE_COMPUTER_USE_RUNTIME_TAG || 'computer-use-runtime-v1'
const RUNTIME_MANIFEST_FILENAME = 'computer-use-runtime-manifest.json'
const GITHUB_RELEASE_ROOT =
  `https://github.com/wk42worldworld/cybercode/releases/download/${RUNTIME_RELEASE_TAG}`
const DEFAULT_MANIFEST_URLS = [
  `${GITHUB_RELEASE_ROOT}/${RUNTIME_MANIFEST_FILENAME}`,
  `https://gh-proxy.com/${GITHUB_RELEASE_ROOT}/${RUNTIME_MANIFEST_FILENAME}`,
  `https://ghfast.top/${GITHUB_RELEASE_ROOT}/${RUNTIME_MANIFEST_FILENAME}`,
]

const desktopRoot = path.resolve(import.meta.dir, '..')
const resourceDir = path.join(
  desktopRoot,
  'src-tauri',
  'resources',
  'computer-use-runtime',
)
const targetTriple = process.env.TAURI_ENV_TARGET_TRIPLE || process.env.CARGO_BUILD_TARGET || ''
const embedRuntime = process.env.CYBERCODE_EMBED_COMPUTER_USE_RUNTIME === '1'

await prepareRuntime()

async function prepareRuntime() {
  if (!embedRuntime) {
    await rm(resourceDir, { recursive: true, force: true })
    await mkdir(resourceDir, { recursive: true })
    await writeFile(path.join(resourceDir, '.gitignore'), '*\n!.gitignore\n')
    console.log('[prepare-computer-use-runtime] embedding disabled; runtime will download on demand')
    return
  }

  await mkdir(resourceDir, { recursive: true })
  await writeFile(path.join(resourceDir, '.gitignore'), '*\n!.gitignore\n')

  const platformKey = platformKeyForTarget(targetTriple)
  const { manifest } = await fetchManifest()
  const asset = manifest.assets[platformKey]
  if (!asset) {
    throw new Error(
      `[prepare-computer-use-runtime] runtime manifest does not contain ${platformKey}`,
    )
  }

  if (hasReusableRuntime(manifest.runtimeVersion, platformKey, asset)) {
    console.log(
      `[prepare-computer-use-runtime] reusing bundled Computer Use runtime ${manifest.runtimeVersion} for ${platformKey}`,
    )
    return
  }

  const temporaryDir = `${resourceDir}.preparing-${process.pid}-${Date.now()}`
  const backupDir = `${resourceDir}.backup-${process.pid}-${Date.now()}`
  const archivePath = path.join(temporaryDir, asset.filename)

  await rm(temporaryDir, { recursive: true, force: true })
  await rm(backupDir, { recursive: true, force: true })
  await mkdir(temporaryDir, { recursive: true })

  try {
    await writeFile(path.join(temporaryDir, '.gitignore'), '*\n!.gitignore\n')
    const archive = await downloadFirstAvailable(
      manifestUrls().map(url => archiveUrl(url, asset.filename)),
    )
    const checksum = createHash('sha256').update(archive).digest('hex')
    if (checksum.toLowerCase() !== asset.sha256.toLowerCase()) {
      throw new Error(
        `[prepare-computer-use-runtime] checksum mismatch for ${asset.filename}: expected ${asset.sha256}, got ${checksum}`,
      )
    }
    if (archive.byteLength !== asset.size) {
      throw new Error(
        `[prepare-computer-use-runtime] size mismatch for ${asset.filename}: expected ${asset.size}, got ${archive.byteLength}`,
      )
    }

    await writeFile(archivePath, archive)
    await writeFile(
      path.join(temporaryDir, 'manifest.json'),
      `${JSON.stringify(
        {
          name: 'computer-use-runtime',
          format: 'archive-v1',
          version: manifest.runtimeVersion,
          source: GITHUB_RELEASE_ROOT,
          targetTriple,
          platformKey,
          asset: asset.filename,
          sha256: asset.sha256,
          size: asset.size,
          pythonPath: asset.pythonPath,
          available: true,
        },
        null,
        2,
      )}\n`,
      'utf8',
    )

    if (existsSync(resourceDir)) await rename(resourceDir, backupDir)
    try {
      await rename(temporaryDir, resourceDir)
    } catch (error) {
      if (!existsSync(resourceDir) && existsSync(backupDir)) {
        await rename(backupDir, resourceDir)
      }
      throw error
    }
    await rm(backupDir, { recursive: true, force: true })
    console.log(
      `[prepare-computer-use-runtime] bundled Computer Use runtime ${manifest.runtimeVersion} for ${platformKey}`,
    )
  } finally {
    await rm(temporaryDir, { recursive: true, force: true })
    await rm(backupDir, { recursive: true, force: true })
  }
}

function platformKeyForTarget(triple: string): string {
  if (triple === 'aarch64-apple-darwin') return 'darwin-arm64'
  if (triple === 'x86_64-apple-darwin') return 'darwin-x64'
  if (triple === 'x86_64-pc-windows-msvc') return 'win32-x64'
  if (triple === 'x86_64-unknown-linux-gnu') return 'linux-x64'
  throw new Error(
    `[prepare-computer-use-runtime] unsupported target triple: ${triple || '(empty)'}`,
  )
}

function manifestUrls(): string[] {
  const override = process.env.CYBERCODE_COMPUTER_USE_RUNTIME_MANIFEST_URLS
  if (!override) return DEFAULT_MANIFEST_URLS
  return override
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
}

async function fetchManifest(): Promise<{ manifest: RuntimeManifest; url: string }> {
  const errors: string[] = []
  for (const url of manifestUrls()) {
    try {
      const body = await download(url)
      const manifest = JSON.parse(body.toString('utf8')) as unknown
      assertSafeManifest(manifest)
      return { manifest, url }
    } catch (error) {
      errors.push(`${url}: ${errorMessage(error)}`)
    }
  }
  throw new Error(
    `[prepare-computer-use-runtime] unable to fetch runtime manifest: ${errors.join('; ')}`,
  )
}

function assertSafeManifest(manifest: unknown): asserts manifest is RuntimeManifest {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('[prepare-computer-use-runtime] invalid runtime manifest')
  }
  const candidate = manifest as Partial<RuntimeManifest>
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.runtimeVersion !== 'string' ||
    !/^[a-zA-Z0-9._-]+$/.test(candidate.runtimeVersion) ||
    !candidate.assets ||
    typeof candidate.assets !== 'object'
  ) {
    throw new Error('[prepare-computer-use-runtime] runtime manifest is missing required fields')
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
      throw new Error('[prepare-computer-use-runtime] runtime manifest contains an unsafe asset')
    }
  }
}

function archiveUrl(manifestUrl: string, filename: string): string {
  const separator = manifestUrl.lastIndexOf('/')
  if (separator < 0) throw new Error('[prepare-computer-use-runtime] invalid manifest URL')
  return `${manifestUrl.slice(0, separator + 1)}${encodeURIComponent(filename)}`
}

async function downloadFirstAvailable(urls: string[]): Promise<Buffer> {
  const errors: string[] = []
  for (const url of urls) {
    try {
      return await download(url)
    } catch (error) {
      errors.push(`${url}: ${errorMessage(error)}`)
    }
  }
  throw new Error(
    `[prepare-computer-use-runtime] unable to download runtime archive: ${errors.join('; ')}`,
  )
}

async function download(url: string): Promise<Buffer> {
  try {
    const response = await fetch(url, { redirect: 'follow' })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    return Buffer.from(await response.arrayBuffer())
  } catch (error) {
    console.warn(
      `[prepare-computer-use-runtime] Bun download failed; retrying with curl: ${errorMessage(error)}`,
    )
    return downloadWithCurl(url)
  }
}

async function downloadWithCurl(url: string): Promise<Buffer> {
  const process = Bun.spawn(
    ['curl', '--fail', '--location', '--silent', '--show-error', url],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const bodyPromise = new Response(process.stdout).arrayBuffer()
  const errorPromise = new Response(process.stderr).text()
  const exitCode = await process.exited
  const [body, stderr] = await Promise.all([bodyPromise, errorPromise])
  if (exitCode !== 0) {
    throw new Error(`curl failed with exit ${exitCode}: ${stderr.trim() || url}`)
  }
  return Buffer.from(body)
}

function hasReusableRuntime(version: string, platformKey: string, asset: RuntimeAsset): boolean {
  const manifestPath = path.join(resourceDir, 'manifest.json')
  const archivePath = path.join(resourceDir, asset.filename)
  if (!existsSync(manifestPath) || !existsSync(archivePath)) return false

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      name?: string
      format?: string
      version?: string
      targetTriple?: string
      platformKey?: string
      asset?: string
      sha256?: string
      size?: number
      pythonPath?: string
      available?: boolean
    }
    const archiveStat = statSync(archivePath)
    return (
      manifest.name === 'computer-use-runtime' &&
      manifest.format === 'archive-v1' &&
      manifest.available === true &&
      manifest.version === version &&
      manifest.targetTriple === targetTriple &&
      manifest.platformKey === platformKey &&
      manifest.asset === asset.filename &&
      manifest.sha256 === asset.sha256 &&
      manifest.size === asset.size &&
      manifest.pythonPath === asset.pythonPath &&
      archiveStat.isFile() &&
      archiveStat.size === asset.size
    )
  } catch {
    return false
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
