import { z } from 'zod'
import { errorResponse, ApiError } from '../middleware/errorHandler.js'
import { gatewayService } from '../gateway/gatewayService.js'

export async function handleGatewayApi(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const action = segments[2]
    const keyId = segments[3]
    const keyAction = segments[4]
    if (!action && req.method === 'GET') {
      return Response.json(await gatewayService.getStatus(url))
    }
    if (action === 'config' && req.method === 'PUT') {
      let body: unknown
      try {
        body = await req.json()
      } catch {
        throw ApiError.badRequest('Invalid JSON body')
      }
      return Response.json({ status: await gatewayService.updateConfig(body, url) })
    }
    if (action === 'keys' && keyId && keyAction === 'rotate' && req.method === 'POST') {
      return Response.json(await gatewayService.rotateKey(keyId, url))
    }
    if (action === 'keys' && !keyId && req.method === 'POST') {
      const raw = await req.text()
      let body: unknown = {}
      if (raw.trim()) {
        try {
          body = JSON.parse(raw)
        } catch {
          throw ApiError.badRequest('Invalid JSON body')
        }
      }
      return Response.json(await gatewayService.createKey(body, url), { status: 201 })
    }
    if (action === 'keys' && keyId && !keyAction && req.method === 'PUT') {
      let body: unknown
      try {
        body = await req.json()
      } catch {
        throw ApiError.badRequest('Invalid JSON body')
      }
      return Response.json({ status: await gatewayService.updateKey(keyId, body, url) })
    }
    if (action === 'keys' && keyId && !keyAction && req.method === 'DELETE') {
      return Response.json({ status: await gatewayService.revokeKey(keyId, url) })
    }
    throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(ApiError.badRequest(error.issues.map((issue) => issue.message).join('; ')))
    }
    return errorResponse(error)
  }
}
