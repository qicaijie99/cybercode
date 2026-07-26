/**
 * Adapted from OmniRoute's Windsurf executor (MIT).
 * See LICENSE-OmniRoute.md in this directory.
 */

import { randomUUID } from 'node:crypto'
import {
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
import type { OpenAIChatMessage } from '../transform/types.js'

const WINDSURF_CHAT_URL =
  'https://server.self-serve.windsurf.com/' +
  'exa.language_server_pb.LanguageServerService/GetChatMessage'

const MODEL_ALIASES: Record<string, string> = {
  'swe-1.6-fast': 'swe-1-6-fast',
  'swe-1.6': 'swe-1-6',
  'swe-1.5-fast': 'swe-1p5',
  'swe-1.5': 'swe-1p5',
  'claude-sonnet-4.6-thinking-1m': 'claude-sonnet-4-6-thinking-1m',
  'claude-sonnet-4.6-1m': 'claude-sonnet-4-6-1m',
  'claude-sonnet-4.6-thinking': 'claude-sonnet-4-6-thinking',
  'claude-sonnet-4.6': 'claude-sonnet-4-6',
  'claude-opus-4.7-high': 'claude-opus-4-7-high',
  'claude-opus-4.7': 'claude-opus-4-7-high',
  'gpt-5.5': 'gpt-5-5-medium',
  'gpt-5.4': 'gpt-5-4-medium',
  'gemini-3.1-pro': 'gemini-3-1-pro-high',
  'gemini-3.1-pro-high': 'gemini-3-1-pro-high',
}

function encodeVarint(value: number): Uint8Array<ArrayBuffer> {
  const bytes: number[] = []
  let remaining = value >>> 0
  while (remaining > 0x7f) {
    bytes.push((remaining & 0x7f) | 0x80)
    remaining >>>= 7
  }
  bytes.push(remaining)
  return new Uint8Array(bytes)
}

function concatBytes(
  arrays: Uint8Array[],
): Uint8Array<ArrayBuffer> {
  const total = arrays.reduce((sum, item) => sum + item.length, 0)
  const output = new Uint8Array(total)
  let offset = 0
  arrays.forEach((item) => {
    output.set(item, offset)
    offset += item.length
  })
  return output
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function encodeField(
  fieldNumber: number,
  value: Uint8Array,
): Uint8Array<ArrayBuffer> {
  return concatBytes([
    encodeVarint((fieldNumber << 3) | 2),
    encodeVarint(value.length),
    value,
  ])
}

function encodeString(fieldNumber: number, value: string): Uint8Array<ArrayBuffer> {
  return encodeField(fieldNumber, encoder.encode(value))
}

function encodeMessage(fieldNumber: number, value: Uint8Array): Uint8Array<ArrayBuffer> {
  return encodeField(fieldNumber, value)
}

function messageText(message: OpenAIChatMessage): string {
  if (typeof message.content === 'string') return message.content
  if (!Array.isArray(message.content)) return ''
  return message.content
    .map((part) => part.type === 'text' ? part.text : '[image]')
    .join('')
}

function buildMetadata(apiKey: string, sessionId: string): Uint8Array<ArrayBuffer> {
  return concatBytes([
    encodeString(1, apiKey),
    encodeString(2, 'windsurf'),
    encodeString(3, '3.14.0'),
    encodeString(4, '3.14.0'),
    encodeString(5, sessionId),
    encodeString(6, 'en-US'),
  ])
}

function buildChatMessage(message: OpenAIChatMessage): Uint8Array<ArrayBuffer> {
  return concatBytes([
    encodeString(1, message.role),
    encodeString(2, messageText(message)),
    ...(message.tool_call_id ? [encodeString(3, message.tool_call_id)] : []),
  ])
}

function requestPayload(
  apiKey: string,
  model: string,
  messages: OpenAIChatMessage[],
): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [
    encodeMessage(1, buildMetadata(apiKey, randomUUID())),
    encodeString(2, randomUUID()),
    encodeMessage(3, encodeString(1, MODEL_ALIASES[model] ?? model)),
  ]
  messages.forEach((message) => {
    parts.push(encodeMessage(4, buildChatMessage(message)))
  })
  return concatBytes(parts)
}

function grpcFrame(payload: Uint8Array): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(5 + payload.length)
  output[0] = 0
  new DataView(output.buffer).setUint32(1, payload.length, false)
  output.set(payload, 5)
  return output
}

function readVarint(value: Uint8Array, start: number): [number, number] {
  let result = 0
  let shift = 0
  let offset = start
  while (offset < value.length) {
    const byte = value[offset++]!
    result |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) break
    shift += 7
  }
  return [result >>> 0, offset]
}

function stringField(value: Uint8Array, target: number): string | null {
  let offset = 0
  while (offset < value.length) {
    let tag: number
    ;[tag, offset] = readVarint(value, offset)
    const field = tag >>> 3
    const wire = tag & 7
    if (wire === 2) {
      let length: number
      ;[length, offset] = readVarint(value, offset)
      const payload = value.slice(offset, offset + length)
      offset += length
      if (field === target) return decoder.decode(payload)
    } else if (wire === 0) {
      ;[, offset] = readVarint(value, offset)
    } else if (wire === 1) {
      offset += 8
    } else if (wire === 5) {
      offset += 4
    } else {
      return null
    }
  }
  return null
}

