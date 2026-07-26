/**
 * Minimal Cursor AgentService protobuf codec adapted from OmniRoute (MIT).
 * See LICENSE-OmniRoute.md in this directory.
 */

import { randomUUID } from 'node:crypto'

type Field =
  | { field: number; wire: 0; value: bigint }
  | { field: number; wire: 2; bytes: Buffer }

function varint(value: number | bigint): Buffer {
  let remaining = typeof value === 'bigint' ? value : BigInt(value)
  const bytes: number[] = []
  while (remaining > 0x7fn) {
    bytes.push(Number(remaining & 0x7fn) | 0x80)
    remaining >>= 7n
  }
  bytes.push(Number(remaining))
  return Buffer.from(bytes)
}

function tag(field: number, wire: number): Buffer {
  return varint((field << 3) | wire)
}

function bytesField(field: number, value: Buffer): Buffer {
  return Buffer.concat([tag(field, 2), varint(value.length), value])
}

function stringField(field: number, value: string): Buffer {
  return bytesField(field, Buffer.from(value, 'utf8'))
}

function messageField(field: number, parts: Buffer[]): Buffer {
  return bytesField(field, Buffer.concat(parts))
}

function numberField(field: number, value: number): Buffer {
  return Buffer.concat([tag(field, 0), varint(value)])
}

