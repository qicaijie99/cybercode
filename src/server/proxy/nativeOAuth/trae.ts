/**
 * Adapted from OmniRoute's Trae executor (MIT).
 * See LICENSE-OmniRoute.md in this directory.
 */

import {
  flattenMessages,
  parseTextToolCalls,
  prepareTextToolRequest,
  resolvedCompletionResponse,
  upstreamError,
} from './completion.js'
import type {
  NativeCompletion,
  NativeOAuthChatInput,
  NativeOAuthChatResult,
} from './types.js'

type JsonRecord = Record<string, unknown>

function commonParams(
  data: Record<string, unknown>,
  mode: 'code' | 'work',
): string {
  return JSON.stringify({
    language: 'en-us',
    app_language: typeof data.appLanguage === 'string' ? data.appLanguage : 'en',
    quality: 'stable',
    app_version: typeof data.appVersion === 'string' ? data.appVersion : '1.0.0.1229',
    web_id: typeof data.webId === 'string' ? data.webId : '',
    user_identity: typeof data.userIdentity === 'string' ? data.userIdentity : 'Free',
    is_freshman: '0',
    biz_user_id: typeof data.bizUserId === 'string' ? data.bizUserId : '',
    user_unique_id: typeof data.userUniqueId === 'string' ? data.userUniqueId : '',
    scope: typeof data.scope === 'string' ? data.scope : 'marscode-us',
    tenant: typeof data.tenant === 'string' ? data.tenant : 'marscode',
    region: typeof data.region === 'string' ? data.region : 'US-East',
    aiRegion: typeof data.aiRegion === 'string' ? data.aiRegion : 'US-East',
    is_privacy_mode: 0,
    privacy_mode: 'off',
    solo_chat_mode: mode,
  })
}

function modeFor(model: string): {
  mode: 'code' | 'work'
  strategy: 'auto' | 'manual'
  modelName: string
} {
  const normalized = model.trim().toLowerCase()
  if (normalized === 'work' || normalized === 'auto-work' || normalized === 'solo-work') {
    return { mode: 'work', strategy: 'auto', modelName: '' }
  }
  const automatic = !normalized || normalized === 'auto'
  return {
    mode: 'code',
    strategy: automatic ? 'auto' : 'manual',
    modelName: automatic ? '' : model,
  }
}

async function createSession(
  input: NativeOAuthChatInput,
  requestText: string,
): Promise<
  | { sessionId: string; messageId: string; baseUrl: string; headers: Record<string, string> }
  | NativeOAuthChatResult
> {
  const fetchFn = input.fetchFn ?? fetch
  const baseUrl = 'https://core-normal.trae.ai/api/remote/v1'
  const headers = {
    ...input.auth.headers,
    'Content-Type': 'application/json',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
  }
  const { mode, strategy, modelName } = modeFor(input.request.model)
  const response = await fetchFn(`${baseUrl}/chat_sessions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      mode,
      environment_id: 'default',
      initial_message: {
        chat_session_id: '',
        content: [],
        query: JSON.stringify([{ type: 'text', data: { content: requestText } }]),
        model_name: modelName,
        agent_type: 'solo_agent_remote',
        model_selection_strategy: strategy,
        common_params: commonParams(input.auth.providerSpecificData, mode),
      },
      env: 'remote',
      auto_create_project: false,
      origin: 'web',
    }),
    signal: input.signal,
  })
  const text = await response.text()
  if (!response.ok) return upstreamError('Trae', response.status, text)
  let payload: JsonRecord
  try {
    payload = JSON.parse(text) as JsonRecord
  } catch {
    return upstreamError('Trae', 502, 'create-session response was not JSON')
  }
  const data = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data as JsonRecord
    : {}
  if (
    payload.code !== 0 ||
    typeof data.chat_session_id !== 'string' ||
    typeof data.message_id !== 'string'
  ) {
    return upstreamError('Trae', 502, text)
  }
  return {
    sessionId: data.chat_session_id,
    messageId: data.message_id,
    baseUrl,
    headers,
  }
}

async function collectEvents(
  input: NativeOAuthChatInput,
  session: {
    sessionId: string
    messageId: string
    baseUrl: string
    headers: Record<string, string>
  },
): Promise<NativeCompletion> {
  const fetchFn = input.fetchFn ?? fetch
  const url = `${session.baseUrl}/chat_sessions/${session.sessionId}/events` +
    `?reply_to_message_id=${encodeURIComponent(session.messageId)}`
  const timeout = AbortSignal.timeout(300_000)
  const signal = input.signal
    ? AbortSignal.any([input.signal, timeout])
    : timeout
  const response = await fetchFn(url, {
    headers: session.headers,
    signal,
  })
  if (!response.ok || !response.body) {
    throw new Error(`Trae events stream failed (${response.status})`)
  }

  const thoughts = new Map<string, string>()
  const order: string[] = []
  let usage: OpenAIUsage | undefined
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let eventName = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim()
        continue
      }
      if (!line.startsWith('data:')) {
        if (!line.trim()) eventName = ''
        continue
      }
      const raw = line.slice(5).trim()
      let data: JsonRecord
      try {
        data = JSON.parse(raw) as JsonRecord
      } catch {
        continue
      }
      if (eventName === 'error') {
        throw new Error(`Trae ${String(data.code ?? '')}: ${String(data.message ?? 'request failed')}`)
      }
      if (eventName === 'token_usage') {
        const prompt = typeof data.prompt_tokens === 'number' ? data.prompt_tokens : 0
        const completion = typeof data.completion_tokens === 'number'
          ? data.completion_tokens
          : 0
        usage = {
          prompt_tokens: prompt,
          completion_tokens: completion,
          total_tokens: typeof data.total_tokens === 'number'
            ? data.total_tokens
            : prompt + completion,
        }
      }
      if (eventName === 'plan_item' && typeof data.id === 'string') {
        if (!thoughts.has(data.id)) order.push(data.id)
        const text = typeof data.thought === 'string' ? data.thought : ''
        if (text.length >= (thoughts.get(data.id)?.length ?? 0)) {
          thoughts.set(data.id, text)
        }
      }
      if (eventName === 'done') {
        await reader.cancel().catch(() => {})
        const content = order.map((id) => thoughts.get(id) ?? '').join('')
        return {
          ...parseTextToolCalls(content, input.request),
          ...(usage && { usage }),
        }
      }
    }
  }
  const content = order.map((id) => thoughts.get(id) ?? '').join('')
  return {
    ...parseTextToolCalls(content, input.request),
    ...(usage && { usage }),
  }
}

type OpenAIUsage = {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export async function executeTrae(
  input: NativeOAuthChatInput,
): Promise<NativeOAuthChatResult> {
  const prepared = prepareTextToolRequest(input.request)
  const session = await createSession(input, flattenMessages(prepared.messages))
  if ('response' in session) return session
  return resolvedCompletionResponse(
    input.request,
    input.stream,
    () => collectEvents(input, session),
  )
}