function usageFromDone(value: Uint8Array): {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
} | null {
  let offset = 0
  let usage: Uint8Array | null = null
  while (offset < value.length) {
    let tag: number
    ;[tag, offset] = readVarint(value, offset)
    const field = tag >>> 3
    const wire = tag & 7
    if (wire === 2) {
      let length: number
      ;[length, offset] = readVarint(value, offset)
      if (field === 1) usage = value.slice(offset, offset + length)
      offset += length
    } else if (wire === 0) {
      ;[, offset] = readVarint(value, offset)
    } else {
      break
    }
  }
  if (!usage) return null
  offset = 0
  let prompt = 0
  let completion = 0
  while (offset < usage.length) {
    let tag: number
    ;[tag, offset] = readVarint(usage, offset)
    const field = tag >>> 3
    const wire = tag & 7
    if (wire === 0) {
      let number: number
      ;[number, offset] = readVarint(usage, offset)
      if (field === 1) prompt = number
      if (field === 2) completion = number
    } else if (wire === 2) {
      let length: number
      ;[length, offset] = readVarint(usage, offset)
      offset += length
    } else {
      break
    }
  }
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
  }
}

function decodeChunk(value: Uint8Array):
  | { type: 'content'; text: string }
  | { type: 'done'; usage: NativeCompletion['usage'] }
  | { type: 'error'; message: string }
  | null {
  let offset = 0
  while (offset < value.length) {
    let tag: number
    ;[tag, offset] = readVarint(value, offset)
    const field = tag >>> 3
    const wire = tag & 7
    if (wire !== 2) {
      if (wire === 0) {
        ;[, offset] = readVarint(value, offset)
      } else if (wire === 1) {
        offset += 8
      } else if (wire === 5) {
        offset += 4
      } else {
        return null
      }
      continue
    }
    let length: number
    ;[length, offset] = readVarint(value, offset)
    const payload = value.slice(offset, offset + length)
    offset += length
    if (field === 1) {
      const text = stringField(payload, 1)
      if (text !== null) return { type: 'content', text }
    }
    if (field === 3) return { type: 'done', usage: usageFromDone(payload) ?? undefined }
    if (field === 4) {
      return {
        type: 'error',
        message: stringField(payload, 1) ?? 'unknown Windsurf error',
      }
    }
  }
  return null
}

async function runWindsurf(input: NativeOAuthChatInput): Promise<NativeCompletion> {
  const fetchFn = input.fetchFn ?? fetch
  const prepared = prepareTextToolRequest(input.request)
  const payload = grpcFrame(requestPayload(
    input.auth.token,
    input.request.model,
    prepared.messages,
  ))
  const response = await fetchFn(WINDSURF_CHAT_URL, {
    method: 'POST',
    headers: {
      ...input.auth.headers,
      'Content-Type': 'application/grpc-web+proto',
      Accept: 'application/grpc-web+proto',
      'X-Grpc-Web': '1',
    },
    body: payload,
    signal: input.signal,
  })
  if (!response.ok) {
    throw new Error(`Windsurf returned HTTP ${response.status}: ${await response.text()}`)
  }

  const bytes = new Uint8Array(await response.arrayBuffer())
  let offset = 0
  let content = ''
  let usage: NativeCompletion['usage']
  while (offset + 5 <= bytes.length) {
    const flag = bytes[offset]!
    const length = new DataView(
      bytes.buffer,
      bytes.byteOffset + offset + 1,
      4,
    ).getUint32(0, false)
    if (offset + 5 + length > bytes.length) {
      throw new Error('Windsurf returned a truncated gRPC-web frame')
    }
    const frame = bytes.slice(offset + 5, offset + 5 + length)
    offset += 5 + length
    if (flag === 0x80) {
      const trailer = decoder.decode(frame)
      const status = /grpc-status:\s*(\d+)/i.exec(trailer)?.[1]
      if (status && status !== '0') {
        const encodedMessage = /grpc-message:\s*(.+)/i.exec(trailer)?.[1]
        throw new Error(encodedMessage
          ? decodeURIComponent(encodedMessage.trim())
          : `Windsurf gRPC status ${status}`)
      }
      continue
    }
    if (flag !== 0) continue
    const chunk = decodeChunk(frame)
    if (chunk?.type === 'content') content += chunk.text
    if (chunk?.type === 'done') usage = chunk.usage
    if (chunk?.type === 'error') throw new Error(chunk.message)
  }
  return {
    ...parseTextToolCalls(content, input.request),
    ...(usage && { usage }),
  }
}

export async function executeWindsurf(
  input: NativeOAuthChatInput,
): Promise<NativeOAuthChatResult> {
  if (!input.auth.token) return upstreamError('Windsurf', 401, 'access token is missing')
  return resolvedCompletionResponse(
    input.request,
    input.stream,
    () => runWindsurf(input),
  )
}
