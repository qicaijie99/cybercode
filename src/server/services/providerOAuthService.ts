import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  arch,
  homedir,
  hostname,
  release,
  type as osType,
} from 'node:os'
import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { Database } from 'bun:sqlite'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import {
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
} from '../../services/oauth/crypto.js'
import { getPublicOAuthCredential } from './providerPublicOAuthCredentials.js'
import { qoderRuntimeService } from './qoderRuntimeService.js'
import {
  CODEX_CLIENT_VERSION,
  CODEX_DEFAULT_MODEL_CONTEXT_WINDOWS,
  CODEX_DEFAULT_MODELS,
  CODEX_FALLBACK_MODEL_CATALOG,
} from './codexModelCatalog.js'

export const DEVICE_OAUTH_PROVIDER_IDS = [
  'kimi-coding',
  'github',
  'kilocode',
  'codebuddy-cn',
  'grok-cli',
  'amazon-q',
] as const
export type DeviceOAuthProviderId = (typeof DEVICE_OAUTH_PROVIDER_IDS)[number]
export const BROWSER_OAUTH_PROVIDER_IDS = [
  'codex',
  'cline',
  'antigravity',
  'gemini-cli',
  'gitlab-duo',
] as const
export type BrowserOAuthProviderId = (typeof BROWSER_OAUTH_PROVIDER_IDS)[number]
export const IMPORT_OAUTH_PROVIDER_IDS = [
  'cursor',
  'qoder',
  'windsurf',
  'trae',
] as const
export type ImportOAuthProviderId = (typeof IMPORT_OAUTH_PROVIDER_IDS)[number]
export const OAUTH_PROVIDER_IDS = [
  ...DEVICE_OAUTH_PROVIDER_IDS,
  ...BROWSER_OAUTH_PROVIDER_IDS,
  ...IMPORT_OAUTH_PROVIDER_IDS,
] as const
export type ProviderOAuthId = (typeof OAUTH_PROVIDER_IDS)[number]

export type ProviderOAuthSetupMode =
  | 'device_code'
  | 'browser'
  | 'local_import'
  | 'token_import'
  | 'configured_browser'

export type ProviderOAuthCapability = {
  providerId: ProviderOAuthId
  setupMode: ProviderOAuthSetupMode
  canAutoDetect?: boolean
  requiresClientRegistration?: boolean
  helpUrl?: string
}

export const OAUTH_PROVIDER_CAPABILITIES: Record<
  ProviderOAuthId,
  ProviderOAuthCapability
> = {
  codex: { providerId: 'codex', setupMode: 'browser' },
  cline: { providerId: 'cline', setupMode: 'browser' },
  antigravity: { providerId: 'antigravity', setupMode: 'browser' },
  'gemini-cli': { providerId: 'gemini-cli', setupMode: 'browser' },
  'gitlab-duo': {
    providerId: 'gitlab-duo',
    setupMode: 'configured_browser',
    requiresClientRegistration: true,
    helpUrl: 'https://docs.gitlab.com/integration/oauth_provider/',
  },
  'kimi-coding': { providerId: 'kimi-coding', setupMode: 'device_code' },
  github: { providerId: 'github', setupMode: 'device_code' },
  kilocode: { providerId: 'kilocode', setupMode: 'device_code' },
  'codebuddy-cn': { providerId: 'codebuddy-cn', setupMode: 'device_code' },
  'grok-cli': { providerId: 'grok-cli', setupMode: 'device_code' },
  'amazon-q': { providerId: 'amazon-q', setupMode: 'device_code' },
  cursor: {
    providerId: 'cursor',
    setupMode: 'local_import',
    canAutoDetect: true,
  },
  qoder: {
    providerId: 'qoder',
    setupMode: 'token_import',
    helpUrl: 'https://qoder.com/account/integrations',
  },
  windsurf: {
    providerId: 'windsurf',
    setupMode: 'token_import',
    helpUrl: 'https://windsurf.com/show-auth-token',
  },
  trae: {
    providerId: 'trae',
    setupMode: 'token_import',
    helpUrl: 'https://solo.trae.ai/',
  },
}

export type ProviderOAuthStatus = {
  providerId: ProviderOAuthId
  connected: boolean
  expiresAt: number | null
  accountLabel?: string
}

export type DeviceOAuthStart = {
  flowType: 'device_code'
  providerId: DeviceOAuthProviderId
  sessionId: string
  userCode: string
  verificationUri: string
  verificationUriComplete: string
  expiresAt: number
  intervalMs: number
}

export type BrowserOAuthStart = {
  flowType: 'authorization_code_pkce' | 'authorization_code'
  providerId: BrowserOAuthProviderId
  sessionId: string
  authorizeUrl: string
  redirectUri: string
  expiresAt: number
  intervalMs: number
}

export type ProviderOAuthStart = DeviceOAuthStart | BrowserOAuthStart

export type ProviderOAuthPoll =
  | { status: 'pending'; intervalMs: number }
  | { status: 'connected'; connection: ProviderOAuthStatus }

export type ProviderOAuthStartOptions = {
  baseUrl?: string
  clientId?: string
  clientSecret?: string
}

export type ProviderOAuthImportInput = {
  accessToken?: string
  machineId?: string
  webId?: string
  bizUserId?: string
  userUniqueId?: string
  scope?: string
  tenant?: string
  region?: string
}

export type ProviderOAuthDetection = {
  providerId: ImportOAuthProviderId
  found: boolean
  source?: string
}

export type ProviderRuntimeAuth = {
  token: string
  headers: Record<string, string>
  providerSpecificData: Record<string, unknown>
}

type StoredProviderOAuthConnection = {
  providerId: ProviderOAuthId
  accessToken: string
  refreshToken: string | null
  idToken?: string | null
  expiresAt: number | null
  scopes: string[]
  accountLabel?: string
  providerSpecificData: Record<string, unknown>
}

type DeviceSession = {
  flowType: 'device_code'
  providerId: DeviceOAuthProviderId
  connectionVersion: number
  deviceCode: string
  expiresAt: number
  intervalMs: number
  lastPolledAt: number
  providerSpecificData: Record<string, unknown>
}

type BrowserSession = {
  flowType: 'authorization_code_pkce' | 'authorization_code'
  providerId: BrowserOAuthProviderId
  connectionVersion: number
  redirectUri: string
  callbackPath: string
  requiresState: boolean
  state: string
  codeVerifier: string
  providerSpecificData: Record<string, unknown>
  expiresAt: number
  intervalMs: number
  outcome:
    | { status: 'pending' }
    | { status: 'connected'; connection: ProviderOAuthStatus }
    | { status: 'error'; message: string }
  server: Server
  cleanupTimer: ReturnType<typeof setTimeout>
}

type OAuthSession = DeviceSession | BrowserSession
type FetchFn = typeof fetch

const KIMI_CLIENT_ID = '17e5f671-d194-4dfb-9706-5516cb48c098'
const GITHUB_CLIENT_ID = 'Iv1.b507a08c87ecfe98'
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const KIMI_DEVICE_CODE_URL = 'https://auth.kimi.com/api/oauth/device_authorization'
const KIMI_TOKEN_URL = 'https://auth.kimi.com/api/oauth/token'
const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code'
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const GITHUB_USER_URL = 'https://api.github.com/user'
const GITHUB_COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token'
const KILOCODE_DEVICE_CODE_URL = 'https://api.kilo.ai/api/device-auth/codes'
const CODEBUDDY_BASE_URL = 'https://copilot.tencent.com'
const CODEBUDDY_STATE_URL = `${CODEBUDDY_BASE_URL}/v2/plugin/auth/state`
const CODEBUDDY_TOKEN_URL = `${CODEBUDDY_BASE_URL}/v2/plugin/auth/token`
const CODEBUDDY_REFRESH_URL = `${CODEBUDDY_TOKEN_URL}/refresh`
const CLINE_AUTHORIZE_URL = 'https://api.cline.bot/api/v1/auth/authorize'
const CLINE_TOKEN_URL = 'https://api.cline.bot/api/v1/auth/token'
const CLINE_REFRESH_URL = 'https://api.cline.bot/api/v1/auth/refresh'
const GROK_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828'
const GROK_DEVICE_CODE_URL = 'https://auth.x.ai/oauth2/device/code'
const GROK_TOKEN_URL = 'https://auth.x.ai/oauth2/token'
const AWS_OIDC_REGION = 'us-east-1'
const AWS_REGISTER_CLIENT_URL = `https://oidc.${AWS_OIDC_REGION}.amazonaws.com/client/register`
const AWS_DEVICE_AUTH_URL = `https://oidc.${AWS_OIDC_REGION}.amazonaws.com/device_authorization`
const AWS_TOKEN_URL = `https://oidc.${AWS_OIDC_REGION}.amazonaws.com/token`
const AWS_BUILDER_ID_START_URL = 'https://view.awsapps.com/start'
const AWS_BUILDER_ID_ISSUER =
  'https://identitycenter.amazonaws.com/ssoins-722374e8c3c8e6c6'
const AWS_Q_SCOPES = [
  'codewhisperer:completions',
  'codewhisperer:analysis',
  'codewhisperer:conversations',
]
const CODEX_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize'
const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const CODEX_CALLBACK_PATH = '/auth/callback'
const CODEX_CALLBACK_PORT = 1455
const CODEX_OAUTH_TIMEOUT_MS = 10 * 60_000
const GITHUB_API_VERSION = '2026-06-01'
const GITHUB_EDITOR_VERSION = 'vscode/1.126.0'
const GITHUB_CHAT_PLUGIN_VERSION = 'copilot-chat/0.54.0'
const GITHUB_CHAT_USER_AGENT = 'GitHubCopilotChat/0.54.0'
const GITHUB_REFRESH_PLUGIN_VERSION = 'copilot/1.388.0'
const KIMI_CLI_VERSION = '0.26.0'
const CODEBUDDY_AUTH_USER_AGENT = 'CLI/2.63.2 CodeBuddy/2.63.2'
const CODEBUDDY_RUNTIME_USER_AGENT = 'CLI/2.108.1 CodeBuddy/2.108.1'
const CLINE_CLIENT_VERSION = '1.1.0'
const GROK_CLIENT_VERSION = '0.2.106'
const GROK_OAUTH_SCOPE = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'grok-cli:access',
  'api:access',
  'conversations:read',
  'conversations:write',
  'workspaces:read',
  'workspaces:write',
].join(' ')
const EXPIRY_BUFFER_MS = 5 * 60_000
const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USER_INFO_URL = 'https://www.googleapis.com/oauth2/v1/userinfo'
const GOOGLE_GEMINI_CLI_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]
const GOOGLE_ANTIGRAVITY_SCOPES = [
  ...GOOGLE_GEMINI_CLI_SCOPES,
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs',
]
const GOOGLE_CODE_ASSIST_TIMEOUT_MS = 10 * 60_000
const AWS_REGION_PATTERN = /^[a-z]{2}-[a-z]+-\d{1,2}$/
const GITLAB_CALLBACK_PORT = 54_897

