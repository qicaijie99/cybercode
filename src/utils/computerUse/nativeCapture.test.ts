import { describe, expect, test } from 'bun:test'
import {
  isNativeCaptureCommand,
  nativeCaptureHelperCandidates,
  NativeCaptureError,
  parseNativeCaptureOutput,
} from './nativeCapture.js'

describe('native Computer Use capture bridge', () => {
  test('routes only screen-pixel commands through the native helper', () => {
    expect(isNativeCaptureCommand('screenshot')).toBe(true)
    expect(isNativeCaptureCommand('resolve_prepare_capture')).toBe(true)
    expect(isNativeCaptureCommand('click')).toBe(false)
    expect(isNativeCaptureCommand('read_clipboard')).toBe(false)
  })

  test('resolves platform-specific installed and development helpers', () => {
    expect(
      nativeCaptureHelperCandidates('linux', {
        configHome: '/home/user/.cyber',
        projectRoot: '/workspace/cybercode',
      }),
    ).toEqual([
      '/home/user/.cyber/computer-use/cybercode-computer-use',
      '/workspace/cybercode/desktop/src-tauri/resources/computer-use/cybercode-computer-use',
    ])

    expect(
      nativeCaptureHelperCandidates('darwin', {
        configHome: '/Users/user/.cyber',
        projectRoot: '/workspace/cybercode',
      }),
    ).toEqual([
      '/Users/user/.cyber/computer-use/CyberCode Computer Use.app/Contents/MacOS/CyberCodeComputerUse',
      '/workspace/cybercode/desktop/src-tauri/resources/computer-use/CyberCode Computer Use.app/Contents/MacOS/CyberCodeComputerUse',
    ])
  })

  test('parses successful helper responses', () => {
    expect(
      parseNativeCaptureOutput<{ screenRecording: boolean }>(
        'check_screen_recording',
        '{"ok":true,"result":{"screenRecording":true}}',
      ),
    ).toEqual({ screenRecording: true })
  })

  test('preserves native helper error codes', () => {
    expect(() =>
      parseNativeCaptureOutput(
        'screenshot',
        '{"ok":false,"error":{"code":"SCREEN_CAPTURE_PERMISSION_REQUIRED","message":"Permission required"}}',
      ),
    ).toThrow(NativeCaptureError)

    try {
      parseNativeCaptureOutput(
        'screenshot',
        '{"ok":false,"error":{"code":"SCREEN_CAPTURE_PERMISSION_REQUIRED","message":"Permission required"}}',
      )
    } catch (error) {
      expect(error).toBeInstanceOf(NativeCaptureError)
      expect((error as NativeCaptureError).code).toBe(
        'SCREEN_CAPTURE_PERMISSION_REQUIRED',
      )
    }
  })
})
