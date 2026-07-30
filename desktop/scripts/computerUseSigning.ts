type ComputerUseCodesignOptions = {
  appBundlePath: string
  bundleIdentifier: string
  developmentRequirementPath: string
  identity?: string
  requireOfficialIdentity?: boolean
}

export function buildComputerUseCodesignArgs({
  appBundlePath,
  bundleIdentifier,
  developmentRequirementPath,
  identity: rawIdentity,
  requireOfficialIdentity = false,
}: ComputerUseCodesignOptions): string[] {
  const identity = rawIdentity?.trim() || '-'
  const isAdHoc = identity === '-'

  if (requireOfficialIdentity && isAdHoc) {
    throw new Error(
      'A stable Apple signing identity is required for the macOS Computer Use helper',
    )
  }

  const args = [
    '--force',
    '--deep',
    '--sign',
    identity,
    '--identifier',
    bundleIdentifier,
  ]

  if (isAdHoc) {
    args.push(
      '--requirements',
      developmentRequirementPath,
      '--timestamp=none',
    )
  } else {
    args.push('--options', 'runtime', '--timestamp')
  }

  args.push(appBundlePath)
  return args
}
