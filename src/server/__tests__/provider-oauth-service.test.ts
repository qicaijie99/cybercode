import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  OAUTH_PROVIDER_CAPABILITIES,
  OAUTH_PROVIDER_IDS,
  OAUTH_PROVIDER_RUNTIME_DEFINITIONS,
  ProviderOAuthService,
  providerOAuthService,
} from '../services/providerOAuthService.js'
import { ProviderService } from '../services/providerService.js'
import { handleProxyRequest } from '../proxy/handler.js'

let temporaryDirectory = ''
let originalConfigDirectory: string | undefined
let service: ProviderOAuthService

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

function codexIdToken(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'signature',
  ].join('.')
}

beforeEach(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-oauth-test-'))
  originalConfigDirectory = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = temporaryDirectory
  service = new ProviderOAuthService()
})

afterEach(async () => {
  service.resetFetchFn()
  providerOAuthService.resetFetchFn()
  providerOAuthService.clearSessions()
  if (originalConfigDirectory === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = originalConfigDirectory
  await fs.rm(temporaryDirectory, { recursive: true, force: true })
})

describe('OAuth provider catalog contract', () => {
  test('every advertised provider has a connection flow and runtime definition', () => {
    const providerIds = [...OAUTH_PROVIDER_IDS].sort()

    expect(Object.keys(OAUTH_PROVIDER_CAPABILITIES).sort()).toEqual(providerIds)
    expect(Object.keys(OAUTH_PROVIDER_RUNTIME_DEFINITIONS).sort()).toEqual(providerIds)
  })
})

describe('Kimi Coding device OAuth', () => {
  test('starts, completes, persists and exposes runtime identity headers', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    service.setFetchFn((async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.endsWith('/device_authorization')) {
        return jsonResponse({
          device_code: 'device-token',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://www.kimi.com/device',
          verification_uri_complete: 'https://www.kimi.com/device?code=ABCD-EFGH',
          expires_in: 900,
          interval: 2,
        })
      }
      return jsonResponse({
        access_token: 'kimi-access',
        refresh_token: 'kimi-refresh',
        expires_in: 3600,
        scope: 'openid profile',
      })
    }) as typeof fetch)

    const started = await service.start('kimi-coding')
    expect(started.userCode).toBe('ABCD-EFGH')
    expect(started.intervalMs).toBe(2_000)

    const result = await service.poll('kimi-coding', started.sessionId)
    expect(result.status).toBe('connected')
    expect(await service.status('kimi-coding')).toMatchObject({
      providerId: 'kimi-coding',
      connected: true,
    })

    const runtime = await service.runtimeAuth('kimi-coding')
    expect(runtime?.token).toBe('kimi-access')
    expect(runtime?.headers['X-Msh-Platform']).toBe('kimi_code_cli')
    expect(runtime?.headers['X-Msh-Device-Id']).toBeTruthy()
    expect(runtime?.headers.Authorization).toBeUndefined()

    const tokenRequest = requests.find((request) => request.url.endsWith('/token'))
    expect(new Headers(tokenRequest?.init?.headers).get('X-Msh-Device-Id')).toBeTruthy()

    const tokenPath = path.join(
      temporaryDirectory,
      'cybercode',
      'provider-oauth',
      'kimi-coding.json',
    )
    expect((await fs.stat(tokenPath)).mode & 0o777).toBe(0o600)
  })

  test('keeps polling pending without persisting a connection', async () => {
    let requestCount = 0
    service.setFetchFn((async () => {
      requestCount += 1
      if (requestCount === 1) {
        return jsonResponse({
          device_code: 'device-token',
          user_code: 'WAIT-CODE',
          verification_uri: 'https://www.kimi.com/device',
          expires_in: 900,
          interval: 2,
        })
      }
      return jsonResponse({
        error: 'authorization_pending',
        error_description: 'Waiting for user',
      }, 400)
    }) as typeof fetch)

    const started = await service.start('kimi-coding')
    expect(await service.poll('kimi-coding', started.sessionId)).toEqual({
      status: 'pending',
      intervalMs: 2_000,
    })
    expect(await service.status('kimi-coding')).toEqual({
      providerId: 'kimi-coding',
      connected: false,
      expiresAt: null,
    })
  })
})

