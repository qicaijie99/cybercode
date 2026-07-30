import { ApiError } from '../middleware/errorHandler.js'
import { handleProxyRequest } from '../proxy/handler.js'
import type { AnthropicResponse } from '../proxy/transform/types.js'
import { gatewayService } from './gatewayService.js'
import {
  anthropicStreamToOpenai,
  anthropicToOpenaiResponse,
  openaiToAnthropicRequest,
} from './openai.js'

function openaiError(
  status: number,
  message: string,
  type = 'invalid_request_error',
  code?: string,
): Response {
  return Response.json({
    error: {
      message,
      type,
      ...(code && { code }),
    },
  }, { status })
}

function anthropicError(
  status: number,
  message: string,
  type = 'invalid_request_error',
): Response {
  return Response.json({
    type: 'error',
    error: { type, message },
  }, { status })
}

function sessionId(req: Request, keyId: string, body: Record<string, unknown>): string {
  const metadata = body.metadata && typeof body.metadata === 'object'
    ? body.metadata as Record<string, unknown>
    : null
  const bodyUser = typeof body.user === 'string' ? body.user : undefined
  const metadataUser = typeof metadata?.user_id === 'string'
    ? metadata.user_id
    : undefined
  const candidate = req.headers.get('x-session-id')
    ?? req.headers.get('x-session_id')
    ?? bodyUser
    ?? metadataUser
    ?? ''
  const safeCandidate = candidate.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)
  return `node-${keyId.slice(0, 8)}-${safeCandidate || 'default'}`
}

function proxyUrl(url: URL, target: { kind: 'model' | 'route'; providerId?: string; routeId?: string }, session: string): string {
  if (target.kind === 'model' && target.providerId) {
    return new URL(
      `/proxy/providers/${encodeURIComponent(target.providerId)}/v1/messages`,
      url.origin,
    ).toString()
  }
  if (target.kind === 'route' && target.routeId) {
    return new URL(
      `/proxy/routes/${encodeURIComponent(target.routeId)}/sessions/${encodeURIComponent(session)}/v1/messages`,
      url.origin,
    ).toString()
  }
  throw ApiError.badRequest('Invalid node target')
}

async function readError(response: Response): Promise<{ message: string; type?: string; code?: string }> {
  try {
    const data = await response.json() as Record<string, unknown>
    const error = data.error && typeof data.error === 'object'
      ? data.error as Record<string, unknown>
      : data
    return {
      message: typeof error.message === 'string' ? error.message : `Upstream returned HTTP ${response.status}`,
      ...(typeof error.type === 'string' && { type: error.type }),
      ...(typeof error.code === 'string' && { code: error.code }),
    }
  } catch {
    return { message: `Upstream returned HTTP ${response.status}` }
  }
}

