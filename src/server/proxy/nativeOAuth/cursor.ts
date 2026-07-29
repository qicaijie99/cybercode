/**
 * Adapted from OmniRoute's Cursor AgentService executor (MIT).
 * See LICENSE-OmniRoute.md in this directory.
 */

import * as http2 from 'node:http2'
import { randomBytes, randomUUID } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import {
  flattenMessages,
  parseTextToolCalls,
  prepareTextToolRequest,
  resolvedCompletionResponse,
  upstreamError,
} from './completion.js'
import {
  buildCursorAgentRequest,
  cursorExecResponse,
  decodeCursorServerEvents,
} from './cursorWire.js'
import type {
  NativeCompletion,
  NativeOAuthChatInput,
  NativeOAuthChatResult,
} from './types.js'

const CURSOR_HOST = 'agentn.global.api5.cursor.sh'
const CURSOR_PATH = '/agent.v1.AgentService/Run'
const MAX_FRAME_BYTES = 16 * 1024 * 1024
const CLIENT_VERSION = 'cli-2026.07.08-0c04a8a'

function cursorHeaders(token: string): Record<string, string> {
  const cleanToken = token.includes('::') ? token.split('::').at(-1)! : token
  const requestId = randomUUID()
  const traceParent =
    `00-${randomBytes(16).toString('hex')}-${randomBytes(8).toString('hex')}-01`
  return {
    authorization: `Bearer ${cleanToken}`,
    'backend-traceparent': traceParent,
    'connect-accept-encoding': 'gzip',
    'connect-protocol-version': '1',
    'content-type': 'application/connect+proto',
    traceparent: traceParent,
    'user-agent': 'connect-es/1.6.1',
    'x-cursor-client-type': 'cli',
    'x-cursor-client-version': CLIENT_VERSION,
    'x-ghost-mode': 'true',
    'x-original-request-id': requestId,
    'x-request-id': requestId,
  }
}

function visibleComposerText(thinking: string): string {
  const end = thinking.lastIndexOf('</think>')
  if (end < 0) return ''
  return thinking
    .slice(end + '</think>'.length)
    .replace(/^\s*<[｜|]\s*final\s*[｜|]>\s*/i, '')
    .replace(/\s*<[｜|]\s*\/\s*final\s*[｜|]>\s*$/i, '')
    .trim()
}

async function runCursor(input: NativeOAuthChatInput): Promise<NativeCompletion> {
  const prepared = prepareTextToolRequest(input.request)
  const body = buildCursorAgentRequest(
    input.request.model,
    flattenMessages(prepared.messages),
  )
  const headers = cursorHeaders(input.auth.token)
  const client = http2.connect(`https://${CURSOR_HOST}`)

  return new Promise<NativeCompletion>((resolve, reject) => {
    const request = client.request({
      ':method': 'POST',
      ':path': CURSOR_PATH,
      ':authority': CURSOR_HOST,
      ':scheme': 'https',
      ...headers,
    })
    let buffer = Buffer.alloc(0)
    let content = ''
    let thinking = ''
    let tokenDelta = 0
    let responseStatus = 0
    let settled = false
    const timeout = setTimeout(() => {
      finish(new Error('Cursor AgentService timed out'))
    }, 300_000)
    timeout.unref?.()

    const cleanup = () => {
      clearTimeout(timeout)
      input.signal?.removeEventListener('abort', onAbort)
      try {
        request.close()
        client.close()
      } catch {
        // The stream may already be closed.
      }
    }
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) {
        reject(error)
        return
      }
      const visible = content || visibleComposerText(thinking)
      const parsed = parseTextToolCalls(visible, input.request)
      resolve({
        ...parsed,
        ...(tokenDelta > 0 && {
          usage: {
            prompt_tokens: Math.max(
              1,
              Math.ceil(flattenMessages(input.request.messages).length / 4),
            ),
            completion_tokens: tokenDelta,
            total_tokens: Math.max(
              1,
              Math.ceil(flattenMessages(input.request.messages).length / 4),
            ) + tokenDelta,
          },
        }),
      })
    }
    const onAbort = () => finish(new Error('Cursor request was cancelled'))
    if (input.signal) {
      if (input.signal.aborted) {
        onAbort()
        return
      }
      input.signal.addEventListener('abort', onAbort, { once: true })
    }

    request.on('response', (responseHeaders) => {
      responseStatus = Number(responseHeaders[':status'] ?? 500)
    })
    request.on('data', (chunk: Buffer) => {
      if (settled) return
      buffer = buffer.length === 0
        ? Buffer.from(chunk)
        : Buffer.concat([buffer, chunk])
      try {
        let offset = 0
        while (offset + 5 <= buffer.length) {
          const flags = buffer[offset]!
          const length = buffer.readUInt32BE(offset + 1)
          if (length > MAX_FRAME_BYTES) {
            throw new Error(`Cursor frame is too large (${length} bytes)`)
          }
          if (offset + 5 + length > buffer.length) break
          const raw = buffer.subarray(offset + 5, offset + 5 + length)
          offset += 5 + length
          const payload = flags & 1 ? gunzipSync(raw) : raw
          for (const event of decodeCursorServerEvents(payload)) {
            if (event.type === 'text') content += event.text
            else if (event.type === 'thinking') thinking += event.text
            else if (event.type === 'tokens') tokenDelta += event.tokens
            else if (event.type === 'exec') {
              const response = cursorExecResponse(event)
              if (response) request.write(response)
            } else if (event.type === 'turn-ended') {
              finish()
              return
            } else if (event.type === 'kv' && (content || thinking)) {
              finish()
              return
            }
          }
        }
        if (offset > 0) buffer = buffer.subarray(offset)
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    })
    request.on('end', () => {
      if (responseStatus && responseStatus !== 200) {
        finish(new Error(`Cursor returned HTTP ${responseStatus}`))
      } else {
        finish()
      }
    })
    request.on('error', (error) => finish(error))
    client.on('error', (error) => finish(error))
    request.write(body)
  })
}

export async function executeCursor(
  input: NativeOAuthChatInput,
): Promise<NativeOAuthChatResult> {
  if (!input.auth.token) return upstreamError('Cursor', 401, 'access token is missing')
  return resolvedCompletionResponse(
    input.request,
    input.stream,
    () => runCursor(input),
  )
}
