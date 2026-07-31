import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { detectHostTriple } from './sidecarTarget'

const desktopRoot = path.resolve(import.meta.dir, '..')
const repoRoot = path.resolve(desktopRoot, '..')
const targetTriple =
  process.env.TAURI_ENV_TARGET_TRIPLE ||
  process.env.CARGO_BUILD_TARGET ||
  (await detectHostTriple(repoRoot))
const executableBase = path.join(
  desktopRoot,
  'src-tauri',
  'binaries',
  `cybercode-sidecar-${targetTriple}`,
)
const executable = [executableBase, `${executableBase}.exe`].find(existsSync)

if (!executable) {
  throw new Error(`[sidecar-smoke] Missing sidecar executable: ${executableBase}`)
}

const temporaryHome = await mkdtemp(path.join(tmpdir(), 'cybercode-sidecar-smoke-'))
const codeGraphAssetDir = path.join(desktopRoot, 'src-tauri', 'resources', 'codegraph')
const computerUseRuntimeDir = path.join(
  desktopRoot,
  'src-tauri',
  'resources',
  'computer-use-runtime',
)
await smokeTestFreshCodeGraphIndex(executable, temporaryHome, codeGraphAssetDir)
const port = await reserveLocalPort()
const authToken = 'cybercode-release-smoke-test'
const child = Bun.spawn(
  [
    executable,
    'server',
    '--auth-required',
    '--app-root',
    repoRoot,
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
  ],
  {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: temporaryHome,
      USERPROFILE: temporaryHome,
      CYBER_CONFIG_DIR: path.join(temporaryHome, '.cyber'),
      CLAUDE_CONFIG_DIR: path.join(temporaryHome, '.cyber'),
      SERVER_AUTH_TOKEN: authToken,
      CYBER_COMPUTER_USE_RUNTIME_ROOT: computerUseRuntimeDir,
      // A release smoke test must prove the bundled runtime works offline.
      CYBERCODE_COMPUTER_USE_RUNTIME_MANIFEST_URLS:
        'http://127.0.0.1:9/computer-use-runtime-manifest.json',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  },
)

const stdoutPromise = new Response(child.stdout).text()
const stderrPromise = new Response(child.stderr).text()
let exited = false
let exitCode: number | null = null
const exitPromise = child.exited.then(code => {
  exited = true
  exitCode = code
  return code
})
let healthy = false
let computerUseFailure: string | null = null

try {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline && !exited) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(750),
      })
      if (response.ok) {
        const payload = (await response.json()) as { status?: string }
        healthy = payload.status === 'ok'
        if (healthy) break
      }
    } catch {
      // The server is still importing its bundled modules.
    }
    await Bun.sleep(150)
  }

  if (healthy) {
    try {
      await smokeTestBundledComputerUseRuntime(port, authToken)
    } catch (error) {
      computerUseFailure = error instanceof Error ? error.message : String(error)
    }
  }
} finally {
  if (!exited) child.kill()
  await exitPromise
  await rm(temporaryHome, { recursive: true, force: true })
}

