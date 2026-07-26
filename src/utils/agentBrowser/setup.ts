import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'
import { buildMcpToolName } from '../../services/mcp/mcpStringUtils.js'
import type { ScopedMcpServerConfig } from '../../services/mcp/types.js'

export const AGENT_BROWSER_MCP_SERVER_NAME = 'agent-browser'
const CYBERCODE_AGENT_BROWSER_IDLE_TIMEOUT_MS = '1800000'

const CORE_TOOLS = [
  'agent_browser_tools_profiles',
  'agent_browser_open',
  'agent_browser_read',
  'agent_browser_snapshot',
  'agent_browser_click',
  'agent_browser_fill',
  'agent_browser_type',
  'agent_browser_press',
  'agent_browser_check',
  'agent_browser_uncheck',
  'agent_browser_select',
  'agent_browser_scroll',
  'agent_browser_wait_ms',
  'agent_browser_wait_for_selector',
  'agent_browser_wait_for_text',
  'agent_browser_wait_for_load',
  'agent_browser_screenshot',
  'agent_browser_get_text',
  'agent_browser_get_url',
  'agent_browser_get_title',
  'agent_browser_eval',
  'agent_browser_close',
  'agent_browser_back',
  'agent_browser_forward',
  'agent_browser_reload',
  'agent_browser_tab_new',
  'agent_browser_tab_list',
  'agent_browser_tab_switch',
  'agent_browser_tab_close',
] as const

export const AGENT_BROWSER_SYSTEM_PROMPT = [
  'For websites and local web apps, prefer the agent-browser MCP tools.',
  'Open the page, take a compact accessibility snapshot, and use its stable element refs before clicking or typing.',
  'Browser-page screenshots do not require operating-system screen-recording permission.',
  "Use Computer Use instead when the task requires the full desktop, another application, or the user's already-open browser session.",
].join(' ')

export function resolveAgentBrowserBinary(): string | null {
  const configuredPath = process.env.CYBER_AGENT_BROWSER_PATH?.trim()
  if (configuredPath && existsSync(configuredPath)) return configuredPath

  const siblingName =
    process.platform === 'win32' ? 'agent-browser.exe' : 'agent-browser'
  const siblingPath = path.join(path.dirname(process.execPath), siblingName)
  if (existsSync(siblingPath)) return siblingPath

  return typeof Bun !== 'undefined' ? Bun.which('agent-browser') : null
}

export function buildAgentBrowserSessionName(sessionId: string): string {
  const normalized = sessionId
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const base = normalized || 'session'
  const prefix = 'cybercode-'
  const maxBaseLength = 64 - prefix.length
  if (base.length <= maxBaseLength) return `${prefix}${base}`

  const digest = createHash('sha256').update(sessionId).digest('hex').slice(0, 8)
  return `${prefix}${base.slice(0, maxBaseLength - digest.length - 1)}-${digest}`
}

export function setupAgentBrowserMCP(): {
  mcpConfig: Record<string, ScopedMcpServerConfig>
  allowedTools: string[]
  systemPrompt: string
} | null {
  const command = resolveAgentBrowserBinary()
  if (!command) return null

  const env: Record<string, string> = {
    AGENT_BROWSER_SOCKET_DIR:
      process.env.AGENT_BROWSER_SOCKET_DIR ||
      path.join(homedir(), '.cyber', 'agent-browser'),
  }
  const cybercodeSessionId =
    process.env.CYBERCODE_AGENT_BROWSER_SESSION_ID?.trim()
  const configuredSession = process.env.AGENT_BROWSER_SESSION?.trim()
  if (cybercodeSessionId) {
    env.AGENT_BROWSER_SESSION =
      buildAgentBrowserSessionName(cybercodeSessionId)
    env.AGENT_BROWSER_IDLE_TIMEOUT_MS =
      process.env.AGENT_BROWSER_IDLE_TIMEOUT_MS ||
      CYBERCODE_AGENT_BROWSER_IDLE_TIMEOUT_MS
  } else if (configuredSession) {
    env.AGENT_BROWSER_SESSION = configuredSession
  }
  const browserExecutable =
    process.env.CYBER_AGENT_BROWSER_EXECUTABLE_PATH?.trim()
  if (browserExecutable) {
    env.AGENT_BROWSER_EXECUTABLE_PATH = browserExecutable
  }

  return {
    mcpConfig: {
      [AGENT_BROWSER_MCP_SERVER_NAME]: {
        type: 'stdio',
        command,
        args: ['mcp', '--tools', 'core'],
        env,
        scope: 'dynamic',
      },
    },
    allowedTools: CORE_TOOLS.map((toolName) =>
      buildMcpToolName(AGENT_BROWSER_MCP_SERVER_NAME, toolName),
    ),
    systemPrompt: AGENT_BROWSER_SYSTEM_PROMPT,
  }
}
