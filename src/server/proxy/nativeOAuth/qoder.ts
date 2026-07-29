/**
 * Qoder PAT transport follows OmniRoute's qodercli adapter contract (MIT).
 * CyberCode additionally prepares Qoder's official standalone runtime so the
 * user does not need Node, npm, PATH changes, or a separate CLI installation.
 */

import { qoderRuntimeService } from '../../services/qoderRuntimeService.js'
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

const MODEL_LEVELS: Record<string, string> = {
  'qwen3.8-max-preview': 'qmodel_preview',
  'qwen3.7-max': 'qmodel_latest',
  'qwen3.7-plus': 'qmodel',
  'kimi-k3': 'kmodel_latest',
  'kimi-k2.7-code': 'kmodel',
  'glm-5.2': 'gm51model',
  'deepseek-v4-pro': 'dmodel',
  'deepseek-v4-flash': 'dfmodel',
  'minimax-m3': 'mmodel',
}

function modelLevel(model: string): string {
  const normalized = model.trim().toLowerCase()
  if (!normalized) return 'auto'
  if (Object.values(MODEL_LEVELS).includes(normalized) || normalized === 'auto') {
    return normalized
  }
  const id = normalized.includes('/')
    ? normalized.slice(normalized.lastIndexOf('/') + 1)
    : normalized
  if (MODEL_LEVELS[id]) return MODEL_LEVELS[id]!
  if (id.includes('deepseek-r1')) return 'dmodel'
  if (id.includes('glm')) return 'gm51model'
  if (id.includes('minimax')) return 'mmodel'
  if (id.includes('qwen3-max-preview')) return 'qmodel_preview'
  if (id.includes('qwen3-max')) return 'qmodel_latest'
  if (id.includes('kimi-k2')) return 'kmodel'
  if (id.includes('qwen3-coder') || id.includes('qoder-rome')) return 'qmodel'
  return 'auto'
}

function parseResult(stdout: string): {
  content: string
  isError: boolean
  error: string
  usage?: NativeCompletion['usage']
} {
  const trimmed = stdout.trim()
  let payload: JsonRecord | null = null
  try {
    payload = JSON.parse(trimmed) as JsonRecord
  } catch {
    for (const line of trimmed.split(/\r?\n/).reverse()) {
      if (!line.trim().startsWith('{')) continue
      try {
        payload = JSON.parse(line) as JsonRecord
        break
      } catch {}
    }
  }
  if (!payload) {
    return {
      content: '',
      isError: true,
      error: trimmed.slice(0, 500) || 'qodercli produced no output',
    }
  }

  const result = typeof payload.result === 'string' ? payload.result : ''
  const isError = payload.is_error === true ||
    String(payload.subtype ?? '').toLowerCase() === 'error'
  const rawUsage = payload.usage &&
    typeof payload.usage === 'object' &&
    !Array.isArray(payload.usage)
    ? payload.usage as JsonRecord
    : null
  const prompt = typeof rawUsage?.input_tokens === 'number'
    ? rawUsage.input_tokens
    : typeof rawUsage?.prompt_tokens === 'number' ? rawUsage.prompt_tokens : 0
  const completion = typeof rawUsage?.output_tokens === 'number'
    ? rawUsage.output_tokens
    : typeof rawUsage?.completion_tokens === 'number' ? rawUsage.completion_tokens : 0
  return {
    content: result,
    isError,
    error: isError ? result || 'qodercli returned an error' : '',
    ...(prompt > 0 || completion > 0
      ? {
          usage: {
            prompt_tokens: prompt,
            completion_tokens: completion,
            total_tokens: prompt + completion,
          },
        }
      : {}),
  }
}

function statusForFailure(detail: string): number {
  const normalized = detail.toLowerCase()
  if (
    normalized.includes('invalid token') ||
    normalized.includes('not logged in') ||
    normalized.includes('please run /login') ||
    normalized.includes('unauthorized') ||
    normalized.includes('personal access token')
  ) return 401
  if (normalized.includes('timed out') || normalized.includes('timeout')) return 504
  return 502
}

async function runQoder(input: NativeOAuthChatInput): Promise<NativeCompletion> {
  const prepared = prepareTextToolRequest(input.request)
  const prompt = [
    'You are answering a CyberCode model request through Qoder.',
    'Use only the conversation below. Your built-in local tools are disabled.',
    flattenMessages(prepared.messages),
  ].join('\n\n')
  const result = await qoderRuntimeService.run({
    token: input.auth.token,
    args: [
      '--print',
      '--output-format',
      'json',
      '--model',
      modelLevel(input.request.model),
      '--tools',
      '',
      '--config-dir',
      qoderRuntimeService.getConfigDir(),
    ],
    input: prompt,
    signal: input.signal,
    timeoutMs: 300_000,
  })
  const combined = `${result.stderr}\n${result.error ?? ''}`.trim()
  if (result.code !== 0) {
    throw new QoderRequestError(
      statusForFailure(combined),
      combined || `qodercli exited with code ${result.code}`,
    )
  }
  const parsed = parseResult(result.stdout)
  if (parsed.isError) {
    throw new QoderRequestError(statusForFailure(parsed.error), parsed.error)
  }
  return {
    ...parseTextToolCalls(parsed.content, input.request),
    ...(parsed.usage && { usage: parsed.usage }),
    model: input.request.model,
  }
}

class QoderRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'QoderRequestError'
  }
}

export async function executeQoder(
  input: NativeOAuthChatInput,
): Promise<NativeOAuthChatResult> {
  if (!input.auth.token.startsWith('pt-')) {
    return upstreamError('Qoder', 400, 'native Qoder transport requires a pt- Personal Access Token')
  }
  try {
    // qodercli returns one complete JSON result rather than incremental deltas.
    // Resolve it first so authentication/runtime failures retain their HTTP
    // status instead of surfacing later as a broken HTTP 200 stream.
    const completion = await runQoder(input)
    return await resolvedCompletionResponse(
      input.request,
      input.stream,
      async () => completion,
    )
  } catch (error) {
    if (error instanceof QoderRequestError) {
      return upstreamError('Qoder', error.status, error.message)
    }
    throw error
  }
}

export const qoderAdapterTestUtils = {
  modelLevel,
  parseResult,
  statusForFailure,
}
