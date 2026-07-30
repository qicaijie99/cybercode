import { registerCleanup } from '../../utils/cleanupRegistry.js'
import { logForDebugging } from '../../utils/debug.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import {
  ProviderService,
  getProviderManagedEnvKeys,
} from '../services/providerService.js'
import type { SavedProvider } from '../types/provider.js'
import { handleGatewayRequest } from '../gateway/handler.js'
import { routingService } from '../routing/routingService.js'
import { handleProxyRequest } from './handler.js'

type EmbeddedProxyServer = ReturnType<typeof Bun.serve>

export type ProviderRuntimeStatus = {
  mode: 'official' | 'direct' | 'proxy' | 'host-managed'
  provider?: SavedProvider
  proxyPort?: number
}

export type RouteRuntimeStatus = {
  mode: 'route'
  routeId: string
  model: string
  proxyPort: number
}

let embeddedProxy: EmbeddedProxyServer | null = null
let cleanupRegistered = false
const originalProviderEnv = new Map<string, string | undefined>()

function isProviderManagedByHost(): boolean {
  return isEnvTruthy(process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)
}

function rememberOriginalProviderEnvironment(): void {
  for (const key of getProviderManagedEnvKeys()) {
    if (!originalProviderEnv.has(key)) {
      originalProviderEnv.set(key, process.env[key])
    }
  }
}

function applyProviderEnvironment(env: Record<string, string>): void {
  rememberOriginalProviderEnvironment()

  for (const [key, originalValue] of originalProviderEnv) {
    if (originalValue === undefined) delete process.env[key]
    else process.env[key] = originalValue
  }

  Object.assign(process.env, env)
}

function registerProxyCleanup(): void {
  if (cleanupRegistered) return
  cleanupRegistered = true
  registerCleanup(async () => {
    if (!embeddedProxy) return
    embeddedProxy.stop(true)
    embeddedProxy = null
  })
}

function preferredEmbeddedPort(): number {
  const configured = Number.parseInt(process.env.CYBERCODE_TUI_SERVER_PORT ?? '3456', 10)
  return Number.isInteger(configured) && configured >= 0 && configured <= 65_535
    ? configured
    : 3456
}

function createEmbeddedProxy(port: number): EmbeddedProxyServer {
  return Bun.serve({
    hostname: '127.0.0.1',
    port,
    idleTimeout: 60,
    async fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === '/health') {
        return Response.json({ status: 'ok', service: 'cybercode-tui-runtime' })
      }
      if (url.pathname.startsWith('/v1/')) {
        try {
          return await handleGatewayRequest(req, url)
        } catch (error) {
          logForDebugging(
            `[tui-runtime] gateway request failed: ${error instanceof Error ? error.message : String(error)}`,
            { level: 'error' },
          )
          return Response.json(
            { error: { type: 'server_error', message: 'Internal gateway error' } },
            { status: 500 },
          )
        }
      }
      if (!url.pathname.startsWith('/proxy/')) {
        return new Response('Not Found', { status: 404 })
      }

      try {
        return await handleProxyRequest(req, url)
      } catch (error) {
        logForDebugging(
          `[provider-proxy] request failed: ${error instanceof Error ? error.message : String(error)}`,
          { level: 'error' },
        )
        return Response.json(
          {
            type: 'error',
            error: {
              type: 'api_error',
              message: 'Internal provider proxy error',
            },
          },
          { status: 500 },
        )
      }
    },
  })
}

function startEmbeddedProxy(): EmbeddedProxyServer {
  if (embeddedProxy) return embeddedProxy

  const preferredPort = preferredEmbeddedPort()
  try {
    embeddedProxy = createEmbeddedProxy(preferredPort)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (
      preferredPort === 0 ||
      (code !== 'EADDRINUSE' && !String(error).includes('address already in use'))
    ) {
      throw error
    }
    embeddedProxy = createEmbeddedProxy(0)
  }

  registerProxyCleanup()
  logForDebugging(
    `[tui-runtime] embedded server listening on 127.0.0.1:${embeddedProxy.port}`,
  )
  return embeddedProxy
}

export function ensureEmbeddedRuntimeServer(): { port: number; origin: string } {
  if (isProviderManagedByHost()) {
    throw new Error('This session uses the CyberCode Desktop runtime; manage the node from Desktop settings')
  }
  const server = startEmbeddedProxy()
  ProviderService.setServerPort(server.port)
  return {
    port: server.port,
    origin: `http://127.0.0.1:${server.port}`,
  }
}

/**
 * Prepare the active CyberCode provider for a standalone CLI process.
 * Desktop child processes are already routed by their host and intentionally
 * skip this path.
 */
export async function ensureActiveProviderRuntime(options?: {
  applyEnvironment?: boolean
}): Promise<ProviderRuntimeStatus> {
  if (isProviderManagedByHost()) return { mode: 'host-managed' }

  const providerService = new ProviderService()
  const { providers, activeId } = await providerService.listProviders()
  const provider = activeId
    ? providers.find((item) => item.id === activeId)
    : undefined

  if (!provider) {
    if (options?.applyEnvironment) applyProviderEnvironment({})
    return { mode: 'official' }
  }

  if ((provider.apiFormat ?? 'anthropic') !== 'anthropic') {
    const server = ensureEmbeddedRuntimeServer()
    await providerService.activateProvider(provider.id)
    const runtimeEnv = await providerService.getProviderRuntimeEnv(provider.id)
    if (options?.applyEnvironment !== false) applyProviderEnvironment(runtimeEnv)
    return { mode: 'proxy', provider, proxyPort: server.port }
  }

  await providerService.activateProvider(provider.id)
  const runtimeEnv = await providerService.getProviderRuntimeEnv(provider.id)
  if (options?.applyEnvironment !== false) applyProviderEnvironment(runtimeEnv)
  return { mode: 'direct', provider }
}

export async function activateRouteForCli(
  routeId: string,
  sessionId: string,
): Promise<RouteRuntimeStatus> {
  const server = ensureEmbeddedRuntimeServer()
  const runtimeEnv = await routingService.getRuntimeEnv(routeId, sessionId)
  applyProviderEnvironment(runtimeEnv)
  return {
    mode: 'route',
    routeId,
    model: runtimeEnv.ANTHROPIC_MODEL!,
    proxyPort: server.port,
  }
}

export async function activateProviderForCli(
  providerId: string | null,
): Promise<ProviderRuntimeStatus> {
  const providerService = new ProviderService()
  if (providerId) await providerService.activateProvider(providerId)
  else await providerService.activateOfficial()
  return ensureActiveProviderRuntime({ applyEnvironment: true })
}

export function getEmbeddedProviderProxyPort(): number | null {
  return embeddedProxy?.port ?? null
}

export function stopEmbeddedProviderProxy(): void {
  embeddedProxy?.stop(true)
  embeddedProxy = null
}
