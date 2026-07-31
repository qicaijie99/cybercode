import { createHash } from 'node:crypto'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test'
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import {
  USB_PORTABLE_DIRECTORY_NAME,
  UsbMigrationError,
  UsbMigrationService,
  type PortableReleaseManifest,
  type UsbMigrationJob,
} from '../services/usbMigrationService.js'

describe('UsbMigrationService', () => {
  let root: string
  let configDir: string
  let projectDir: string
  let destinationDir: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cyber-usb-migration-'))
    configDir = join(root, 'home', '.cyber')
    projectDir = join(root, 'workspace', 'app')
    destinationDir = join(root, 'usb')
    await mkdir(join(configDir, 'skills', 'review'), { recursive: true })
    await mkdir(join(configDir, 'plugins', 'cache'), { recursive: true })
    await mkdir(join(projectDir, 'src'), { recursive: true })
    await mkdir(destinationDir, { recursive: true })
    await writeFile(join(configDir, 'skills', 'review', 'SKILL.md'), '# Review')
    await writeFile(join(configDir, 'plugins', 'cache', 'plugin.json'), '{"name":"demo"}')
    await writeFile(join(projectDir, 'src', 'index.ts'), 'export const answer = 42\n')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('copies config, skills, plugins, projects, registry, and launchers', async () => {
    const service = createService()
    const scan = await service.scan()

    expect(scan.configSizeBytes).toBeGreaterThan(0)
    expect(scan.projects).toHaveLength(1)
    expect(scan.projects[0]?.sizeBytes).toBeGreaterThan(0)

    const started = await service.start({
      destinationPath: destinationDir,
      includeApplications: false,
      projectIds: [scan.projects[0]!.id],
    })
    const completed = await waitForJob(service, started.id)
    const portableRoot = join(destinationDir, USB_PORTABLE_DIRECTORY_NAME)

    expect(completed).toMatchObject({
      status: 'completed',
      stage: 'completed',
      progressPercent: 100,
    })
    expect(await readFile(
      join(portableRoot, 'data', 'config', 'skills', 'review', 'SKILL.md'),
      'utf8',
    )).toBe('# Review')
    expect(await readFile(
      join(portableRoot, 'data', 'config', 'plugins', 'cache', 'plugin.json'),
      'utf8',
    )).toContain('demo')

    const registry = JSON.parse(await readFile(
      join(portableRoot, 'data', 'config', 'portable-projects.json'),
      'utf8',
    )) as {
      projects: Array<{ relativePath: string; originalPaths: string[] }>
    }
    expect(registry.projects).toHaveLength(1)
    expect(registry.projects[0]?.originalPaths).toEqual([await realpath(projectDir)])
    expect(await readFile(
      join(portableRoot, registry.projects[0]!.relativePath, 'src', 'index.ts'),
      'utf8',
    )).toContain('answer')

    await access(join(portableRoot, 'Start-CyberCode.command'))
    await access(join(portableRoot, 'Start-CyberCode.sh'))
    await access(join(portableRoot, 'Start-CyberCode.cmd'))
    await access(join(portableRoot, 'Start-CyberCode.ps1'))
    const shellLauncher = await readFile(
      join(portableRoot, 'Start-CyberCode.sh'),
      'utf8',
    )
    const windowsLauncher = await readFile(
      join(portableRoot, 'Start-CyberCode.ps1'),
      'utf8',
    )
    expect(shellLauncher).toContain('export CYBER_CONFIG_DIR="$ROOT/data/config"')
    expect(shellLauncher).toContain('export CYBER_PORTABLE_ROOT="$ROOT"')
    expect(shellLauncher).toContain('APPIMAGE_EXTRACT_AND_RUN=1 exec "$APPIMAGE"')
    expect(windowsLauncher).toContain('$env:CYBER_CONFIG_DIR')
    expect(windowsLauncher).toContain('$env:CYBER_PORTABLE_ROOT')
    expect(windowsLauncher).toContain('$LaunchOptions.ArgumentList = $args')
    expect(await readFile(join(portableRoot, '.cybercode-portable'), 'utf8'))
      .toBe('cybercode-portable-v1\n')
  })

  test('skips rebuildable caches and generated project dependencies', async () => {
    await mkdir(join(configDir, '.runtime', 'python'), { recursive: true })
    await mkdir(join(configDir, 'indexes'), { recursive: true })
    await mkdir(join(configDir, 'cache'), { recursive: true })
    await writeFile(join(configDir, '.runtime', 'python', 'runtime.bin'), 'runtime')
    await writeFile(join(configDir, 'indexes', 'memory.db'), 'index')
    await writeFile(join(configDir, 'cache', 'response.json'), 'cache')

    const generatedDirectories = [
      ['node_modules', 'package', 'index.js'],
      ['target', 'debug', 'app'],
      ['.codegraph', 'graph.db'],
      ['build', 'bundle.js'],
    ]
    for (const parts of generatedDirectories) {
      const target = join(projectDir, ...parts)
      await mkdir(join(target, '..'), { recursive: true })
      await writeFile(target, 'generated')
    }

    const service = createService()
    const scan = await service.scan()

    expect(scan.configSizeBytes).toBe(
      Buffer.byteLength('# Review') + Buffer.byteLength('{"name":"demo"}'),
    )
    expect(scan.projects[0]?.sizeBytes).toBe(
      Buffer.byteLength('export const answer = 42\n'),
    )

    const started = await service.start({
      destinationPath: destinationDir,
      includeApplications: false,
      projectIds: [scan.projects[0]!.id],
    })
    const completed = await waitForJob(service, started.id)
    const portableRoot = join(destinationDir, USB_PORTABLE_DIRECTORY_NAME)
    const portableProject = join(
      portableRoot,
      'projects',
      `app-${scan.projects[0]!.id.slice(0, 8)}`,
    )

    expect(completed.status).toBe('completed')
    await access(join(portableProject, 'src', 'index.ts'))
    await expect(access(join(portableRoot, 'data', 'config', '.runtime')))
      .rejects.toThrow()
    await expect(access(join(portableRoot, 'data', 'config', 'indexes')))
      .rejects.toThrow()
    await expect(access(join(portableProject, 'node_modules')))
      .rejects.toThrow()
    await expect(access(join(portableProject, 'target')))
      .rejects.toThrow()
    await expect(access(join(portableProject, '.codegraph')))
      .rejects.toThrow()
    await expect(access(join(portableProject, 'build')))
      .rejects.toThrow()
  })

  test('downloads and verifies a selected platform package', async () => {
    const packageBytes = new TextEncoder().encode('portable-windows-package')
    const sha256 = createHash('sha256').update(packageBytes).digest('hex')
    const manifest = createManifest({
      filename: 'CyberCode_1.2.0_windows_x64_portable.zip',
      size: packageBytes.byteLength,
      sha256,
      archiveType: 'zip',
      urls: ['https://example.test/windows.zip'],
    })
    const service = createService({
      resolveRelease: async () => ({
        manifest,
        sourceUrl: 'https://example.test/portable.json',
      }),
      fetchImpl: async (input) => {
        expect(String(input)).toBe('https://example.test/windows.zip')
        return new Response(packageBytes)
      },
    })
    const scan = await service.scan()
    const started = await service.start({
      destinationPath: destinationDir,
      projectIds: [scan.projects[0]!.id],
      platforms: ['windows-x64'],
    })
    const completed = await waitForJob(service, started.id)
    const packagePath = join(
      destinationDir,
      USB_PORTABLE_DIRECTORY_NAME,
      'packages',
      'windows-x64',
      'CyberCode_1.2.0_windows_x64_portable.zip',
    )

    expect(completed.status).toBe('completed')
    expect(new Uint8Array(await Bun.file(packagePath).arrayBuffer())).toEqual(packageBytes)
    expect(await readFile(
      join(destinationDir, USB_PORTABLE_DIRECTORY_NAME, 'checksums.sha256'),
      'utf8',
    )).toContain(sha256)
  })

  test('falls back to the next package mirror when a download stalls', async () => {
    const packageBytes = new TextEncoder().encode('portable-windows-package')
    const sha256 = createHash('sha256').update(packageBytes).digest('hex')
    const urls = [
      'https://slow.example.test/windows.zip',
      'https://mirror.example.test/windows.zip',
    ]
    const requests: string[] = []
    const manifest = createManifest({
      filename: 'CyberCode_1.2.0_windows_x64_portable.zip',
      size: packageBytes.byteLength,
      sha256,
      archiveType: 'zip',
      urls,
    })
    const service = createService({
      resolveRelease: async () => ({
        manifest,
        sourceUrl: 'https://example.test/portable.json',
      }),
      downloadStallTimeoutMs: 10,
      fetchImpl: async (input, init) => {
        const url = String(input)
        requests.push(url)
        if (url === urls[0]) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(init.signal?.reason),
              { once: true },
            )
          })
        }
        return new Response(packageBytes)
      },
    })
    const scan = await service.scan()
    const started = await service.start({
      destinationPath: destinationDir,
      projectIds: [],
      platforms: ['windows-x64'],
    })
    const completed = await waitForJob(service, started.id)

    expect(completed.status).toBe('completed')
    expect(requests).toEqual(urls)
  })

  test('rejects a destination inside a project being copied', async () => {
    const nestedDestination = join(projectDir, 'backup')
    await mkdir(nestedDestination)
    const service = createService()
    const scan = await service.scan()

    await expect(service.start({
      destinationPath: nestedDestination,
      includeApplications: false,
      projectIds: [scan.projects[0]!.id],
    })).rejects.toMatchObject<Partial<UsbMigrationError>>({
      code: 'DESTINATION_INSIDE_SOURCE',
    })
  })

  test('requires explicit confirmation before replacing an existing bundle', async () => {
    const service = createService()
    const scan = await service.scan()
    const first = await service.start({
      destinationPath: destinationDir,
      includeApplications: false,
      projectIds: [scan.projects[0]!.id],
    })
    await waitForJob(service, first.id)

    await expect(service.start({
      destinationPath: destinationDir,
      includeApplications: false,
      projectIds: [scan.projects[0]!.id],
    })).rejects.toMatchObject<Partial<UsbMigrationError>>({
      code: 'PORTABLE_BUNDLE_EXISTS',
    })

    const replacement = await service.start({
      destinationPath: destinationDir,
      includeApplications: false,
      replaceExisting: true,
      projectIds: [scan.projects[0]!.id],
    })
    expect((await waitForJob(service, replacement.id)).status).toBe('completed')
  })

  test('updates a portable bundle when the bundle directory itself is selected', async () => {
    const service = createService()
    const scan = await service.scan()
    const first = await service.start({
      destinationPath: destinationDir,
      includeApplications: false,
      projectIds: [scan.projects[0]!.id],
    })
    await waitForJob(service, first.id)

    const portableRoot = join(destinationDir, USB_PORTABLE_DIRECTORY_NAME)
    const replacement = await service.start({
      destinationPath: portableRoot,
      includeApplications: false,
      replaceExisting: true,
      projectIds: [scan.projects[0]!.id],
    })

    expect((await waitForJob(service, replacement.id)).status).toBe('completed')
    expect(await readFile(join(portableRoot, '.cybercode-portable'), 'utf8'))
      .toBe('cybercode-portable-v1\n')
  })

  test('creates an empty portable config directory for a first-run profile', async () => {
    await rm(configDir, { recursive: true, force: true })
    const service = createService()
    const started = await service.start({
      destinationPath: destinationDir,
      includeApplications: false,
      projectIds: [],
    })
    const completed = await waitForJob(service, started.id)
    const portableConfigDir = join(
      destinationDir,
      USB_PORTABLE_DIRECTORY_NAME,
      'data',
      'config',
    )

    expect(completed.status).toBe('completed')
    await access(portableConfigDir)
    await access(join(portableConfigDir, 'portable-projects.json'))
  })

  test('excludes filesystem, user-profile, and config-owning roots from projects', async () => {
    const service = createService({
      discoverProjects: async () => [
        { path: projectDir, modifiedAt: '2026-07-30T12:00:00.000Z' },
        { path: homedir(), modifiedAt: '2026-07-30T11:00:00.000Z' },
        { path: parse(homedir()).root, modifiedAt: '2026-07-30T10:00:00.000Z' },
        { path: configDir, modifiedAt: '2026-07-30T09:00:00.000Z' },
        { path: join(root, 'home'), modifiedAt: '2026-07-30T08:00:00.000Z' },
      ],
    })

    const result = await service.scan()

    expect(result.projects).toHaveLength(1)
    expect(result.projects[0]?.path).toBe(await realpath(projectDir))
  })

  function createService(overrides: ConstructorParameters<typeof UsbMigrationService>[0] = {}) {
    return new UsbMigrationService({
      configDir,
      discoverProjects: async () => [{
        path: projectDir,
        modifiedAt: '2026-07-30T12:00:00.000Z',
        sessionCount: 2,
      }],
      resolveRelease: async () => null,
      availableBytes: async () => Number.MAX_SAFE_INTEGER,
      ...overrides,
    })
  }
})

async function waitForJob(
  service: UsbMigrationService,
  jobId: string,
): Promise<UsbMigrationJob> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const job = service.getJob(jobId)
    if (['completed', 'failed', 'cancelled'].includes(job.status)) return job
    await Bun.sleep(10)
  }
  throw new Error(`Timed out waiting for USB migration job ${jobId}`)
}

function createManifest(
  windowsAsset: PortableReleaseManifest['platforms']['windows-x64'],
): PortableReleaseManifest {
  const placeholder = {
    filename: 'placeholder.bin',
    size: 1,
    sha256: '0'.repeat(64),
    archiveType: 'zip' as const,
  }
  return {
    schemaVersion: 1,
    version: '1.2.0',
    generatedAt: '2026-07-30T12:00:00.000Z',
    platforms: {
      'macos-arm64': { ...placeholder, archiveType: 'app-tar-gz' },
      'macos-x64': { ...placeholder, archiveType: 'app-tar-gz' },
      'windows-x64': windowsAsset,
      'linux-x64': { ...placeholder, archiveType: 'appimage' },
    },
  }
}
