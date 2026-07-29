import { z } from 'zod'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import { ProviderService } from '../services/providerService.js'
import {
  OAUTH_PROVIDER_CAPABILITIES,
  OAUTH_PROVIDER_IDS,
  OAUTH_PROVIDER_RUNTIME_DEFINITIONS,
  providerOAuthService,
  type ProviderOAuthId,
} from '../services/providerOAuthService.js'

const providerService = new ProviderService()
const PollSchema = z.object({ sessionId: z.string().uuid() })
const StartSchema = z.object({
  baseUrl: z.string().trim().max(2_048).optional(),
  clientId: z.string().trim().max(1_024).optional(),
  clientSecret: z.string().trim().max(2_048).optional(),
}).optional()
const ImportSchema = z.object({
  accessToken: z.string().max(32_768).optional(),
  machineId: z.string().max(2_048).optional(),
  webId: z.string().max(2_048).optional(),
  bizUserId: z.string().max(2_048).optional(),
  userUniqueId: z.string().max(2_048).optional(),
  scope: z.string().max(256).optional(),
  tenant: z.string().max(256).optional(),
  region: z.string().max(256).optional(),
  autoDetect: z.boolean().optional(),
})

async function readOptionalJson(req: Request): Promise<unknown> {
  const text = await req.text()
  if (!text.trim()) return undefined
  try {
    return JSON.parse(text)
  } catch {
    throw ApiError.badRequest('Invalid JSON body')
  }
}

function parseProviderId(value: string | undefined): ProviderOAuthId {
  if (
    value &&
    (OAUTH_PROVIDER_IDS as readonly string[]).includes(value)
  ) {
    return value as ProviderOAuthId
  }
  throw ApiError.badRequest(`Unsupported OAuth provider: ${value ?? ''}`)
}

export async function handleProviderOAuthApi(
  req: Request,
  _url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const providerSegment = segments[2]
    const action = segments[3]

    if (!providerSegment && req.method === 'GET') {
      return Response.json({
        supportedProviders: OAUTH_PROVIDER_IDS,
        capabilities: Object.values(OAUTH_PROVIDER_CAPABILITIES),
        statuses: await providerOAuthService.statuses(),
      })
    }

    const providerId = parseProviderId(providerSegment)

    if (!action && req.method === 'GET') {
      return Response.json(await providerOAuthService.status(providerId))
    }

    if (!action && req.method === 'DELETE') {
      await providerOAuthService.disconnect(providerId)
      await providerService.removeOAuthProvider(providerId)
      return Response.json({ ok: true })
    }

    if (action === 'start' && req.method === 'POST') {
      const parsed = StartSchema.safeParse(await readOptionalJson(req))
      if (!parsed.success) throw ApiError.badRequest('Invalid OAuth start options')
      return Response.json(await providerOAuthService.start(providerId, parsed.data))
    }

    if (action === 'poll' && req.method === 'POST') {
      let body: unknown
      try {
        body = await req.json()
      } catch {
        throw ApiError.badRequest('Invalid JSON body')
      }
      const parsed = PollSchema.safeParse(body)
      if (!parsed.success) throw ApiError.badRequest('sessionId is required')
      const result = await providerOAuthService.poll(providerId, parsed.data.sessionId)
      if (result.status === 'connected') {
        const definition = OAUTH_PROVIDER_RUNTIME_DEFINITIONS[providerId]
        const provider = await providerService.upsertOAuthProvider(providerId, definition)
        return Response.json({ ...result, providerId: provider.id })
      }
      return Response.json(result)
    }

    if (action === 'detect' && req.method === 'GET') {
      return Response.json(await providerOAuthService.detect(providerId))
    }

    if (action === 'import' && req.method === 'POST') {
      const parsed = ImportSchema.safeParse(await readOptionalJson(req))
      if (!parsed.success) throw ApiError.badRequest('Invalid credential import')
      const { autoDetect, ...input } = parsed.data
      const connection = await providerOAuthService.importConnection(
        providerId,
        input,
        { autoDetect },
      )
      const definition = OAUTH_PROVIDER_RUNTIME_DEFINITIONS[providerId]
      const provider = await providerService.upsertOAuthProvider(providerId, definition)
      return Response.json({ connection, providerId: provider.id })
    }

    throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
  } catch (error) {
    return errorResponse(error)
  }
}
