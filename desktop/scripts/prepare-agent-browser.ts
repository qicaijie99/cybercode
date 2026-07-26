import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { chmod, copyFile, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const AGENT_BROWSER_VERSION = '0.33.0'
const AGENT_BROWSER_TAG = `v${AGENT_BROWSER_VERSION}`
const CHECKSUMS: Record<string, string> = {
  'agent-browser-darwin-arm64': 'd12b70c42e9816c8f44642df6c60c41ccc0b6f34d73f3cf891a5da14045b80e9',
  'agent-browser-darwin-x64': 'bfa163965806bc2684763a8575ebcdfa2e702001d3733d4a10b10113c53e7ba8',
  'agent-browser-linux-x64': 'b77d85eb8d0d305be4170f9477c59f0304b3609dc39bf0e8b8c740a1abd1e08a',
  'agent-browser-win32-x64.exe': '2033bf28c66e3652b0e4dfe4fd07ba05c22a7678e89185d14c407230659bcc08',
}

const desktopRoot = path.resolve(import.meta.dir, '..')
const resourceDir = path.join(desktopRoot, 'src-tauri', 'resources', 'agent-browser')
const binariesDir = path.join(desktopRoot, 'src-tauri', 'binaries')
const targetTriple = process.env.TAURI_ENV_TARGET_TRIPLE || process.env.CARGO_BUILD_TARGET || ''
const assetName = assetForTarget(targetTriple)
const expectedChecksum = CHECKSUMS[assetName]
const binaryName = targetTriple.includes('windows') ? 'agent-browser.exe' : 'agent-browser'
const externalBinaryPath = path.join(
  binariesDir,
  `agent-browser-${targetTriple}${targetTriple.includes('windows') ? '.exe' : ''}`,
)
const releaseBase =
  `https://github.com/vercel-labs/agent-browser/releases/download/${AGENT_BROWSER_TAG}`

await prepareRuntime()

async function prepareRuntime() {
  if (hasReusableRuntime()) {
    await stageExternalBinary()
    console.log(
      `[prepare-agent-browser] reusing agent-browser ${AGENT_BROWSER_VERSION} for ${targetTriple}`,
    )
    return
  }

  const temporaryDir = `${resourceDir}.preparing-${process.pid}-${Date.now()}`
  const backupDir = `${resourceDir}.backup-${process.pid}-${Date.now()}`

  await rm(temporaryDir, { recursive: true, force: true })
  await rm(backupDir, { recursive: true, force: true })
  await mkdir(temporaryDir, { recursive: true })

  try {
    await writeFile(path.join(temporaryDir, '.gitignore'), '*\n!.gitignore\n')

    const binary = await download(`${releaseBase}/${assetName}`)
    const actualChecksum = createHash('sha256').update(binary).digest('hex')
    if (actualChecksum !== expectedChecksum) {
      throw new Error(
        `[prepare-agent-browser] checksum mismatch for ${assetName}: expected ${expectedChecksum}, got ${actualChecksum}`,
      )
    }

    const binaryPath = path.join(temporaryDir, binaryName)
    await writeFile(binaryPath, binary)
    if (!targetTriple.includes('windows')) await chmod(binaryPath, 0o755)

    const license = await download(
      `https://raw.githubusercontent.com/vercel-labs/agent-browser/${AGENT_BROWSER_TAG}/LICENSE`,
    )
    await writeFile(path.join(temporaryDir, 'LICENSE'), license)
    await writeFile(
      path.join(temporaryDir, 'manifest.json'),
      `${JSON.stringify(
        {
          name: 'agent-browser',
          version: AGENT_BROWSER_VERSION,
          source: 'https://github.com/vercel-labs/agent-browser',
          license: 'Apache-2.0',
          targetTriple,
          asset: assetName,
          sha256: actualChecksum,
        },
        null,
        2,
      )}\n`,
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
    await stageExternalBinary()
    console.log(
      `[prepare-agent-browser] agent-browser ${AGENT_BROWSER_VERSION} prepared for ${targetTriple}`,
    )
  } finally {
    await rm(temporaryDir, { recursive: true, force: true })
    await rm(backupDir, { recursive: true, force: true })
  }
}

async function stageExternalBinary() {
  const sourcePath = path.join(resourceDir, binaryName)
  const temporaryPath = `${externalBinaryPath}.preparing-${process.pid}-${Date.now()}`

  await mkdir(binariesDir, { recursive: true })
  await rm(temporaryPath, { force: true })

  try {
    await copyFile(sourcePath, temporaryPath)
    if (!targetTriple.includes('windows')) await chmod(temporaryPath, 0o755)
    await rm(externalBinaryPath, { force: true })
    await rename(temporaryPath, externalBinaryPath)
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

function hasReusableRuntime() {
  const binaryPath = path.join(resourceDir, binaryName)
  const manifestPath = path.join(resourceDir, 'manifest.json')
  if (!existsSync(binaryPath) || !existsSync(manifestPath)) return false

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      version?: string
      targetTriple?: string
      sha256?: string
    }
    const binaryChecksum = createHash('sha256')
      .update(readFileSync(binaryPath))
      .digest('hex')
    return (
      manifest.version === AGENT_BROWSER_VERSION &&
      manifest.targetTriple === targetTriple &&
      manifest.sha256 === expectedChecksum &&
      binaryChecksum === expectedChecksum
    )
  } catch {
    return false
  }
}

async function download(url: string) {
  try {
    const response = await fetch(url, { redirect: 'follow' })
    if (!response.ok) {
      throw new Error(
        `[prepare-agent-browser] download failed (${response.status}): ${url}`,
      )
    }
    return Buffer.from(await response.arrayBuffer())
  } catch (error) {
    console.warn(
      `[prepare-agent-browser] Bun download failed; retrying with curl: ${errorMessage(error)}`,
    )
    return downloadWithCurl(url)
  }
}

async function downloadWithCurl(url: string) {
  const process = Bun.spawn(
    ['curl', '--fail', '--location', '--silent', '--show-error', url],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const bodyPromise = new Response(process.stdout).arrayBuffer()
  const errorPromise = new Response(process.stderr).text()
  const exitCode = await process.exited
  const [body, stderr] = await Promise.all([bodyPromise, errorPromise])
  if (exitCode !== 0) {
    throw new Error(
      `[prepare-agent-browser] curl download failed (exit ${exitCode}): ${stderr.trim() || url}`,
    )
  }
  return Buffer.from(body)
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function assetForTarget(triple: string) {
  if (triple === 'aarch64-apple-darwin') return 'agent-browser-darwin-arm64'
  if (triple === 'x86_64-apple-darwin') return 'agent-browser-darwin-x64'
  if (triple === 'x86_64-unknown-linux-gnu') return 'agent-browser-linux-x64'
  if (triple === 'x86_64-pc-windows-msvc') return 'agent-browser-win32-x64.exe'
  throw new Error(
    `[prepare-agent-browser] unsupported target triple: ${triple || '(empty)'}`,
  )
}
