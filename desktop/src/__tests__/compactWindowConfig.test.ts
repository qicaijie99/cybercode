import { describe, expect, it } from 'vitest'
import rootConfigRaw from '../../src-tauri/tauri.conf.json?raw'
import windowsConfigRaw from '../../src-tauri/tauri.windows.conf.json?raw'
import macosConfigRaw from '../../src-tauri/tauri.macos.conf.json?raw'
import desktopStylesRaw from '../theme/globals.css?raw'

const configs = [
  ['tauri.conf.json', rootConfigRaw],
  ['tauri.windows.conf.json', windowsConfigRaw],
  ['tauri.macos.conf.json', macosConfigRaw],
]

describe('compact desktop window configuration', () => {
  it.each(configs)('%s keeps the supported minimum viewport in sync', (_name, rawConfig) => {
    const config = JSON.parse(rawConfig)
    const windowConfig = config.app.windows[0]

    expect(windowConfig.minWidth).toBe(640)
    expect(windowConfig.minHeight).toBe(420)
  })

  it('activates the compact density tier for narrow or short windows', () => {
    expect(desktopStylesRaw).toContain('@media (max-width: 720px), (max-height: 600px)')
    expect(desktopStylesRaw).toContain('.compact-density-scope')
    expect(desktopStylesRaw).toContain('--text-base: 13px')
    expect(desktopStylesRaw).toContain('.settings-segmented-control')
  })

  it('centers child surfaces in the live viewport and respects workspace rails', () => {
    expect(desktopStylesRaw).toContain('.viewport-overlay')
    expect(desktopStylesRaw).toContain('place-items: center')
    expect(desktopStylesRaw).toContain('width: 100dvw')
    expect(desktopStylesRaw).toContain('height: 100dvh')
    expect(desktopStylesRaw).toContain('.settings-panel-overlay--reserve-sidebar')
    expect(desktopStylesRaw).toContain('.settings-panel-overlay--reserve-right-rail')
  })
})
