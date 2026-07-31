import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

describe('desktop portable release workflow', () => {
  test('publishes true portable assets and a checksummed manifest', async () => {
    const workflow = await readFile(
      resolve(import.meta.dir, '../../../.github/workflows/release-desktop.yml'),
      'utf8',
    )

    expect(workflow).toContain("tauri_args: '--verbose --bundles deb,appimage'")
    expect(workflow).toContain('CyberCode_${VERSION}_${ASSET_SUFFIX}_portable.AppImage')
    expect(workflow).toContain('"$APPIMAGE" --appimage-extract')
    expect(workflow).toContain('smoke_linux_sidecar "$APPIMAGE_ROOT" "appimage"')
    expect(workflow).toContain('CyberCode_${VERSION}_${ASSET_SUFFIX}_portable.zip')
    expect(workflow).toContain("'release-assets/portable.json'")
    expect(workflow).toContain("crypto.createHash('sha256')")
    expect(workflow).toContain("'macos-arm64'")
    expect(workflow).toContain("'macos-x64'")
    expect(workflow).toContain("'linux-x64'")
    expect(workflow).toContain("'windows-x64'")
  })

  test('creates the Windows portable archive from the validated installer payload', async () => {
    const workflow = await readFile(
      resolve(import.meta.dir, '../../../.github/workflows/release-desktop.yml'),
      'utf8',
    )
    const extractIndex = workflow.indexOf('7z x -bd -y "-o$ROOT" "$NSIS"')
    const portableIndex = workflow.indexOf(
      'CyberCode_${VERSION}_${ASSET_SUFFIX}_portable.zip',
      extractIndex,
    )
    const validationIndex = workflow.indexOf(
      'Validate packaged runtime resources',
    )

    expect(extractIndex).toBeGreaterThan(validationIndex)
    expect(portableIndex).toBeGreaterThan(extractIndex)
  })
})
