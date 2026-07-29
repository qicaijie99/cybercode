import { expect, test, type Page } from '@playwright/test'

const apiPort = Number.parseInt(process.env.CYBERCODE_E2E_API_PORT || '3467', 10)
const apiUrl = `http://127.0.0.1:${apiPort}`
const appUrl = `/?serverUrl=${encodeURIComponent(apiUrl)}`

async function openApp(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('cybercode-locale', 'en')
    window.localStorage.setItem('cybercode-theme', 'light')
  })
  await page.goto(appUrl)
  await expect(page.locator('[data-compact-layout]')).toBeVisible()
  await expect(page.locator('#boot-splash')).toHaveCount(0)
}

test('boots the desktop web UI against the isolated backend', async ({ page, request }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await openApp(page)

  await expect(page).toHaveTitle('CyberCode')
  await expect(page.getByRole('menu', { name: 'New session' })).toBeVisible()
  await expect(page.getByText('RENDER ERROR')).toHaveCount(0)

  const health = await request.get(`${apiUrl}/health`)
  expect(health.ok()).toBe(true)
  await expect(health.json()).resolves.toMatchObject({ status: 'ok' })
  expect(pageErrors).toEqual([])
})

test('opens and closes the settings panel', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await openApp(page)

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const settingsPanel = page.getByTestId('settings-panel')
  await expect(settingsPanel).toBeVisible()
  await expect(settingsPanel).toHaveAttribute('data-state', 'open')

  await page.keyboard.press('Escape')
  await expect(settingsPanel).toHaveCount(0)
  expect(pageErrors).toEqual([])
})

test('renders a single-pixel separator beside the icon rail', async ({ page }) => {
  await openApp(page)

  const iconRail = page.locator('.icon-rail-glass')
  const sidebarShell = page.getByTestId('app-sidebar-shell')

  await expect(iconRail).toHaveCSS('border-right-width', '1px')
  await expect(iconRail).toHaveCSS('box-shadow', 'none')
  if (await sidebarShell.getAttribute('data-state') === 'closed') {
    await iconRail.getByRole('button').first().click()
  }
  await expect(sidebarShell).toHaveAttribute('data-state', 'open')
  await expect(sidebarShell).toHaveCSS('border-right-width', '1px')

  await iconRail.getByRole('button').first().click()

  await expect(sidebarShell).toHaveAttribute('data-state', 'closed')
  await expect(sidebarShell).toHaveCSS('border-right-width', '0px')
  await expect.poll(async () => {
    return page.evaluate(() => {
      const rail = document.querySelector<HTMLElement>('.icon-rail-glass')
      const sidebar = document.querySelector<HTMLElement>('[data-testid="app-sidebar-shell"]')
      const content = document.querySelector<HTMLElement>('#content-area')
      if (!rail || !sidebar || !content) return null

      const railBounds = rail.getBoundingClientRect()
      const sidebarBounds = sidebar.getBoundingClientRect()
      const contentBounds = content.getBoundingClientRect()
      return {
        railRight: railBounds.right,
        sidebarWidth: sidebarBounds.width,
        contentLeft: contentBounds.left,
      }
    })
  }).toEqual({
    railRight: 72,
    sidebarWidth: 0,
    contentLeft: 72,
  })
})
