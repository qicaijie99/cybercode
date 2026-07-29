import { z } from 'zod'
import {
  MEDIA_PROVIDER_KINDS,
  getMediaProvidersByKind,
  isMediaProviderKind,
  type MediaProviderKind,
} from '../../shared/mediaProviders.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import { MediaProviderService } from '../services/mediaProviderService.js'

const mediaProviderService = new MediaProviderService()

const SaveMediaProviderSchema = z.object({
  credentials: z.record(
    z.string().trim().min(1).max(100),
    z.string().max(64_000),
  ).optional(),
  modelId: z.string().trim().min(1).max(300).optional(),
})

function parseKind(value: string | undefined): MediaProviderKind {
  if (!value || !isMediaProviderKind(value)) {
    throw ApiError.notFound(`Unknown media provider kind: ${value ?? ''}`)
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

export async function handleMediaProvidersApi(
  req: Request,
  _url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const rawKind = segments[2]
    const providerId = segments[3]
    const action = segments[4]

    if (!rawKind) {
      if (req.method !== 'GET') {
        throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
      }
      const statuses = await mediaProviderService.getStatuses()
      return Response.json({
        total: statuses.length,
        configured: statuses.filter((status) => status.configured).length,
        totalsByKind: Object.fromEntries(
          MEDIA_PROVIDER_KINDS.map((kind) => [
            kind,
            getMediaProvidersByKind(kind).length,
          ]),
        ),
        statuses,
      })
    }

    const kind = parseKind(rawKind)
    if (!providerId) {
      throw ApiError.notFound(`Media provider is required for ${kind}`)
    }

    if (action === 'test') {
      if (req.method !== 'POST') {
        throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
      }
      return Response.json({
        result: await mediaProviderService.testConnection(kind, providerId, req.signal),
      })
    }

    if (action) throw ApiError.notFound(`Unknown media provider action: ${action}`)

    if (req.method === 'PUT' || req.method === 'POST') {
      const input = SaveMediaProviderSchema.parse(await parseBody(req))
      return Response.json({
        status: await mediaProviderService.saveConnection(kind, providerId, input),
      })
    }

    if (req.method === 'DELETE') {
      await mediaProviderService.disconnect(kind, providerId)
      return Response.json({ ok: true })
    }

    throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        ApiError.badRequest(error.issues.map((issue) => issue.message).join('; ')),
      )
    }
    return errorResponse(error)
  }
}
