import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'

const desktopRoot = path.resolve(import.meta.dir, '..')
const runtimeRoot = path.join(desktopRoot, 'test-results', 'runtime')
const configDir = path.join(runtimeRoot, 'config')
const homeDir = path.join(runtimeRoot, 'home')
const port = Number.parseInt(process.env.CYBERCODE_E2E_API_PORT || '3467', 10)

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`Invalid Playwright API port: ${process.env.CYBERCODE_E2E_API_PORT}`)
}

await rm(runtimeRoot, { recursive: true, force: true })
await Promise.all([
  mkdir(configDir, { recursive: true }),
  mkdir(homeDir, { recursive: true }),
])

process.env.CYBER_CONFIG_DIR = configDir
process.env.CLAUDE_CONFIG_DIR = configDir
process.env.HOME = homeDir
process.env.USERPROFILE = homeDir
process.env.CYBERCODE_USAGE_ANALYTICS_DISABLED = '1'
process.env.DO_NOT_TRACK = '1'

const { startServer } = await import('../../src/server/index.ts')
startServer(port, '127.0.0.1')
