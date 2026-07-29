/**
 * Adapted from OmniRoute's GitLab Duo executor (MIT).
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

type DirectAccess = {
  token: string
  baseUrl: string
  headers: Record<string, string>
  expiresAt: number | null
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function normalizeBaseUrl(value: unknown): string {
  const raw = typeof value === 'string' && value.trim()
    ? value.trim()
    : 'https://gitlab.com'
  return raw.replace(/\/+$/, '')
}

function directGatewayUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '')
  if (normalized.endsWith('/ai/v2/completions')) return normalized
  if (normalized.endsWith('/ai/v2')) return `${normalized}/completions`
  return `${normalized}/ai/v2/completions`
}

function parseDirectAccess(value: unknown): DirectAccess | null {
  const data = record(value)
  const token = typeof data.token === 'string' ? data.token.trim() : ''
  const baseUrlValue = data.baseUrl ?? data.base_url
  const baseUrl = typeof baseUrlValue === 'string' ? baseUrlValue.trim() : ''
  if (!token || !baseUrl) return null
  const rawHeaders = record(data.headers)
  const headers: Record<string, string> = {}
  Object.entries(rawHeaders).forEach(([key, headerValue]) => {
    if (typeof headerValue === 'string') headers[key] = headerValue
  })
  const rawExpiry = data.expiresAt ?? data.expires_at
  const expiresAt = typeof rawExpiry === 'number'
    ? (rawExpiry < 10_000_000_000 ? rawExpiry * 1000 : rawExpiry)
    : typeof rawExpiry === 'string'
      ? Date.parse(rawExpiry)
      : null
  if (expiresAt && Number.isFinite(expiresAt) && expiresAt <= Date.now() + 60_000) {
    return null
  }
  return { token, baseUrl, headers, expiresAt }
}

async function requestDirectAccess(
  input: NativeOAuthChatInput,
  root: string,
): Promise<DirectAccess | null> {
  const cached = parseDirectAccess(input.auth.providerSpecificData.gitlabDirectAccess)
  if (cached) return cached
  const response = await (input.fetchFn ?? fetch)(
    `${root}/api/v4/code_suggestions/direct_access`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.auth.token}`,
        Accept: 'application/json',
      },
      signal: input.signal,
    },
  ).catch(() => null)
  if (!response?.ok) return null
  return parseDirectAccess(await response.json().catch(() => ({})))
}

function extractResponseContent(payload: JsonRecord): string {
  const choices = Array.isArray(payload.choices) ? payload.choices : []
  const first = record(choices[0])
  if (typeof first.text === 'string') return first.text
  const message = record(first.message)
  if (typeof message.content === 'string') return message.content
  if (typeof payload.content === 'string') return payload.content
  return ''
}

function resolveResponseModel(payload: JsonRecord, fallback: string): string {
  if (typeof payload.model === 'string' && payload.model.trim()) return payload.model.trim()
  const model = record(payload.model)
  if (typeof model.name === 'string' && model.name.trim()) return model.name.trim()
  if (typeof model.id === 'string' && model.id.trim()) return model.id.trim()
  return fallback
}

async function runGitLabDuo(input: NativeOAuthChatInput): Promise<NativeCompletion> {
  const fetchFn = input.fetchFn ?? fetch
  const prepared = prepareTextToolRequest(input.request)
  const prompt = flattenMessages(prepared.messages)
  if (!prompt.trim()) throw new Error('GitLab Duo requires at least one message')
  const boundedPrompt = prompt.length > 24_000
    ? `${prompt.slice(-24_000)}\n[older context truncated]`
    : prompt
  const root = normalizeBaseUrl(input.auth.providerSpecificData.baseUrl)
  const directAccess = await requestDirectAccess(input, root)
  const target = directAccess
    ? {
        url: directGatewayUrl(directAccess.baseUrl),
        headers: {
          Authorization: `Bearer ${directAccess.token}`,
          ...directAccess.headers,
        },
      }
    : {
        url: `${root}/api/v4/code_suggestions/completions`,
        headers: { Authorization: `Bearer ${input.auth.token}` },
      }
  const payload = {
    current_file: {
      file_name: 'snippet.txt',
      content_above_cursor: boundedPrompt,
      content_below_cursor: '',
    },
    intent: 'generation',
    generation_type: 'small_file',
    stream: false,
    user_instruction: boundedPrompt.slice(-4_000),
  }

  let response = await fetchFn(target.url, {
    method: 'POST',
    headers: {
      ...target.headers,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: input.signal,
  })
  if (!response.ok && directAccess) {
    response = await fetchFn(`${root}/api/v4/code_suggestions/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.auth.token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: input.signal,
    })
  }
  if (!response.ok) {
    throw new Error(`GitLab Duo returned HTTP ${response.status}: ${await response.text()}`)
  }
  const responsePayload = await response.json().catch(() => ({})) as JsonRecord
  const content = extractResponseContent(responsePayload)
  if (!content) throw new Error('GitLab Duo returned no completion text')
  return {
    ...parseTextToolCalls(content, input.request),
    model: resolveResponseModel(responsePayload, input.request.model),
  }
}

export async function executeGitLabDuo(
  input: NativeOAuthChatInput,
): Promise<NativeOAuthChatResult> {
  if (!input.auth.token) return upstreamError('GitLab Duo', 401, 'access token is missing')
  return resolvedCompletionResponse(
    input.request,
    input.stream,
    () => runGitLabDuo(input),
  )
}
