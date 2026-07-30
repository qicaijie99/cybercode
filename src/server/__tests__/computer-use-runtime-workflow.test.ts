import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, test } from 'bun:test'

const repoRoot = path.resolve(import.meta.dir, '../../..')
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'computer-use-runtime.yml')

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
})