export const OAUTH_PROVIDER_RUNTIME_DEFINITIONS = {
  'kimi-coding': {
    presetId: 'kimi-code',
    name: 'Kimi Coding',
    baseUrl: 'https://api.kimi.com/coding/v1',
    apiFormat: 'openai_chat' as const,
    models: {
      main: 'kimi-for-coding',
      haiku: 'kimi-for-coding',
      sonnet: 'kimi-for-coding',
      opus: 'kimi-for-coding',
    },
    modelContextWindows: {
      main: 262_144,
      haiku: 262_144,
      sonnet: 262_144,
      opus: 262_144,
    },
  },
  github: {
    presetId: 'github-copilot',
    name: 'GitHub Copilot',
    baseUrl: 'https://api.githubcopilot.com',
    apiFormat: 'openai_chat' as const,
    models: {
      main: 'gpt-5.4',
      haiku: 'gpt-5-mini',
      sonnet: 'gpt-5.4',
      opus: 'gpt-5.4',
    },
    modelContextWindows: {
      main: 1_050_000,
      haiku: 400_000,
      sonnet: 1_050_000,
      opus: 1_050_000,
    },
  },
  kilocode: {
    presetId: 'kilocode',
    name: 'Kilo Code',
    baseUrl: 'https://api.kilo.ai/api/openrouter',
    apiFormat: 'openai_chat' as const,
    models: {
      main: 'openai/gpt-5.5',
      haiku: 'openrouter/free',
      sonnet: 'anthropic/claude-sonnet-4.6',
      opus: 'anthropic/claude-opus-4.7',
    },
    modelContextWindows: {
      main: 400_000,
      haiku: 200_000,
      sonnet: 200_000,
      opus: 200_000,
    },
  },
  'codebuddy-cn': {
    presetId: 'codebuddy-cn',
    name: 'CodeBuddy CN',
    baseUrl: `${CODEBUDDY_BASE_URL}/v2`,
    apiFormat: 'openai_chat' as const,
    models: {
      main: 'glm-5.2',
      haiku: 'deepseek-v4-flash',
      sonnet: 'kimi-k2.7',
      opus: 'deepseek-v4-pro',
    },
    modelContextWindows: {
      main: 1_000_000,
      haiku: 1_000_000,
      sonnet: 256_000,
      opus: 1_000_000,
    },
  },
  cline: {
    presetId: 'cline',
    name: 'Cline',
    baseUrl: 'https://api.cline.bot/api/v1',
    apiFormat: 'openai_chat' as const,
    models: {
      main: 'zai/glm-5.2',
      haiku: 'openrouter/free',
      sonnet: 'moonshotai/kimi-k3',
      opus: 'openai/gpt-5.6-sol',
    },
    modelContextWindows: {
      main: 1_040_000,
      haiku: 200_000,
      sonnet: 1_048_576,
      opus: 1_050_000,
    },
  },
  'grok-cli': {
    presetId: 'grok-cli',
    name: 'Grok Build',
    baseUrl: 'https://cli-chat-proxy.grok.com/v1',
    apiFormat: 'openai_responses' as const,
    models: {
      main: 'grok-4.5',
      haiku: 'grok-composer-2.5-fast',
      sonnet: 'grok-composer-2.5-fast',
      opus: 'grok-4.5',
    },
    modelContextWindows: {
      main: 500_000,
      haiku: 200_000,
      sonnet: 200_000,
      opus: 500_000,
    },
  },
  codex: {
    presetId: 'openai-codex',
    name: 'OpenAI Codex',
    baseUrl: 'https://chatgpt.com/backend-api/codex',
    apiFormat: 'openai_responses' as const,
    models: CODEX_DEFAULT_MODELS,
    modelContextWindows: CODEX_DEFAULT_MODEL_CONTEXT_WINDOWS,
    modelCatalog: CODEX_FALLBACK_MODEL_CATALOG,
    modelSyncEnabled: true,
  },
  cursor: {
    presetId: 'cursor-oauth',
    name: 'Cursor',
    baseUrl: 'https://agent.api5.cursor.sh',
    apiFormat: 'openai_chat' as const,
    models: {
      main: 'auto',
      haiku: 'composer-2.5-fast',
      sonnet: 'auto',
      opus: 'auto',
    },
    modelContextWindows: {
      main: 200_000,
      haiku: 200_000,
      sonnet: 200_000,
      opus: 200_000,
    },
  },
  antigravity: {
    presetId: 'antigravity-oauth',
    name: 'Antigravity',
    baseUrl: 'https://cloudcode-pa.googleapis.com',
    apiFormat: 'openai_chat' as const,
    models: {
      main: 'gemini-pro-agent',
      haiku: 'gemini-3.6-flash-low',
      sonnet: 'claude-sonnet-4-6',
      opus: 'claude-opus-4-6-thinking',
    },
    modelContextWindows: {
      main: 1_000_000,
      haiku: 1_000_000,
      sonnet: 200_000,
      opus: 200_000,
    },
  },
  'gemini-cli': {
    presetId: 'gemini-cli-oauth',
    name: 'Gemini CLI',
    baseUrl: 'https://cloudcode-pa.googleapis.com',
    apiFormat: 'openai_chat' as const,
    models: {
      main: 'gemini-pro-agent',
      haiku: 'gemini-3.6-flash-low',
      sonnet: 'gemini-pro-agent',
      opus: 'gemini-pro-agent',
    },
    modelContextWindows: {
      main: 1_000_000,
      haiku: 1_000_000,
      sonnet: 1_000_000,
      opus: 1_000_000,
    },
  },
  qoder: {
    presetId: 'qoder-token',
    name: 'Qoder',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiFormat: 'openai_chat' as const,
    models: {
      main: 'qwen3.8-max-preview',
      haiku: 'deepseek-v4-flash',
      sonnet: 'glm-5.2',
      opus: 'qwen3.8-max-preview',
    },
    modelContextWindows: {
      main: 1_000_000,
      haiku: 1_000_000,
      sonnet: 1_000_000,
      opus: 1_000_000,
    },
  },
  windsurf: {
    presetId: 'windsurf-token',
    name: 'Windsurf',
    baseUrl: 'https://server.self-serve.windsurf.com',
    apiFormat: 'openai_chat' as const,
    models: {
      main: 'swe-1.6-fast',
      haiku: 'swe-1.6-fast',
      sonnet: 'claude-sonnet-4.6',
      opus: 'claude-opus-4.7-high',
    },
    modelContextWindows: {
      main: 200_000,
      haiku: 200_000,
      sonnet: 200_000,
      opus: 200_000,
    },
  },
  'gitlab-duo': {
    presetId: 'gitlab-duo-oauth',
    name: 'GitLab Duo',
    baseUrl: 'https://gitlab.com/api/v4/code_suggestions',
    apiFormat: 'openai_chat' as const,
    models: {
      main: 'claude-sonnet-4-6',
      haiku: 'claude-haiku-4-5',
      sonnet: 'claude-sonnet-4-6',
      opus: 'claude-sonnet-4-6',
    },
    modelContextWindows: {
      main: 128_000,
      haiku: 128_000,
      sonnet: 128_000,
      opus: 128_000,
    },
  },
  'amazon-q': {
    presetId: 'amazon-q-oauth',
    name: 'Amazon Q',
    baseUrl: 'https://codewhisperer.us-east-1.amazonaws.com',
    apiFormat: 'openai_chat' as const,
    models: {
      main: 'claude-sonnet-4.5',
      haiku: 'claude-haiku-4.5',
      sonnet: 'claude-sonnet-4.5',
      opus: 'claude-sonnet-5',
    },
    modelContextWindows: {
      main: 200_000,
      haiku: 200_000,
      sonnet: 200_000,
      opus: 1_000_000,
    },
  },
  trae: {
    presetId: 'trae-token',
    name: 'Trae',
    baseUrl: 'https://core-normal.trae.ai/api/remote/v1',
    apiFormat: 'openai_chat' as const,
    models: {
      main: 'auto',
      haiku: 'work',
      sonnet: 'gemini-3.1-pro',
      opus: 'gpt-5.4',
    },
    modelContextWindows: {
      main: 272_000,
      haiku: 272_000,
      sonnet: 1_000_000,
      opus: 272_000,
    },
  },
} as const

function isSupportedProvider(value: string): value is ProviderOAuthId {
  return (OAUTH_PROVIDER_IDS as readonly string[]).includes(value)
}

function isDeviceProvider(value: ProviderOAuthId): value is DeviceOAuthProviderId {
  return (DEVICE_OAUTH_PROVIDER_IDS as readonly string[]).includes(value)
}

function isBrowserProvider(value: ProviderOAuthId): value is BrowserOAuthProviderId {
  return (BROWSER_OAUTH_PROVIDER_IDS as readonly string[]).includes(value)
}

function isImportProvider(value: ProviderOAuthId): value is ImportOAuthProviderId {
  return (IMPORT_OAUTH_PROVIDER_IDS as readonly string[]).includes(value)
}

function sanitizeHeader(value: unknown, fallback = 'unknown'): string {
  const text = String(value ?? '').trim().replace(/[^\x20-\x7e]/g, '')
  return text || fallback
}

function parseScopes(scope: unknown): string[] {
  if (Array.isArray(scope)) {
    return scope.filter((item): item is string => typeof item === 'string' && item.length > 0)
  }
  return typeof scope === 'string' ? scope.split(/\s+/).filter(Boolean) : []
}

function normalizeEpoch(value: unknown): number | null {
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return normalizeEpoch(numeric)
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return value < 10_000_000_000 ? value * 1000 : value
}

function readNonEmptyString(record: Record<string, unknown>, key: string): string {
  return typeof record[key] === 'string' ? String(record[key]).trim() : ''
}

function normalizeImportedToken(value: unknown, scheme?: string): string {
  let token = typeof value === 'string' ? value.trim() : ''
  if (scheme && token.toLowerCase().startsWith(`${scheme.toLowerCase()} `)) {
    token = token.slice(scheme.length + 1).trim()
  }
  return token
}