describe('Qoder credential import', () => {
  test('prepares and validates the managed runtime before saving a PAT', async () => {
    const validatedTokens: string[] = []
    service = new ProviderOAuthService({
      qoderRuntime: {
        validateToken: async (token) => {
          validatedTokens.push(token)
          return ['qmodel_preview', 'qmodel_latest']
        },
      },
    })

    const status = await service.importConnection('qoder', {
      accessToken: 'pt-valid-qoder-token',
    })
    const runtime = await service.runtimeAuth('qoder')

    expect(status).toMatchObject({
      providerId: 'qoder',
      connected: true,
    })
    expect(validatedTokens).toEqual(['pt-valid-qoder-token'])
    expect(runtime?.providerSpecificData).toMatchObject({
      tokenType: 'pat',
      transport: 'qodercli',
      availableModels: ['qmodel_preview', 'qmodel_latest'],
    })
  })

  test('does not persist a PAT when official runtime validation fails', async () => {
    service = new ProviderOAuthService({
      qoderRuntime: {
        validateToken: async () => {
          throw new Error('Qoder Personal Access Token is invalid or expired')
        },
      },
    })

    await expect(service.importConnection('qoder', {
      accessToken: 'pt-invalid-qoder-token',
    })).rejects.toThrow('invalid or expired')
    expect(await service.status('qoder')).toEqual({
      providerId: 'qoder',
      connected: false,
      expiresAt: null,
    })
  })

  test('keeps DashScope API keys on the direct HTTP transport', async () => {
    let validationCount = 0
    service = new ProviderOAuthService({
      qoderRuntime: {
        validateToken: async () => {
          validationCount += 1
          return []
        },
      },
    })

    await service.importConnection('qoder', {
      accessToken: 'sk-dashscope-api-key',
    })
    const runtime = await service.runtimeAuth('qoder')

    expect(validationCount).toBe(0)
    expect(runtime?.providerSpecificData).toMatchObject({
      tokenType: 'api',
      transport: 'dashscope',
    })
  })
})

describe('GitHub Copilot device OAuth', () => {
  test('mints a Copilot runtime token and records the GitHub login', async () => {
    service.setFetchFn((async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/login/device/code')) {
        return jsonResponse({
          device_code: 'github-device',
          user_code: '1234-5678',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5,
        })
      }
      if (url.endsWith('/login/oauth/access_token')) {
        return jsonResponse({
          access_token: 'github-access',
          token_type: 'bearer',
          scope: 'read:user',
        })
      }
      if (url.endsWith('/copilot_internal/v2/token')) {
        return jsonResponse({
          token: 'copilot-runtime',
          expires_at: Math.floor(Date.now() / 1000) + 1800,
        })
      }
      if (url.endsWith('/user')) return jsonResponse({ login: 'cyber-user' })
      throw new Error(`Unexpected URL: ${url}`)
    }) as typeof fetch)

    const started = await service.start('github')
    const result = await service.poll('github', started.sessionId)
    expect(result).toMatchObject({
      status: 'connected',
      connection: { accountLabel: 'cyber-user' },
    })

    const runtime = await service.runtimeAuth('github')
    expect(runtime?.token).toBe('copilot-runtime')
    expect(runtime?.headers['copilot-integration-id']).toBe('vscode-chat')
    expect(runtime?.headers['editor-version']).toContain('vscode/')
  })
})

describe('Kilo Code device OAuth', () => {
  test('uses Kilo device authorization and exposes the required editor header', async () => {
    const requestedUrls: string[] = []
    service.setFetchFn((async (input: string | URL | Request) => {
      const url = String(input)
      requestedUrls.push(url)
      if (url.endsWith('/api/device-auth/codes')) {
        return jsonResponse({
          code: 'kilo-device-code',
          verificationUrl: 'https://app.kilo.ai/auth/device?k=kilo-device-code',
          expiresIn: 300,
        })
      }
      if (url.endsWith('/api/device-auth/codes/kilo-device-code')) {
        return jsonResponse({
          status: 'approved',
          token: 'kilo-access',
          userEmail: 'kilo@example.com',
        })
      }
      throw new Error(`Unexpected URL: ${url}`)
    }) as typeof fetch)

    const started = await service.start('kilocode')
    expect(started).toMatchObject({
      flowType: 'device_code',
      userCode: 'kilo-device-code',
      verificationUriComplete: 'https://app.kilo.ai/auth/device?k=kilo-device-code',
      intervalMs: 3_000,
    })
    expect(await service.poll('kilocode', started.sessionId)).toMatchObject({
      status: 'connected',
      connection: { accountLabel: 'kilo@example.com' },
    })

    const runtime = await service.runtimeAuth('kilocode')
    expect(runtime?.token).toBe('kilo-access')
    expect(runtime?.headers['X-KILOCODE-EDITORNAME']).toBe('CyberCode')
    expect(requestedUrls).toHaveLength(2)
  })
})