export async function handleGatewayRequest(req: Request, url: URL): Promise<Response> {
  const isAnthropicMessages = url.pathname === '/v1/messages'
  try {
    const auth = await gatewayService.authenticate(req)

    if (req.method === 'GET' && url.pathname === '/v1/models') {
      const status = await gatewayService.getStatus(url)
      const allowedTargets = status.targets.filter((target) => (
        target.available && auth.key.allowedTargets.includes(target.id)
      ))
      const models = allowedTargets.map((target) => ({
        id: target.publicId,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: target.kind === 'route' ? 'cybercode-route' : 'cybercode-model',
        ...(target.kind === 'model' && { root: target.modelId }),
      }))
      if (auth.key.defaultTarget && allowedTargets.some((target) => target.id === auth.key.defaultTarget)) {
        const defaultTarget = allowedTargets.find((target) => target.id === auth.key.defaultTarget)
        models.unshift({
          id: 'auto',
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: 'cybercode-route',
          root: defaultTarget?.publicId ?? auth.key.defaultTarget,
        })
      }
      return Response.json({ object: 'list', data: models })
    }

    const isOpenaiMessages = url.pathname === '/v1/chat/completions'
    if (req.method !== 'POST' || (!isOpenaiMessages && !isAnthropicMessages)) {
      return openaiError(404, 'Not Found', 'invalid_request_error')
    }
    const requestError = isAnthropicMessages ? anthropicError : openaiError

    let body: Record<string, unknown>
    try {
      const parsed = await req.json()
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return requestError(400, 'Request body must be a JSON object')
      }
      body = parsed as Record<string, unknown>
    } catch {
      return requestError(400, 'Invalid JSON body')
    }

    const requestedModel = typeof body.model === 'string' ? body.model : 'auto'
    const target = await gatewayService.resolveAuthorizedTarget(auth.key, requestedModel)
    const actualModel = target.modelId ?? `cybercode-route-${target.routeId}`

    if (isAnthropicMessages) {
      const anthropicRequest = {
        ...body,
        model: actualModel,
      }
      await gatewayService.consumeRequest(auth.key, target.id)

      const internalHeaders = new Headers({
        'Content-Type': 'application/json',
        'anthropic-version': req.headers.get('anthropic-version') || '2023-06-01',
      })
      const beta = req.headers.get('anthropic-beta')
      if (beta) internalHeaders.set('anthropic-beta', beta)
      const internalRequest = new Request(
        proxyUrl(url, target, sessionId(req, auth.key.id, body)),
        {
          method: 'POST',
          headers: internalHeaders,
          body: JSON.stringify(anthropicRequest),
          signal: req.signal,
        },
      )
      const upstream = await handleProxyRequest(internalRequest, new URL(internalRequest.url))
      if (!upstream.ok) {
        const error = await readError(upstream)
        return anthropicError(
          upstream.status,
          error.message,
          error.type ?? 'api_error',
        )
      }

      const headers = new Headers(upstream.headers)
      headers.set('x-cybercode-target', target.id)
      const routedTarget = upstream.headers.get('x-cybercode-route-model')
      if (routedTarget) headers.set('x-cybercode-resolved-model', routedTarget)
      return new Response(upstream.body, {
        status: upstream.status,
        headers,
      })
    }

    let anthropicRequest
    try {
      anthropicRequest = openaiToAnthropicRequest(body, actualModel)
    } catch (error) {
      return openaiError(400, error instanceof Error ? error.message : String(error))
    }

    await gatewayService.consumeRequest(auth.key, target.id)

    const internalRequest = new Request(proxyUrl(url, target, sessionId(req, auth.key.id, body)), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(anthropicRequest),
      signal: req.signal,
    })
    const upstream = await handleProxyRequest(internalRequest, new URL(internalRequest.url))
    if (!upstream.ok) {
      const error = await readError(upstream)
      return openaiError(upstream.status, error.message, error.type ?? 'api_error', error.code)
    }

    const headers = new Headers({
      'x-cybercode-target': target.id,
    })
    const routedTarget = upstream.headers.get('x-cybercode-route-model')
    if (routedTarget) headers.set('x-cybercode-resolved-model', routedTarget)
    if (anthropicRequest.stream) {
      if (!upstream.body) return openaiError(502, 'Upstream returned no stream')
      headers.set('Content-Type', 'text/event-stream')
      headers.set('Cache-Control', 'no-cache')
      headers.set('Connection', 'keep-alive')
      return new Response(anthropicStreamToOpenai(upstream.body, requestedModel), {
        status: 200,
        headers,
      })
    }

    let response: AnthropicResponse
    try {
      response = await upstream.json() as AnthropicResponse
    } catch {
      return openaiError(502, 'Upstream returned invalid JSON')
    }
    headers.set('Content-Type', 'application/json')
    return Response.json(anthropicToOpenaiResponse(response, requestedModel), { headers })
  } catch (error) {
    if (error instanceof ApiError) {
      const type = error.statusCode === 401 ? 'authentication_error'
        : error.statusCode === 429 ? 'rate_limit_error'
          : 'invalid_request_error'
      if (isAnthropicMessages) {
        return anthropicError(error.statusCode, error.message, type)
      }
      return openaiError(error.statusCode, error.message, type, error.code)
    }
    console.error('[gateway] Request failed:', error)
    if (isAnthropicMessages) {
      return anthropicError(500, 'Internal gateway error', 'api_error')
    }
    return openaiError(500, 'Internal gateway error', 'server_error')
  }
}
