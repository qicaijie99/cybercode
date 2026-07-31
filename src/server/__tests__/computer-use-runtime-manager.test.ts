import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  ComputerUseRuntimeManager,
  type ComputerUseRuntimeManifest,
} from '../../utils/computerUse/runtimeManager.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'cybercode-computer-use-runtime-'))
  roots.push(root)
  return root
}

function manifestFor(bytes: Uint8Array): ComputerUseRuntimeManifest {
  return {
    schemaVersion: 1,
    runtimeVersion: 'test-v1',
    assets: {
      'win32-x64': {
        filename: 'computer-use-runtime-win32-x64.tar.gz',
        sha256: createHash('sha256').update(bytes).digest('hex'),
        size: bytes.byteLength,
        pythonPath: 'python/python.exe',
      },
    },
  }
}

function encodeBundledPayload(archive: Uint8Array): Uint8Array {
  return Uint8Array.from(archive, byte => byte ^ 0xa5)
}

async function fakeExtract(_archivePath: string, destination: string): Promise<void> {
  await mkdir(path.join(destination, 'python'), { recursive: true })
  await writeFile(path.join(destination, 'python', 'python.exe'), 'fake python')
}

async function writeActiveRuntime(
  root: string,
  runtimeVersion: string,
  platformKey = 'win32-x64',
): Promise<string> {
  const pythonPath = path.join(
    root,
    'managed',
    runtimeVersion,
    platformKey,
    'python',
    'python.exe',
  )
  await mkdir(path.dirname(pythonPath), { recursive: true })
  await writeFile(pythonPath, 'fake python')
  await writeFile(
    path.join(root, 'managed', 'active.json'),
    `${JSON.stringify(
      {
        runtimeVersion,
        platformKey,
        pythonPath: 'python/python.exe',
        sha256: 'a'.repeat(64),
        installedAt: '2026-07-30T00:00:00.000Z',
      },
      null,
      2,
    )}\n`,
  )
  return pythonPath
}

