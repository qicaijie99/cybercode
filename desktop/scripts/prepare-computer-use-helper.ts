import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { chmod, copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { detectHostTriple } from './sidecarTarget'

const HELPER_VERSION = '2'
const MAC_BUNDLE_NAME = 'CyberCode Computer Use.app'
const MAC_EXECUTABLE_NAME = 'CyberCodeComputerUse'
const MAC_BUNDLE_IDENTIFIER = 'com.cybercode.computer-use'
const LINUX_EXECUTABLE_NAME = 'cybercode-computer-use'

const desktopRoot = path.resolve(import.meta.dir, '..')
const repoRoot = path.resolve(desktopRoot, '..')
const macSourceDir = path.join(desktopRoot, 'computer-use-macos')
const linuxSourceDir = path.join(desktopRoot, 'computer-use-linux')
const resourceDir = path.join(
  desktopRoot,
  'src-tauri',
  'resources',
  'computer-use',
)
const macAppBundle = path.join(resourceDir, MAC_BUNDLE_NAME)
const macExecutablePath = path.join(
  macAppBundle,
  'Contents',
  'MacOS',
  MAC_EXECUTABLE_NAME,
)
const macInfoPlistPath = path.join(macAppBundle, 'Contents', 'Info.plist')
const linuxExecutablePath = path.join(resourceDir, LINUX_EXECUTABLE_NAME)
const manifestPath = path.join(resourceDir, 'manifest.json')
const targetTriple =
  process.env.TAURI_ENV_TARGET_TRIPLE ||
  process.env.CARGO_BUILD_TARGET ||
  (await detectHostTriple(repoRoot))

await prepareHelper()

async function prepareHelper() {
  await mkdir(resourceDir, { recursive: true })
  await writeFile(path.join(resourceDir, '.gitignore'), '*\n!.gitignore\n')

  if (targetTriple.endsWith('-apple-darwin')) {
    await rm(linuxExecutablePath, { force: true })
    await prepareMacHelper()
    return
  }

  if (targetTriple.endsWith('-unknown-linux-gnu')) {
    await rm(macAppBundle, { recursive: true, force: true })
    await prepareLinuxHelper()
    return
  }

  await rm(macAppBundle, { recursive: true, force: true })
  await rm(linuxExecutablePath, { force: true })
  await writeManifest({
    available: false,
    targetTriple,
    sourceSha256: sourceDigestForTarget(),
    executableSha256: null,
    bundleIdentifier: null,
    backend: null,
  })
  console.log(
    `[prepare-computer-use-helper] native helper is not needed for ${targetTriple}`,
  )
}

async function prepareMacHelper() {
  const sourceSha256 = sourceDigestForTarget()
  if (!hasReusableHelper(sourceSha256, macExecutablePath, macInfoPlistPath)) {
    await buildMacHelper()
  }
  await signMacHelper()
  await writeManifest({
    available: true,
    targetTriple,
    sourceSha256,
    executableSha256: createHash('sha256')
      .update(readFileSync(macExecutablePath))
      .digest('hex'),
    bundleIdentifier: MAC_BUNDLE_IDENTIFIER,
    backend: 'coregraphics',
  })

  console.log(
    `[prepare-computer-use-helper] prepared ${MAC_BUNDLE_NAME} for ${targetTriple}`,
  )
}

async function prepareLinuxHelper() {
  const sourceSha256 = sourceDigestForTarget()
  if (!hasReusableHelper(sourceSha256, linuxExecutablePath)) {
    await buildLinuxHelper()
  }
  await chmod(linuxExecutablePath, 0o755)
  await writeManifest({
    available: true,
    targetTriple,
    sourceSha256,
    executableSha256: createHash('sha256')
      .update(readFileSync(linuxExecutablePath))
      .digest('hex'),
    bundleIdentifier: null,
    backend: 'xdg-desktop-portal',
  })
  console.log(
    `[prepare-computer-use-helper] prepared ${LINUX_EXECUTABLE_NAME} for ${targetTriple}`,
  )
}

function sourceDigestForTarget() {
  const hash = createHash('sha256')
  hash.update(HELPER_VERSION)
  if (targetTriple.endsWith('-apple-darwin')) {
    hash.update(readFileSync(path.join(macSourceDir, 'main.swift')))
    hash.update(readFileSync(path.join(macSourceDir, 'Info.plist')))
  } else if (targetTriple.endsWith('-unknown-linux-gnu')) {
    hash.update(readFileSync(path.join(linuxSourceDir, 'Cargo.toml')))
    hash.update(readFileSync(path.join(linuxSourceDir, 'Cargo.lock')))
    hash.update(readFileSync(path.join(linuxSourceDir, 'src/main.rs')))
  } else {
    hash.update(targetTriple)
  }
  return hash.digest('hex')
}

function hasReusableHelper(
  sourceSha256: string,
  executablePath: string,
  companionPath?: string,
) {
  if (!existsSync(executablePath)) return false
  if (companionPath && !existsSync(companionPath)) return false
  if (!existsSync(manifestPath)) return false

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      available?: boolean
      targetTriple?: string
      sourceSha256?: string
    }
    return (
      manifest.available === true &&
      manifest.targetTriple === targetTriple &&
      manifest.sourceSha256 === sourceSha256
    )
  } catch {
    return false
  }
}

