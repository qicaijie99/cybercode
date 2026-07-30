import {
  getWebSessionProviderIdFromPreset,
} from '../../../shared/webSessionProviders.js'
import type { SavedProvider } from '../../types/provider.js'
import { anthropicToOpenaiChat } from '../transform/anthropicToOpenaiChat.js'
import { openaiChatToAnthropic } from '../transform/openaiChatToAnthropic.js'
import { openaiChatStreamToAnthropic } from '../streaming/openaiChatStreamToAnthropic.js'
import type { AnthropicRequest } from '../transform/types.js'
import { executeWebSessionProvider } from './executors.js'
import { sanitizeErrorMessage } from './vendor/omniroute/open-sse/utils/error.js'

export function isWebSessionProvider(provider: Pick<SavedProvider, 'presetId'>): boolean {
  return getWebSessionProviderIdFromPreset(provider.presetId) !== null
}

export async function handleWebSessionRequest(
  provider: SavedProvider,
  body: AnthropicRequest,
  signal?: AbortSignal,
): Promise<Response> {
  const providerId = getWebSessionProviderIdFromPreset(provider.presetId)
  if (!providerId) {
    return Response.json(
      {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'The selected provider is not a Web Cookie provider',
        },
      },
      { status: 400 },
    )
  }

  const stream = body.stream === true
  const transformed = anthropicToOpenaiChat(body)
  transformed.model = provider.models.main || body.model
  transformed.stream = stream

  const upstream = await executeWebSessionProvider({
    providerId,
    providerRecordId: provider.id,
    credential: provider.apiKey,
    model: transformed.model,
    body: transformed,
    stream,
    signal,
  })

  if (!upstream.ok) {
    const raw = await upstream.text().catch(() => '')
    let message = sanitizeErrorMessage(raw).slice(0, 500)
    try {
      const parsed = JSON.parse(raw) as {
        error?: { message?: string }
        message?: string
      }
      message = sanitizeErrorMessage(parsed.error?.message ?? parsed.message ?? message)
    } catch {
      // Preserve the sanitized upstream text.
    }
    return Response.json(
      {
        type: 'error',
        error: {
          type: upstream.status === 401 || upstream.status === 403
            ? 'authentication_error'
            : upstream.status === 429
              ? 'rate_limit_error'
              : 'api_error',
          message: message || `Web session returned HTTP ${upstream.status}`,
        },
      },
      { status: upstream.status },
    )
  }

  if (stream) {
    if (!upstream.body) {
      return Response.json(
        {
          type: 'error',
          error: {
            type: 'api_error',
            message: 'Web session returned no streaming response body',
          },
        },
        { status: 502 },
      )
    }
    return new Response(
      openaiChatStreamToAnthropic(upstream.body, body.model),
      {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      },
    )
  }

  const payload = await upstream.json()
  return Response.json(openaiChatToAnthropic(payload, body.model))
}
