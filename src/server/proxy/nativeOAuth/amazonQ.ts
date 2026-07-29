/**
 * Adapted from OmniRoute's Kiro/Amazon Q executor (MIT).
 * See LICENSE-OmniRoute.md in this directory.
 */

import { randomUUID } from 'node:crypto'
import {
  flattenMessages,
  parseTextToolCalls,
  prepareTextToolRequest,
  resolvedCompletionResponse,
  upstreamError,
} from './completion.js'
import { ByteQueue, parseEventFrame } from './awsEventStream.js'
import type {
  NativeCompletion,
  NativeOAuthChatInput,
  NativeOAuthChatResult,
} from './types.js'

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function runtimeRegion(data: JsonRecord): string {
  const profileArn = typeof data.profileArn === 'string' ? data.profileArn : ''
  const profileRegion = /^arn:aws:codewhisperer:([a-z0-9-]+):/.exec(profileArn)?.[1]
  if (profileRegion === 'us-east-1' || profileRegion === 'eu-central-1') {
    return profileRegion
  }
  const stored = typeof data.region === 'string' ? data.region : ''
  return stored === 'eu-central-1' ? stored : 'us-east-1'
}

function runtimeHost(data: JsonRecord): string {
  const region = runtimeRegion(data)
  return region === 'us-east-1'
    ? 'https://codewhisperer.us-east-1.amazonaws.com'
    : `https://q.${region}.amazonaws.com`
}

function buildPayload(input: NativeOAuthChatInput): JsonRecord {
  const prepared = prepareTextToolRequest(input.request)
  const content = flattenMessages(prepared.messages)
  const payload: JsonRecord = {
    conversationState: {
      chatTriggerType: 'MANUAL',
      conversationId: randomUUID(),
      currentMessage: {
        userInputMessage: {
          content: `[Context: Current time is ${new Date().toISOString()}]\n\n${content}`,
          modelId: input.request.model,
          origin: 'AI_EDITOR',
        },
      },
      history: [],
    },
  }
  const profileArn = input.auth.providerSpecificData.profileArn
  if (typeof profileArn === 'string' && profileArn) payload.profileArn = profileArn
  const maxTokens = input.request.max_completion_tokens ?? input.request.max_tokens
  if (
    typeof maxTokens === 'number' ||
    typeof input.request.temperature === 'number' ||
    typeof input.request.top_p === 'number'
  ) {
    payload.inferenceConfig = {
      ...(typeof maxTokens === 'number' && maxTokens > 0 && {
        maxTokens: Math.floor(maxTokens),
      }),
      ...(typeof input.request.temperature === 'number' && {
        temperature: input.request.temperature,
      }),
      ...(typeof input.request.top_p === 'number' && { topP: input.request.top_p }),
    }
  }
  return payload
}

function eventContent(payload: JsonRecord): string {
  if (typeof payload.content === 'string') return payload.content
  const response = record(payload.assistantResponseEvent)
  return typeof response.content === 'string' ? response.content : ''
}

async function collectAmazonQ(
  input: NativeOAuthChatInput,
  response: Response,
): Promise<NativeCompletion> {
  if (!response.body) throw new Error('Amazon Q returned no event stream')
  const queue = new ByteQueue()
  const reader = response.body.getReader()
  let content = ''
  let usage: NativeCompletion['usage']
  while (true) {
    const { done, value } = await reader.read()
    if (value) queue.push(value)
    while (queue.length >= 16) {
      const totalLength = queue.peekUint32BE()
      if (!totalLength || totalLength < 16 || totalLength > queue.length) break
      const bytes = queue.read(totalLength)
      if (!bytes) break
      const event = parseEventFrame(bytes)
      if (!event) continue
      const eventType = event.headers[':event-type'] ?? ''
      const payload = event.payload ?? {}
      if (eventType === 'assistantResponseEvent' || eventType === 'codeEvent') {
        content += eventContent(payload)
      }
      if (eventType === 'reasoningContentEvent') continue
      if (eventType === 'metricsEvent') {
        const metrics = record(payload.metricsEvent ?? payload)
        const prompt = typeof metrics.inputTokens === 'number' ? metrics.inputTokens : 0
        const completion = typeof metrics.outputTokens === 'number'
          ? metrics.outputTokens
          : 0
        if (prompt > 0 || completion > 0) {
          usage = {
            prompt_tokens: prompt,
            completion_tokens: completion,
            total_tokens: prompt + completion,
            ...(typeof metrics.cacheReadTokens === 'number' && {
              prompt_tokens_details: { cached_tokens: metrics.cacheReadTokens },
            }),
          }
        }
      }
      if (event.headers[':message-type'] === 'exception') {
        throw new Error(
          typeof payload.message === 'string'
            ? payload.message
            : `Amazon Q ${eventType || 'stream exception'}`,
        )
      }
    }
    if (done) break
  }
  return {
    ...parseTextToolCalls(content, input.request),
    ...(usage && { usage }),
  }
}

export async function executeAmazonQ(
  input: NativeOAuthChatInput,
): Promise<NativeOAuthChatResult> {
  if (!input.auth.token) return upstreamError('Amazon Q', 401, 'access token is missing')
  const url = `${runtimeHost(input.auth.providerSpecificData)}/generateAssistantResponse`
  const response = await (input.fetchFn ?? fetch)(url, {
    method: 'POST',
    headers: {
      ...input.auth.headers,
      'Content-Type': 'application/x-amz-json-1.0',
      Accept: 'application/vnd.amazon.eventstream',
      'X-Amz-Target': 'AmazonCodeWhispererStreamingService.GenerateAssistantResponse',
    },
    body: JSON.stringify(buildPayload(input)),
    signal: input.signal,
  })
  if (!response.ok) {
    return upstreamError('Amazon Q', response.status, await response.text())
  }
  return resolvedCompletionResponse(
    input.request,
    input.stream,
    () => collectAmazonQ(input, response),
  )
}