function readVarint(bytes: Buffer, start: number): [bigint, number] {
  let result = 0n
  let shift = 0n
  let offset = start
  while (offset < bytes.length) {
    const byte = bytes[offset++]!
    result |= BigInt(byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return [result, offset]
    shift += 7n
  }
  throw new Error('Cursor protobuf varint is truncated')
}

function fields(bytes: Buffer): Field[] {
  const output: Field[] = []
  let offset = 0
  while (offset < bytes.length) {
    let rawTag: bigint
    ;[rawTag, offset] = readVarint(bytes, offset)
    const field = Number(rawTag >> 3n)
    const wire = Number(rawTag & 7n)
    if (wire === 0) {
      let value: bigint
      ;[value, offset] = readVarint(bytes, offset)
      output.push({ field, wire: 0, value })
      continue
    }
    if (wire === 2) {
      let rawLength: bigint
      ;[rawLength, offset] = readVarint(bytes, offset)
      const length = Number(rawLength)
      if (!Number.isSafeInteger(length) || length < 0 || offset + length > bytes.length) {
        throw new Error('Cursor protobuf field is truncated')
      }
      output.push({ field, wire: 2, bytes: bytes.subarray(offset, offset + length) })
      offset += length
      continue
    }
    if (wire === 1) {
      offset += 8
      continue
    }
    if (wire === 5) {
      offset += 4
      continue
    }
    throw new Error(`Cursor protobuf wire type ${wire} is unsupported`)
  }
  return output
}

function readString(bytes: Buffer, target: number): string {
  const field = fields(bytes).find((item) => item.field === target && item.wire === 2)
  return field?.wire === 2 ? field.bytes.toString('utf8') : ''
}

function frame(payload: Buffer): Buffer {
  const header = Buffer.alloc(5)
  header.writeUInt32BE(payload.length, 1)
  return Buffer.concat([header, payload])
}

function requestedModel(model: string): {
  id: string
  parameters: Array<{ id: string; value: string }>
} {
  const normalized = model.trim() || 'composer-2.5'
  if (normalized === 'auto') return { id: 'default', parameters: [] }
  if (normalized.startsWith('composer-') && normalized.endsWith('-fast')) {
    return {
      id: normalized.slice(0, -5),
      parameters: [{ id: 'fast', value: 'true' }],
    }
  }
  for (const [prefix, parameter] of [
    ['claude-', 'effort'],
    ['gpt-', 'reasoning'],
  ] as const) {
    if (!normalized.startsWith(prefix)) continue
    for (const value of ['low', 'medium', 'high', 'xhigh', 'max']) {
      if (normalized.endsWith(`-${value}`)) {
        return {
          id: normalized.slice(0, -(value.length + 1)),
          parameters: [{ id: parameter, value }],
        }
      }
    }
  }
  return { id: normalized, parameters: [] }
}

export function buildCursorAgentRequest(model: string, userText: string): Buffer {
  const conversationId = randomUUID()
  const messageId = randomUUID()
  const resolved = requestedModel(model)
  const selectedContext = messageField(3, [])
  const userMessage = messageField(1, [
    stringField(1, userText),
    stringField(2, messageId),
    selectedContext,
    numberField(4, 1),
  ])
  const action = messageField(2, [
    messageField(1, [userMessage]),
  ])
  const modelDetails = messageField(3, [
    stringField(1, resolved.id),
    stringField(3, resolved.id),
    stringField(4, resolved.id),
  ])
  const mcpTools = messageField(4, [])
  const requested = messageField(9, [
    stringField(1, resolved.id),
    ...resolved.parameters.map((parameter) => (
      messageField(3, [
        stringField(1, parameter.id),
        stringField(2, parameter.value),
      ])
    )),
  ])
  const runRequest = messageField(1, [
    messageField(1, []),
    action,
    modelDetails,
    mcpTools,
    stringField(5, conversationId),
    requested,
    numberField(12, 0),
    stringField(16, conversationId),
  ])
  return frame(runRequest)
}

export type CursorServerEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tokens'; tokens: number }
  | { type: 'turn-ended' }
  | { type: 'kv' }
  | {
      type: 'exec'
      id: number
      execId: string
      variant: number
      payload: Buffer
    }

export function decodeCursorServerEvents(payload: Buffer): CursorServerEvent[] {
  const output: CursorServerEvent[] = []
  for (const top of fields(payload)) {
    if (top.wire !== 2) continue
    if (top.field === 4) {
      output.push({ type: 'kv' })
      continue
    }
    if (top.field === 2) {
      const nested = fields(top.bytes)
      const idField = nested.find((item) => item.field === 1 && item.wire === 0)
      const execIdField = nested.find((item) => item.field === 15 && item.wire === 2)
      const variant = nested.find((item) => (
        item.wire === 2 && item.field !== 15
      ))
      if (variant?.wire === 2) {
        output.push({
          type: 'exec',
          id: idField?.wire === 0 ? Number(idField.value) : 0,
          execId: execIdField?.wire === 2 ? execIdField.bytes.toString('utf8') : '',
          variant: variant.field,
          payload: variant.bytes,
        })
      }
      continue
    }
    if (top.field !== 1) continue
    for (const update of fields(top.bytes)) {
      if (update.field === 1 && update.wire === 2) {
        output.push({ type: 'text', text: readString(update.bytes, 1) })
      } else if (update.field === 4 && update.wire === 2) {
        output.push({ type: 'thinking', text: readString(update.bytes, 1) })
      } else if (update.field === 8 && update.wire === 2) {
        const token = fields(update.bytes).find((item) => item.field === 1 && item.wire === 0)
        output.push({
          type: 'tokens',
          tokens: token?.wire === 0 ? Number(token.value) : 0,
        })
      } else if (update.field === 14) {
        output.push({ type: 'turn-ended' })
      }
    }
  }
  return output
}

function wrapExecResult(
  id: number,
  execId: string,
  resultField: number,
  result: Buffer,
): Buffer {
  return frame(messageField(2, [
    numberField(1, id),
    stringField(15, execId),
    messageField(resultField, [result]),
  ]))
}

export function cursorExecResponse(
  event: Extract<CursorServerEvent, { type: 'exec' }>,
): Buffer | null {
  if (event.variant === 10) {
    const requestContext = messageField(1, [])
    const success = messageField(1, [requestContext])
    return wrapExecResult(event.id, event.execId, 10, success)
  }

  const reason = 'Tool unavailable here. Use the tools declared in the user prompt.'
  const path = readString(event.payload, 1)
  const workingDirectory = readString(event.payload, 2)
  if ([3, 4, 7, 8].includes(event.variant)) {
    return wrapExecResult(
      event.id,
      event.execId,
      event.variant,
      messageField(2, [stringField(1, path), stringField(2, reason)]),
    )
  }
  if (event.variant === 2 || event.variant === 14 || event.variant === 16) {
    return wrapExecResult(
      event.id,
      event.execId,
      event.variant === 14 ? 2 : event.variant,
      messageField(2, [
        stringField(1, path),
        stringField(2, workingDirectory),
        stringField(3, reason),
      ]),
    )
  }
  if (event.variant === 5 || event.variant === 23) {
    return wrapExecResult(
      event.id,
      event.execId,
      event.variant,
      messageField(2, [stringField(1, reason)]),
    )
  }
  if (event.variant === 9) {
    return wrapExecResult(event.id, event.execId, 9, Buffer.alloc(0))
  }
  if (event.variant === 20) {
    return wrapExecResult(
      event.id,
      event.execId,
      20,
      messageField(2, [stringField(1, path), stringField(2, reason)]),
    )
  }
  return null
}