async function buildMacHelper() {
  await rm(macAppBundle, { recursive: true, force: true })
  await mkdir(path.dirname(macExecutablePath), { recursive: true })
  await copyFile(path.join(macSourceDir, 'Info.plist'), macInfoPlistPath)

  const swiftTarget =
    targetTriple === 'aarch64-apple-darwin'
      ? 'arm64-apple-macosx12.0'
      : targetTriple === 'x86_64-apple-darwin'
        ? 'x86_64-apple-macosx12.0'
        : null
  if (!swiftTarget) {
    throw new Error(
      `[prepare-computer-use-helper] unsupported macOS target: ${targetTriple}`,
    )
  }

  const process = Bun.spawn(
    [
      'xcrun',
      'swiftc',
      '-parse-as-library',
      '-O',
      '-whole-module-optimization',
      '-target',
      swiftTarget,
      '-framework',
      'CoreGraphics',
      '-framework',
      'ImageIO',
      '-o',
      macExecutablePath,
      path.join(macSourceDir, 'main.swift'),
    ],
    {
      cwd: repoRoot,
      stdout: 'inherit',
      stderr: 'inherit',
    },
  )
  const exitCode = await process.exited
  if (exitCode !== 0) {
    throw new Error(
      `[prepare-computer-use-helper] swiftc failed with exit ${exitCode}`,
    )
  }
  await chmod(macExecutablePath, 0o755)
}

async function buildLinuxHelper() {
  const cargoTargetDir = path.join(linuxSourceDir, 'target')
  const build = Bun.spawn(
    [
      'cargo',
      'build',
      '--locked',
      '--release',
      '--manifest-path',
      path.join(linuxSourceDir, 'Cargo.toml'),
      '--target',
      targetTriple,
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, CARGO_TARGET_DIR: cargoTargetDir },
      stdout: 'inherit',
      stderr: 'inherit',
    },
  )
  const buildExit = await build.exited
  if (buildExit !== 0) {
    throw new Error(
      `[prepare-computer-use-helper] Linux helper build failed with exit ${buildExit}`,
    )
  }

  const builtExecutable = path.join(
    cargoTargetDir,
    targetTriple,
    'release',
    LINUX_EXECUTABLE_NAME,
  )
  if (!existsSync(builtExecutable)) {
    throw new Error(
      `[prepare-computer-use-helper] Linux helper output is missing: ${builtExecutable}`,
    )
  }
  await copyFile(builtExecutable, linuxExecutablePath)
  await chmod(linuxExecutablePath, 0o755)
}

async function signMacHelper() {
  const identity = process.env.APPLE_SIGNING_IDENTITY?.trim() || '-'
  const signArgs = [
    '--force',
    '--deep',
    '--sign',
    identity,
    '--identifier',
    MAC_BUNDLE_IDENTIFIER,
  ]
  if (identity === '-') {
    signArgs.push('--timestamp=none')
  } else {
    signArgs.push('--options', 'runtime', '--timestamp')
  }
  signArgs.push(macAppBundle)

  const sign = Bun.spawn(['codesign', ...signArgs], {
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const signExit = await sign.exited
  if (signExit !== 0) {
    throw new Error(
      `[prepare-computer-use-helper] codesign failed with exit ${signExit}`,
    )
  }

  const verify = Bun.spawn(
    ['codesign', '--verify', '--deep', '--strict', '--verbose=2', macAppBundle],
    { stdout: 'inherit', stderr: 'inherit' },
  )
  const verifyExit = await verify.exited
  if (verifyExit !== 0) {
    throw new Error(
      `[prepare-computer-use-helper] signature verification failed with exit ${verifyExit}`,
    )
  }
}

async function writeManifest({
  available,
  targetTriple,
  sourceSha256,
  executableSha256,
  bundleIdentifier,
  backend,
}: {
  available: boolean
  targetTriple: string
  sourceSha256: string
  executableSha256: string | null
  bundleIdentifier: string | null
  backend: string | null
}) {
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        name: 'cybercode-computer-use-helper',
        version: HELPER_VERSION,
        bundleIdentifier,
        backend,
        available,
        targetTriple,
        sourceSha256,
        executableSha256,
      },
      null,
      2,
    )}\n`,
  )
}
