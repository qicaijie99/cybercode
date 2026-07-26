import { describe, expect, test } from 'bun:test'
import {
  qoderRuntimeMetadata,
  resolveQoderRuntimeAsset,
} from '../services/qoderRuntimeService.js'

describe('Qoder managed runtime selection', () => {
  test('uses Qoder Node SEA legacy runtime on Windows x64', () => {
    expect(resolveQoderRuntimeAsset('win32', 'x64')).toMatchObject({
      platformKey: 'win32-x64',
      archiveName: 'qodercli-windows-x64-legacy.zip',
      binaryName: 'qodercli.exe',
    })
  })

  test('uses the baseline runtime on Linux x64', () => {
    expect(resolveQoderRuntimeAsset('linux', 'x64')).toMatchObject({
      platformKey: 'linux-x64',
      archiveName: 'qodercli-linux-x64-baseline.tar.gz',
      binaryName: 'qodercli',
    })
  })

  test('supports both current macOS architectures', () => {
    expect(resolveQoderRuntimeAsset('darwin', 'arm64')?.archiveName).toBe(
      'qodercli-darwin-arm64.tar.gz',
    )
    expect(resolveQoderRuntimeAsset('darwin', 'x64')?.archiveName).toBe(
      'qodercli-darwin-x64.tar.gz',
    )
  })

  test('rejects platforms without an official Qoder runtime', () => {
    expect(resolveQoderRuntimeAsset('win32', 'arm64')).toBeNull()
    expect(resolveQoderRuntimeAsset('freebsd', 'x64')).toBeNull()
  })

  test('builds downloads from the pinned official release', () => {
    const asset = resolveQoderRuntimeAsset('darwin', 'arm64')

    expect(asset?.downloadUrl).toBe(
      `${qoderRuntimeMetadata.releaseRoot}/${asset?.archiveName}`,
    )
    expect(asset?.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(qoderRuntimeMetadata.version).toBe('1.1.5')
  })
})
