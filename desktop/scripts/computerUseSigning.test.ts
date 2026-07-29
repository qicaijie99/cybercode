import { describe, expect, it } from 'vitest'
import { buildComputerUseCodesignArgs } from './computerUseSigning'

const baseOptions = {
  appBundlePath: '/tmp/CyberCode Computer Use.app',
  bundleIdentifier: 'com.cybercode.computer-use',
  developmentRequirementPath: '/repo/designated-requirement.txt',
}

describe('buildComputerUseCodesignArgs', () => {
  it('gives development helpers a stable designated requirement', () => {
    expect(buildComputerUseCodesignArgs(baseOptions)).toEqual([
      '--force',
      '--deep',
      '--sign',
      '-',
      '--identifier',
      'com.cybercode.computer-use',
      '--requirements',
      '/repo/designated-requirement.txt',
      '--timestamp=none',
      '/tmp/CyberCode Computer Use.app',
    ])
  })

  it('uses hardened runtime and timestamps for official identities', () => {
    expect(buildComputerUseCodesignArgs({
      ...baseOptions,
      identity: 'Developer ID Application: CyberCode',
      requireOfficialIdentity: true,
    })).toEqual([
      '--force',
      '--deep',
      '--sign',
      'Developer ID Application: CyberCode',
      '--identifier',
      'com.cybercode.computer-use',
      '--options',
      'runtime',
      '--timestamp',
      '/tmp/CyberCode Computer Use.app',
    ])
  })

  it('fails release signing instead of silently using an ad-hoc identity', () => {
    expect(() => buildComputerUseCodesignArgs({
      ...baseOptions,
      identity: '-',
      requireOfficialIdentity: true,
    })).toThrow('stable Apple signing identity')
  })
})
