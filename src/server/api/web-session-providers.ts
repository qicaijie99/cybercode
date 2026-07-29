import { z } from 'zod'
import {
  WEB_SESSION_PROVIDERS,
  getWebSessionPresetId,
  getWebSessionProvider,
  isWebSessionProviderId,
  type WebSessionProviderId,
} from '../../shared/webSessionProviders.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import { executeWebSessionProvider } from '../proxy/webSession/executors.js'
import { ProviderService } from '../services/providerService.js'
import type { SavedProvider } from '../types/provider.js'

const providerService = new ProviderService()

const SaveWebSessionProviderSchema = z.object({
  credential: z.string().trim().max(64_000).optional(),
  modelId: z.string().trim().min(1).max(300).optional(),
})

function parseProviderId(value: string | undefined): WebSessionProviderId {
  if (!value || !isWebSessionProviderId(value)) {
    throw ApiError.notFound(`Unknown Web Cookie provider: ${value ?? ''}`)
  }
  return value
}

async function parseBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return await req.json() as Record<string, unknown>
  } catch {
    throw ApiError.badRequest('Invalid JSON body')
  }
}

function publicStatus(
  providerId: WebSessionProviderId,
  configured: SavedProvider | undefined,
  activeId: string | null,
) {
  return {
    providerId,
    connected: Boolean(configured?.apiKey),
    active: configured?.id === activeId,
    providerRecordId: configured?.id,
    modelId: configured?.models.main,
  }
}

async function getConfiguredProvider(
  providerId: WebSessionProviderId,
): Promise<SavedProvider | undefined> {
  const { providers } = await providerService.listProviders()
  const presetId = getWebSessionPresetId(providerId)
  return providers.find((provider) => provider.presetId === presetId)
}

async function testConfiguredProvider(
  providerId: WebSessionProviderId,
  requestSignal?: AbortSignal,
) {
  const provider = await getConfiguredProvider(providerId)
  if (!provider?.apiKey) {
    return {
      providerId,
      success: false,
      latencyMs: 0,
      error: 'Session credential is not configured',
    }
  }

  const startedAt = Date.now()
  const timeoutSignal = AbortSignal.timeout(45_000)
  const signal = requestSignal
    ? AbortSignal.any([requestSignal, timeoutSignal])
    : timeoutSignal
  try {
    const response = await executeWebSessionProvider({
      providerId,
      providerRecordId: provider.id,
      credential: provider.apiKey,
      model: provider.models.main,
      stream: false,
      signal,
      body: {
        model: provider.models.main,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        max_tokens: 8,
        stream: false,
      },
    })
    if (!response.ok) {
      const raw = await response.text().catch(() => '')
      return {
        providerId,
        success: false,
        latencyMs: Date.now() - startedAt,
        error: sanitizeTestError(raw || `HTTP ${response.status}`),
      }
    }
    return {
      providerId,
      success: true,
      latencyMs: Date.now() - startedAt,
    }
  } catch (error) {
    return {
      providerId,
      success: false,
      latencyMs: Date.now() - startedAt,
      error: sanitizeTestError(error instanceof Error ? error.message : String(error)),
    }
  }
}

function sanitizeTestError(value: string): string {
  return value
    .replace(/(cookie|token|sessionKey|access_token)\s*[=:]\s*[^;\s"']+/gi, '$1=<redacted>')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer <redacted>')
    .slice(0, 500)
}

export async function handleWebSessionProvidersApi(
  req: Request,
  _url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const resource = segments[2]
    const action = segments[3]

    if (!resource) {
      if (req.method !== 'GET') {
        throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
      }
      const { providers, activeId } = await providerService.listProviders()
      const byPreset = new Map(providers.map((provider) => [provider.presetId, provider]))
      return Response.json({
        total: WEB_SESSION_PROVIDERS.length,
        configured: WEB_SESSION_PROVIDERS.filter(
          (definition) => byPreset.get(getWebSessionPresetId(definition.id))?.apiKey,
        ).length,
        statuses: WEB_SESSION_PROVIDERS.map((definition) => publicStatus(
          definition.id,
          byPreset.get(getWebSessionPresetId(definition.id)),
          activeId,
        )),
      })
    }

    if (resource === 'test-all') {
      if (req.method !== 'POST') {
        throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
      }
      const { providers } = await providerService.listProviders()
      const configuredIds = WEB_SESSION_PROVIDERS
        .filter((definition) => providers.some(
          (provider) => (
            provider.presetId === getWebSessionPresetId(definition.id) &&
            Boolean(provider.apiKey)
          ),
        ))
        .map((definition) => definition.id)
      const results = []
      for (const providerId of configuredIds) {
        if (req.signal.aborted) break
        results.push(await testConfiguredProvider(providerId, req.signal))
      }
      return Response.json({ results })
    }

    const providerId = parseProviderId(resource)
    const definition = getWebSessionProvider(providerId)!

    if (action === 'test') {
      if (req.method !== 'POST') {
        throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
      }
      return Response.json({
        result: await testConfiguredProvider(providerId, req.signal),
      })
    }

    if (action === 'activate') {
      if (req.method !== 'POST') {
        throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
      }
      const provider = await getConfiguredProvider(providerId)
      if (!provider?.apiKey) throw ApiError.badRequest('Configure this provider first')
      await providerService.activateProvider(provider.id)
      return Response.json({ ok: true })
    }

    if (action) throw ApiError.notFound(`Unknown Web Cookie provider action: ${action}`)

    if (req.method === 'PUT' || req.method === 'POST') {
      const input = SaveWebSessionProviderSchema.parse(await parseBody(req))
      const selectedModel = input.modelId ?? definition.defaultModel
      if (!definition.models.some((model) => model.id === selectedModel)) {
        throw ApiError.badRequest(`Unsupported model for ${providerId}: ${selectedModel}`)
      }
      const provider = await providerService.upsertWebSessionProvider(
        providerId,
        input.credential,
        selectedModel,
      )
      return Response.json({
        status: publicStatus(providerId, provider, null),
      })
    }

    if (req.method === 'DELETE') {
      await providerService.removeWebSessionProvider(providerId)
      return Response.json({ ok: true })
    }

    throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(ApiError.badRequest(error.issues.map((issue) => issue.message).join('; ')))
    }
    return errorResponse(error)
  }
}
