import type {
  AnthropicContentBlock,
  AnthropicRequest,
  AnthropicResponse,
  OpenAIChatMessage,
  OpenAIChatRequest,
  OpenAIChatResponse,
  OpenAIToolCall,
} from '../proxy/transform/types.js'

type OpenAIRequestInput = OpenAIChatRequest & Record<string, unknown>
type OpenAIMessageInput = OpenAIChatMessage & Record<string, unknown>

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((part) => {
    if (!part || typeof part !== 'object') return ''
    const record = part as Record<string, unknown>
    return typeof record.text === 'string' ? record.text : ''
  }).filter(Boolean).join('\n')
}

function contentBlocks(content: unknown): AnthropicContentBlock[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (!Array.isArray(content)) return [{ type: 'text', text: '' }]
  const blocks: AnthropicContentBlock[] = []
  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    const record = part as Record<string, unknown>
    if ((record.type === 'text' || record.type === 'input_text') && typeof record.text === 'string') {
      blocks.push({ type: 'text', text: record.text })
      continue
    }
    if (record.type === 'image_url' && record.image_url && typeof record.image_url === 'object') {
      const url = (record.image_url as Record<string, unknown>).url
      if (typeof url === 'string' && url.startsWith('data:')) {
        const match = url.match(/^data:([^;,]+);base64,(.+)$/)
        if (match) {
          blocks.push({
            type: 'image',
            source: { type: 'base64', media_type: match[1]!, data: match[2]! },
          })
          continue
        }
      }
      if (typeof url === 'string') blocks.push({ type: 'text', text: `[image] ${url}` })
    }
  }
  return blocks.length > 0 ? blocks : [{ type: 'text', text: '' }]
}

function appendMessage(
  messages: AnthropicRequest['messages'],
  role: 'user' | 'assistant',
  content: AnthropicRequest['messages'][number]['content'],
) {
  const previous = messages[messages.length - 1]
  if (!previous || previous.role !== role) {
    messages.push({ role, content })
    return
  }
  const previousBlocks = typeof previous.content === 'string'
    ? [{ type: 'text', text: previous.content } as AnthropicContentBlock]
    : previous.content
  const nextBlocks = typeof content === 'string'
    ? [{ type: 'text', text: content } as AnthropicContentBlock]
    : content
  previous.content = [...previousBlocks, ...nextBlocks]
}

function toolCallsFromMessage(message: OpenAIMessageInput): AnthropicContentBlock[] {
  if (!Array.isArray(message.tool_calls)) return []
  return message.tool_calls.flatMap((call) => {
    if (!call || call.type !== 'function' || !call.function?.name) return []
    let input: Record<string, unknown> = {}
    try {
      input = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>
    } catch {
      input = { raw: call.function.arguments || '' }
    }
    return [{
      type: 'tool_use' as const,
      id: call.id || `call_${crypto.randomUUID()}`,
      name: call.function.name,
      input,
    }]
  })
}

export function openaiToAnthropicRequest(
  input: unknown,
  model: string,
): AnthropicRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Request body must be a JSON object')
  }
  const body = input as OpenAIRequestInput
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new Error('messages must be a non-empty array')
  }

  const systemParts: string[] = []
  const messages: AnthropicRequest['messages'] = []
  for (const rawMessage of body.messages) {
    if (!rawMessage || typeof rawMessage !== 'object') continue
    const message = rawMessage as OpenAIMessageInput
    if (message.role === 'system' || message.role === 'developer') {
      const text = textFromContent(message.content)
      if (text) systemParts.push(text)
      continue
    }
    if (message.role === 'tool') {
      const toolUseId = typeof message.tool_call_id === 'string' ? message.tool_call_id : ''
      if (!toolUseId) continue
      appendMessage(messages, 'user', [{
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: textFromContent(message.content),
      }])
      continue
    }
    if (message.role === 'assistant') {
      const blocks = [...contentBlocks(message.content), ...toolCallsFromMessage(message)]
      appendMessage(messages, 'assistant', blocks)
      continue
    }
    appendMessage(messages, 'user', contentBlocks(message.content))
  }

  if (messages.length === 0) throw new Error('messages did not contain a supported user or assistant message')

  const maxTokens = typeof body.max_tokens === 'number'
    ? body.max_tokens
    : typeof body.max_completion_tokens === 'number'
      ? body.max_completion_tokens
      : 4096
  const request: AnthropicRequest = {
    model,
    messages,
    max_tokens: Math.max(1, Math.floor(maxTokens)),
    ...(systemParts.length > 0 && { system: systemParts.join('\n\n') }),
    ...(typeof body.temperature === 'number' && { temperature: body.temperature }),
    ...(typeof body.top_p === 'number' && { top_p: body.top_p }),
    ...(body.stream === true && { stream: true }),
  }
  if (typeof body.stop === 'string') request.stop_sequences = [body.stop]
  else if (Array.isArray(body.stop)) request.stop_sequences = body.stop.filter((item): item is string => typeof item === 'string')
  if (Array.isArray(body.tools)) {
    request.tools = body.tools.flatMap((rawTool) => {
      if (!rawTool || typeof rawTool !== 'object') return []
      const tool = rawTool as { type?: unknown; function?: Record<string, unknown> }
      if (tool.type !== 'function' || !tool.function || typeof tool.function.name !== 'string') return []
      return [{
        name: tool.function.name,
        ...(typeof tool.function.description === 'string' && { description: tool.function.description }),
        input_schema: tool.function.parameters && typeof tool.function.parameters === 'object'
          ? tool.function.parameters as Record<string, unknown>
          : { type: 'object', properties: {} },
      }]
    })
  }
  if (body.tool_choice !== undefined) {
    if (body.tool_choice === 'none') request.tool_choice = { type: 'none' }
    else if (body.tool_choice === 'required') request.tool_choice = { type: 'any' }
    else if (body.tool_choice === 'auto') request.tool_choice = { type: 'auto' }
    else if (body.tool_choice && typeof body.tool_choice === 'object') {
      const choice = body.tool_choice as { type?: unknown; function?: { name?: unknown } }
      if (choice.type === 'function' && typeof choice.function?.name === 'string') {
        request.tool_choice = { type: 'tool', name: choice.function.name }
      }
    }
  }
  return request
}