describe('CodeBuddy CN device OAuth', () => {
  test('completes Tencent device login and refreshes short-lived tokens', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    service.setFetchFn((async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.includes('/v2/plugin/auth/state')) {
        return jsonResponse({
          code: 0,
          data: {
            state: 'codebuddy-state',
            authUrl: 'https://copilot.tencent.com/auth?state=codebuddy-state',
          },
        })
      }
      if (url.includes('/v2/plugin/auth/token?state=')) {
        return jsonResponse({
          code: 0,
          data: {
            accessToken: 'codebuddy-expiring',
            refreshToken: 'codebuddy-refresh',
            expiresIn: 1,
          },
        })
      }
      if (url.endsWith('/v2/plugin/auth/token/refresh')) {
        return jsonResponse({
          code: 0,
          data: {
            accessToken: 'codebuddy-fresh',
            refreshToken: 'codebuddy-refresh-rotated',
            expiresIn: 3600,
          },
        })
      }
      throw new Error(`Unexpected URL: ${url}`)
    }) as typeof fetch)

    const started = await service.start('codebuddy-cn')
    expect(started).toMatchObject({
      flowType: 'device_code',
      userCode: 'codebuddy-state',
      verificationUriComplete: 'https://copilot.tencent.com/auth?state=codebuddy-state',
      intervalMs: 5_000,
    })
    expect(await service.poll('codebuddy-cn', started.sessionId)).toMatchObject({
      status: 'connected',
    })

    const runtime = await service.runtimeAuth('codebuddy-cn')
    expect(runtime?.token).toBe('codebuddy-fresh')
    expect(runtime?.headers['X-CodeBuddy-Request']).toBe('1')
    expect(runtime?.headers['X-IDE-Name']).toBe('CLI')

    const stateRequest = requests.find((request) => request.url.includes('/auth/state'))
    expect(new URL(stateRequest!.url).searchParams.get('platform')).toBe('CLI')
    const refreshRequest = requests.find((request) => request.url.endsWith('/token/refresh'))
    expect(new Headers(refreshRequest?.init?.headers).get('X-Refresh-Token'))
      .toBe('codebuddy-refresh')
  })
})

describe('Grok Build device OAuth', () => {
  test('uses xAI device authorization and exposes Grok Build runtime identity', async () => {
    const expiringAccessToken = codexIdToken({
      email: 'grok@example.com',
      sub: 'grok-user',
      principal_type: 'user',
      tier: 1,
      token_version: 'old',
    })
    const freshAccessToken = codexIdToken({
      email: 'grok@example.com',
      sub: 'grok-user',
      principal_type: 'user',
      tier: 1,
      token_version: 'new',
    })
    service.setFetchFn((async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/oauth2/device/code')) {
        const body = new URLSearchParams(String(init?.body))
        expect(body.get('referrer')).toBe('grok-build')
        return jsonResponse({
          device_code: 'grok-device',
          user_code: 'GROK-1234',
          verification_uri: 'https://auth.x.ai/device',
          verification_uri_complete: 'https://auth.x.ai/device?code=GROK-1234',
          expires_in: 1800,
          interval: 5,
        })
      }
      if (url.endsWith('/oauth2/token')) {
        const body = new URLSearchParams(String(init?.body))
        if (body.get('grant_type') === 'refresh_token') {
          expect(body.get('refresh_token')).toBe('grok-refresh')
          expect(body.get('principal_type')).toBe('user')
          return jsonResponse({
            access_token: freshAccessToken,
            refresh_token: 'grok-refresh-rotated',
            expires_in: 21_600,
          })
        }
        return jsonResponse({
          access_token: expiringAccessToken,
          refresh_token: 'grok-refresh',
          expires_in: 1,
          scope: 'openid grok-cli:access',
        })
      }
      throw new Error(`Unexpected URL: ${url}`)
    }) as typeof fetch)

    const started = await service.start('grok-cli')
    expect(started).toMatchObject({
      flowType: 'device_code',
      userCode: 'GROK-1234',
      intervalMs: 5_000,
    })
    expect(await service.poll('grok-cli', started.sessionId)).toMatchObject({
      status: 'connected',
      connection: { accountLabel: 'grok@example.com' },
    })

    const runtime = await service.runtimeAuth('grok-cli')
    expect(runtime?.token).toBe(freshAccessToken)
    expect(runtime?.headers['X-Grok-Client-Identifier']).toBe('grok-shell')
    expect(runtime?.headers['X-XAI-Token-Auth']).toBe('xai-grok-cli')
    expect(runtime?.headers['X-UserId']).toBe('grok-user')
  })
})

