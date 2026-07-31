import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, test } from 'bun:test'
import { parse } from 'yaml'

const repoRoot = path.resolve(import.meta.dir, '../../..')
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'computer-use-runtime.yml')
const releaseWorkflowPath = path.join(repoRoot, '.github', 'workflows', 'release-desktop.yml')
const sidecarSmokePath = path.join(repoRoot, 'desktop', 'scripts', 'smoke-test-sidecar.ts')

describe('Computer Use runtime workflow', () => {
  test('converts Windows tar paths to POSIX paths before packaging', async () => {
    const workflow = await readFile(workflowPath, 'utf8')

    expect(workflow).toContain('TAR_BUNDLE_DIR="$BUNDLE_DIR"')
    expect(workflow).toContain('TAR_ASSET_PATH="$OUT_DIR/$ASSET_NAME"')
    expect(workflow).toContain('TAR_BUNDLE_DIR="$(cygpath -u "$TAR_BUNDLE_DIR")"')
    expect(workflow).toContain('TAR_ASSET_PATH="$(cygpath -u "$TAR_ASSET_PATH")"')
    expect(workflow).toContain('tar -czf "$TAR_ASSET_PATH" -C "$TAR_BUNDLE_DIR" .')
    expect(workflow).not.toContain('tar -czf "$OUT_DIR/$ASSET_NAME" -C "$BUNDLE_DIR" .')
  })

  test('keeps the bundled runtime enabled for nested Tauri sidecar builds', async () => {
    const workflow = parse(await readFile(releaseWorkflowPath, 'utf8')) as {
      jobs?: {
        build?: {
          env?: Record<string, unknown>
          steps?: Array<{ name?: string; env?: Record<string, unknown> }>
        }
      }
    }
    const buildJob = workflow.jobs?.build

    expect(buildJob?.env?.CYBERCODE_EMBED_COMPUTER_USE_RUNTIME).toBe('1')
    expect(buildJob?.steps?.find(step => step.name === 'Build sidecars')).toBeDefined()
    expect(buildJob?.steps?.find(step => step.name === 'Build Tauri app')).toBeDefined()
    expect(
      buildJob?.steps?.find(step => step.name === 'Build Tauri app with Apple notarization'),
    ).toBeDefined()
  })

  test('publishes the runtime as a verified opaque payload', async () => {
    const workflow = parse(await readFile(releaseWorkflowPath, 'utf8')) as {
      jobs?: {
        build?: {
          steps?: Array<{ name?: string; run?: string }>
        }
      }
    }
    const validation = workflow.jobs?.build?.steps?.find(
      step => step.name === 'Validate packaged runtime resources',
    )?.run ?? ''

    expect(validation).toContain(
      "computerUseRuntimeManifest.format !== 'opaque-xor-v1'",
    )
    expect(validation).toContain(
      'Packaged Computer Use runtime payload checksum is invalid',
    )
    expect(validation).toContain(
      'Packaged Computer Use runtime cannot restore the verified archive',
    )
    expect(validation).toContain(
      'Packaged Computer Use runtime must remain archived until first use',
    )
    expect(validation).not.toContain(
      "path.join(process.env.COMPUTER_USE_RUNTIME_RESOURCE_DIR, 'managed', 'active.json')",
    )
  })

  test('executes the bundled runtime offline before a desktop release can publish', async () => {
    const smokeTest = await readFile(sidecarSmokePath, 'utf8')

    expect(smokeTest).toContain('CYBER_COMPUTER_USE_RUNTIME_ROOT')
    expect(smokeTest).toContain('CYBERCODE_COMPUTER_USE_RUNTIME_MANIFEST_URLS')
    expect(smokeTest).toContain("'http://127.0.0.1:9/computer-use-runtime-manifest.json'")
    expect(smokeTest).toContain('/api/computer-use/runtime')
    expect(smokeTest).toContain('/api/computer-use/status')
    expect(smokeTest).toContain('status.python?.installed !== true')
    expect(smokeTest).toContain('status.dependencies?.installed !== true')
  })
})
