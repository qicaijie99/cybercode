/**
 * Adapters API — IM Adapter 配置读写
 *
 * GET  /api/adapters  → 返回配置（敏感字段脱敏）
 * PUT  /api/adapters  → 更新配置（浅合并），返回更新后的脱敏配置
 */

import { adapterService } from '../services/adapterService.js'
import { adapterLoginService, type AdapterLoginPlatform } from '../services/adapterLoginService.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'

const ALLOWED_TOP_KEYS = new Set([
  'serverUrl',
  'defaultProjectDir',
  'telegram',
  'feishu',
  'weixin',
  'qq',
  'pairing',
])

export async function handleAdaptersApi(
  req: Request,
  _url: URL,
  segments: string[],
): Promise<Response> {
  try {
    if (segments[2] === 'login') {
      return await handleAdapterLoginApi(req, segments)
    }

    if (req.method === 'GET') {
      const config = await adapterService.getConfig()
      return Response.json(config)
    }

    if (req.method === 'PUT') {
      const body = (await req.json()) as Record<string, unknown>
      // Basic validation: only allow known top-level keys
      for (const key of Object.keys(body)) {
        if (!ALLOWED_TOP_KEYS.has(key)) {
          throw ApiError.badRequest(`Unknown config key: ${key}`)
        }
      }
      await adapterService.updateConfig(body)
      const config = await adapterService.getConfig()
      return Response.json(config)
    }

    throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
  } catch (error) {
    return errorResponse(error)
  }
}

async function handleAdapterLoginApi(req: Request, segments: string[]): Promise<Response> {
  const target = segments[3]
  if (req.method === 'POST' && (target === 'weixin' || target === 'qq') && !segments[4]) {
    return Response.json(await adapterLoginService.start(target as AdapterLoginPlatform), { status: 201 })
  }

  if (target === 'session' && segments[4]) {
    const sessionId = decodeURIComponent(segments[4])
    if (req.method === 'GET' && !segments[5]) {
      const state = adapterLoginService.get(sessionId)
      if (!state) throw ApiError.notFound('Login session not found')
      return Response.json(state)
    }
    if (req.method === 'POST' && segments[5] === 'verify') {
      const body = await req.json().catch(() => ({})) as { code?: unknown }
      if (typeof body.code !== 'string') throw ApiError.badRequest('Verification code is required')
      try {
        const state = adapterLoginService.submitVerification(sessionId, body.code)
        if (!state) throw ApiError.notFound('Login session not found or not awaiting verification')
        return Response.json(state)
      } catch (error) {
        if (error instanceof ApiError) throw error
        throw ApiError.badRequest(error instanceof Error ? error.message : String(error))
      }
    }
    if (req.method === 'DELETE' && !segments[5]) {
      if (!adapterLoginService.cancel(sessionId)) throw ApiError.notFound('Login session not found')
      return new Response(null, { status: 204 })
    }
  }

  throw ApiError.notFound('Adapter login route not found')
}
