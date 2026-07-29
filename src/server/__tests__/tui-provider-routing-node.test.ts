import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { executeNodeCommand } from '../../commands/node/node.js'
import { runProviderArgs } from '../../commands/provider/provider.js'
import { executeRoutingCommand } from '../../commands/routing/routing.js'
import {
  stopEmbeddedProviderProxy,
} from '../proxy/embeddedProxy.js'
import { routingService } from '../routing/routingService.js'
import { ProviderService } from '../services/providerService.js'

const ENV_KEYS = [
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST',
  'CYBERCODE_TUI_SERVER_PORT',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'CYBERCODE_PROVIDER_ID',
] as const

describe('standalone TUI provider, routing, and node commands', () => {
  let tmpDir: string
  let originalEnv: Record<string, string | undefined>

  beforeEach(async () => {
    originalEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]))
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cybercode-tui-runtime-'))
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    process.env.CYBERCODE_TUI_SERVER_PORT = '0'
    delete process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
    stopEmbeddedProviderProxy()
    routingService.resetHealth()
  })

  afterEach(async () => {
    stopEmbeddedProviderProxy()
    routingService.resetHealth()
    ProviderService.setServerPort(3456)
    for (const key of ENV_KEYS) {
      const value = originalEnv[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('reports providers and manages model auto-sync without a desktop server', async () => {
    const service = new ProviderService()
    const provider = await service.addProvider({
      presetId: 'custom',
      name: 'Terminal Provider',
      apiKey: 'secret',
      baseUrl: 'https://models.example.com/v1',
      apiFormat: 'openai_chat',
      models: {
        main: 'terminal-model',
        haiku: 'terminal-model',
        sonnet: 'terminal-model',
        opus: 'terminal-model',
      },
    })
    await service.activateProvider(provider.id)

    const status = await runProviderArgs('status')
    expect(status).toContain('Terminal Provider')
    expect(status).toContain('terminal-model')
    expect(status).toContain('auto-sync on')

    const result = await runProviderArgs('auto-sync off')
    expect(result).toContain('is off')
    expect((await service.getProvider(provider.id)).modelSync?.enabled).toBe(false)
  })

  test('creates and activates a smart route in the current TUI session', async () => {
    const service = new ProviderService()
    const provider = await service.addProvider({
      presetId: 'deepseek',
      name: 'DeepSeek terminal',
      apiKey: 'route-secret',
      baseUrl: 'https://api.deepseek.com',
      apiFormat: 'openai_chat',
      models: {
        main: 'deepseek-v4-flash',
        haiku: 'deepseek-v4-flash',
        sonnet: 'deepseek-v4-flash',
        opus: 'deepseek-v4-flash',
      },
    })

    const created = await executeRoutingCommand(
      'create terminal-route Terminal Route',
      'terminal-session',
    )
    expect(created?.message).toContain('Created route Terminal Route')

    const dashboard = await routingService.getDashboard()
    expect(dashboard.routeAvailability['terminal-route']).toMatchObject({
      available: true,
      candidateCount: 1,
    })

    const activated = await executeRoutingCommand(
      'use terminal-route',
      'terminal-session',
    )
    expect(activated?.runtimeModel).toBe('cybercode-route-terminal-route')
    expect(process.env.ANTHROPIC_BASE_URL).toContain(
      '/proxy/routes/terminal-route/sessions/terminal-session',
    )
    expect(process.env.ANTHROPIC_API_KEY).toBe('routing-managed')
    expect(provider.id).toBeString()
  })

  test('starts a real local agent node and serves its scoped model catalog', async () => {
    const service = new ProviderService()
    const provider = await service.addProvider({
      presetId: 'lmstudio',
      name: 'Local terminal model',
      apiKey: '',
      baseUrl: 'http://127.0.0.1:1234',
      apiFormat: 'openai_chat',
      models: {
        main: 'local-model',
        haiku: 'local-model',
        sonnet: 'local-model',
        opus: 'local-model',
      },
    })

    const started = await executeNodeCommand('start')
    expect(started?.apiKey).toStartWith('cc_')
    expect(started?.message).toContain('Agent node is online')

    const endpoint = started!.message.match(/Endpoint: (http:\/\/127\.0\.0\.1:\d+\/v1)/)?.[1]
    expect(endpoint).toBeString()
    const response = await fetch(`${endpoint}/models`, {
      headers: { authorization: `Bearer ${started!.apiKey}` },
    })
    const body = await response.json() as {
      data: Array<{ id: string }>
    }

    expect(response.status).toBe(200)
    expect(body.data.map(model => model.id)).toContain(
      'lmstudio/local-model',
    )

    const second = await executeNodeCommand('key create Build server')
    expect(second?.apiKey).toStartWith('cc_')
    expect(second?.message).toContain('API keys (2)')
    expect(second?.message).toContain('Build server')

    const limited = await executeNodeCommand('limit 25 --key=Build')
    expect(limited?.message).toContain('Build server')
    expect(limited?.message).toContain('0/25')

    const renamed = await executeNodeCommand('key rename Build Worker')
    expect(renamed?.message).toContain('Worker')

    const revoked = await executeNodeCommand('key revoke Worker')
    expect(revoked?.message).toContain('Agent node is online')
    expect(revoked?.message).not.toContain('Worker')

    const stopped = await executeNodeCommand('stop')
    expect(stopped?.message).toContain('Agent node is offline')
  })
})
