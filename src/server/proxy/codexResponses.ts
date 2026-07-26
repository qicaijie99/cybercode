import type {
  OpenAIResponsesRequest,
  OpenAIResponsesResponse,
} from './transform/types.js'

type JsonRecord = Record<string, unknown>

function flattenFunctionTool(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const tool = value as JsonRecord
  if (tool.type !== 'function') return null

  const nested = tool.function && typeof tool.function === 'object' && !Array.isArray(tool.function)
    ? tool.function as JsonRecord
    : null
  const name = typeof tool.name === 'string'
    ? tool.name.trim()
    : typeof nested?.name === 'string' ? nested.name.trim() : ''
  if (!name) return null

  const description = typeof tool.description === 'string'
    ? tool.description
    : typeof nested?.description === 'string' ? nested.description : undefined
  const parameters = tool.parameters && typeof tool.parameters === 'object'
    ? tool.parameters
    : nested?.parameters && typeof nested.parameters === 'object'
      ? nested.parameters
      : { type: 'object', properties: {} }

  return {
    type: 'function',
    name: name.slice(0, 128),
    ...(description && { description }),
    parameters,
  }
}

function normalizeToolChoice(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const choice = value as JsonRecord
  if (choice.type !== 'function') return value
  if (typeof choice.name === 'string' && choice.name.trim()) {
    return { type: 'function', name: choice.name.trim().slice(0, 128) }
  }
  const nested = choice.function && typeof choice.function === 'object'
    ? choice.function as JsonRecord
    : null
  return typeof nested?.name === 'string' && nested.name.trim()
    ? { type: 'function', name: nested.name.trim().slice(0, 128) }
    : 'auto'
}

export function prepareCodexResponsesRequest(
  request: OpenAIResponsesRequest,
): JsonRecord {
  const prepared = structuredClone(request) as JsonRecord
  prepared.stream = true
  prepared.store = false

  if (typeof prepared.instructions !== 'string' || !prepared.instructions.trim()) {
    prepared.instructions = Array.isArray(prepared.tools) && prepared.tools.length > 0
      ? 'You are CyberCode, a coding agent. Use the available tools to complete the user request.'
      : 'You are CyberCode, a helpful AI assistant.'
  }

  if (Array.isArray(prepared.tools)) {
    prepared.tools = prepared.tools
      .map(flattenFunctionTool)
      .filter((tool): tool is JsonRecord => tool !== null)
  }
  if (prepared.tool_choice !== undefined) {
    prepared.tool_choice = normalizeToolChoice(prepared.tool_choice)
  }

  delete prepared.temperature
  delete prepared.top_p
  delete prepared.max_tokens
  delete prepared.max_output_tokens
  delete prepared.truncation
  delete prepared.background
  delete prepared.prompt_cache_retention
  delete prepared.safety_identifier
  delete prepared.user

  return prepared
}

export async function readCodexResponsesCompletion(
  response: Response,
): Promise<OpenAIResponsesResponse> {
  const text = await response.text()
  let currentEvent = ''
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('event:')) {
      currentEvent = trimmed.slice(6).trim()
      continue
    }
    if (!trimmed.startsWith('data:')) {
      if (!trimmed) currentEvent = ''
      continue
    }

    const raw = trimmed.slice(5).trim()
    if (!raw || raw === '[DONE]') continue
    let data: JsonRecord
    try {
      data = JSON.parse(raw) as JsonRecord
    } catch {
      continue
    }
    const eventType = currentEvent || (typeof data.type === 'string' ? data.type : '')
    if (eventType === 'response.completed' && data.response) {
      return data.response as OpenAIResponsesResponse
    }
    if (eventType === 'response.failed') {
      const failed = data.response && typeof data.response === 'object'
        ? data.response as JsonRecord
        : data
      const detail = failed.error && typeof failed.error === 'object'
        ? failed.error as JsonRecord
        : undefined
      throw new Error(
        typeof detail?.message === 'string'
          ? detail.message
          : 'OpenAI Codex returned a failed response',
      )
    }
  }
  throw new Error('OpenAI Codex stream ended without a completed response')
}
