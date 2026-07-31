import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const ELF_HEADER = Buffer.from([0x7f, 0x45, 0x4c, 0x46])
const DEFAULT_PAYLOAD_NAME = 'cybercode-sidecar.body'
const DEFAULT_MANIFEST_NAME = 'manifest.json'

export interface LinuxSidecarManifest {
  schemaVersion: 1
  name: 'cybercode-sidecar'
  format: 'split-elf-header-v1'
  targetTriple: string
  payload: string
  payloadSize: number
  payloadSha256: string
  executableSize: number
  executableSha256: string
}

export async function prepareLinuxSidecarPackage({
  executablePath,
  launcherPath,
  resourceDir,
  targetTriple,
}: {
  executablePath: string
  launcherPath: string
  resourceDir: string
  targetTriple: string
}): Promise<LinuxSidecarManifest> {
  const executable = await readFile(executablePath)
  if (
    executable.length <= ELF_HEADER.length ||
    !executable.subarray(0, ELF_HEADER.length).equals(ELF_HEADER)
  ) {
    throw new Error(
      `[build-sidecars] Linux sidecar is not a valid ELF executable: ${executablePath}`,
    )
  }

  const payload = executable.subarray(ELF_HEADER.length)
  const executableSha256 = sha256(executable)
  const payloadSha256 = sha256(payload)
  const manifest: LinuxSidecarManifest = {
    schemaVersion: 1,
    name: 'cybercode-sidecar',
    format: 'split-elf-header-v1',
    targetTriple,
    payload: DEFAULT_PAYLOAD_NAME,
    payloadSize: payload.length,
    payloadSha256,
    executableSize: executable.length,
    executableSha256,
  }

  await mkdir(path.dirname(launcherPath), { recursive: true })
  await mkdir(resourceDir, { recursive: true })
  await writeFile(
    path.join(resourceDir, DEFAULT_PAYLOAD_NAME),
    payload,
  )
  await writeFile(
    path.join(resourceDir, DEFAULT_MANIFEST_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
  await writeFile(
    launcherPath,
    buildLinuxSidecarLauncher({
      executableSha256,
      payloadName: DEFAULT_PAYLOAD_NAME,
    }),
  )
  await chmod(launcherPath, 0o755)

  return manifest
}

export function buildLinuxSidecarLauncher({
  executableSha256,
  payloadName = DEFAULT_PAYLOAD_NAME,
}: {
  executableSha256: string
  payloadName?: string
}): string {
  if (!/^[0-9a-f]{64}$/.test(executableSha256)) {
    throw new Error('Linux sidecar launcher requires a SHA-256 checksum')
  }
  if (path.basename(payloadName) !== payloadName || !/^[a-zA-Z0-9._-]+$/.test(payloadName)) {
    throw new Error('Linux sidecar payload name must be a plain filename')
  }

  return `#!/bin/sh
set -eu
umask 077

EXPECTED_SHA256='${executableSha256}'
PAYLOAD_NAME='${payloadName}'
SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
PAYLOAD="\${CYBERCODE_SIDECAR_PAYLOAD:-}"

if [ -z "$PAYLOAD" ]; then
  for candidate in \
    "$SCRIPT_DIR/../resources/sidecar/$PAYLOAD_NAME" \
    "$SCRIPT_DIR/../lib/CyberCode/resources/sidecar/$PAYLOAD_NAME" \
    "$SCRIPT_DIR/resources/sidecar/$PAYLOAD_NAME"
  do
    if [ -f "$candidate" ]; then
      PAYLOAD="$candidate"
      break
    fi
  done
fi

if [ -z "$PAYLOAD" ] || [ ! -s "$PAYLOAD" ]; then
  echo "CyberCode sidecar payload is missing. Reinstall CyberCode and try again." >&2
  exit 126
fi

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
    return
  fi
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
    return
  fi
  echo "CyberCode requires sha256sum or shasum to verify its Linux sidecar." >&2
  exit 126
}

if [ -n "\${XDG_CACHE_HOME:-}" ]; then
  CACHE_BASE="$XDG_CACHE_HOME"
elif [ -n "\${HOME:-}" ]; then
  CACHE_BASE="$HOME/.cache"
else
  CACHE_BASE="\${TMPDIR:-/tmp}/cybercode-\$(id -u 2>/dev/null || printf 'user')"
fi

CACHE_DIR="$CACHE_BASE/cybercode/sidecar"
if ! mkdir -p "$CACHE_DIR" 2>/dev/null; then
  CACHE_DIR="\${TMPDIR:-/tmp}/cybercode-\$(id -u 2>/dev/null || printf 'user')/sidecar"
  mkdir -p "$CACHE_DIR"
fi
chmod 700 "$CACHE_DIR" 2>/dev/null || true

TARGET="$CACHE_DIR/cybercode-sidecar"
CURRENT_SHA256=''
if [ -x "$TARGET" ]; then
  CURRENT_SHA256="$(sha256_file "$TARGET")"
fi

if [ "$CURRENT_SHA256" != "$EXPECTED_SHA256" ]; then
  TEMP="$CACHE_DIR/.cybercode-sidecar.$$"
  cleanup() {
    rm -f "$TEMP"
  }
  trap cleanup 0 1 2 15

  {
    printf '\\177ELF'
    cat "$PAYLOAD"
  } > "$TEMP"
  chmod 700 "$TEMP"

  ACTUAL_SHA256="$(sha256_file "$TEMP")"
  if [ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]; then
    echo "CyberCode sidecar verification failed. Reinstall CyberCode and try again." >&2
    exit 126
  fi

  mv -f "$TEMP" "$TARGET"
  trap - 0 1 2 15
fi

exec "$TARGET" "$@"
`
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}
