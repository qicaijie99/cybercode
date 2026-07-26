/**
 * AWS EventStream framing adapted from OmniRoute's Kiro executor (MIT).
 * See LICENSE-OmniRoute.md in this directory.
 */

type JsonRecord = Record<string, unknown>

export type AwsEventFrame = {
  headers: Record<string, string>
  payload: JsonRecord | null
}

export class ByteQueue {
  private chunks: Uint8Array[] = []
  private headOffset = 0
  length = 0

  push(chunk: Uint8Array): void {
    if (chunk.length === 0) return
    this.chunks.push(chunk)
    this.length += chunk.length
  }

  peekUint32BE(offset = 0): number | null {
    if (this.length < offset + 4) return null
    let value = 0
    for (let index = 0; index < 4; index += 1) {
      value = (value << 8) | this.byteAt(offset + index)
    }
    return value >>> 0
  }

  read(length: number): Uint8Array | null {
    if (length < 0 || this.length < length) return null
    const output = new Uint8Array(length)
    let written = 0
    while (written < length) {
      const head = this.chunks[0]!
      const available = head.length - this.headOffset
      const take = Math.min(available, length - written)
      output.set(head.subarray(this.headOffset, this.headOffset + take), written)
      written += take
      this.headOffset += take
      this.length -= take
      if (this.headOffset >= head.length) {
        this.chunks.shift()
        this.headOffset = 0
      }
    }
    return output
  }

  private byteAt(offset: number): number {
    let remaining = offset
    for (let index = 0; index < this.chunks.length; index += 1) {
      const chunk = this.chunks[index]!
      const start = index === 0 ? this.headOffset : 0
      const available = chunk.length - start
      if (remaining < available) return chunk[start + remaining]!
      remaining -= available
    }
    return 0
  }
}

const CRC32_TABLE = new Uint32Array(256)
for (let index = 0; index < 256; index += 1) {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  CRC32_TABLE[index] = value >>> 0
}

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

export function parseEventFrame(data: Uint8Array): AwsEventFrame | null {
  if (data.length < 16) return null
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const totalLength = view.getUint32(0, false)
  const headersLength = view.getUint32(4, false)
  if (totalLength !== data.length || headersLength > totalLength - 16) return null
  if (view.getUint32(8, false) !== crc32(data.subarray(0, 8))) return null

  const decoder = new TextDecoder()
  const headers: Record<string, string> = {}
  let offset = 12
  const headerEnd = 12 + headersLength
  while (offset < headerEnd) {
    const nameLength = data[offset++]!
    if (offset + nameLength + 3 > headerEnd) return null
    const name = decoder.decode(data.subarray(offset, offset + nameLength))
    offset += nameLength
    const type = data[offset++]!
    if (type !== 7) return null
    const valueLength = (data[offset]! << 8) | data[offset + 1]!
    offset += 2
    if (offset + valueLength > headerEnd) return null
    headers[name] = decoder.decode(data.subarray(offset, offset + valueLength))
    offset += valueLength
  }

  const payloadBytes = data.subarray(headerEnd, totalLength - 4)
  if (payloadBytes.length === 0) return { headers, payload: null }
  try {
    return {
      headers,
      payload: JSON.parse(decoder.decode(payloadBytes)) as JsonRecord,
    }
  } catch {
    return { headers, payload: null }
  }
}
