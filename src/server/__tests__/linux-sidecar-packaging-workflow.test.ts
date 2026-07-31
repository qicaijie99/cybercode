import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, test } from 'bun:test'

const repoRoot = path.resolve(import.meta.dir, '../../..')

describe('Linux sidecar release packaging', () => {
  test('bundles a split ELF payload and validates both DEB and AppImage launchers', async () => {
    const [workflow, tauriConfig, buildScript] = await Promise.all([
      readFile(
        path.join(repoRoot, '.github', 'workflows', 'release-desktop.yml'),
        'utf8',
      ),
      readFile(
        path.join(repoRoot, 'desktop', 'src-tauri', 'tauri.conf.json'),
        'utf8',
      ),
      readFile(
        path.join(repoRoot, 'desktop', 'scripts', 'build-sidecars.ts'),
        'utf8',
      ),
    ])

    expect(JSON.parse(tauriConfig).bundle.resources).toContain('resources/sidecar')
    expect(buildScript).toContain('prepareLinuxSidecarPackage')
    expect(buildScript).toContain("targetTriple.includes('-linux-')")
    expect(workflow).toContain("sidecarManifest.format !== 'split-elf-header-v1'")
    expect(workflow).toContain('Packaged Linux sidecar cannot restore the verified ELF')
    expect(workflow).toContain('smoke_linux_sidecar "$ROOT" "deb"')
    expect(workflow).toContain('smoke_linux_sidecar "$APPIMAGE_ROOT" "appimage"')
    expect(workflow).toContain(
      "if: github.event_name != 'workflow_dispatch' || inputs.build_only != true",
    )
  })
})
