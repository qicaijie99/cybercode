/**
 * Adapted from OmniRoute's Antigravity executor (MIT).
 * See LICENSE-OmniRoute.md in this directory.
 */

import { randomUUID } from 'node:crypto'
import {
  resolvedCompletionResponse,
  upstreamError,
} from './completion.js'
import type {
  NativeCompletion,
  NativeOAuthChatInput,
  NativeOAuthChatResult,
} from './types.js'
import type {
  OpenAIChatContentPart,
  OpenAIChatMessage,
} from '../transform/types.js'

type JsonRecord = Record<string, unknown>
type GeminiPart = Record<string, unknown>
type GeminiContent = {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

const ANTIGRAVITY_URLS = [
  'https://daily-cloudcode-pa.googleapis.com',
  'https://cloudcode-pa.googleapis.com',
] as const

const MODEL_ALIASES: Record<string, string> = {
  'gemini-3.1-pro-high': 'gemini-pro-agent',
  'gemini-3-pro-image-preview': 'gemini-3-pro-image',
  'gemini-claude-sonnet-4-5': 'claude-sonnet-4-6',
  'gemini-claude-sonnet-4-5-thinking': 'claude-sonnet-4-6',
  'gemini-claude-opus-4-5-thinking': 'claude-opus-4-6-thinking',
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function textParts(content: OpenAIChatMessage['content']): GeminiPart[] {
  if (typeof content === 'string') return content ? [{ text: content }] : []
  if (!Array.isArray(content)) return []
  return content.flatMap((part: OpenAIChatContentPart): GeminiPart[] => {
    if (part.type === 'text') return part.text ? [{ text: part.text }] : []
    const match = /^data:([^;,]+);base64,(.+)$/s.exec(part.image_url.url)
    if (!match) return [{ text: `[image: ${part.image_url.url}]` }]
    return [{
      inlineData: {
        mimeType: match[1],
        data: match[2],
      },
    }]
  })
}

function parseArguments(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return { raw: value }
  }
}

function appendContent(
  contents: GeminiContent[],
  role: GeminiContent['role'],
  parts: GeminiPart[],
): void {
  if (parts.length === 0) return
  const previous = contents.at(-1)
  if (previous?.role === role) previous.parts.push(...parts)
  else contents.push({ role, parts })
}

function buildGeminiContents(messages: OpenAIChatMessage[]): {
  contents: GeminiContent[]
  systemInstruction?: { role: 'user'; parts: GeminiPart[] }
} {
  const contents: GeminiContent[] = []
  const systemParts: GeminiPart[] = []
  const callNames = new Map<string, string>()

  for (const message of messages) {
    if (message.role === 'system') {
      systemParts.push(...textParts(message.content))
      continue
    }
    if (message.role === 'assistant') {
      const parts = textParts(message.content)
      for (const call of message.tool_calls ?? []) {
        callNames.set(call.id, call.function.name)
        parts.push({
          functionCall: {
            id: call.id,
            name: call.function.name,
            args: parseArguments(call.function.arguments),
          },
          thoughtSignature: 'skip_thought_signature_validator',
        })
      }
      appendContent(contents, 'model', parts)
      continue
    }
    if (message.role === 'tool') {
      const name = message.name || (
        message.tool_call_id ? callNames.get(message.tool_call_id) : undefined
      ) || 'tool'
      const text = textParts(message.content)
        .map((part) => typeof part.text === 'string' ? part.text : '')
        .join('')
      appendContent(contents, 'user', [{
        functionResponse: {
          id: message.tool_call_id,
          name,
          response: { output: text },
        },
      }])
      continue
    }
    appendContent(contents, 'user', textParts(message.content))
  }

  if (contents.length === 0) {
    contents.push({ role: 'user', parts: [{ text: '' }] })
  }
  return {
    contents,
    ...(systemParts.length > 0 && {
      systemInstruction: { role: 'user' as const, parts: systemParts },
    }),
  }
}

function sanitizeSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeSchema)
  if (!value || typeof value !== 'object') return value
  const output: JsonRecord = {}
  for (const [key, item] of Object.entries(value as JsonRecord)) {
    if ([
      '$schema',
      '$id',
      'additionalProperties',
      'examples',
      'default',
      'title',
    ].includes(key)) continue
    output[key] = sanitizeSchema(item)
  }
  return output
}

function buildRequest(input: NativeOAuthChatInput, projectId: string): JsonRecord {
  const model = MODEL_ALIASES[input.request.model] ?? input.request.model
  const converted = buildGeminiContents(input.request.messages)
  const tools = input.request.tools?.length
    ? [{
        functionDeclarations: input.request.tools.map((tool) => ({
          name: tool.function.name,
          description: tool.function.description || `Tool: ${tool.function.name}`,
          parameters: sanitizeSchema(tool.function.parameters ?? {
            type: 'object',
            properties: {},
          }),
        })),
      }]
    : undefined
  const maxOutputTokens = input.request.max_completion_tokens ??
    input.request.max_tokens
  const generationConfig: JsonRecord = {
    topK: 40,
    topP: input.request.top_p ?? 1,
    ...(typeof input.request.temperature === 'number' && {
      temperature: input.request.temperature,
    }),
    ...(typeof maxOutputTokens === 'number' && maxOutputTokens > 0 && {
      maxOutputTokens: Math.min(65_536, Math.floor(maxOutputTokens)),
    }),
    ...(input.request.stop && {
      stopSequences: Array.isArray(input.request.stop)
        ? input.request.stop
        : [input.request.stop],
    }),
  }
  return {
    project: projectId,
    model,
    userAgent: input.providerId === 'gemini-cli' ? 'gemini-cli' : 'antigravity',
    requestType: 'agent',
    requestId: randomUUID(),
    request: {
      model,
      ...converted,
      generationConfig,
      sessionId: randomUUID(),
      ...(tools && {
        tools,
        toolConfig: { functionCallingConfig: { mode: 'VALIDATED' } },
      }),
    },
  }
}

