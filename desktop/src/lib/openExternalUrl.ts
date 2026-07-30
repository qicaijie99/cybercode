import { isTauriRuntime } from './desktopRuntime'

function openBrowserWindow(url: string): boolean {
  const browserWindow = window.open('', '_blank')
  if (!browserWindow) return false

  browserWindow.opener = null
  browserWindow.location.replace(url)
  return true
}

export async function openExternalUrl(url: string): Promise<void> {
  if (!isTauriRuntime()) {
    if (!openBrowserWindow(url)) {
      throw new Error('The browser blocked the authorization window')
    }
    return
  }

  try {
    const { open } = await import('@tauri-apps/plugin-shell')
    await open(url)
  } catch (error) {
    if (!openBrowserWindow(url)) throw error
  }
}
