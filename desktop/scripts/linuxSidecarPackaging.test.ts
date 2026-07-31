import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  buildLinuxSidecarLauncher,
  prepareLinuxSidecarPackage,
} from './linuxSidecarPackaging'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(directory =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('Linux sidecar packaging', () => {
  test('splits the ELF header so AppImage bundlers cannot rewrite the Bun executable', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cybercode-linux-sidecar-'))
    temporaryDirectories.push(root)
    const executablePath = path.join(root, 'compiled-sidecar')
    const launcherPath = path.join(root, 'binaries', 'cybercode-sidecar')
    const resourceDir = path.join(root, 'resources', 'sidecar')
    const executable = Buffer.concat([
      Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
      Buffer.from('bun-compiled-sidecar-body'),
    ])
    await writeFile(executablePath, executable)

    const manifest = await prepareLinuxSidecarPackage({
      executablePath,
      launcherPath,
      resourceDir,
      targetTriple: 'x86_64-unknown-linux-gnu',
    })

    const payload = await readFile(path.join(resourceDir, manifest.payload))
    const restored = Buffer.concat([
      Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
      payload,
    ])
    const launcher = await readFile(launcherPath, 'utf8')
    const launcherMode = (await stat(launcherPath)).mode & 0o777

    expect(payload.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))).toBe(false)
    expect(restored).toEqual(executable)
    expect(manifest.executableSha256).toBe(
      createHash('sha256').update(executable).digest('hex'),
    )
    expect(manifest.payloadSha256).toBe(
      createHash('sha256').update(payload).digest('hex'),
    )
    expect(launcher).toContain("printf '\\177ELF'")
    expect(launcher).toContain(manifest.executableSha256)
    expect(launcher).toContain('exec "$TARGET" "$@"')
    expect(launcherMode).toBe(0o755)
  })

  test('rejects unsafe payload names and invalid checksums', () => {
    expect(() =>
      buildLinuxSidecarLauncher({
        executableSha256: 'not-a-checksum',
      }),
    ).toThrow('SHA-256')
    expect(() =>
      buildLinuxSidecarLauncher({
        executableSha256: 'a'.repeat(64),
        payloadName: '../sidecar',
      }),
    ).toThrow('plain filename')
  })
})