async function discoverProjectId(input: NativeOAuthChatInput): Promise<string> {
  const stored = input.auth.providerSpecificData.projectId
  if (typeof stored === 'string' && stored.trim()) return stored.trim()
  for (const baseUrl of ANTIGRAVITY_URLS) {
    const response = await (input.fetchFn ?? fetch)(
      `${baseUrl}/v1internal:loadCodeAssist`,
      {
        method: 'POST',
        headers: input.auth.headers,
        body: JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } }),
        signal: input.signal,
      },
    ).catch(() => null)
    if (!response?.ok) continue
    const payload = record(await response.json().catch(() => ({})))
    const project = payload.cloudaicompanionProject
    const projectId = typeof project === 'string'
      ? project
      : typeof record(project).id === 'string' ? String(record(project).id) : ''
    if (projectId.trim()) return projectId.trim()
  }
  return ''
}

function parseSsePayload(
  raw: string,
  seenTools: Set<string>,
  completion: NativeCompletion,
): void {
  let parsed: JsonRecord
  try {
    parsed = record(JSON.parse(raw))
  } catch {
    return
  }
  const response = record(parsed.response)
  const candidates = Array.isArray(response.candidates)
    ? response.candidates
    : Array.isArray(parsed.candidates) ? parsed.candidates : []
  const candidate = record(candidates[0])
  const content = record(candidate.content)
  const parts = Array.isArray(content.parts) ? content.parts : []
  for (const rawPart of parts) {
    const part = record(rawPart)
    const functionCall = record(part.functionCall)
    if (typeof functionCall.name === 'string' && functionCall.name) {
      const args = functionCall.args ?? {}
      const identity = `${String(functionCall.id ?? '')}:${functionCall.name}:${JSON.stringify(args)}`
      if (!seenTools.has(identity)) {
        seenTools.add(identity)
        completion.toolCalls ??= []
        completion.toolCalls.push({
          id: typeof functionCall.id === 'string' && functionCall.id
            ? functionCall.id
            : `call_${randomUUID().replace(/-/g, '')}`,
          type: 'function',
          function: {
            name: functionCall.name,
            arguments: JSON.stringify(args),
          },
        })
      }
      continue
    }
    if (
      typeof part.text === 'string' &&
      part.thought !== true &&
      typeof part.thoughtSignature !== 'string'
    ) {
      completion.content += part.text
    }
  }
  const usage = record(response.usageMetadata ?? parsed.usageMetadata)
  if (
    typeof usage.promptTokenCount === 'number' ||
    typeof usage.candidatesTokenCount === 'number'
  ) {
    const prompt = Number(usage.promptTokenCount ?? 0)
    const output = Number(usage.candidatesTokenCount ?? 0)
    completion.usage = {
      prompt_tokens: prompt,
      completion_tokens: output,
      total_tokens: Number(usage.totalTokenCount ?? prompt + output),
    }
  }
}

async function collectAntigravity(response: Response): Promise<NativeCompletion> {
  if (!response.body) throw new Error('Antigravity returned no response stream')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const completion: NativeCompletion = { content: '' }
  const seenTools = new Set<string>()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const lines = buffer.split(/\r?\n/)
    buffer = done ? '' : lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const raw = trimmed.slice(5).trim()
      if (raw && raw !== '[DONE]') parseSsePayload(raw, seenTools, completion)
    }
    if (done) break
  }
  return completion
}

export async function executeAntigravity(
  input: NativeOAuthChatInput,
): Promise<NativeOAuthChatResult> {
  if (!input.auth.token) {
    return upstreamError('Google Code Assist', 401, 'access token is missing')
  }
  const projectId = await discoverProjectId(input)
  if (!projectId) {
    return upstreamError(
      'Google Code Assist',
      422,
      'no Cloud Code project was found for this account; complete Code Assist onboarding and reconnect',
    )
  }

  const body = buildRequest(input, projectId)
  let lastResponse: Response | null = null
  for (const baseUrl of ANTIGRAVITY_URLS) {
    const response = await (input.fetchFn ?? fetch)(
      `${baseUrl}/v1internal:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        headers: {
          ...input.auth.headers,
          Accept: 'text/event-stream',
          'x-goog-user-project': projectId,
        },
        body: JSON.stringify(body),
        signal: input.signal,
      },
    )
    if (response.ok) {
      return resolvedCompletionResponse(
        input.request,
        input.stream,
        () => collectAntigravity(response),
      )
    }
    lastResponse = response
    if (response.status !== 404 && response.status < 500) break
  }

  const status = lastResponse?.status ?? 502
  const detail = lastResponse ? await lastResponse.text() : 'all endpoints failed'
  return upstreamError('Google Code Assist', status, detail)
}