describe('Cline browser OAuth', () => {
  test('decodes the callback token, refreshes it and applies Cline protocol headers', async () => {
    service.setFetchFn((async (input: string | URL | Request) => {
      expect(String(input)).toBe('https://api.cline.bot/api/v1/auth/refresh')
      return jsonResponse({
        data: {
          accessToken: 'cline-fresh',
          refreshToken: 'cline-refresh-rotated',
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        },
      })
    }) as typeof fetch)

    const started = await service.start('cline')
    expect(started.flowType).toBe('authorization_code')
    if (started.flowType === 'device_code') {
      throw new Error('Expected a browser OAuth flow')
    }
    const authorizationUrl = new URL(started.authorizeUrl)
    expect(authorizationUrl.href).toContain('https://api.cline.bot/api/v1/auth/authorize')
    expect(authorizationUrl.searchParams.get('client_type')).toBe('extension')
    expect(authorizationUrl.searchParams.get('callback_url')).toBe(started.redirectUri)

    const embeddedCode = Buffer.from(JSON.stringify({
      accessToken: 'cline-expiring',
      refreshToken: 'cline-refresh',
      email: 'cline@example.com',
      firstName: 'Cyber',
      lastName: 'Coder',
      expiresAt: new Date(Date.now() + 1_000).toISOString(),
    })).toString('base64')
    const callback = new URL(started.redirectUri)
    callback.searchParams.set('code', embeddedCode)
    const callbackResponse = await fetch(callback)
    expect(callbackResponse.status).toBe(200)
    expect(await callbackResponse.text()).toContain('CyberCode authorization complete')

    expect(await service.poll('cline', started.sessionId)).toMatchObject({
      status: 'connected',
      connection: { accountLabel: 'Cyber Coder' },
    })
    const runtime = await service.runtimeAuth('cline')
    expect(runtime?.token).toBe('workos:cline-fresh')
    expect(runtime?.headers['HTTP-Referer']).toBe('https://cline.bot')
    expect(runtime?.headers['X-CLIENT-TYPE']).toBe('cybercode')
    expect(runtime?.headers['X-Task-ID']).toBeTruthy()
  })
})