describe('ComputerUseRuntimeManager', () => {
  test('selects the bundled Linux x64 runtime', () => {
    const manager = new ComputerUseRuntimeManager({
      platform: 'linux',
      arch: 'x64',
      runtimeRoot: '/tmp/cybercode-runtime-platform-test',
    })

    expect(manager.snapshot().platformKey).toBe('linux-x64')
  })

  test('downloads, verifies and atomically activates a private runtime', async () => {
    const root = await makeRoot()
    const archive = new TextEncoder().encode('portable-runtime')
    const manifest = manifestFor(archive)
    const requests: string[] = []
    await mkdir(path.join(root, 'downloads'), { recursive: true })
    await writeFile(path.join(root, 'downloads', 'stale-runtime.tar.gz.part'), 'stale')

    const manager = new ComputerUseRuntimeManager({
      runtimeRoot: root,
      platform: 'win32',
      arch: 'x64',
      manifestUrls: ['https://downloads.example/runtime/manifest.json'],
      fetchImpl: (async (input: RequestInfo | URL) => {
        const url = String(input)
        requests.push(url)
        if (url.endsWith('manifest.json')) return Response.json(manifest)
        return new Response(archive, { status: 200 })
      }) as typeof fetch,
      extractArchive: fakeExtract,
      validatePython: async () => 'Python 3.12.0',
    })

    const preparation = manager.startInBackground()
    expect(preparation).toMatchObject({ phase: 'checking', ready: false })
    const pythonPath = await manager.ensureReady()
    expect(pythonPath).toBe(path.join(root, 'managed', 'test-v1', 'win32-x64', 'python', 'python.exe'))
    expect(manager.snapshot()).toMatchObject({
      phase: 'ready',
      ready: true,
      source: 'managed',
      progressPercent: 100,
    })
    expect(requests).toEqual([
      'https://downloads.example/runtime/manifest.json',
      'https://downloads.example/runtime/computer-use-runtime-win32-x64.tar.gz',
    ])

    const pointer = JSON.parse(
      await readFile(path.join(root, 'managed', 'active.json'), 'utf8'),
    )
    expect(pointer).toMatchObject({
      runtimeVersion: 'test-v1',
      platformKey: 'win32-x64',
      pythonPath: 'python/python.exe',
    })
    await expect(
      readFile(path.join(root, 'downloads', 'stale-runtime.tar.gz.part'), 'utf8'),
    ).rejects.toThrow()
  })

  test('uses a bundled runtime without fetching a manifest', async () => {
    const runtimeRoot = await makeRoot()
    const bundledRoot = await makeRoot()
    const bundledPython = await writeActiveRuntime(bundledRoot, 'bundled-v1')
    let fetchCalls = 0

    const manager = new ComputerUseRuntimeManager({
      runtimeRoot,
      bundledRuntimeRoot: bundledRoot,
      platform: 'win32',
      arch: 'x64',
      manifestUrls: ['https://downloads.example/runtime/manifest.json'],
      fetchImpl: (async () => {
        fetchCalls += 1
        throw new Error('network should not be used for bundled runtime')
      }) as typeof fetch,
      validatePython: async () => 'Python 3.12.0',
    })

    await expect(manager.ensureReady()).resolves.toBe(bundledPython)
    expect(manager.snapshot()).toMatchObject({
      phase: 'ready',
      ready: true,
      source: 'bundled',
      version: 'bundled-v1',
    })
    expect(fetchCalls).toBe(0)
  })

  test('installs an archived bundled runtime without network access', async () => {
    const runtimeRoot = await makeRoot()
    const bundledRoot = await makeRoot()
    const archive = new TextEncoder().encode('bundled-archive-runtime')
    const payload = encodeBundledPayload(archive)
    const manifest = manifestFor(archive)
    const asset = manifest.assets['win32-x64']!
    const payloadFilename = 'computer-use-runtime-win32-x64.cyber-runtime'
    const payloadPath = path.join(bundledRoot, payloadFilename)
    await writeFile(payloadPath, payload)
    await writeFile(
      path.join(bundledRoot, 'manifest.json'),
      `${JSON.stringify(
        {
          name: 'computer-use-runtime',
          format: 'opaque-xor-v1',
          encoding: 'xor-a5',
          version: manifest.runtimeVersion,
          platformKey: 'win32-x64',
          payload: payloadFilename,
          payloadSha256: createHash('sha256').update(payload).digest('hex'),
          payloadSize: payload.byteLength,
          archiveFilename: asset.filename,
          archiveSha256: asset.sha256,
          archiveSize: asset.size,
          pythonPath: asset.pythonPath,
          available: true,
        },
        null,
        2,
      )}\n`,
    )
    let fetchCalls = 0

    const manager = new ComputerUseRuntimeManager({
      runtimeRoot,
      bundledRuntimeRoot: bundledRoot,
      platform: 'win32',
      arch: 'x64',
      fetchImpl: (async () => {
        fetchCalls += 1
        throw new Error('network should not be used for bundled runtime')
      }) as typeof fetch,
      extractArchive: fakeExtract,
      validatePython: async () => 'Python 3.12.0',
    })

    await expect(manager.ensureReady()).resolves.toBe(
      path.join(runtimeRoot, 'managed', 'test-v1', 'win32-x64', 'python', 'python.exe'),
    )
    expect(manager.snapshot()).toMatchObject({
      phase: 'ready',
      ready: true,
      source: 'bundled',
      version: 'test-v1',
    })
    expect(fetchCalls).toBe(0)
    await expect(readFile(payloadPath)).resolves.toEqual(payload)
    await expect(
      readFile(path.join(runtimeRoot, 'managed', 'active.json'), 'utf8'),
    ).resolves.toContain('"runtimeVersion": "test-v1"')
  })

  test('rejects a corrupted archived bundled runtime without deleting it', async () => {
    const runtimeRoot = await makeRoot()
    const bundledRoot = await makeRoot()
    const expected = new TextEncoder().encode('expected-bundled-runtime')
    const corrupted = new TextEncoder().encode('corrupted-bundled-runtime')
    const manifest = manifestFor(expected)
    const asset = manifest.assets['win32-x64']!
    const payloadFilename = 'computer-use-runtime-win32-x64.cyber-runtime'
    const payloadPath = path.join(bundledRoot, payloadFilename)
    await writeFile(payloadPath, corrupted)
    await writeFile(
      path.join(bundledRoot, 'manifest.json'),
      `${JSON.stringify(
        {
          name: 'computer-use-runtime',
          format: 'opaque-xor-v1',
          encoding: 'xor-a5',
          version: manifest.runtimeVersion,
          platformKey: 'win32-x64',
          payload: payloadFilename,
          payloadSha256: createHash('sha256').update(expected).digest('hex'),
          payloadSize: corrupted.byteLength,
          archiveFilename: asset.filename,
          archiveSha256: asset.sha256,
          archiveSize: asset.size,
          pythonPath: asset.pythonPath,
          available: true,
        },
        null,
        2,
      )}\n`,
    )

    const manager = new ComputerUseRuntimeManager({
      runtimeRoot,
      bundledRuntimeRoot: bundledRoot,
      platform: 'win32',
      arch: 'x64',
      fetchImpl: (async () => {
        throw new Error('network should not be used for a bundled runtime')
      }) as typeof fetch,
      extractArchive: fakeExtract,
      validatePython: async () => 'Python 3.12.0',
    })

    await expect(manager.ensureReady()).rejects.toThrow('内置运行组件校验失败')
    await expect(readFile(payloadPath)).resolves.toEqual(corrupted)
    expect(manager.snapshot()).toMatchObject({ phase: 'error', ready: false })
  })

  test('prefers an installed managed runtime over the bundled runtime', async () => {
    const runtimeRoot = await makeRoot()
    const bundledRoot = await makeRoot()
    await writeActiveRuntime(bundledRoot, 'bundled-v1')
    const managedPython = await writeActiveRuntime(runtimeRoot, 'managed-v2')

    const manager = new ComputerUseRuntimeManager({
      runtimeRoot,
      bundledRuntimeRoot: bundledRoot,
      platform: 'win32',
      arch: 'x64',
      fetchImpl: (async () => {
        throw new Error('network should not be used when managed runtime exists')
      }) as typeof fetch,
    })

    await expect(manager.ensureReady()).resolves.toBe(managedPython)
    expect(manager.snapshot()).toMatchObject({
      phase: 'ready',
      ready: true,
      source: 'managed',
      version: 'managed-v2',
    })
  })

  test('resumes a partial download with an HTTP Range request', async () => {
    const root = await makeRoot()
    const archive = new TextEncoder().encode('0123456789-runtime')
    const manifest = manifestFor(archive)
    const partialSize = 7
    const partialPath = path.join(
      root,
      'downloads',
      'computer-use-runtime-win32-x64.tar.gz.part',
    )
    await mkdir(path.dirname(partialPath), { recursive: true })
    await writeFile(partialPath, archive.slice(0, partialSize))
    let rangeHeader: string | null = null

    const manager = new ComputerUseRuntimeManager({
      runtimeRoot: root,
      platform: 'win32',
      arch: 'x64',
      manifestUrls: ['https://downloads.example/runtime/manifest.json'],
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith('manifest.json')) return Response.json(manifest)
        rangeHeader = new Headers(init?.headers).get('Range')
        return new Response(archive.slice(partialSize), { status: 206 })
      }) as typeof fetch,
      extractArchive: fakeExtract,
      validatePython: async () => 'Python 3.12.0',
    })

    await manager.ensureReady()
    expect(rangeHeader).toBe(`bytes=${partialSize}-`)
    expect(manager.snapshot().phase).toBe('ready')
  })

  test('falls back to the next manifest and asset mirror', async () => {
    const root = await makeRoot()
    const archive = new TextEncoder().encode('mirror-runtime')
    const manifest = manifestFor(archive)
    const requests: string[] = []

    const manager = new ComputerUseRuntimeManager({
      runtimeRoot: root,
      platform: 'win32',
      arch: 'x64',
      manifestUrls: [
        'https://primary.example/runtime/manifest.json',
        'https://mirror.example/runtime/manifest.json',
      ],
      fetchImpl: (async (input: RequestInfo | URL) => {
        const url = String(input)
        requests.push(url)
        if (url.startsWith('https://primary.example')) {
          return new Response('unavailable', { status: 503 })
        }
        if (url.endsWith('manifest.json')) return Response.json(manifest)
        return new Response(archive, { status: 200 })
      }) as typeof fetch,
      extractArchive: fakeExtract,
      validatePython: async () => 'Python 3.12.0',
    })

    await manager.ensureReady()
    expect(manager.snapshot().ready).toBe(true)
    expect(requests).toContain('https://mirror.example/runtime/manifest.json')
    expect(requests).toContain(
      'https://mirror.example/runtime/computer-use-runtime-win32-x64.tar.gz',
    )
  })

  test('does not activate a runtime with a mismatched checksum', async () => {
    const root = await makeRoot()
    const expected = new TextEncoder().encode('expected-runtime')
    const corrupted = new TextEncoder().encode('corrupted-runtime')
    const manifest = manifestFor(expected)

    const manager = new ComputerUseRuntimeManager({
      runtimeRoot: root,
      platform: 'win32',
      arch: 'x64',
      manifestUrls: ['https://downloads.example/runtime/manifest.json'],
      fetchImpl: (async (input: RequestInfo | URL) => {
        if (String(input).endsWith('manifest.json')) return Response.json(manifest)
        return new Response(corrupted, { status: 200 })
      }) as typeof fetch,
      extractArchive: fakeExtract,
      validatePython: async () => 'Python 3.12.0',
    })

    await expect(manager.ensureReady()).rejects.toThrow('运行组件下载失败')
    expect(manager.snapshot()).toMatchObject({ phase: 'error', ready: false })
    await expect(readFile(path.join(root, 'managed', 'active.json'), 'utf8')).rejects.toThrow()
  })

  test('aborts cleanly when paused before the manifest request starts', async () => {
    const root = await makeRoot()
    const archive = new TextEncoder().encode('resumable-runtime')
    const manifest = manifestFor(archive)
    let manifestRequests = 0
    let assetRequests = 0

    const manager = new ComputerUseRuntimeManager({
      runtimeRoot: root,
      platform: 'win32',
      arch: 'x64',
      manifestUrls: ['https://downloads.example/runtime/manifest.json'],
      fetchImpl: (async (input: RequestInfo | URL) => {
        if (String(input).endsWith('manifest.json')) {
          manifestRequests += 1
          return Response.json(manifest)
        }
        assetRequests += 1
        return new Response(archive, { status: 200 })
      }) as typeof fetch,
      extractArchive: fakeExtract,
      validatePython: async () => 'Python 3.12.0',
    })

    manager.startInBackground()
    const paused = await manager.pause()
    expect(paused).toMatchObject({ phase: 'paused', ready: false })

    const resumed = manager.startInBackground()
    expect(resumed.phase).toBe('checking')
    await manager.ensureReady()

    expect(manager.snapshot()).toMatchObject({ phase: 'ready', ready: true })
    expect(manifestRequests).toBe(1)
    expect(assetRequests).toBe(1)
  })

  test('waits for an active download to stop before acknowledging pause', async () => {
    const root = await makeRoot()
    const archive = new TextEncoder().encode('resume-after-active-download')
    const manifest = manifestFor(archive)
    let assetRequests = 0
    let markAssetStarted!: () => void
    const assetStarted = new Promise<void>(resolve => {
      markAssetStarted = resolve
    })

    const manager = new ComputerUseRuntimeManager({
      runtimeRoot: root,
      platform: 'win32',
      arch: 'x64',
      manifestUrls: ['https://downloads.example/runtime/manifest.json'],
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith('manifest.json')) return Response.json(manifest)
        assetRequests += 1
        if (assetRequests > 1) return new Response(archive, { status: 200 })

        markAssetStarted()
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            setTimeout(() => reject(init.signal?.reason), 20)
          }, { once: true })
        })
      }) as typeof fetch,
      extractArchive: fakeExtract,
      validatePython: async () => 'Python 3.12.0',
    })

    manager.startInBackground()
    await assetStarted
    const paused = await manager.pause()
    expect(paused).toMatchObject({ phase: 'paused', ready: false })

    expect(manager.startInBackground().phase).toBe('checking')
    await manager.ensureReady()
    expect(manager.snapshot()).toMatchObject({ phase: 'ready', ready: true })
    expect(assetRequests).toBe(2)
  })
})