function normalizeGitLabBaseUrl(value: unknown): string {
  const raw = typeof value === 'string' && value.trim()
    ? value.trim()
    : 'https://gitlab.com'
  const parsed = new URL(raw)
  const localHttp = parsed.protocol === 'http:' &&
    (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
  if (parsed.protocol !== 'https:' && !localHttp) {
    throw new Error('GitLab URL must use HTTPS')
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '')
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString().replace(/\/+$/, '')
}

function cursorDatabaseCandidates(): string[] {
  const home = homedir()
  if (process.platform === 'darwin') {
    return [
      path.join(home, 'Library/Application Support/Cursor/User/globalStorage/state.vscdb'),
      path.join(home, 'Library/Application Support/Cursor - Insiders/User/globalStorage/state.vscdb'),
    ]
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA?.trim()
    return appData
      ? [path.join(appData, 'Cursor/User/globalStorage/state.vscdb')]
      : []
  }
  return [
    path.join(home, '.config/Cursor/User/globalStorage/state.vscdb'),
    path.join(home, '.config/Cursor - Insiders/User/globalStorage/state.vscdb'),
  ]
}

function parseCursorStoredValue(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  try {
    const decoded = JSON.parse(trimmed)
    return typeof decoded === 'string' ? decoded.trim() : trimmed
  } catch {
    return trimmed
  }
}

function getDeviceModel(): string {
  const platform = osType()
  const version = release()
  if (platform === 'Darwin') return `macOS ${version} ${arch()}`
  if (platform === 'Windows_NT') return `Windows ${version} ${arch()}`
  return `${platform} ${version} ${arch()}`
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function codexTokenMetadata(idToken: unknown): {
  accountLabel?: string
  providerSpecificData: Record<string, unknown>
} {
  if (typeof idToken !== 'string' || !idToken) return { providerSpecificData: {} }
  const payload = decodeJwtPayload(idToken)
  if (!payload) return { providerSpecificData: {} }

  const rawAuth = payload['https://api.openai.com/auth']
  const auth = rawAuth && typeof rawAuth === 'object' && !Array.isArray(rawAuth)
    ? rawAuth as Record<string, unknown>
    : {}
  const email = typeof payload.email === 'string' && payload.email.trim()
    ? payload.email.trim()
    : undefined

  return {
    ...(email && { accountLabel: email }),
    providerSpecificData: {
      ...(typeof auth.chatgpt_account_id === 'string' && auth.chatgpt_account_id && {
        workspaceId: auth.chatgpt_account_id,
      }),
      ...(typeof auth.chatgpt_plan_type === 'string' && auth.chatgpt_plan_type && {
        workspacePlanType: auth.chatgpt_plan_type,
      }),
      ...(typeof auth.chatgpt_user_id === 'string' && auth.chatgpt_user_id && {
        chatgptUserId: auth.chatgpt_user_id,
      }),
      ...(typeof auth.user_id === 'string' && auth.user_id && {
        userId: auth.user_id,
      }),
      ...(Array.isArray(auth.organizations) && { organizations: auth.organizations }),
    },
  }
}

function grokTokenMetadata(
  accessToken: string,
  idToken: unknown,
): {
  accountLabel?: string
  providerSpecificData: Record<string, unknown>
} {
  const access = decodeJwtPayload(accessToken) ?? {}
  const identity = typeof idToken === 'string' ? decodeJwtPayload(idToken) ?? {} : {}
  const readString = (record: Record<string, unknown>, key: string): string | undefined => (
    typeof record[key] === 'string' && record[key]
      ? String(record[key])
      : undefined
  )
  const principalType = readString(access, 'principal_type') ??
    readString(identity, 'principal_type')
  const principalId = readString(access, 'principal_id') ??
    readString(identity, 'principal_id')
  const email = readString(identity, 'email') ??
    readString(identity, 'preferred_username') ??
    readString(access, 'email')
  const isSharedPrincipal = (
    principalType?.toLowerCase() === 'team' ||
    principalType?.toLowerCase() === 'organization'
  ) && Boolean(principalId)
  const userId = isSharedPrincipal
    ? principalId
    : readString(identity, 'sub') ?? readString(access, 'sub')

  return {
    ...(email && { accountLabel: email }),
    providerSpecificData: {
      ...(email && { email }),
      ...(userId && { userId }),
      ...(principalType && { principalType }),
      ...(principalId && { principalId }),
      ...(readString(access, 'team_id') && { teamId: readString(access, 'team_id') }),
      ...(readString(access, 'organization_id') && {
        organizationId: readString(access, 'organization_id'),
      }),
      ...(typeof access.tier === 'number' && { tier: access.tier }),
    },
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function readOAuthError(
  data: Record<string, unknown>,
  raw: string,
): { code: string; message: string } {
  const nested = data.error &&
    typeof data.error === 'object' &&
    !Array.isArray(data.error)
    ? data.error as Record<string, unknown>
    : {}
  const code = readNonEmptyString(nested, 'code') ||
    readNonEmptyString(data, 'error')
  const message = readNonEmptyString(nested, 'message') ||
    readNonEmptyString(data, 'error_description') ||
    code ||
    raw.slice(0, 300)
  return { code, message }
}

function codexTokenExchangeFailure(
  status: number,
  data: Record<string, unknown>,
  raw: string,
): string {
  const { code, message } = readOAuthError(data, raw)
  if (code === 'unsupported_country_region_territory') {
    return 'OpenAI rejected this sign-in because the current country or region is not supported. CyberCode cannot bypass provider region policies. Please choose a provider that is available in your region.'
  }
  return `OpenAI Codex token exchange failed (${status}): ${message}`
}

function browserAuthorizationFailure(
  providerId: BrowserOAuthProviderId,
  code: string | null,
  description: string | null,
): string {
  if (
    (providerId === 'antigravity' || providerId === 'gemini-cli') &&
    (
      code === 'restricted_client' ||
      description?.toLowerCase().includes('unregistered scope')
    )
  ) {
    return 'Google rejected this OAuth client or one of its requested permissions. CyberCode cannot bypass Google account or scope restrictions. Update CyberCode or choose another supported connection method.'
  }
  return description ||
    code ||
    `${OAUTH_PROVIDER_RUNTIME_DEFINITIONS[providerId].name} did not return an authorization code.`
}

function oauthCallbackHtml(success: boolean, message: string): string {
  const title = success ? 'CyberCode authorization complete' : 'CyberCode authorization failed'
  const color = success ? '#17833d' : '#b42318'
  const symbol = success ? '&#10003;' : '!'
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f6f7f9; color: #17191c; font: 15px/1.6 system-ui, sans-serif; }
    main { width: min(420px, calc(100vw - 48px)); padding: 34px; border: 1px solid #e1e4e8; border-radius: 10px; background: #fff; box-shadow: 0 14px 40px rgba(20, 24, 32, .08); text-align: center; }
    .mark { display: grid; place-items: center; width: 48px; height: 48px; margin: 0 auto 16px; border-radius: 50%; background: ${color}; color: white; font-size: 27px; font-weight: 700; }
    h1 { margin: 0 0 8px; font-size: 20px; letter-spacing: 0; }
    p { margin: 0; color: #61666d; }
  </style>
</head>
<body>
  <main>
    <div class="mark">${symbol}</div>
    <h1>${title}</h1>
    <p>${escapeHtml(message)}</p>
  </main>
</body>
</html>`
}

export class ProviderOAuthService {
  private sessions = new Map<string, OAuthSession>()
  private connectionPromises = new Map<
    ProviderOAuthId,
    Promise<StoredProviderOAuthConnection | null>
  >()
  private connectionVersions = new Map<ProviderOAuthId, number>()
  private fetchFn: FetchFn = fetch
  private readonly codexCallbackPort: number
  private readonly qoderRuntime: {
    validateToken(token: string, signal?: AbortSignal): Promise<string[]>
  }

  constructor(options?: {
    codexCallbackPort?: number
    qoderRuntime?: {
      validateToken(token: string, signal?: AbortSignal): Promise<string[]>
    }
  }) {
    this.codexCallbackPort = options?.codexCallbackPort ?? CODEX_CALLBACK_PORT
    this.qoderRuntime = options?.qoderRuntime ?? qoderRuntimeService
  }

  setFetchFn(fetchFn: FetchFn): void {
    this.fetchFn = fetchFn
  }

  resetFetchFn(): void {
    this.fetchFn = fetch
  }

  private fetchOAuth(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    const timeoutSignal = AbortSignal.timeout(30_000)
    const signal = init?.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal
    return this.fetchFn(input, { ...init, signal })
  }

  clearSessions(): void {
    for (const session of this.sessions.values()) {
      if (session.flowType !== 'device_code') {
        clearTimeout(session.cleanupTimer)
        session.server.close()
      }
    }
    this.sessions.clear()
    this.connectionPromises.clear()
    this.connectionVersions.clear()
  }

  private connectionVersion(providerId: ProviderOAuthId): number {
    return this.connectionVersions.get(providerId) ?? 0
  }

  private invalidateConnection(providerId: ProviderOAuthId): void {
    this.connectionVersions.set(providerId, this.connectionVersion(providerId) + 1)
    this.connectionPromises.delete(providerId)
  }

  private async saveRefreshedConnection(
    connection: StoredProviderOAuthConnection,
    expectedVersion: number,
  ): Promise<boolean> {
    if (this.connectionVersion(connection.providerId) !== expectedVersion) return false
    await this.saveConnection(connection)
    if (this.connectionVersion(connection.providerId) === expectedVersion) return true
    await fs.unlink(this.connectionPath(connection.providerId)).catch(() => {})
    return false
  }

  private get storageDir(): string {
    return path.join(getClaudeConfigHomeDir(), 'cybercode', 'provider-oauth')
  }

  private connectionPath(providerId: ProviderOAuthId): string {
    return path.join(this.storageDir, `${providerId}.json`)
  }

  private deviceIdentityPath(): string {
    return path.join(this.storageDir, 'kimi-device.json')
  }

  private async findCursorCredentials(): Promise<{
    accessToken: string
    machineId: string
    source: string
  } | null> {
    for (const databasePath of cursorDatabaseCandidates()) {
      let database: Database | null = null
      try {
        await fs.access(databasePath)
        database = new Database(databasePath, { readonly: true })
        const statement = database.query(
          'SELECT value FROM ItemTable WHERE key = ? LIMIT 1',
        )
        const readValue = (keys: string[]): string => {
          for (const key of keys) {
            const row = statement.get(key) as { value?: unknown } | null
            const value = parseCursorStoredValue(row?.value)
            if (value) return value
          }
          return ''
        }
        const accessToken = readValue([
          'cursorAuth/accessToken',
          'cursorAuth/token',
        ])
        if (!accessToken) continue
        const machineId = readValue([
          'storage.serviceMachineId',
          'storage.machineId',
          'telemetry.machineId',
        ])
        return { accessToken, machineId, source: databasePath }
      } catch {
        // Cursor may hold the database open. Continue to the JSON fallback.
      } finally {
        database?.close()
      }
    }

    const authJsonPath = path.join(homedir(), '.config/cursor/auth.json')
    try {
      const parsed = JSON.parse(await fs.readFile(authJsonPath, 'utf-8')) as Record<
        string,
        unknown
      >
      const accessToken = readNonEmptyString(parsed, 'accessToken') ||
        readNonEmptyString(parsed, 'token')
      if (accessToken) {
        return {
          accessToken,
          machineId: readNonEmptyString(parsed, 'machineId'),
          source: authJsonPath,
        }
      }
    } catch {
      // No Cursor Agent credential file is a normal state.
    }
    return null
  }

  async detect(providerId: string): Promise<ProviderOAuthDetection> {
    if (!isImportProvider(providerId)) {
      throw new Error(`Provider does not support local credential detection: ${providerId}`)
    }
    if (providerId !== 'cursor') return { providerId, found: false }
    const credentials = await this.findCursorCredentials()
    return {
      providerId,
      found: credentials !== null,
      ...(credentials && { source: credentials.source }),
    }
  }

  async importConnection(
    providerId: string,
    input: ProviderOAuthImportInput,
    options?: { autoDetect?: boolean },
  ): Promise<ProviderOAuthStatus> {
    if (!isImportProvider(providerId)) {
      throw new Error(`Provider does not support credential import: ${providerId}`)
    }

    let accessToken = normalizeImportedToken(
      input.accessToken,
      providerId === 'trae' ? 'Cloud-IDE-JWT' : undefined,
    )
    let machineId = typeof input.machineId === 'string' ? input.machineId.trim() : ''
    let source = 'manual'
    if (providerId === 'cursor' && options?.autoDetect) {
      const detected = await this.findCursorCredentials()
      if (!detected) {
        throw new Error('Cursor credentials were not found on this computer')
      }
      accessToken = detected.accessToken
      machineId = detected.machineId
      source = detected.source
    }

    const minimumLength = providerId === 'qoder' ? 8 : 16
    if (accessToken.length < minimumLength) {
      throw new Error(`${providerId} token is empty or too short`)
    }

    const jwtExpiry = providerId === 'trae'
      ? normalizeEpoch(decodeJwtPayload(accessToken)?.exp)
      : null
    const providerSpecificData: Record<string, unknown> = {
      authMethod: source === 'manual' ? 'imported' : 'local-import',
      source,
    }
    if (providerId === 'cursor') {
      Object.assign(providerSpecificData, {
        ...(machineId && { machineId }),
        clientVersion: '3.2.14',
      })
    } else if (providerId === 'qoder') {
      const isPersonalToken = accessToken.startsWith('pt-')
      const availableModels = isPersonalToken
        ? await this.qoderRuntime.validateToken(accessToken)
        : []
      Object.assign(providerSpecificData, {
        tokenType: isPersonalToken ? 'pat' : 'api',
        transport: isPersonalToken ? 'qodercli' : 'dashscope',
        ...(availableModels.length > 0 && { availableModels }),
      })
    } else if (providerId === 'windsurf') {
      Object.assign(providerSpecificData, {
        ideName: 'windsurf',
        ideVersion: '3.14.0',
        extensionVersion: '3.14.0',
      })
    } else {
      Object.assign(providerSpecificData, {
        webId: input.webId?.trim() || '',
        bizUserId: input.bizUserId?.trim() || '',
        userUniqueId: input.userUniqueId?.trim() || '',
        scope: input.scope?.trim() || 'marscode-us',
        tenant: input.tenant?.trim() || 'marscode',
        region: input.region?.trim() || 'US-East',
        aiRegion: input.region?.trim() || 'US-East',
        appLanguage: 'en',
        appVersion: '1.0.0.1229',
        userRegion: 'US',
        userIdentity: 'Free',
      })
    }

    this.invalidateConnection(providerId)
    const connection: StoredProviderOAuthConnection = {
      providerId,
      accessToken,
      refreshToken: null,
      expiresAt: jwtExpiry ?? (
        providerId === 'trae' ? Date.now() + 14 * 24 * 60 * 60_000 : null
      ),
      scopes: [],
      accountLabel: source === 'manual'
        ? undefined
        : path.basename(source),
      providerSpecificData,
    }
    await this.saveConnection(connection)
    return this.toStatus(connection)
  }

  private async loadConnection(
    providerId: ProviderOAuthId,
  ): Promise<StoredProviderOAuthConnection | null> {
    try {
      const raw = await fs.readFile(this.connectionPath(providerId), 'utf-8')
      return JSON.parse(raw) as StoredProviderOAuthConnection
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  private async saveConnection(connection: StoredProviderOAuthConnection): Promise<void> {
    await fs.mkdir(this.storageDir, { recursive: true, mode: 0o700 })
    const target = this.connectionPath(connection.providerId)
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
    try {
      await fs.writeFile(temporary, `${JSON.stringify(connection, null, 2)}\n`, {
        encoding: 'utf-8',
        mode: 0o600,
      })
      await fs.rename(temporary, target)
      await fs.chmod(target, 0o600).catch(() => {})
    } catch (error) {
      await fs.unlink(temporary).catch(() => {})
      throw error
    }
  }

  private async getKimiIdentity(): Promise<Record<string, string>> {
    let deviceId = ''
    try {
      const parsed = JSON.parse(await fs.readFile(this.deviceIdentityPath(), 'utf-8')) as {
        deviceId?: unknown
      }
      if (typeof parsed.deviceId === 'string') deviceId = parsed.deviceId.trim()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    if (!deviceId) {
      deviceId = randomUUID()
      await fs.mkdir(this.storageDir, { recursive: true, mode: 0o700 })
      const target = this.deviceIdentityPath()
      await fs.writeFile(target, `${JSON.stringify({ deviceId }, null, 2)}\n`, {
        encoding: 'utf-8',
        mode: 0o600,
      })
      await fs.chmod(target, 0o600).catch(() => {})
    }

    return {
      deviceId,
      deviceName: sanitizeHeader(hostname()),
      deviceModel: sanitizeHeader(getDeviceModel()),
      osVersion: sanitizeHeader(release()),
    }
  }

  private kimiHeaders(identity: Record<string, unknown>): Record<string, string> {
    return {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'X-Msh-Platform': 'kimi_code_cli',
      'X-Msh-Version': KIMI_CLI_VERSION,
      'X-Msh-Device-Name': sanitizeHeader(identity.deviceName),
      'X-Msh-Device-Model': sanitizeHeader(identity.deviceModel),
      'X-Msh-Os-Version': sanitizeHeader(identity.osVersion),
      'X-Msh-Device-Id': sanitizeHeader(identity.deviceId),
    }
  }

  private codeBuddyAnonymousHeaders(): Record<string, string> {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': CODEBUDDY_AUTH_USER_AGENT,
      'X-Requested-With': 'XMLHttpRequest',
      'X-Domain': 'copilot.tencent.com',
      'X-No-Authorization': 'true',
      'X-No-User-Id': 'true',
      'X-No-Enterprise-Id': 'true',
      'X-No-Department-Info': 'true',
      'X-Product': 'SaaS',
    }
  }

  private async beginDeviceAuthorization(
    providerId: DeviceOAuthProviderId,
  ): Promise<{
    deviceCode: string
    userCode: string
    verificationUri: string
    verificationUriComplete: string
    expiresIn: number
    intervalMs: number
    providerSpecificData: Record<string, unknown>
  }> {
    if (providerId === 'amazon-q') {
      const registrationResponse = await this.fetchOAuth(AWS_REGISTER_CLIENT_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientName: 'cybercode-oauth-client',
          clientType: 'public',
          scopes: AWS_Q_SCOPES,
          grantTypes: [
            'urn:ietf:params:oauth:grant-type:device_code',
            'refresh_token',
          ],
          issuerUrl: AWS_BUILDER_ID_ISSUER,
        }),
      })
      const registration = await registrationResponse.json().catch(() => ({})) as Record<
        string,
        unknown
      >
      if (
        !registrationResponse.ok ||
        typeof registration.clientId !== 'string' ||
        typeof registration.clientSecret !== 'string'
      ) {
        const detail = typeof registration.message === 'string'
          ? registration.message
          : `HTTP ${registrationResponse.status}`
        throw new Error(`Amazon Q client registration failed: ${detail}`)
      }

      const deviceResponse = await this.fetchOAuth(AWS_DEVICE_AUTH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientId: registration.clientId,
          clientSecret: registration.clientSecret,
          startUrl: AWS_BUILDER_ID_START_URL,
        }),
      })
      const data = await deviceResponse.json().catch(() => ({})) as Record<string, unknown>
      const deviceCode = readNonEmptyString(data, 'deviceCode')
      const userCode = readNonEmptyString(data, 'userCode')
      const verificationUri = readNonEmptyString(data, 'verificationUri')
      const verificationUriComplete =
        readNonEmptyString(data, 'verificationUriComplete') || verificationUri
      if (!deviceResponse.ok || !deviceCode || !userCode || !verificationUri) {
        const detail = readNonEmptyString(data, 'message') || `HTTP ${deviceResponse.status}`
        throw new Error(`Amazon Q device authorization failed: ${detail}`)
      }
      return {
        deviceCode,
        userCode,
        verificationUri,
        verificationUriComplete,
        expiresIn: typeof data.expiresIn === 'number' ? data.expiresIn : 600,
        intervalMs: Math.max(
          2_000,
          (typeof data.interval === 'number' ? data.interval : 5) * 1000,
        ),
        providerSpecificData: {
          clientId: registration.clientId,
          clientSecret: registration.clientSecret,
          region: AWS_OIDC_REGION,
          authMethod: 'builder-id',
        },
      }
    }

    if (providerId === 'kilocode') {
      const response = await this.fetchOAuth(KILOCODE_DEVICE_CODE_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      })
      if (!response.ok) {
        const detail = response.status === 429
          ? 'Too many pending authorization requests'
          : (await response.text()).slice(0, 300)
        throw new Error(`Kilo Code authorization failed (${response.status}): ${detail}`)
      }
      const data = await response.json() as Record<string, unknown>
      const code = typeof data.code === 'string' ? data.code : ''
      const verificationUrl = typeof data.verificationUrl === 'string'
        ? data.verificationUrl
        : ''
      if (!code || !verificationUrl) {
        throw new Error('Kilo Code authorization response is incomplete')
      }
      return {
        deviceCode: code,
        userCode: code,
        verificationUri: verificationUrl,
        verificationUriComplete: verificationUrl,
        expiresIn: typeof data.expiresIn === 'number' ? data.expiresIn : 300,
        intervalMs: 3_000,
        providerSpecificData: {},
      }
    }

    if (providerId === 'codebuddy-cn') {
      const stateUrl = new URL(CODEBUDDY_STATE_URL)
      stateUrl.searchParams.set('platform', 'CLI')
      const response = await this.fetchOAuth(stateUrl, {
        method: 'POST',
        headers: this.codeBuddyAnonymousHeaders(),
        body: JSON.stringify({ platform: 'CLI' }),
      })
      if (!response.ok) {
        throw new Error(`CodeBuddy authorization failed (${response.status})`)
      }
      const payload = await response.json() as Record<string, unknown>
      const data = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
        ? payload.data as Record<string, unknown>
        : {}
      const state = typeof data.state === 'string' ? data.state : ''
      const verificationUrl = typeof data.authUrl === 'string'
        ? data.authUrl
        : typeof data.url === 'string' ? data.url : ''
      if (payload.code !== 0 || !state || !verificationUrl) {
        const detail = typeof payload.msg === 'string' ? payload.msg : 'missing login state'
        throw new Error(`CodeBuddy authorization failed: ${detail}`)
      }
      return {
        deviceCode: state,
        userCode: state,
        verificationUri: verificationUrl,
        verificationUriComplete: verificationUrl,
        expiresIn: 600,
        intervalMs: 5_000,
        providerSpecificData: {},
      }
    }

    if (providerId === 'grok-cli') {
      const response = await this.fetchOAuth(GROK_DEVICE_CODE_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Grok-Client-Version': GROK_CLIENT_VERSION,
          'X-Grok-Client-Surface': 'ui',
        },
        body: new URLSearchParams({
          client_id: GROK_CLIENT_ID,
          scope: GROK_OAUTH_SCOPE,
          referrer: 'grok-build',
        }),
      })
      const data = await response.json().catch(() => ({})) as Record<string, unknown>
      if (!response.ok) {
        const detail = typeof data.error_description === 'string'
          ? data.error_description
          : `HTTP ${response.status}`
        throw new Error(`Grok Build authorization failed: ${detail}`)
      }
      const deviceCode = typeof data.device_code === 'string' ? data.device_code : ''
      const userCode = typeof data.user_code === 'string' ? data.user_code : ''
      const verificationUri = typeof data.verification_uri === 'string'
        ? data.verification_uri
        : ''
      const verificationUriComplete = typeof data.verification_uri_complete === 'string'
        ? data.verification_uri_complete
        : verificationUri
      if (
        !deviceCode ||
        !/^[A-Za-z0-9-]+$/.test(userCode) ||
        !verificationUri
      ) {
        throw new Error('Grok Build authorization response is incomplete')
      }
      for (const candidate of [verificationUri, verificationUriComplete]) {
        const parsed = new URL(candidate)
        const localHttp = parsed.protocol === 'http:' &&
          (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
        if (parsed.protocol !== 'https:' && !localHttp) {
          throw new Error('Grok Build returned an unsupported verification URL')
        }
      }
      return {
        deviceCode,
        userCode,
        verificationUri,
        verificationUriComplete,
        expiresIn: typeof data.expires_in === 'number' ? data.expires_in : 1_800,
        intervalMs: Math.max(
          2_000,
          (typeof data.interval === 'number' ? data.interval : 5) * 1000,
        ),
        providerSpecificData: {},
      }
    }

    const identity = providerId === 'kimi-coding' ? await this.getKimiIdentity() : null
    const response = await this.fetchOAuth(
      providerId === 'kimi-coding' ? KIMI_DEVICE_CODE_URL : GITHUB_DEVICE_CODE_URL,
      {
        method: 'POST',
        headers: providerId === 'kimi-coding'
          ? this.kimiHeaders(identity!)
          : {
              'Content-Type': 'application/x-www-form-urlencoded',
              Accept: 'application/json',
            },
        body: new URLSearchParams({
          client_id: providerId === 'kimi-coding' ? KIMI_CLIENT_ID : GITHUB_CLIENT_ID,
          ...(providerId === 'github' ? { scope: 'read:user' } : {}),
        }),
      },
    )
    if (!response.ok) {
      throw new Error(`Device authorization failed (${response.status}): ${await response.text()}`)
    }

    const data = await response.json() as Record<string, unknown>
    const deviceCode = typeof data.device_code === 'string' ? data.device_code : ''
    const userCode = typeof data.user_code === 'string' ? data.user_code : ''
    const verificationUri = typeof data.verification_uri === 'string'
      ? data.verification_uri
      : typeof data.verification_url === 'string' ? data.verification_url : ''
    const verificationUriComplete = typeof data.verification_uri_complete === 'string'
      ? data.verification_uri_complete
      : verificationUri
    if (!deviceCode || !userCode || !verificationUri) {
      throw new Error('Device authorization response is incomplete')
    }

    return {
      deviceCode,
      userCode,
      verificationUri,
      verificationUriComplete,
      expiresIn: typeof data.expires_in === 'number' ? data.expires_in : 900,
      intervalMs: Math.max(
        2_000,
        (typeof data.interval === 'number' ? data.interval : 5) * 1000,
      ),
      providerSpecificData: {},
    }
  }

  async start(
    providerId: string,
    options: ProviderOAuthStartOptions = {},
  ): Promise<ProviderOAuthStart> {
    if (!isSupportedProvider(providerId)) {
      throw new Error(`OAuth provider is not supported yet: ${providerId}`)
    }
    if (isImportProvider(providerId)) {
      throw new Error(`${providerId} uses local credential import instead of browser OAuth`)
    }
    if (isBrowserProvider(providerId)) {
      if (providerId === 'codex') return this.startCodexBrowserFlow()
      if (providerId === 'cline') return this.startClineBrowserFlow()
      if (providerId === 'gitlab-duo') return this.startGitLabBrowserFlow(options)
      return this.startGoogleCodeAssistBrowserFlow(providerId)
    }
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.providerId === providerId) this.cleanupSession(sessionId)
    }

    const authorization = await this.beginDeviceAuthorization(providerId)
    const sessionId = randomUUID()
    const expiresAt = Date.now() + authorization.expiresIn * 1000
    this.sessions.set(sessionId, {
      flowType: 'device_code',
      providerId,
      connectionVersion: this.connectionVersion(providerId),
      deviceCode: authorization.deviceCode,
      expiresAt,
      intervalMs: authorization.intervalMs,
      lastPolledAt: 0,
      providerSpecificData: authorization.providerSpecificData,
    })

    return {
      flowType: 'device_code',
      providerId,
      sessionId,
      userCode: authorization.userCode,
      verificationUri: authorization.verificationUri,
      verificationUriComplete: authorization.verificationUriComplete,
      expiresAt,
      intervalMs: authorization.intervalMs,
    }
  }

  private async startCodexBrowserFlow(): Promise<BrowserOAuthStart> {
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.providerId === 'codex') this.cleanupSession(sessionId)
    }

    const sessionId = randomUUID()
    const state = generateState()
    const codeVerifier = generateCodeVerifier()
    const codeChallenge = generateCodeChallenge(codeVerifier)
    const server = createServer((req, res) => {
      void this.handleBrowserCallback(sessionId, req.url ?? '/', res)
    })

    const port = await new Promise<number>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.removeListener('listening', onListening)
        if (error.code === 'EADDRINUSE') {
          reject(new Error(
            `OpenAI Codex login needs localhost port ${this.codexCallbackPort}, but it is already in use. Close the other Codex login window and try again.`,
          ))
          return
        }
        reject(new Error(`Failed to start the OpenAI Codex login callback: ${error.message}`))
      }
      const onListening = () => {
        server.removeListener('error', onError)
        const address = server.address()
        if (!address || typeof address === 'string') {
          reject(new Error('OpenAI Codex login callback did not expose a local port'))
          return
        }
        resolve(address.port)
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(this.codexCallbackPort, '127.0.0.1')
    })

    const redirectUri = `http://localhost:${port}${CODEX_CALLBACK_PATH}`
    const expiresAt = Date.now() + CODEX_OAUTH_TIMEOUT_MS
    const cleanupTimer = setTimeout(() => this.cleanupSession(sessionId), CODEX_OAUTH_TIMEOUT_MS)
    cleanupTimer.unref?.()
    this.sessions.set(sessionId, {
      flowType: 'authorization_code_pkce',
      providerId: 'codex',
      connectionVersion: this.connectionVersion('codex'),
      redirectUri,
      callbackPath: CODEX_CALLBACK_PATH,
      requiresState: true,
      state,
      codeVerifier,
      providerSpecificData: {},
      expiresAt,
      intervalMs: 1_000,
      outcome: { status: 'pending' },
      server,
      cleanupTimer,
    })

    const authorizeUrl = new URL(CODEX_AUTHORIZE_URL)
    authorizeUrl.search = new URLSearchParams({
      response_type: 'code',
      client_id: CODEX_CLIENT_ID,
      redirect_uri: redirectUri,
      scope: 'openid profile email offline_access',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
      originator: 'codex_cli_rs',
      prompt: 'login',
      state,
    }).toString()

    return {
      flowType: 'authorization_code_pkce',
      providerId: 'codex',
      sessionId,
      authorizeUrl: authorizeUrl.toString(),
      redirectUri,
      expiresAt,
      intervalMs: 1_000,
    }
  }

  private async startClineBrowserFlow(): Promise<BrowserOAuthStart> {
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.providerId === 'cline') this.cleanupSession(sessionId)
    }

    const sessionId = randomUUID()
    const server = createServer((req, res) => {
      void this.handleBrowserCallback(sessionId, req.url ?? '/', res)
    })
    const port = await new Promise<number>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.removeListener('listening', onListening)
        reject(new Error(`Failed to start the Cline login callback: ${error.message}`))
      }
      const onListening = () => {
        server.removeListener('error', onError)
        const address = server.address()
        if (!address || typeof address === 'string') {
          reject(new Error('Cline login callback did not expose a local port'))
          return
        }
        resolve(address.port)
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(0, '127.0.0.1')
    })

    const callbackPath = '/callback'
    const redirectUri = `http://localhost:${port}${callbackPath}`
    const expiresAt = Date.now() + CODEX_OAUTH_TIMEOUT_MS
    const cleanupTimer = setTimeout(() => this.cleanupSession(sessionId), CODEX_OAUTH_TIMEOUT_MS)
    cleanupTimer.unref?.()
    this.sessions.set(sessionId, {
      flowType: 'authorization_code',
      providerId: 'cline',
      connectionVersion: this.connectionVersion('cline'),
      redirectUri,
      callbackPath,
      requiresState: false,
      state: '',
      codeVerifier: '',
      providerSpecificData: {},
      expiresAt,
      intervalMs: 1_000,
      outcome: { status: 'pending' },
      server,
      cleanupTimer,
    })

    const authorizeUrl = new URL(CLINE_AUTHORIZE_URL)
    authorizeUrl.search = new URLSearchParams({
      client_type: 'extension',
      callback_url: redirectUri,
      redirect_uri: redirectUri,
    }).toString()

    return {
      flowType: 'authorization_code',
      providerId: 'cline',
      sessionId,
      authorizeUrl: authorizeUrl.toString(),
      redirectUri,
      expiresAt,
      intervalMs: 1_000,
    }
  }

  private async listenForBrowserCallback(
    sessionId: string,
    providerName: string,
    port = 0,
  ): Promise<{ server: Server; port: number }> {
    const server = createServer((req, res) => {
      void this.handleBrowserCallback(sessionId, req.url ?? '/', res)
    })
    const listeningPort = await new Promise<number>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.removeListener('listening', onListening)
        const portHint = error.code === 'EADDRINUSE' && port > 0
          ? ` Local callback port ${port} is already in use.`
          : ''
        reject(new Error(
          `Failed to start the ${providerName} login callback: ${error.message}.${portHint}`,
        ))
      }
      const onListening = () => {
        server.removeListener('error', onError)
        const address = server.address()
        if (!address || typeof address === 'string') {
          reject(new Error(`${providerName} login callback did not expose a local port`))
          return
        }
        resolve(address.port)
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, '127.0.0.1')
    })
    return { server, port: listeningPort }
  }

  private async startGoogleCodeAssistBrowserFlow(
    providerId: 'antigravity' | 'gemini-cli',
  ): Promise<BrowserOAuthStart> {
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.providerId === providerId) this.cleanupSession(sessionId)
    }

    const sessionId = randomUUID()
    const state = generateState()
    const codeVerifier = generateCodeVerifier()
    const codeChallenge = generateCodeChallenge(codeVerifier)
    const { server, port } = await this.listenForBrowserCallback(
      sessionId,
      providerId === 'antigravity' ? 'Antigravity' : 'Gemini CLI',
    )
    const callbackPath = '/callback'
    const redirectUri = `http://127.0.0.1:${port}${callbackPath}`
    const expiresAt = Date.now() + GOOGLE_CODE_ASSIST_TIMEOUT_MS
    const cleanupTimer = setTimeout(
      () => this.cleanupSession(sessionId),
      GOOGLE_CODE_ASSIST_TIMEOUT_MS,
    )
    cleanupTimer.unref?.()

    const isAntigravity = providerId === 'antigravity'
    const scopes = isAntigravity
      ? GOOGLE_ANTIGRAVITY_SCOPES
      : GOOGLE_GEMINI_CLI_SCOPES
    const clientId = getPublicOAuthCredential(
      isAntigravity ? 'antigravityClientId' : 'geminiClientId',
      isAntigravity ? 'ANTIGRAVITY_OAUTH_CLIENT_ID' : 'GEMINI_OAUTH_CLIENT_ID',
    )
    const clientSecret = getPublicOAuthCredential(
      isAntigravity ? 'antigravityClientSecret' : 'geminiClientSecret',
      isAntigravity ? 'ANTIGRAVITY_OAUTH_CLIENT_SECRET' : 'GEMINI_OAUTH_CLIENT_SECRET',
    )
    this.sessions.set(sessionId, {
      flowType: 'authorization_code_pkce',
      providerId,
      connectionVersion: this.connectionVersion(providerId),
      redirectUri,
      callbackPath,
      requiresState: true,
      state,
      codeVerifier,
      providerSpecificData: {
        clientId,
        clientSecret,
        clientProfile: isAntigravity ? 'ide' : 'cli',
      },
      expiresAt,
      intervalMs: 1_000,
      outcome: { status: 'pending' },
      server,
      cleanupTimer,
    })

    const authorizeUrl = new URL(GOOGLE_AUTHORIZE_URL)
    authorizeUrl.search = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: scopes.join(' '),
      state,
      access_type: 'offline',
      prompt: 'consent',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    }).toString()
    return {
      flowType: 'authorization_code_pkce',
      providerId,
      sessionId,
      authorizeUrl: authorizeUrl.toString(),
      redirectUri,
      expiresAt,
      intervalMs: 1_000,
    }
  }

  private async startGitLabBrowserFlow(
    options: ProviderOAuthStartOptions,
  ): Promise<BrowserOAuthStart> {
    const clientId = options.clientId?.trim() || ''
    if (!clientId) {
      throw new Error('GitLab OAuth application client ID is required')
    }
    const baseUrl = normalizeGitLabBaseUrl(options.baseUrl)
    const clientSecret = options.clientSecret?.trim() || ''
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.providerId === 'gitlab-duo') this.cleanupSession(sessionId)
    }

    const sessionId = randomUUID()
    const state = generateState()
    const codeVerifier = generateCodeVerifier()
    const codeChallenge = generateCodeChallenge(codeVerifier)
    const { server, port } = await this.listenForBrowserCallback(
      sessionId,
      'GitLab Duo',
      GITLAB_CALLBACK_PORT,
    )
    const callbackPath = '/callback'
    const redirectUri = `http://127.0.0.1:${port}${callbackPath}`
    const expiresAt = Date.now() + CODEX_OAUTH_TIMEOUT_MS
    const cleanupTimer = setTimeout(
      () => this.cleanupSession(sessionId),
      CODEX_OAUTH_TIMEOUT_MS,
    )
    cleanupTimer.unref?.()
    this.sessions.set(sessionId, {
      flowType: 'authorization_code_pkce',
      providerId: 'gitlab-duo',
      connectionVersion: this.connectionVersion('gitlab-duo'),
      redirectUri,
      callbackPath,
      requiresState: true,
      state,
      codeVerifier,
      providerSpecificData: {
        baseUrl,
        clientId,
        clientSecret,
      },
      expiresAt,
      intervalMs: 1_000,
      outcome: { status: 'pending' },
      server,
      cleanupTimer,
    })

    const authorizeUrl = new URL(`${baseUrl}/oauth/authorize`)
    authorizeUrl.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state,
      scope: 'ai_features read_user',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    }).toString()
    return {
      flowType: 'authorization_code_pkce',
      providerId: 'gitlab-duo',
      sessionId,
      authorizeUrl: authorizeUrl.toString(),
      redirectUri,
      expiresAt,
      intervalMs: 1_000,
    }
  }

  private async handleBrowserCallback(
    sessionId: string,
    rawUrl: string,
    response: import('node:http').ServerResponse,
  ): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session || session.flowType === 'device_code') {
      response.writeHead(410, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('This CyberCode authorization session has expired.')
      return
    }

    const callbackUrl = new URL(rawUrl, session.redirectUri)
    if (callbackUrl.pathname !== session.callbackPath) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('Not found')
      return
    }

    if (
      session.requiresState &&
      callbackUrl.searchParams.get('state') !== session.state
    ) {
      response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(oauthCallbackHtml(false, 'The login state did not match. Return to CyberCode and try again.'))
      return
    }

    const providerError = callbackUrl.searchParams.get('error')
    const code = callbackUrl.searchParams.get('code')
    if (providerError || !code) {
      const message = browserAuthorizationFailure(
        session.providerId,
        providerError,
        callbackUrl.searchParams.get('error_description'),
      )
      session.outcome = { status: 'error', message }
      response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(oauthCallbackHtml(false, message))
      if (session.server.listening) session.server.close()
      return
    }

    try {
      let connection: StoredProviderOAuthConnection
      if (session.providerId === 'codex') {
        connection = await this.exchangeCodexAuthorizationCode(
          code,
          session.redirectUri,
          session.codeVerifier,
        )
      } else if (session.providerId === 'cline') {
        connection = await this.exchangeClineAuthorizationCode(code, session.redirectUri)
      } else if (
        session.providerId === 'antigravity' ||
        session.providerId === 'gemini-cli'
      ) {
        connection = await this.exchangeGoogleCodeAssistAuthorizationCode(
          session.providerId,
          code,
          session.redirectUri,
          session.codeVerifier,
          session.providerSpecificData,
        )
      } else {
        connection = await this.exchangeGitLabAuthorizationCode(
          code,
          session.redirectUri,
          session.codeVerifier,
          session.providerSpecificData,
        )
      }
      if (this.sessions.get(sessionId) !== session) {
        throw new Error('This CyberCode authorization session was cancelled.')
      }
      if (!await this.saveRefreshedConnection(connection, session.connectionVersion)) {
        throw new Error('This CyberCode authorization session was cancelled.')
      }
      session.outcome = { status: 'connected', connection: this.toStatus(connection) }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(oauthCallbackHtml(
        true,
        `Your ${OAUTH_PROVIDER_RUNTIME_DEFINITIONS[session.providerId].name} account is connected. You can close this tab and return to CyberCode.`,
      ))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      session.outcome = { status: 'error', message }
      response.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(oauthCallbackHtml(false, message))
    } finally {
      if (session.server.listening) session.server.close()
    }
  }

  private async exchangeCodexAuthorizationCode(
    code: string,
    redirectUri: string,
    codeVerifier: string,
  ): Promise<StoredProviderOAuthConnection> {
    const response = await this.fetchOAuth(CODEX_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CODEX_CLIENT_ID,
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    })
    const raw = await response.text()
    let data: Record<string, unknown> = {}
    try {
      data = JSON.parse(raw) as Record<string, unknown>
    } catch {
      // The status and short response body below are enough for a useful error.
    }
    if (!response.ok) {
      throw new Error(codexTokenExchangeFailure(response.status, data, raw))
    }
    if (typeof data.access_token !== 'string' || !data.access_token) {
      throw new Error('OpenAI Codex token response did not include an access token')
    }

    const metadata = codexTokenMetadata(data.id_token)
    return {
      providerId: 'codex',
      accessToken: data.access_token,
      refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : null,
      idToken: typeof data.id_token === 'string' ? data.id_token : null,
      expiresAt: typeof data.expires_in === 'number'
        ? Date.now() + data.expires_in * 1000
        : null,
      scopes: parseScopes(data.scope),
      ...(metadata.accountLabel && { accountLabel: metadata.accountLabel }),
      providerSpecificData: metadata.providerSpecificData,
    }
  }

  private async exchangeClineAuthorizationCode(
    code: string,
    redirectUri: string,
  ): Promise<StoredProviderOAuthConnection> {
    let tokenData: Record<string, unknown> | null = null
    try {
      let encoded = code
      try {
        encoded = decodeURIComponent(encoded)
      } catch {
        // URLSearchParams may already have decoded the callback value.
      }
      const remainder = encoded.length % 4
      if (remainder) encoded += '='.repeat(4 - remainder)
      const decoded = Buffer.from(encoded, 'base64').toString('utf-8')
      const lastBrace = decoded.lastIndexOf('}')
      if (lastBrace >= 0) {
        tokenData = JSON.parse(decoded.slice(0, lastBrace + 1)) as Record<string, unknown>
      }
    } catch {
      tokenData = null
    }

    if (!tokenData || typeof tokenData.accessToken !== 'string' || !tokenData.accessToken) {
      const response = await this.fetchOAuth(CLINE_TOKEN_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code,
          client_type: 'extension',
          redirect_uri: redirectUri,
        }),
      })
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>
      if (!response.ok) {
        const detail = typeof payload.error === 'string'
          ? payload.error
          : `HTTP ${response.status}`
        throw new Error(`Cline token exchange failed: ${detail}`)
      }
      tokenData = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
        ? payload.data as Record<string, unknown>
        : payload
    }

    const accessToken = typeof tokenData.accessToken === 'string'
      ? tokenData.accessToken
      : ''
    if (!accessToken) throw new Error('Cline token response did not include an access token')
    const firstName = typeof tokenData.firstName === 'string' ? tokenData.firstName.trim() : ''
    const lastName = typeof tokenData.lastName === 'string' ? tokenData.lastName.trim() : ''
    const email = typeof tokenData.email === 'string' ? tokenData.email.trim() : ''
    const fullName = [firstName, lastName].filter(Boolean).join(' ')
    const expiresAt = normalizeEpoch(tokenData.expiresAt)

    return {
      providerId: 'cline',
      accessToken,
      refreshToken: typeof tokenData.refreshToken === 'string'
        ? tokenData.refreshToken
        : null,
      expiresAt: expiresAt ?? (
        typeof tokenData.expiresIn === 'number'
          ? Date.now() + tokenData.expiresIn * 1000
          : Date.now() + 3_600_000
      ),
      scopes: [],
      ...((fullName || email) && { accountLabel: fullName || email }),
      providerSpecificData: {
        ...(firstName && { firstName }),
        ...(lastName && { lastName }),
        ...(email && { email }),
      },
    }
  }

  private googleCodeAssistHeaders(
    accessToken: string,
    clientProfile: unknown,
  ): Record<string, string> {
    const profile = clientProfile === 'cli' ? 'cli' : 'ide'
    return {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': profile === 'cli'
        ? 'antigravity/cli/1.1.1 (aidev_client; os_type=darwin; arch=arm64; auth_method=consumer)'
        : 'antigravity/2.1.1 darwin/arm64 google-api-nodejs-client/10.3.0',
      ...(profile === 'ide' && { 'X-Goog-Api-Client': 'gl-node/22.21.1' }),
    }
  }

  private async discoverGoogleCodeAssistIdentity(
    accessToken: string,
    clientProfile: unknown,
  ): Promise<{
    accountLabel?: string
    projectId?: string
    tier?: string
  }> {
    const [userResponse, codeAssistResponse] = await Promise.all([
      this.fetchOAuth(`${GOOGLE_USER_INFO_URL}?alt=json`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }).catch(() => null),
      this.fetchOAuth('https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist', {
        method: 'POST',
        headers: this.googleCodeAssistHeaders(accessToken, clientProfile),
        body: JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } }),
      }).catch(() => null),
    ])

    let accountLabel: string | undefined
    if (userResponse?.ok) {
      const user = await userResponse.json().catch(() => ({})) as Record<string, unknown>
      accountLabel = readNonEmptyString(user, 'email') || undefined
    }

    let projectId: string | undefined
    let tier: string | undefined
    if (codeAssistResponse?.ok) {
      const data = await codeAssistResponse.json().catch(() => ({})) as Record<string, unknown>
      const project = data.cloudaicompanionProject
      projectId = typeof project === 'string'
        ? project
        : project && typeof project === 'object' && !Array.isArray(project)
          ? readNonEmptyString(project as Record<string, unknown>, 'id') || undefined
          : undefined
      const subscription = data.currentTier &&
        typeof data.currentTier === 'object' &&
        !Array.isArray(data.currentTier)
        ? data.currentTier as Record<string, unknown>
        : {}
      tier = readNonEmptyString(subscription, 'id') ||
        readNonEmptyString(subscription, 'name') ||
        undefined
    }
    return { accountLabel, projectId, tier }
  }

  private async exchangeGoogleCodeAssistAuthorizationCode(
    providerId: 'antigravity' | 'gemini-cli',
    code: string,
    redirectUri: string,
    codeVerifier: string,
    providerSpecificData: Record<string, unknown>,
  ): Promise<StoredProviderOAuthConnection> {
    const clientId = readNonEmptyString(providerSpecificData, 'clientId')
    const clientSecret = readNonEmptyString(providerSpecificData, 'clientSecret')
    const response = await this.fetchOAuth(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        ...(clientSecret && { client_secret: clientSecret }),
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    })
    const data = await response.json().catch(() => ({})) as Record<string, unknown>
    if (!response.ok || typeof data.access_token !== 'string' || !data.access_token) {
      const detail = readNonEmptyString(data, 'error_description') ||
        readNonEmptyString(data, 'error') ||
        `HTTP ${response.status}`
      throw new Error(`Google Code Assist token exchange failed: ${detail}`)
    }

    const identity = await this.discoverGoogleCodeAssistIdentity(
      data.access_token,
      providerSpecificData.clientProfile,
    )
    return {
      providerId,
      accessToken: data.access_token,
      refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : null,
      expiresAt: typeof data.expires_in === 'number'
        ? Date.now() + data.expires_in * 1000
        : null,
      scopes: parseScopes(data.scope),
      ...(identity.accountLabel && { accountLabel: identity.accountLabel }),
      providerSpecificData: {
        ...providerSpecificData,
        ...(identity.projectId && { projectId: identity.projectId }),
        ...(identity.tier && { tier: identity.tier }),
      },
    }
  }

  private async exchangeGitLabAuthorizationCode(
    code: string,
    redirectUri: string,
    codeVerifier: string,
    providerSpecificData: Record<string, unknown>,
  ): Promise<StoredProviderOAuthConnection> {
    const baseUrl = normalizeGitLabBaseUrl(providerSpecificData.baseUrl)
    const clientId = readNonEmptyString(providerSpecificData, 'clientId')
    const clientSecret = readNonEmptyString(providerSpecificData, 'clientSecret')
    const body = new URLSearchParams({
      client_id: clientId,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    })
    if (clientSecret) body.set('client_secret', clientSecret)
    const response = await this.fetchOAuth(`${baseUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    })
    const data = await response.json().catch(() => ({})) as Record<string, unknown>
    if (!response.ok || typeof data.access_token !== 'string' || !data.access_token) {
      const detail = readNonEmptyString(data, 'error_description') ||
        readNonEmptyString(data, 'error') ||
        `HTTP ${response.status}`
      throw new Error(`GitLab Duo token exchange failed: ${detail}`)
    }

    const headers = {
      Authorization: `Bearer ${data.access_token}`,
      Accept: 'application/json',
    }
    const [userResponse, directAccessResponse] = await Promise.all([
      this.fetchOAuth(`${baseUrl}/api/v4/user`, { headers }).catch(() => null),
      this.fetchOAuth(`${baseUrl}/api/v4/code_suggestions/direct_access`, {
        method: 'POST',
        headers,
      }).catch(() => null),
    ])
    const user = userResponse?.ok
      ? await userResponse.json().catch(() => ({})) as Record<string, unknown>
      : {}
    const directAccess = directAccessResponse?.ok
      ? await directAccessResponse.json().catch(() => ({})) as Record<string, unknown>
      : {}
    const accountLabel = readNonEmptyString(user, 'name') ||
      readNonEmptyString(user, 'username') ||
      readNonEmptyString(user, 'email')

    return {
      providerId: 'gitlab-duo',
      accessToken: data.access_token,
      refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : null,
      expiresAt: typeof data.expires_in === 'number'
        ? Date.now() + data.expires_in * 1000
        : null,
      scopes: parseScopes(data.scope),
      ...(accountLabel && { accountLabel }),
      providerSpecificData: {
        ...providerSpecificData,
        gitlabUserId: user.id,
        gitlabUsername: user.username,
        ...(readNonEmptyString(directAccess, 'token') &&
          readNonEmptyString(directAccess, 'base_url') && {
            gitlabDirectAccess: {
              token: readNonEmptyString(directAccess, 'token'),
              baseUrl: readNonEmptyString(directAccess, 'base_url'),
              expiresAt: normalizeEpoch(directAccess.expires_at),
              headers: directAccess.headers &&
                typeof directAccess.headers === 'object' &&
                !Array.isArray(directAccess.headers)
                ? directAccess.headers
                : {},
            },
          }),
      },
    }
  }

  private async pollDeviceToken(
    session: DeviceSession,
  ): Promise<
    | { status: 'pending' }
    | {
        status: 'connected'
        data: Record<string, unknown>
        accountLabel?: string
        providerSpecificData: Record<string, unknown>
      }
  > {
    const providerId = session.providerId

    if (providerId === 'amazon-q') {
      const clientId = readNonEmptyString(session.providerSpecificData, 'clientId')
      const clientSecret = readNonEmptyString(session.providerSpecificData, 'clientSecret')
      const region = readNonEmptyString(session.providerSpecificData, 'region') ||
        AWS_OIDC_REGION
      if (!AWS_REGION_PATTERN.test(region) || !clientId || !clientSecret) {
        throw new Error('Amazon Q authorization session is incomplete')
      }
      const response = await this.fetchOAuth(
        `https://oidc.${region}.amazonaws.com/token`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            clientId,
            clientSecret,
            deviceCode: session.deviceCode,
            grantType: 'urn:ietf:params:oauth:grant-type:device_code',
          }),
        },
      )
      const data = await response.json().catch(() => ({})) as Record<string, unknown>
      const error = readNonEmptyString(data, 'error')
      if (error === 'authorization_pending') return { status: 'pending' }
      if (error === 'slow_down') {
        session.intervalMs += 5_000
        return { status: 'pending' }
      }
      const accessToken = readNonEmptyString(data, 'accessToken')
      if (!response.ok || !accessToken) {
        const detail = readNonEmptyString(data, 'error_description') ||
          readNonEmptyString(data, 'message') ||
          error ||
          `HTTP ${response.status}`
        throw new Error(`Amazon Q token exchange failed: ${detail}`)
      }
      return {
        status: 'connected',
        data: {
          access_token: accessToken,
          refresh_token: readNonEmptyString(data, 'refreshToken'),
          expires_in: typeof data.expiresIn === 'number' ? data.expiresIn : 3_600,
        },
        providerSpecificData: session.providerSpecificData,
      }
    }

    if (providerId === 'kilocode') {
      const response = await this.fetchOAuth(
        `${KILOCODE_DEVICE_CODE_URL}/${encodeURIComponent(session.deviceCode)}`,
        { headers: { Accept: 'application/json' } },
      )
      if (response.status === 202) return { status: 'pending' }
      if (response.status === 403) throw new Error('Kilo Code authorization was denied')
      if (response.status === 410) throw new Error('Kilo Code authorization expired')
      if (!response.ok) {
        throw new Error(`Kilo Code token request failed (${response.status})`)
      }
      const data = await response.json() as Record<string, unknown>
      if (data.status !== 'approved' || typeof data.token !== 'string' || !data.token) {
        return { status: 'pending' }
      }
      return {
        status: 'connected',
        data: { access_token: data.token },
        ...(typeof data.userEmail === 'string' && data.userEmail && {
          accountLabel: data.userEmail,
        }),
        providerSpecificData: {},
      }
    }

    if (providerId === 'codebuddy-cn') {
      const tokenUrl = new URL(CODEBUDDY_TOKEN_URL)
      tokenUrl.searchParams.set('state', session.deviceCode)
      const response = await this.fetchOAuth(tokenUrl, {
        headers: this.codeBuddyAnonymousHeaders(),
      })
      if (!response.ok) {
        throw new Error(`CodeBuddy token request failed (${response.status})`)
      }
      const payload = await response.json() as Record<string, unknown>
      const data = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
        ? payload.data as Record<string, unknown>
        : {}
      if (payload.code === 11217) return { status: 'pending' }
      if (payload.code !== 0 || typeof data.accessToken !== 'string' || !data.accessToken) {
        const detail = typeof payload.msg === 'string' ? payload.msg : `code ${String(payload.code)}`
        throw new Error(`CodeBuddy authorization failed: ${detail}`)
      }
      return {
        status: 'connected',
        data: {
          access_token: data.accessToken,
          refresh_token: typeof data.refreshToken === 'string' ? data.refreshToken : '',
          expires_in: typeof data.expiresIn === 'number' ? data.expiresIn : 86_400,
        },
        providerSpecificData: {},
      }
    }

    if (providerId === 'grok-cli') {
      const response = await this.fetchOAuth(GROK_TOKEN_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Grok-Client-Version': GROK_CLIENT_VERSION,
          'X-Grok-Client-Surface': 'ui',
        },
        body: new URLSearchParams({
          client_id: GROK_CLIENT_ID,
          device_code: session.deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      })
      const data = await response.json().catch(() => ({})) as Record<string, unknown>
      const error = typeof data.error === 'string' ? data.error : ''
      if (error === 'authorization_pending') return { status: 'pending' }
      if (error === 'slow_down') {
        session.intervalMs += 5_000
        return { status: 'pending' }
      }
      if (!response.ok || error) {
        const detail = typeof data.error_description === 'string'
          ? data.error_description
          : error || `HTTP ${response.status}`
        throw new Error(`Grok Build token exchange failed: ${detail}`)
      }
      if (typeof data.access_token !== 'string' || !data.access_token) {
        throw new Error('Grok Build token response did not include an access token')
      }
      const metadata = grokTokenMetadata(data.access_token, data.id_token)
      return {
        status: 'connected',
        data: {
          ...data,
          expires_in: typeof data.expires_in === 'number' ? data.expires_in : 21_600,
        },
        ...(metadata.accountLabel && { accountLabel: metadata.accountLabel }),
        providerSpecificData: metadata.providerSpecificData,
      }
    }

    const identity = providerId === 'kimi-coding' ? await this.getKimiIdentity() : null
    const response = await this.fetchOAuth(
      providerId === 'kimi-coding' ? KIMI_TOKEN_URL : GITHUB_TOKEN_URL,
      {
        method: 'POST',
        headers: providerId === 'kimi-coding'
          ? this.kimiHeaders(identity!)
          : {
              'Content-Type': 'application/x-www-form-urlencoded',
              Accept: 'application/json',
            },
        body: new URLSearchParams({
          client_id: providerId === 'kimi-coding' ? KIMI_CLIENT_ID : GITHUB_CLIENT_ID,
          device_code: session.deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      },
    )
    const data = await response.json().catch(() => ({})) as Record<string, unknown>
    const error = typeof data.error === 'string' ? data.error : ''
    if (error === 'authorization_pending') return { status: 'pending' }
    if (error === 'slow_down') {
      session.intervalMs += 5_000
      return { status: 'pending' }
    }
    if (!response.ok || error) {
      const detail = typeof data.error_description === 'string'
        ? data.error_description
        : error || `HTTP ${response.status}`
      throw new Error(`OAuth token exchange failed: ${detail}`)
    }
    if (typeof data.access_token !== 'string' || !data.access_token) {
      throw new Error('OAuth token response did not include an access token')
    }
    return {
      status: 'connected',
      data,
      providerSpecificData: identity ?? {},
    }
  }

  async poll(providerId: string, sessionId: string): Promise<ProviderOAuthPoll> {
    if (!isSupportedProvider(providerId)) {
      throw new Error(`OAuth provider is not supported yet: ${providerId}`)
    }
    const session = this.sessions.get(sessionId)
    if (!session || session.providerId !== providerId) {
      throw new Error('OAuth session was not found')
    }
    if (Date.now() >= session.expiresAt) {
      this.cleanupSession(sessionId)
      throw new Error('OAuth session expired')
    }
    if (session.flowType !== 'device_code') {
      if (session.outcome.status === 'pending') {
        return { status: 'pending', intervalMs: session.intervalMs }
      }
      if (session.outcome.status === 'error') {
        const message = session.outcome.message
        this.cleanupSession(sessionId)
        throw new Error(message)
      }
      const connection = session.outcome.connection
      this.cleanupSession(sessionId)
      return { status: 'connected', connection }
    }
    if (Date.now() - session.lastPolledAt < session.intervalMs - 250) {
      return { status: 'pending', intervalMs: session.intervalMs }
    }
    session.lastPolledAt = Date.now()

    const tokenResult = await this.pollDeviceToken(session)
    if (tokenResult.status === 'pending') {
      return { status: 'pending', intervalMs: session.intervalMs }
    }
    const data = tokenResult.data
    const accessToken = typeof data.access_token === 'string' ? data.access_token : ''
    if (!accessToken) throw new Error('OAuth token response did not include an access token')

    const connection: StoredProviderOAuthConnection = {
      providerId,
      accessToken,
      refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : null,
      ...(typeof data.id_token === 'string' && { idToken: data.id_token }),
      expiresAt: typeof data.expires_in === 'number'
        ? Date.now() + data.expires_in * 1000
        : null,
      scopes: parseScopes(data.scope),
      ...(tokenResult.accountLabel && { accountLabel: tokenResult.accountLabel }),
      providerSpecificData: tokenResult.providerSpecificData,
    }

    if (providerId === 'github') {
      const [copilot, user] = await Promise.all([
        this.fetchGithubCopilotToken(accessToken),
        this.fetchGithubUser(accessToken),
      ])
      connection.accountLabel = user
      connection.providerSpecificData = { ...connection.providerSpecificData, ...copilot }
    }

    if (this.sessions.get(sessionId) !== session) {
      throw new Error('OAuth session was cancelled')
    }
    if (!await this.saveRefreshedConnection(connection, session.connectionVersion)) {
      throw new Error('OAuth session was cancelled')
    }
    this.sessions.delete(sessionId)
    return { status: 'connected', connection: this.toStatus(connection) }
  }

  private async fetchGithubUser(accessToken: string): Promise<string | undefined> {
    const response = await this.fetchOAuth(GITHUB_USER_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
        'User-Agent': GITHUB_CHAT_USER_AGENT,
      },
    })
    if (!response.ok) return undefined
    const data = await response.json() as { login?: unknown; name?: unknown }
    if (typeof data.login === 'string' && data.login) return data.login
    return typeof data.name === 'string' && data.name ? data.name : undefined
  }

  private async fetchGithubCopilotToken(
    accessToken: string,
  ): Promise<Record<string, unknown>> {
    const response = await this.fetchOAuth(GITHUB_COPILOT_TOKEN_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'User-Agent': 'GithubCopilot/1.0',
        'Editor-Version': GITHUB_EDITOR_VERSION,
        'Editor-Plugin-Version': GITHUB_REFRESH_PLUGIN_VERSION,
      },
    })
    if (!response.ok) {
      throw new Error(`GitHub Copilot token request failed (${response.status})`)
    }
    const data = await response.json() as Record<string, unknown>
    if (typeof data.token !== 'string' || !data.token) {
      throw new Error('GitHub account does not have an available Copilot token')
    }
    return {
      copilotToken: data.token,
      copilotTokenExpiresAt: normalizeEpoch(data.expires_at),
    }
  }

  private async refreshKimi(
    connection: StoredProviderOAuthConnection,
    expectedVersion: number,
  ): Promise<StoredProviderOAuthConnection | null> {
    if (!connection.refreshToken) return null
    const identity = {
      ...await this.getKimiIdentity(),
      ...connection.providerSpecificData,
    }
    const response = await this.fetchOAuth(KIMI_TOKEN_URL, {
      method: 'POST',
      headers: this.kimiHeaders(identity),
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: connection.refreshToken,
        client_id: KIMI_CLIENT_ID,
      }),
    })
    if (!response.ok) return null
    const data = await response.json() as Record<string, unknown>
    if (typeof data.access_token !== 'string' || !data.access_token) return null
    const refreshed: StoredProviderOAuthConnection = {
      ...connection,
      accessToken: data.access_token,
      refreshToken: typeof data.refresh_token === 'string'
        ? data.refresh_token
        : connection.refreshToken,
      expiresAt: typeof data.expires_in === 'number'
        ? Date.now() + data.expires_in * 1000
        : connection.expiresAt,
      scopes: parseScopes(data.scope).length > 0 ? parseScopes(data.scope) : connection.scopes,
      providerSpecificData: identity,
    }
    return await this.saveRefreshedConnection(refreshed, expectedVersion)
      ? refreshed
      : null
  }

  private async refreshCodeBuddy(
    connection: StoredProviderOAuthConnection,
    expectedVersion: number,
  ): Promise<StoredProviderOAuthConnection | null> {
    if (!connection.refreshToken) return null
    const response = await this.fetchOAuth(CODEBUDDY_REFRESH_URL, {
      method: 'POST',
      headers: {
        ...this.codeBuddyAnonymousHeaders(),
        'X-Refresh-Token': connection.refreshToken,
        'X-Auth-Refresh-Source': 'plugin',
      },
      body: '{}',
    })
    if (!response.ok) return null
    const payload = await response.json() as Record<string, unknown>
    const data = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
      ? payload.data as Record<string, unknown>
      : {}
    if (payload.code !== 0 || typeof data.accessToken !== 'string' || !data.accessToken) {
      return null
    }

    const refreshed: StoredProviderOAuthConnection = {
      ...connection,
      accessToken: data.accessToken,
      refreshToken: typeof data.refreshToken === 'string' && data.refreshToken
        ? data.refreshToken
        : connection.refreshToken,
      expiresAt: typeof data.expiresIn === 'number'
        ? Date.now() + data.expiresIn * 1000
        : connection.expiresAt,
    }
    return await this.saveRefreshedConnection(refreshed, expectedVersion)
      ? refreshed
      : null
  }

  private async refreshCline(
    connection: StoredProviderOAuthConnection,
    expectedVersion: number,
  ): Promise<StoredProviderOAuthConnection | null> {
    if (!connection.refreshToken) return null
    const response = await this.fetchOAuth(CLINE_REFRESH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        refreshToken: connection.refreshToken,
        grantType: 'refresh_token',
        clientType: 'extension',
      }),
    })
    if (!response.ok) return null
    const payload = await response.json() as Record<string, unknown>
    const data = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
      ? payload.data as Record<string, unknown>
      : payload
    if (typeof data.accessToken !== 'string' || !data.accessToken) return null

    const refreshed: StoredProviderOAuthConnection = {
      ...connection,
      accessToken: data.accessToken,
      refreshToken: typeof data.refreshToken === 'string' && data.refreshToken
        ? data.refreshToken
        : connection.refreshToken,
      expiresAt: normalizeEpoch(data.expiresAt) ?? (
        typeof data.expiresIn === 'number'
          ? Date.now() + data.expiresIn * 1000
          : connection.expiresAt
      ),
    }
    return await this.saveRefreshedConnection(refreshed, expectedVersion)
      ? refreshed
      : null
  }

  private async refreshGrok(
    connection: StoredProviderOAuthConnection,
    expectedVersion: number,
  ): Promise<StoredProviderOAuthConnection | null> {
    if (!connection.refreshToken) return null
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: GROK_CLIENT_ID,
      refresh_token: connection.refreshToken,
    })
    const principalType = connection.providerSpecificData.principalType
    const principalId = connection.providerSpecificData.principalId
    if (typeof principalType === 'string' && principalType) {
      body.set('principal_type', principalType)
    }
    if (typeof principalId === 'string' && principalId) {
      body.set('principal_id', principalId)
    }

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await this.fetchOAuth(GROK_TOKEN_URL, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body,
        })
        const data = await response.json().catch(() => ({})) as Record<string, unknown>
        if (!response.ok) {
          if (data.error === 'invalid_grant' || data.error === 'invalid_client') return null
          if (attempt < 3) {
            await new Promise((resolve) => setTimeout(resolve, attempt * 250))
            continue
          }
          return null
        }
        if (typeof data.access_token !== 'string' || !data.access_token) {
          if (attempt < 3) continue
          return null
        }

        const nextIdToken = typeof data.id_token === 'string'
          ? data.id_token
          : connection.idToken
        const metadata = grokTokenMetadata(data.access_token, nextIdToken)
        const refreshed: StoredProviderOAuthConnection = {
          ...connection,
          accessToken: data.access_token,
          refreshToken: typeof data.refresh_token === 'string' && data.refresh_token
            ? data.refresh_token
            : connection.refreshToken,
          idToken: nextIdToken,
          expiresAt: Date.now() + (
            typeof data.expires_in === 'number' ? data.expires_in : 21_600
          ) * 1000,
          accountLabel: metadata.accountLabel ?? connection.accountLabel,
          providerSpecificData: {
            ...connection.providerSpecificData,
            ...metadata.providerSpecificData,
          },
        }
        return await this.saveRefreshedConnection(refreshed, expectedVersion)
          ? refreshed
          : null
      } catch {
        if (attempt >= 3) return null
        await new Promise((resolve) => setTimeout(resolve, attempt * 250))
      }
    }
    return null
  }

  private async refreshCodex(
    connection: StoredProviderOAuthConnection,
    expectedVersion: number,
  ): Promise<StoredProviderOAuthConnection | null> {
    if (!connection.refreshToken) return null
    const response = await this.fetchOAuth(CODEX_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: connection.refreshToken,
        client_id: CODEX_CLIENT_ID,
      }),
    })
    if (!response.ok) return null
    const data = await response.json() as Record<string, unknown>
    if (typeof data.access_token !== 'string' || !data.access_token) return null

    const nextIdToken = typeof data.id_token === 'string'
      ? data.id_token
      : connection.idToken
    const metadata = codexTokenMetadata(nextIdToken)
    const refreshed: StoredProviderOAuthConnection = {
      ...connection,
      accessToken: data.access_token,
      refreshToken: typeof data.refresh_token === 'string' && data.refresh_token
        ? data.refresh_token
        : connection.refreshToken,
      idToken: nextIdToken,
      expiresAt: typeof data.expires_in === 'number'
        ? Date.now() + data.expires_in * 1000
        : connection.expiresAt,
      scopes: parseScopes(data.scope).length > 0 ? parseScopes(data.scope) : connection.scopes,
      accountLabel: metadata.accountLabel ?? connection.accountLabel,
      providerSpecificData: {
        ...connection.providerSpecificData,
        ...metadata.providerSpecificData,
      },
    }
    return await this.saveRefreshedConnection(refreshed, expectedVersion)
      ? refreshed
      : null
  }

  private async refreshGoogleCodeAssist(
    connection: StoredProviderOAuthConnection,
    expectedVersion: number,
  ): Promise<StoredProviderOAuthConnection | null> {
    if (!connection.refreshToken) return null
    const clientId = readNonEmptyString(connection.providerSpecificData, 'clientId')
    const clientSecret = readNonEmptyString(connection.providerSpecificData, 'clientSecret')
    if (!clientId) return null
    const response = await this.fetchOAuth(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: connection.refreshToken,
        client_id: clientId,
        ...(clientSecret && { client_secret: clientSecret }),
      }),
    })
    const data = await response.json().catch(() => ({})) as Record<string, unknown>
    if (!response.ok || typeof data.access_token !== 'string' || !data.access_token) {
      return null
    }
    const refreshed: StoredProviderOAuthConnection = {
      ...connection,
      accessToken: data.access_token,
      refreshToken: typeof data.refresh_token === 'string' && data.refresh_token
        ? data.refresh_token
        : connection.refreshToken,
      expiresAt: typeof data.expires_in === 'number'
        ? Date.now() + data.expires_in * 1000
        : connection.expiresAt,
      scopes: parseScopes(data.scope).length > 0
        ? parseScopes(data.scope)
        : connection.scopes,
    }
    return await this.saveRefreshedConnection(refreshed, expectedVersion)
      ? refreshed
      : null
  }

  private async refreshGitLab(
    connection: StoredProviderOAuthConnection,
    expectedVersion: number,
  ): Promise<StoredProviderOAuthConnection | null> {
    if (!connection.refreshToken) return null
    const baseUrl = normalizeGitLabBaseUrl(connection.providerSpecificData.baseUrl)
    const clientId = readNonEmptyString(connection.providerSpecificData, 'clientId')
    const clientSecret = readNonEmptyString(connection.providerSpecificData, 'clientSecret')
    if (!clientId) return null
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: connection.refreshToken,
      client_id: clientId,
    })
    if (clientSecret) body.set('client_secret', clientSecret)
    const response = await this.fetchOAuth(`${baseUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    })
    const data = await response.json().catch(() => ({})) as Record<string, unknown>
    if (!response.ok || typeof data.access_token !== 'string' || !data.access_token) {
      return null
    }
    const refreshed: StoredProviderOAuthConnection = {
      ...connection,
      accessToken: data.access_token,
      refreshToken: typeof data.refresh_token === 'string' && data.refresh_token
        ? data.refresh_token
        : connection.refreshToken,
      expiresAt: typeof data.expires_in === 'number'
        ? Date.now() + data.expires_in * 1000
        : connection.expiresAt,
      scopes: parseScopes(data.scope).length > 0
        ? parseScopes(data.scope)
        : connection.scopes,
    }
    return await this.saveRefreshedConnection(refreshed, expectedVersion)
      ? refreshed
      : null
  }

  private async refreshAmazonQ(
    connection: StoredProviderOAuthConnection,
    expectedVersion: number,
  ): Promise<StoredProviderOAuthConnection | null> {
    if (!connection.refreshToken) return null
    const clientId = readNonEmptyString(connection.providerSpecificData, 'clientId')
    const clientSecret = readNonEmptyString(connection.providerSpecificData, 'clientSecret')
    const region = readNonEmptyString(connection.providerSpecificData, 'region') ||
      AWS_OIDC_REGION
    if (!clientId || !clientSecret || !AWS_REGION_PATTERN.test(region)) return null
    const response = await this.fetchOAuth(
      `https://oidc.${region}.amazonaws.com/token`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientId,
          clientSecret,
          refreshToken: connection.refreshToken,
          grantType: 'refresh_token',
        }),
      },
    )
    const data = await response.json().catch(() => ({})) as Record<string, unknown>
    const accessToken = readNonEmptyString(data, 'accessToken')
    if (!response.ok || !accessToken) return null
    const refreshed: StoredProviderOAuthConnection = {
      ...connection,
      accessToken,
      refreshToken: readNonEmptyString(data, 'refreshToken') || connection.refreshToken,
      expiresAt: typeof data.expiresIn === 'number'
        ? Date.now() + data.expiresIn * 1000
        : connection.expiresAt,
    }
    return await this.saveRefreshedConnection(refreshed, expectedVersion)
      ? refreshed
      : null
  }

  private async ensureFreshConnection(
    providerId: ProviderOAuthId,
  ): Promise<StoredProviderOAuthConnection | null> {
    const inFlight = this.connectionPromises.get(providerId)
    if (inFlight) return inFlight

    const pending = this.ensureFreshConnectionUnlocked(providerId)
      .finally(() => this.connectionPromises.delete(providerId))
    this.connectionPromises.set(providerId, pending)
    return pending
  }

  private async ensureFreshConnectionUnlocked(
    providerId: ProviderOAuthId,
  ): Promise<StoredProviderOAuthConnection | null> {
    const expectedVersion = this.connectionVersion(providerId)
    let connection = await this.loadConnection(providerId)
    if (!connection) return null

    if (
      providerId === 'kimi-coding' &&
      connection.expiresAt !== null &&
      connection.expiresAt <= Date.now() + EXPIRY_BUFFER_MS
    ) {
      connection = await this.refreshKimi(connection, expectedVersion)
      if (!connection) return null
    }

    if (
      providerId === 'codex' &&
      connection.expiresAt !== null &&
      connection.expiresAt <= Date.now() + EXPIRY_BUFFER_MS
    ) {
      connection = await this.refreshCodex(connection, expectedVersion)
      if (!connection) return null
    }

    if (
      (providerId === 'antigravity' || providerId === 'gemini-cli') &&
      connection.expiresAt !== null &&
      connection.expiresAt <= Date.now() + EXPIRY_BUFFER_MS
    ) {
      connection = await this.refreshGoogleCodeAssist(connection, expectedVersion)
      if (!connection) return null
    }

    if (
      providerId === 'gitlab-duo' &&
      connection.expiresAt !== null &&
      connection.expiresAt <= Date.now() + EXPIRY_BUFFER_MS
    ) {
      connection = await this.refreshGitLab(connection, expectedVersion)
      if (!connection) return null
    }

    if (
      providerId === 'amazon-q' &&
      connection.expiresAt !== null &&
      connection.expiresAt <= Date.now() + EXPIRY_BUFFER_MS
    ) {
      connection = await this.refreshAmazonQ(connection, expectedVersion)
      if (!connection) return null
    }

    if (
      providerId === 'codebuddy-cn' &&
      connection.expiresAt !== null &&
      connection.expiresAt <= Date.now() + EXPIRY_BUFFER_MS
    ) {
      connection = await this.refreshCodeBuddy(connection, expectedVersion)
      if (!connection) return null
    }

    if (
      providerId === 'cline' &&
      connection.expiresAt !== null &&
      connection.expiresAt <= Date.now() + EXPIRY_BUFFER_MS
    ) {
      connection = await this.refreshCline(connection, expectedVersion)
      if (!connection) return null
    }

    if (
      providerId === 'grok-cli' &&
      connection.expiresAt !== null &&
      connection.expiresAt <= Date.now() + EXPIRY_BUFFER_MS
    ) {
      connection = await this.refreshGrok(connection, expectedVersion)
      if (!connection) return null
    }

    if (providerId === 'github') {
      const copilotExpiresAt = normalizeEpoch(
        connection.providerSpecificData.copilotTokenExpiresAt,
      )
      if (
        typeof connection.providerSpecificData.copilotToken !== 'string' ||
        !copilotExpiresAt ||
        copilotExpiresAt <= Date.now() + EXPIRY_BUFFER_MS
      ) {
        const copilot = await this.fetchGithubCopilotToken(connection.accessToken)
        connection = {
          ...connection,
          providerSpecificData: { ...connection.providerSpecificData, ...copilot },
        }
        if (!await this.saveRefreshedConnection(connection, expectedVersion)) return null
      }
    }
    if (
      connection.expiresAt !== null &&
      connection.expiresAt <= Date.now() &&
      !connection.refreshToken
    ) {
      return null
    }
    return this.connectionVersion(providerId) === expectedVersion ? connection : null
  }

  async status(providerId: string): Promise<ProviderOAuthStatus> {
    if (!isSupportedProvider(providerId)) {
      throw new Error(`OAuth provider is not supported yet: ${providerId}`)
    }
    const connection = await this.ensureFreshConnection(providerId).catch(() => null)
    return connection
      ? this.toStatus(connection)
      : { providerId, connected: false, expiresAt: null }
  }

  async statuses(): Promise<ProviderOAuthStatus[]> {
    return Promise.all(OAUTH_PROVIDER_IDS.map((providerId) => this.status(providerId)))
  }

  matchesRuntimeTarget(
    providerId: string,
    baseUrl: string,
    apiFormat: string,
  ): boolean {
    if (!isSupportedProvider(providerId)) return false
    const definition = OAUTH_PROVIDER_RUNTIME_DEFINITIONS[providerId]
    return (
      definition.baseUrl.replace(/\/+$/, '') === baseUrl.replace(/\/+$/, '') &&
      definition.apiFormat === apiFormat
    )
  }

  async runtimeAuth(providerId: string): Promise<ProviderRuntimeAuth | null> {
    if (!isSupportedProvider(providerId)) return null
    const connection = await this.ensureFreshConnection(providerId).catch(() => null)
    if (!connection) return null

    if (providerId === 'kimi-coding') {
      return {
        token: connection.accessToken,
        providerSpecificData: connection.providerSpecificData,
        headers: {
          ...this.kimiHeaders(connection.providerSpecificData),
          'Content-Type': 'application/json',
          'User-Agent': `kimi-code-cli/${KIMI_CLI_VERSION}`,
        },
      }
    }

    if (providerId === 'codex') {
      const workspaceId = connection.providerSpecificData.workspaceId
      return {
        token: connection.accessToken,
        providerSpecificData: connection.providerSpecificData,
        headers: {
          Version: CODEX_CLIENT_VERSION,
          'Openai-Beta': 'responses=experimental',
          'User-Agent': `codex-cli/${CODEX_CLIENT_VERSION} (${getDeviceModel()})`,
          originator: 'codex_cli_rs',
          ...(typeof workspaceId === 'string' && workspaceId && {
            'chatgpt-account-id': workspaceId,
          }),
        },
      }
    }

    if (providerId === 'kilocode') {
      return {
        token: connection.accessToken,
        providerSpecificData: connection.providerSpecificData,
        headers: {
          'X-KILOCODE-EDITORNAME': 'CyberCode',
        },
      }
    }

    if (providerId === 'codebuddy-cn') {
      return {
        token: connection.accessToken,
        providerSpecificData: connection.providerSpecificData,
        headers: {
          'User-Agent': CODEBUDDY_RUNTIME_USER_AGENT,
          'X-Product': 'SaaS',
          'X-IDE-Type': 'CLI',
          'X-IDE-Name': 'CLI',
          'X-Requested-With': 'XMLHttpRequest',
          'X-CodeBuddy-Request': '1',
        },
      }
    }

    if (providerId === 'cline') {
      const token = connection.accessToken.startsWith('workos:')
        ? connection.accessToken
        : `workos:${connection.accessToken}`
      return {
        token,
        providerSpecificData: connection.providerSpecificData,
        headers: {
          'HTTP-Referer': 'https://cline.bot',
          'X-Title': 'Cline',
          'User-Agent': `Cline/${CLINE_CLIENT_VERSION}`,
          'X-IS-MULTIROOT': 'false',
          'X-CLIENT-TYPE': 'cybercode',
          'X-CLIENT-VERSION': CLINE_CLIENT_VERSION,
          'X-PLATFORM': process.platform,
          'X-PLATFORM-VERSION': release(),
          'X-CORE-VERSION': CLINE_CLIENT_VERSION,
          'X-Task-ID': randomUUID(),
        },
      }
    }

    if (providerId === 'grok-cli') {
      const platform = process.platform === 'darwin'
        ? 'macos'
        : process.platform === 'win32' ? 'windows' : process.platform
      const runtimeArch = arch() === 'arm64' ? 'aarch64' : arch() === 'x64' ? 'x86_64' : arch()
      const principalType = connection.providerSpecificData.principalType
      const email = connection.providerSpecificData.email
      const userId = connection.providerSpecificData.userId
      const sharedPrincipal = principalType === 'team' || principalType === 'organization'
      return {
        token: connection.accessToken,
        providerSpecificData: connection.providerSpecificData,
        headers: {
          'X-Grok-Client-Version': GROK_CLIENT_VERSION,
          'X-Grok-Client-Identifier': 'grok-shell',
          'X-Grok-Client-Mode': 'headless',
          'User-Agent': `grok-shell/${GROK_CLIENT_VERSION} (${platform}; ${runtimeArch})`,
          'X-XAI-Token-Auth': 'xai-grok-cli',
          'X-AuthenticateResponse': 'authenticate-response',
          ...(typeof userId === 'string' && userId && {
            'X-UserId': userId,
            'X-Grok-User-Id': userId,
          }),
          ...(!sharedPrincipal && typeof email === 'string' && email && {
            'X-Email': email,
          }),
        },
      }
    }

    if (providerId === 'antigravity' || providerId === 'gemini-cli') {
      return {
        token: connection.accessToken,
        providerSpecificData: connection.providerSpecificData,
        headers: this.googleCodeAssistHeaders(
          connection.accessToken,
          connection.providerSpecificData.clientProfile,
        ),
      }
    }

    if (providerId === 'cursor') {
      const machineId = readNonEmptyString(connection.providerSpecificData, 'machineId')
      return {
        token: connection.accessToken,
        providerSpecificData: connection.providerSpecificData,
        headers: {
          Authorization: `Bearer ${connection.accessToken}`,
          'User-Agent': 'cursor/3.2.14',
          'x-cursor-client-version': '3.2.14',
          ...(machineId && { 'x-cursor-machine-id': machineId }),
        },
      }
    }

    if (providerId === 'qoder') {
      return {
        token: connection.accessToken,
        providerSpecificData: connection.providerSpecificData,
        headers: {
          'User-Agent': 'Qoder/1.0 CyberCode',
        },
      }
    }

    if (providerId === 'windsurf') {
      return {
        token: connection.accessToken,
        providerSpecificData: connection.providerSpecificData,
        headers: {
          Authorization: `Bearer ${connection.accessToken}`,
          'User-Agent': 'windsurf/3.14.0',
        },
      }
    }

    if (providerId === 'gitlab-duo') {
      return {
        token: connection.accessToken,
        providerSpecificData: connection.providerSpecificData,
        headers: {},
      }
    }

    if (providerId === 'amazon-q') {
      return {
        token: connection.accessToken,
        providerSpecificData: connection.providerSpecificData,
        headers: {
          Authorization: `Bearer ${connection.accessToken}`,
          'Amz-Sdk-Request': 'attempt=1; max=3',
          'Amz-Sdk-Invocation-Id': randomUUID(),
          'x-amzn-bedrock-cache-control': 'enable',
          'anthropic-beta': 'prompt-caching-2024-07-31',
        },
      }
    }

    if (providerId === 'trae') {
      return {
        token: connection.accessToken,
        providerSpecificData: connection.providerSpecificData,
        headers: {
          Authorization: `Cloud-IDE-JWT ${connection.accessToken}`,
          'X-Trae-Client-Type': 'web',
          'X-Preferenced-Language': 'en',
          'x-user-region': 'US',
          Referer: 'https://solo.trae.ai/',
        },
      }
    }

    const copilotToken = connection.providerSpecificData.copilotToken
    if (typeof copilotToken !== 'string' || !copilotToken) return null
    return {
      token: copilotToken,
      providerSpecificData: connection.providerSpecificData,
      headers: {
        'copilot-integration-id': 'vscode-chat',
        'editor-version': GITHUB_EDITOR_VERSION,
        'editor-plugin-version': GITHUB_CHAT_PLUGIN_VERSION,
        'user-agent': GITHUB_CHAT_USER_AGENT,
        'openai-intent': 'conversation-panel',
        'x-github-api-version': GITHUB_API_VERSION,
        'x-vscode-user-agent-library-version': 'electron-fetch',
        'X-Initiator': 'user',
      },
    }
  }

  async disconnect(providerId: string): Promise<void> {
    if (!isSupportedProvider(providerId)) {
      throw new Error(`OAuth provider is not supported yet: ${providerId}`)
    }
    this.invalidateConnection(providerId)
    await fs.unlink(this.connectionPath(providerId)).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    })
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.providerId === providerId) this.cleanupSession(sessionId)
    }
  }

  private cleanupSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    if (session.flowType !== 'device_code') {
      clearTimeout(session.cleanupTimer)
      if (session.server.listening) session.server.close()
    }
    this.sessions.delete(sessionId)
  }

  private toStatus(connection: StoredProviderOAuthConnection): ProviderOAuthStatus {
    return {
      providerId: connection.providerId,
      connected: true,
      expiresAt: connection.expiresAt,
      ...(connection.accountLabel && { accountLabel: connection.accountLabel }),
    }
  }
}

export const providerOAuthService = new ProviderOAuthService()