describe('OpenAI Codex browser OAuth', () => {
  test('completes PKCE callback and binds the ChatGPT workspace', async () => {
    service = new ProviderOAuthService({ codexCallbackPort: 0 })
    let tokenRequest: RequestInit | undefined
    service.setFetchFn((async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('https://auth.openai.com/oauth/token')
      tokenRequest = init
      return jsonResponse({
        access_token: 'codex-access',
        refresh_token: 'codex-refresh',
        id_token: codexIdToken({
          email: 'user@example.com',
          'https://api.openai.com/auth': {
            chatgpt_account_id: 'workspace-123',
            chatgpt_plan_type: 'plus',
            chatgpt_user_id: 'user-123',
          },
        }),
        expires_in: 3600,
        scope: 'openid profile email offline_access',
      })
    }) as typeof fetch)

    const started = await service.start('codex')
    expect(started.flowType).toBe('authorization_code_pkce')
    if (started.flowType !== 'authorization_code_pkce') {
      throw new Error('Expected a browser OAuth flow')
    }

    const authorizationUrl = new URL(started.authorizeUrl)
    expect(authorizationUrl.hostname).toBe('auth.openai.com')
    expect(authorizationUrl.searchParams.get('code_challenge')).toBeTruthy()
    expect(authorizationUrl.searchParams.get('originator')).toBe('codex_cli_rs')
    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(started.redirectUri)

    const callback = new URL(started.redirectUri)
    callback.searchParams.set('code', 'authorization-code')
    callback.searchParams.set('state', authorizationUrl.searchParams.get('state')!)
    const callbackResponse = await fetch(callback)
    expect(callbackResponse.status).toBe(200)
    expect(await callbackResponse.text()).toContain('CyberCode authorization complete')

    const result = await service.poll('codex', started.sessionId)
    expect(result).toMatchObject({
      status: 'connected',
      connection: {
        providerId: 'codex',
        accountLabel: 'user@example.com',
      },
    })

    const tokenBody = new URLSearchParams(String(tokenRequest?.body))
    expect(tokenBody.get('code')).toBe('authorization-code')
    expect(tokenBody.get('code_verifier')).toBeTruthy()
    expect(tokenBody.get('redirect_uri')).toBe(started.redirectUri)

    const runtime = await service.runtimeAuth('codex')
    expect(runtime?.token).toBe('codex-access')
    expect(runtime?.headers.originator).toBe('codex_cli_rs')
    expect(runtime?.headers['chatgpt-account-id']).toBe('workspace-123')
    expect(runtime?.headers.Version).toBeTruthy()
  })

  test('rotates the refresh token before an expired Codex access token is used', async () => {
    service = new ProviderOAuthService({ codexCallbackPort: 0 })
    let exchangeCount = 0
    service.setFetchFn((async () => {
      exchangeCount += 1
      if (exchangeCount === 1) {
        return jsonResponse({
          access_token: 'expired-access',
          refresh_token: 'single-use-refresh',
          id_token: codexIdToken({
            email: 'refresh@example.com',
            'https://api.openai.com/auth': { chatgpt_account_id: 'workspace-refresh' },
          }),
          expires_in: 1,
        })
      }
      return jsonResponse({
        access_token: 'fresh-access',
        refresh_token: 'rotated-refresh',
        expires_in: 3600,
      })
    }) as typeof fetch)

    const started = await service.start('codex')
    if (started.flowType !== 'authorization_code_pkce') {
      throw new Error('Expected a browser OAuth flow')
    }
    const authorizationUrl = new URL(started.authorizeUrl)
    const callback = new URL(started.redirectUri)
    callback.searchParams.set('code', 'refresh-code')
    callback.searchParams.set('state', authorizationUrl.searchParams.get('state')!)
    await fetch(callback)
    await service.poll('codex', started.sessionId)

    const [firstRuntime, secondRuntime] = await Promise.all([
      service.runtimeAuth('codex'),
      service.runtimeAuth('codex'),
    ])
    expect(firstRuntime?.token).toBe('fresh-access')
    expect(secondRuntime?.token).toBe('fresh-access')
    expect(exchangeCount).toBe(2)
    const stored = JSON.parse(await fs.readFile(path.join(
      temporaryDirectory,
      'cybercode',
      'provider-oauth',
      'codex.json',
    ), 'utf-8')) as { refreshToken: string }
    expect(stored.refreshToken).toBe('rotated-refresh')
  })

  test('turns a region rejection into a useful callback error', async () => {
    service = new ProviderOAuthService({ codexCallbackPort: 0 })
    service.setFetchFn((async () => jsonResponse({
      error: {
        code: 'unsupported_country_region_territory',
        message: 'Country, region, or territory not supported',
      },
    }, 403)) as typeof fetch)

    const started = await service.start('codex')
    if (started.flowType !== 'authorization_code_pkce') {
      throw new Error('Expected a browser OAuth flow')
    }
    const authorizationUrl = new URL(started.authorizeUrl)
    const callback = new URL(started.redirectUri)
    callback.searchParams.set('code', 'region-code')
    callback.searchParams.set('state', authorizationUrl.searchParams.get('state')!)

    const callbackResponse = await fetch(callback)
    const callbackBody = await callbackResponse.text()

    expect(callbackResponse.status).toBe(500)
    expect(callbackBody).toContain('current country or region is not supported')
    expect(callbackBody).toContain('CyberCode cannot bypass provider region policies')
    expect(callbackBody).not.toContain('unsupported_country_region_territory')
  })
})

describe('Google Code Assist browser OAuth', () => {
  test('keeps Antigravity-only restricted scopes out of Gemini CLI login', async () => {
    const gemini = await service.start('gemini-cli')
    if (gemini.flowType === 'device_code') {
      throw new Error('Expected a browser OAuth flow')
    }
    const geminiScopes = new URL(gemini.authorizeUrl)
      .searchParams
      .get('scope')
      ?.split(' ') ?? []

    expect(geminiScopes).toEqual([
      'https://www.googleapis.com/auth/cloud-platform',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ])
    expect(geminiScopes).not.toContain('https://www.googleapis.com/auth/cclog')
    expect(new URL(gemini.authorizeUrl).searchParams.get('code_challenge')).toBeTruthy()

    const antigravity = await service.start('antigravity')
    if (antigravity.flowType === 'device_code') {
      throw new Error('Expected a browser OAuth flow')
    }
    const antigravityScopes = new URL(antigravity.authorizeUrl)
      .searchParams
      .get('scope')
      ?.split(' ') ?? []

    expect(antigravityScopes).toContain('https://www.googleapis.com/auth/cclog')
    expect(antigravityScopes).toContain(
      'https://www.googleapis.com/auth/experimentsandconfigs',
    )
  })
})

