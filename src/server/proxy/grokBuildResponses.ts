import type { OpenAIResponsesRequest } from './transform/types.js'

// Protocol compatibility follows OmniRoute's MIT-licensed Grok Build executor.
type JsonRecord = Record<string, unknown>

const UNSUPPORTED_PARAMS = [
  'presencePenalty',
  'frequencyPenalty',
  'logprobs',
  'topLogprobs',
  'presence_penalty',
  'frequency_penalty',
  'top_logprobs',
  'reasoning_effort',
] as const

function sanitizeToolOutput(output: unknown): string {
  if (output == null) return ''
  if (typeof output === 'string') {
    try {
      return JSON.stringify(JSON.parse(output))
    } catch {
      const repaired = output.replace(/\\u([0-9A-Fa-f]{0,3})(?![0-9A-Fa-f])/g, '')
      try {
        return JSON.stringify(JSON.parse(repaired))
      } catch {
        return repaired.replace(/[\uD800-\uDFFF]/g, '\uFFFD')
      }
    }
  }
  if (Array.isArray(output)) {
    return sanitizeToolOutput(output.map((part) => {
      if (part && typeof part === 'object' && !Array.isArray(part)) {
        const record = part as JsonRecord
        if (typeof record.text === 'string') return record.text
      }
      return typeof part === 'string' ? part : JSON.stringify(part)
    }).join('\n'))
  }
  try {
    return JSON.stringify(output)
  } catch {
    return String(output)
  }
}

export function prepareGrokBuildResponsesRequest(
  request: OpenAIResponsesRequest,
): JsonRecord {
  const prepared = structuredClone(request) as JsonRecord
  if (prepared.store === undefined) prepared.store = false

  const include = Array.isArray(prepared.include) ? [...prepared.include] : []
  if (!include.includes('reasoning.encrypted_content')) {
    include.push('reasoning.encrypted_content')
  }
  prepared.include = include

  for (const key of UNSUPPORTED_PARAMS) delete prepared[key]

  const model = typeof prepared.model === 'string' ? prepared.model : ''
  const reasoning = prepared.reasoning &&
    typeof prepared.reasoning === 'object' &&
    !Array.isArray(prepared.reasoning)
    ? { ...prepared.reasoning as JsonRecord }
    : {}
  if (!['low', 'medium', 'high'].includes(String(reasoning.effort))) {
    delete reasoning.effort
  }
  if (model === 'grok-composer-2.5-fast') {
    delete reasoning.effort
  } else if (model === 'grok-4.5' && reasoning.effort === undefined) {
    reasoning.effort = 'high'
  }
  if (Object.keys(reasoning).length > 0) prepared.reasoning = reasoning
  else delete prepared.reasoning

  if (Array.isArray(prepared.tools) && prepared.tools.length > 200) {
    prepared.tools = prepared.tools.slice(0, 200)
  }
  if (Array.isArray(prepared.input)) {
    prepared.input = prepared.input.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return item
      const record = item as JsonRecord
      if (record.type !== 'function_call_output') return item
      return { ...record, output: sanitizeToolOutput(record.output) }
    })
  }

  return prepared
}