const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise])
if (!healthy || computerUseFailure) {
  const failureSummary = healthy
    ? '[sidecar-smoke] Bundled Computer Use runtime validation failed'
    : `[sidecar-smoke] Server failed to become healthy (exit ${exitCode ?? 'unknown'})`
  throw new Error(
    [
      failureSummary,
      computerUseFailure
        ? `[computer-use]\n${computerUseFailure}`
        : '',
      stdout.trim() ? `[stdout]\n${stdout.trim()}` : '',
      stderr.trim() ? `[stderr]\n${stderr.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
  )
}

console.log(
  `[sidecar-smoke] ${targetTriple} fresh Code Graph index, /health, and offline Computer Use runtime succeeded`,
)

async function smokeTestBundledComputerUseRuntime(port: number, authToken: string) {
  const runtimeUrl = `http://127.0.0.1:${port}/api/computer-use/runtime`
  const statusUrl = `http://127.0.0.1:${port}/api/computer-use/status`
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${authToken}`,
  }

  const unauthorized = await fetch(runtimeUrl, {
    signal: AbortSignal.timeout(5_000),
  })
  if (unauthorized.status !== 401) {
    throw new Error(
      `Computer Use runtime endpoint accepted an unauthenticated request (HTTP ${unauthorized.status})`,
    )
  }

  const start = await fetch(runtimeUrl, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(10_000),
  })
  if (!start.ok) {
    throw new Error(
      `Computer Use runtime preparation failed to start (HTTP ${start.status}): ${await start.text()}`,
    )
  }

  const deadline = Date.now() + 180_000
  let lastRuntime: {
    phase?: string
    ready?: boolean
    source?: string | null
    error?: string | null
  } = {}

  while (Date.now() < deadline) {
    const response = await fetch(runtimeUrl, {
      headers,
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) {
      throw new Error(
        `Computer Use runtime status failed (HTTP ${response.status}): ${await response.text()}`,
      )
    }
    lastRuntime = await response.json()
    if (lastRuntime.ready) break
    if (lastRuntime.phase === 'error') {
      throw new Error(lastRuntime.error || 'Computer Use runtime entered the error state')
    }
    await Bun.sleep(250)
  }

  if (!lastRuntime.ready) {
    throw new Error(
      `Computer Use runtime did not become ready: ${JSON.stringify(lastRuntime)}`,
    )
  }

  const statusResponse = await fetch(statusUrl, {
    headers,
    signal: AbortSignal.timeout(30_000),
  })
  if (!statusResponse.ok) {
    throw new Error(
      `Computer Use environment status failed (HTTP ${statusResponse.status}): ${await statusResponse.text()}`,
    )
  }
  const status = (await statusResponse.json()) as {
    supported?: boolean
    runtime?: { ready?: boolean; source?: string | null }
    python?: { installed?: boolean; version?: string | null }
    dependencies?: { installed?: boolean }
  }
  if (
    status.supported !== true ||
    status.runtime?.ready !== true ||
    status.python?.installed !== true ||
    !status.python.version ||
    status.dependencies?.installed !== true
  ) {
    throw new Error(`Computer Use environment is incomplete: ${JSON.stringify(status)}`)
  }
}

async function smokeTestFreshCodeGraphIndex(
  sidecarExecutable: string,
  temporaryRoot: string,
  assetDir: string,
) {
  const projectPath = path.join(temporaryRoot, 'fresh-codegraph-project')
  await mkdir(projectPath, { recursive: true })
  await writeFile(
    path.join(projectPath, 'main.ts'),
    'export function greet(name: string) { return `Hello, ${name}` }\n',
  )

  const child = Bun.spawn(
    [sidecarExecutable, 'codegraph', 'index', '--project', projectPath, '--rebuild'],
    {
      cwd: projectPath,
      env: {
        ...process.env,
        CYBER_CODEGRAPH_ASSET_DIR: assetDir,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const stdoutPromise = new Response(child.stdout).text()
  const stderrPromise = new Response(child.stderr).text()
  const timeout = setTimeout(() => child.kill(), 30_000)
  const exitCode = await child.exited
  clearTimeout(timeout)
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise])
  const completed = stdout
    .split('\n')
    .filter(Boolean)
    .some((line) => {
      try {
        const event = JSON.parse(line) as { type?: string; success?: boolean }
        return event.type === 'complete' && event.success === true
      } catch {
        return false
      }
    })

  if (exitCode !== 0 || !completed || !existsSync(path.join(projectPath, '.codegraph', 'codegraph.db'))) {
    await rm(temporaryRoot, { recursive: true, force: true })
    throw new Error(
      [
        `[sidecar-smoke] Fresh Code Graph index failed (exit ${exitCode})`,
        stdout.trim() ? `[stdout]\n${stdout.trim()}` : '',
        stderr.trim() ? `[stderr]\n${stderr.trim()}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    )
  }
}

async function reserveLocalPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('[sidecar-smoke] Could not reserve a local port'))
        return
      }
      server.close(error => {
        if (error) reject(error)
        else resolve(address.port)
      })
    })
  })
}