describe('OAuth provider lifecycle', () => {
  test('removes the generated provider and active runtime when the account disconnects', async () => {
    const providerService = new ProviderService()
    const provider = await providerService.upsertOAuthProvider(
      'codex',
      OAUTH_PROVIDER_RUNTIME_DEFINITIONS.codex,
    )
    await providerService.activateProvider(provider.id)
    const edited = await providerService.updateProvider(provider.id, {
      name: 'My Codex',
      baseUrl: 'https://example.invalid/steal-token',
      apiFormat: 'anthropic',
    })
    expect(edited.name).toBe('My Codex')
    expect(edited.baseUrl).toBe(OAUTH_PROVIDER_RUNTIME_DEFINITIONS.codex.baseUrl)
    expect(edited.apiFormat).toBe(OAUTH_PROVIDER_RUNTIME_DEFINITIONS.codex.apiFormat)

    await providerService.removeOAuthProvider('codex')
    await providerService.removeOAuthProvider('codex')

    expect(await providerService.listProviders()).toEqual({
      providers: [],
      activeId: null,
    })
    const settings = JSON.parse(await fs.readFile(path.join(
      temporaryDirectory,
      'cybercode',
      'settings.json',
    ), 'utf-8')) as { env?: Record<string, string> }
    expect(settings.env?.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(settings.env?.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
  })
})

describe('OAuth provider proxy runtime', () => {
  test('injects the stored Kimi token and device identity into the real proxy request', async () => {
    let oauthRequestCount = 0
    providerOAuthService.setFetchFn((async () => {
      oauthRequestCount += 1
      if (oauthRequestCount === 1) {
        return jsonResponse({
          device_code: 'proxy-device',
          user_code: 'PROXY-CODE',
          verification_uri: 'https://www.kimi.com/device',
          expires_in: 900,
          interval: 2,
        })
      }
      return jsonResponse({
        access_token: 'proxy-kimi-access',
        refresh_token: 'proxy-kimi-refresh',
        expires_in: 3600,
      })
    }) as typeof fetch)

    const started = await providerOAuthService.start('kimi-coding')
    expect((await providerOAuthService.poll('kimi-coding', started.sessionId)).status)
      .toBe('connected')

    const provider = await new ProviderService().upsertOAuthProvider(
      'kimi-coding',
      OAUTH_PROVIDER_RUNTIME_DEFINITIONS['kimi-coding'],
    )
    const originalFetch = globalThis.fetch
    let upstreamHeaders = new Headers()
    let upstreamUrl = ''
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      upstreamUrl = String(input)
      upstreamHeaders = new Headers(init?.headers)
      return jsonResponse({
        id: 'chatcmpl-oauth',
        object: 'chat.completion',
        created: 1,
        model: 'kimi-for-coding',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'connected' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      })
    }) as typeof fetch

    try {
      const url = new URL(
        `http://127.0.0.1/proxy/providers/${encodeURIComponent(provider.id)}/v1/messages`,
      )
      const response = await handleProxyRequest(new Request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'kimi-for-coding',
          max_tokens: 64,
          messages: [{ role: 'user', content: 'hello' }],
        }),
      }), url)

      expect(response.status).toBe(200)
      expect(upstreamUrl).toBe('https://api.kimi.com/coding/v1/chat/completions')
      expect(upstreamHeaders.get('Authorization')).toBe('Bearer proxy-kimi-access')
      expect(upstreamHeaders.get('X-Msh-Platform')).toBe('kimi_code_cli')
      expect(upstreamHeaders.get('X-Msh-Device-Id')).toBeTruthy()
      expect(await response.text()).toContain('connected')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('uses Codex Responses wire rules and workspace headers', async () => {
    await fs.mkdir(path.join(temporaryDirectory, 'cybercode', 'provider-oauth'), {
      recursive: true,
    })
    await fs.writeFile(
      path.join(temporaryDirectory, 'cybercode', 'provider-oauth', 'codex.json'),
      JSON.stringify({
        providerId: 'codex',
        accessToken: 'codex-runtime-token',
        refreshToken: 'codex-refresh-token',
        expiresAt: Date.now() + 3_600_000,
        scopes: ['openid'],
        accountLabel: 'codex@example.com',
        providerSpecificData: { workspaceId: 'workspace-proxy' },
      }),
    )
    const provider = await new ProviderService().upsertOAuthProvider(
      'codex',
      OAUTH_PROVIDER_RUNTIME_DEFINITIONS.codex,
    )

    const originalFetch = globalThis.fetch
    let upstreamUrl = ''
    let upstreamHeaders = new Headers()
    let upstreamBody: Record<string, unknown> = {}
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      upstreamUrl = String(input)
      upstreamHeaders = new Headers(init?.headers)
      upstreamBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      const sse = [
        'event: response.created',
        'data: {"type":"response.created","response":{"id":"resp_1","model":"gpt-5.5"}}',
        '',
        'event: response.content_part.added',
        'data: {"type":"response.content_part.added","output_index":0,"content_index":0,"part":{"type":"output_text","text":""}}',
        '',
        'event: response.output_text.delta',
        'data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"delta":"connected"}',
        '',
        'event: response.output_text.done',
        'data: {"type":"response.output_text.done","output_index":0,"content_index":0,"text":"connected"}',
        '',
        'event: response.completed',
        'data: {"type":"response.completed","response":{"id":"resp_1","model":"gpt-5.5","status":"completed","output":[],"usage":{"input_tokens":5,"output_tokens":1,"total_tokens":6}}}',
        '',
        'data: [DONE]',
        '',
      ].join('\n')
      return new Response(sse, {
        headers: { 'content-type': 'text/event-stream' },
      })
    }) as typeof fetch

    try {
      const url = new URL(
        `http://127.0.0.1/proxy/providers/${encodeURIComponent(provider.id)}/v1/messages`,
      )
      const response = await handleProxyRequest(new Request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-5.5',
          max_tokens: 64,
          temperature: 0.2,
          stream: true,
          messages: [{ role: 'user', content: 'hello' }],
          tools: [{
            name: 'read_file',
            description: 'Read a file',
            input_schema: {
              type: 'object',
              properties: { path: { type: 'string' } },
            },
          }],
        }),
      }), url)

      expect(response.status).toBe(200)
      expect(upstreamUrl).toBe('https://chatgpt.com/backend-api/codex/responses')
      expect(upstreamHeaders.get('Authorization')).toBe('Bearer codex-runtime-token')
      expect(upstreamHeaders.get('chatgpt-account-id')).toBe('workspace-proxy')
      expect(upstreamHeaders.get('originator')).toBe('codex_cli_rs')
      expect(upstreamBody.stream).toBe(true)
      expect(upstreamBody.store).toBe(false)
      expect(upstreamBody.temperature).toBeUndefined()
      expect(upstreamBody.instructions).toBeTruthy()
      expect(upstreamBody.tools).toEqual([{
        type: 'function',
        name: 'read_file',
        description: 'Read a file',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
        },
      }])
      expect(await response.text()).toContain('connected')

      const providerTest = await new ProviderService().testProvider(provider.id)
      expect(providerTest.connectivity.success).toBe(true)
      expect(providerTest.proxy?.success).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('forces CodeBuddy upstream streaming and aggregates it for non-stream callers', async () => {
    await fs.mkdir(path.join(temporaryDirectory, 'cybercode', 'provider-oauth'), {
      recursive: true,
    })
    await fs.writeFile(
      path.join(temporaryDirectory, 'cybercode', 'provider-oauth', 'codebuddy-cn.json'),
      JSON.stringify({
        providerId: 'codebuddy-cn',
        accessToken: 'codebuddy-runtime-token',
        refreshToken: 'codebuddy-refresh-token',
        expiresAt: Date.now() + 3_600_000,
        scopes: [],
        providerSpecificData: {},
      }),
    )
    const provider = await new ProviderService().upsertOAuthProvider(
      'codebuddy-cn',
      OAUTH_PROVIDER_RUNTIME_DEFINITIONS['codebuddy-cn'],
    )

    const originalFetch = globalThis.fetch
    let upstreamUrl = ''
    let upstreamHeaders = new Headers()
    let upstreamBody: Record<string, unknown> = {}
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      upstreamUrl = String(input)
      upstreamHeaders = new Headers(init?.headers)
      upstreamBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      const sse = [
        'data: {"id":"chatcmpl-codebuddy","object":"chat.completion.chunk","created":1,"model":"glm-5.2","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}',
        '',
        'data: {"id":"chatcmpl-codebuddy","object":"chat.completion.chunk","created":1,"model":"glm-5.2","choices":[{"index":0,"delta":{"content":"连"},"finish_reason":null}]}',
        '',
        'data: {"id":"chatcmpl-codebuddy","object":"chat.completion.chunk","created":1,"model":"glm-5.2","choices":[{"index":0,"delta":{"content":"接成功"},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}',
        '',
        'data: [DONE]',
        '',
      ].join('\n')
      return new Response(sse, {
        headers: { 'content-type': 'text/event-stream' },
      })
    }) as typeof fetch

    try {
      const url = new URL(
        `http://127.0.0.1/proxy/providers/${encodeURIComponent(provider.id)}/v1/messages`,
      )
      const response = await handleProxyRequest(new Request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'glm-5.2',
          max_tokens: 64,
          messages: [{ role: 'user', content: 'hello' }],
        }),
      }), url)

      expect(response.status).toBe(200)
      expect(upstreamUrl).toBe('https://copilot.tencent.com/v2/chat/completions')
      expect(upstreamHeaders.get('Authorization')).toBe('Bearer codebuddy-runtime-token')
      expect(upstreamHeaders.get('X-CodeBuddy-Request')).toBe('1')
      expect(upstreamBody.stream).toBe(true)
      expect(await response.json()).toMatchObject({
        model: 'glm-5.2',
        content: [{ type: 'text', text: '连接成功' }],
        usage: { input_tokens: 4, output_tokens: 2 },
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('applies Grok Build Responses defaults and session headers', async () => {
    await fs.mkdir(path.join(temporaryDirectory, 'cybercode', 'provider-oauth'), {
      recursive: true,
    })
    await fs.writeFile(
      path.join(temporaryDirectory, 'cybercode', 'provider-oauth', 'grok-cli.json'),
      JSON.stringify({
        providerId: 'grok-cli',
        accessToken: 'grok-runtime-token',
        refreshToken: 'grok-refresh-token',
        expiresAt: Date.now() + 3_600_000,
        scopes: ['grok-cli:access'],
        accountLabel: 'grok@example.com',
        providerSpecificData: {
          email: 'grok@example.com',
          userId: 'grok-user',
          principalType: 'user',
        },
      }),
    )
    const provider = await new ProviderService().upsertOAuthProvider(
      'grok-cli',
      OAUTH_PROVIDER_RUNTIME_DEFINITIONS['grok-cli'],
    )

    const originalFetch = globalThis.fetch
    let upstreamUrl = ''
    let upstreamHeaders = new Headers()
    let upstreamBody: Record<string, unknown> = {}
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      upstreamUrl = String(input)
      upstreamHeaders = new Headers(init?.headers)
      upstreamBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return jsonResponse({
        id: 'resp_grok',
        object: 'response',
        created_at: 1,
        model: 'grok-4.5',
        status: 'completed',
        output: [{
          id: 'msg_grok',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'connected' }],
        }],
        usage: { input_tokens: 4, output_tokens: 1, total_tokens: 5 },
      })
    }) as typeof fetch

    try {
      const url = new URL(
        `http://127.0.0.1/proxy/providers/${encodeURIComponent(provider.id)}/v1/messages`,
      )
      const response = await handleProxyRequest(new Request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'grok-4.5',
          max_tokens: 64,
          messages: [{ role: 'user', content: 'hello' }],
        }),
      }), url)

      expect(response.status).toBe(200)
      expect(upstreamUrl).toBe('https://cli-chat-proxy.grok.com/v1/responses')
      expect(upstreamHeaders.get('Authorization')).toBe('Bearer grok-runtime-token')
      expect(upstreamHeaders.get('X-XAI-Token-Auth')).toBe('xai-grok-cli')
      expect(upstreamHeaders.get('X-AuthenticateResponse')).toBe('authenticate-response')
      expect(upstreamHeaders.get('X-Grok-Model-Override')).toBe('grok-4.5')
      expect(upstreamBody.store).toBe(false)
      expect(upstreamBody.include).toContain('reasoning.encrypted_content')
      expect(upstreamBody.reasoning).toEqual({ effort: 'high' })
      expect(await response.text()).toContain('connected')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
