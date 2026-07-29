import { z } from 'zod'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import { routingService } from '../routing/routingService.js'

export async function handleRoutingApi(
  req: Request,
  _url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const action = segments[2]

    if (!action && req.method === 'GET') {
      return Response.json(await routingService.getDashboard())
    }

    if (action === 'config') {
      if (req.method === 'GET') {
        return Response.json({ config: await routingService.getConfig() })
      }
      if (req.method === 'PUT') {
        let body: unknown
        try {
          body = await req.json()
        } catch {
          throw ApiError.badRequest('Invalid JSON body')
        }
        try {
          return Response.json({ config: await routingService.updateConfig(body) })
        } catch (error) {
          if (error instanceof z.ZodError) {
            throw ApiError.badRequest(error.issues.map((issue) => issue.message).join('; '))
          }
          throw error
        }
      }
    }

    if (action === 'reset-health' && req.method === 'POST') {
      routingService.resetHealth()
      return Response.json({ ok: true })
    }

    throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
  } catch (error) {
    return errorResponse(error)
  }
}
