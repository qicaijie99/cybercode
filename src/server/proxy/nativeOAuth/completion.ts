import { randomUUID } from 'node:crypto'
import type {
  OpenAIChatMessage,
  OpenAIChatRequest,
  OpenAIChatResponse,
  OpenAIToolCall,
} from '../transform/types.js'
import type { NativeCompletion, NativeOAuthChatResult } from './types.js'

const TOOL_OPEN = '<cybercode_tool_call>'
const TOOL_CLOSE = '</cybercode_tool_call>'

function textContent(content: OpenAIChatMessage['content']): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => part.type === 'text' ? part.text : '[image]')
    .join('')
}

function toolInstruction(request: OpenAIChatRequest): string {
  if (!request.tools?.length) return ''
  const definitions = request.tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description ?? '',
    input_schema: tool.function.parameters ?? {
      type: 'object',
      properties: {},
    },
  }))
  return [
    'CyberCode has executable tools. Use one when the task requires files, commands, search, or other external actions.',
    'To call a tool, output only one or more exact blocks in this format:',
    `${TOOL_OPEN}{"name":"tool_name","arguments":{"key":"value"}}${TOOL_CLOSE}`,
    'Do not put tool-call blocks in Markdown fences. Do not claim a tool ran before receiving its result.',
    `Available tools: ${JSON.stringify(definitions)}`,
  ].join('\n')
}

export function prepareTextToolRequest(
  request: OpenAIChatRequest,
): OpenAIChatRequest {
  const instruction = toolInstruction(request)
  if (!instruction) return request
  return {
    ...request,
    messages: [
      { role: 'system', content: instruction },
      ...request.messages,
    ],
  }
}

export function flattenMessages(messages: OpenAIChatMessage[]): string {
  return messages
    .map((message) => {
      const role = message.role === 'tool'
        ? `Tool result${message.name ? ` (${message.name})` : ''}`
        : message.role[0]!.toUpperCase() + message.role.slice(1)
      let body = textContent(message.content)
      if (message.tool_calls?.length) {
        const calls = message.tool_calls.map((call) => ({
          id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
        }))
        body = [body, `Tool calls: ${JSON.stringify(calls)}`].filter(Boolean).join('\n')
      }
      if (message.tool_call_id) {
        body = `Tool call id: ${message.tool_call_id}\n${body}`
      }
      return `${role}:\n${body}`
    })
    .join('\n\n')
}

function parseToolPayload(
  raw: string,
  allowedNames: ReadonlySet<string>,
): OpenAIToolCall | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.trim())
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  if (!name || !allowedNames.has(name)) return null
  const args = record.arguments ?? record.input ?? {}
  return {
    id: `call_${randomUUID().replace(/-/g, '')}`,
    type: 'function',
    function: {
      name,
      arguments: typeof args === 'string' ? args : JSON.stringify(args),
    },
  }
}

export function parseTextToolCalls(
  content: string,
  request: OpenAIChatRequest,
): NativeCompletion {
  if (!request.tools?.length || !content.includes(TOOL_OPEN)) return { content }
  const allowedNames = new Set(request.tools.map((tool) => tool.function.name))
  const calls: OpenAIToolCall[] = []
  const pattern = /<cybercode_tool_call>([\s\S]*?)<\/cybercode_tool_call>/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(content))) {
    const call = parseToolPayload(match[1] ?? '', allowedNames)
    if (call) calls.push(call)
  }
  if (calls.length === 0) return { content }
  const visible = content.replace(pattern, '').trim()
  return {
    content: visible,
    toolCalls: calls,
  }
}

function completionPayload(
  request: OpenAIChatRequest,
  completion: NativeCompletion,
  id: string,
  created: number,
): OpenAIChatResponse {
  const promptTokens = completion.usage?.prompt_tokens ??
    Math.max(1, Math.ceil(flattenMessages(request.messages).length / 4))
  const completionTokens = completion.usage?.completion_tokens ??
    Math.max(1, Math.ceil(completion.content.length / 4))
  return {
    id,
    object: 'chat.completion',
    created,
    model: completion.model || request.model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: completion.content || null,
        ...(completion.toolCalls?.length && { tool_calls: completion.toolCalls }),
      },
      finish_reason: completion.toolCalls?.length ? 'tool_calls' : 'stop',
    }],
    usage: completion.usage ?? {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  }
}

export function jsonCompletionResponse(
  request: OpenAIChatRequest,
  completion: NativeCompletion,
): NativeOAuthChatResult {
  const payload = completionPayload(
    request,
    completion,
    `chatcmpl-native-${randomUUID()}`,
    Math.floor(Date.now() / 1000),
  )
  return {
    response: Response.json(payload),
    upstreamIsStream: false,
  }
}

function sseChunk(value: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`)
}

export function streamCompletionResponse(
  request: OpenAIChatRequest,
  run: () => Promise<NativeCompletion>,
): NativeOAuthChatResult {
  const id = `chatcmpl-native-${randomUUID()}`
  const created = Math.floor(Date.now() / 1000)
  const model = request.model
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(sseChunk({
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{
          index: 0,
          delta: { role: 'assistant' },
          finish_reason: null,
        }],
      }))
      try {
        const completion = await run()
        if (completion.content) {
          controller.enqueue(sseChunk({
            id,
            object: 'chat.completion.chunk',
            created,
            model: completion.model || model,
            choices: [{
              index: 0,
              delta: { content: completion.content },
              finish_reason: null,
            }],
          }))
        }
        completion.toolCalls?.forEach((call, index) => {
          controller.enqueue(sseChunk({
            id,
            object: 'chat.completion.chunk',
            created,
            model: completion.model || model,
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index,
                  id: call.id,
                  type: 'function',
                  function: call.function,
                }],
              },
              finish_reason: null,
            }],
          }))
        })
        controller.enqueue(sseChunk({
          id,
          object: 'chat.completion.chunk',
          created,
          model: completion.model || model,
          choices: [{
            index: 0,
            delta: {},
            finish_reason: completion.toolCalls?.length ? 'tool_calls' : 'stop',
          }],
          ...(completion.usage && { usage: completion.usage }),
        }))
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })
  return {
    response: new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    }),
    upstreamIsStream: true,
  }
}

export async function resolvedCompletionResponse(
  request: OpenAIChatRequest,
  stream: boolean,
  run: () => Promise<NativeCompletion>,
): Promise<NativeOAuthChatResult> {
  if (stream) return streamCompletionResponse(request, run)
  return jsonCompletionResponse(request, await run())
}

export function upstreamError(
  provider: string,
  status: number,
  detail: string,
): NativeOAuthChatResult {
  return {
    response: Response.json({
      error: {
        type: status === 401 || status === 403
          ? 'authentication_error'
          : status === 429 ? 'rate_limit_error' : 'api_error',
        message: `${provider} returned HTTP ${status}: ${detail.slice(0, 500)}`,
      },
    }, { status }),
    upstreamIsStream: false,
  }
}
