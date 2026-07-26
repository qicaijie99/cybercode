import { afterEach, describe, expect, test } from 'bun:test'
import {
  AGENT_BROWSER_MCP_SERVER_NAME,
  buildAgentBrowserSessionName,
  resolveAgentBrowserBinary,
  setupAgentBrowserMCP,
} from './setup'

const originalBinaryPath = process.env.CYBER_AGENT_BROWSER_PATH
const originalExecutablePath =
  process.env.CYBER_AGENT_BROWSER_EXECUTABLE_PATH
const originalSocketDir = process.env.AGENT_BROWSER_SOCKET_DIR
const originalSessionId = process.env.CYBERCODE_AGENT_BROWSER_SESSION_ID
const originalBrowserSession = process.env.AGENT_BROWSER_SESSION
const originalIdleTimeout = process.env.AGENT_BROWSER_IDLE_TIMEOUT_MS

afterEach(() => {
  restoreEnv('CYBER_AGENT_BROWSER_PATH', originalBinaryPath)
  restoreEnv(
    'CYBER_AGENT_BROWSER_EXECUTABLE_PATH',
    originalExecutablePath,
  )
  restoreEnv('AGENT_BROWSER_SOCKET_DIR', originalSocketDir)
  restoreEnv('CYBERCODE_AGENT_BROWSER_SESSION_ID', originalSessionId)
  restoreEnv('AGENT_BROWSER_SESSION', originalBrowserSession)
  restoreEnv('AGENT_BROWSER_IDLE_TIMEOUT_MS', originalIdleTimeout)
})

describe('agent-browser setup', () => {
  test('uses the bundled binary and mounts the compact core MCP profile', () => {
    process.env.CYBER_AGENT_BROWSER_PATH = process.execPath
    process.env.CYBER_AGENT_BROWSER_EXECUTABLE_PATH = '/browser/chrome'
    process.env.AGENT_BROWSER_SOCKET_DIR = '/tmp/cyber-agent-browser-test'
    process.env.CYBERCODE_AGENT_BROWSER_SESSION_ID = 'session-123'
    delete process.env.AGENT_BROWSER_SESSION
    delete process.env.AGENT_BROWSER_IDLE_TIMEOUT_MS

    const setup = setupAgentBrowserMCP()
    const config = setup?.mcpConfig[AGENT_BROWSER_MCP_SERVER_NAME]

    expect(resolveAgentBrowserBinary()).toBe(process.execPath)
    expect(config).toMatchObject({
      type: 'stdio',
      command: process.execPath,
      args: ['mcp', '--tools', 'core'],
      env: {
        AGENT_BROWSER_EXECUTABLE_PATH: '/browser/chrome',
        AGENT_BROWSER_SOCKET_DIR: '/tmp/cyber-agent-browser-test',
        AGENT_BROWSER_SESSION: 'cybercode-session-123',
        AGENT_BROWSER_IDLE_TIMEOUT_MS: '1800000',
      },
      scope: 'dynamic',
    })
    expect(setup?.allowedTools).toContain(
      'mcp__agent-browser__agent_browser_snapshot',
    )
    expect(setup?.allowedTools).toContain(
      'mcp__agent-browser__agent_browser_screenshot',
    )
  })

  test('creates valid, bounded names for long desktop session ids', () => {
    const name = buildAgentBrowserSessionName(
      `会话/${'long-session-name-'.repeat(8)}`,
    )

    expect(name.length).toBeLessThanOrEqual(64)
    expect(name).toMatch(/^cybercode-[A-Za-z0-9_-]+$/)
  })
})

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