function finishReason(stopReason: string | null): string | null {
  switch (stopReason) {
    case 'end_turn': return 'stop'
    case 'tool_use': return 'tool_calls'
    case 'max_tokens': return 'length'
    default: return stopReason ? 'stop' : null
  }
}

export function anthropicToOpenaiResponse(
  response: AnthropicResponse,
  model: string,
): OpenAIChatResponse {
  const text = response.content
    .filter((block): block is Extract<AnthropicContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('')
  const reasoning = response.content
    .filter((block): block is Extract<AnthropicContentBlock, { type: 'thinking' }> => block.type === 'thinking')
    .map((block) => block.thinking)
    .join('')
  const toolCalls: OpenAIToolCall[] = response.content
    .filter((block): block is Extract<AnthropicContentBlock, { type: 'tool_use' }> => block.type === 'tool_use')
    .map((block) => ({
      id: block.id,
      type: 'function',
      function: { name: block.name, arguments: JSON.stringify(block.input) },
    }))
  const inputTokens = response.usage?.input_tokens ?? 0
  const outputTokens = response.usage?.output_tokens ?? 0
  return {
    id: response.id || `chatcmpl_${crypto.randomUUID()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: text || null,
        ...(reasoning && { reasoning_content: reasoning }),
        ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
      },
      finish_reason: finishReason(response.stop_reason),
    }],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
      ...(response.usage?.cache_read_input_tokens && {
        prompt_tokens_details: { cached_tokens: response.usage.cache_read_input_tokens },
      }),
    },
  }
}

function sse(data: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
}

function parseSseData(line: string): Record<string, unknown> | null {
  const dataLine = line.split(/\r?\n/).find((entry) => entry.startsWith('data:'))
  if (!dataLine) return null
  const data = dataLine.slice(5).trim()
  if (!data || data === '[DONE]') return null
  try {
    const parsed = JSON.parse(data)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

export function anthropicStreamToOpenai(
  upstream: ReadableStream<Uint8Array>,
  model: string,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  let buffer = ''
  let emittedRole = false
  let emittedDone = false
  let chunkId = `chatcmpl_${crypto.randomUUID()}`
  const created = Math.floor(Date.now() / 1000)

  const emit = (controller: ReadableStreamDefaultController<Uint8Array>, delta: Record<string, unknown>, finishReason: string | null = null) => {
    controller.enqueue(sse({
      id: chunkId,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    }))
  }
  const complete = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (emittedDone) return
    emittedDone = true
    controller.enqueue(encoder.encode('data: [DONE]\n\n'))
  }
  const process = (event: Record<string, unknown>, controller: ReadableStreamDefaultController<Uint8Array>) => {
    const eventType = event.type
    if (eventType === 'message_start') {
      const message = event.message as Record<string, unknown> | undefined
      if (typeof message?.id === 'string') chunkId = message.id.replace(/^msg_/, 'chatcmpl_')
      if (!emittedRole) {
        emittedRole = true
        emit(controller, { role: 'assistant' })
      }
      return
    }
    if (!emittedRole) {
      emittedRole = true
      emit(controller, { role: 'assistant' })
    }
    if (eventType === 'content_block_delta') {
      const delta = event.delta as Record<string, unknown> | undefined
      const index = typeof event.index === 'number' ? event.index : 0
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        emit(controller, { content: delta.text })
      } else if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        emit(controller, { tool_calls: [{ index, function: { arguments: delta.partial_json } }] })
      }
      return
    }
    if (eventType === 'content_block_start') {
      const block = event.content_block as Record<string, unknown> | undefined
      if (block?.type === 'tool_use') {
        const index = typeof event.index === 'number' ? event.index : 0
        emit(controller, {
          tool_calls: [{
            index,
            ...(typeof block.id === 'string' && { id: block.id }),
            type: 'function',
            function: { name: typeof block.name === 'string' ? block.name : '' },
          }],
        })
      }
      return
    }
    if (eventType === 'message_delta') {
      const delta = event.delta as Record<string, unknown> | undefined
      emit(controller, {}, finishReason(typeof delta?.stop_reason === 'string' ? delta.stop_reason : null))
      return
    }
    if (eventType === 'message_stop') complete(controller)
  }

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const events = buffer.split(/\r?\n\r?\n/)
          buffer = events.pop() ?? ''
          for (const rawEvent of events) {
            const event = parseSseData(rawEvent)
            if (event) process(event, controller)
          }
        }
        if (buffer.trim()) {
          const event = parseSseData(buffer)
          if (event) process(event, controller)
        }
        complete(controller)
        controller.close()
      } catch (error) {
        controller.error(error)
      } finally {
        reader.releaseLock()
      }
    },
    cancel(reason) {
      return upstream.cancel(reason)
    },
  })
}
