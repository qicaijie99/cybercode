import { createDecipheriv } from 'node:crypto'
import * as path from 'node:path'
import {
  checkAttachmentLimit,
  FILE_MAX_BYTES,
  IMAGE_MAX_BYTES,
} from '../common/attachment/attachment-limits.js'
import { AttachmentStore } from '../common/attachment/attachment-store.js'
import type { AttachmentRef } from '../common/ws-bridge.js'
import type {
  WeixinCdnMedia,
  WeixinMessage,
  WeixinMessageItem,
} from './ilink-client.js'

const DEFAULT_CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c'

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

type MediaDescriptor = {
  label: string
  kind: 'image' | 'file'
  media: WeixinCdnMedia
  key?: string
  fileName: string
  mimeType?: string
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv',
  '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
}

export async function collectWeixinAttachments(
  message: WeixinMessage,
  chatKey: string,
  store: AttachmentStore,
  options: { fetcher?: Fetcher; cdnBaseUrl?: string } = {},
): Promise<{ attachments: AttachmentRef[]; rejections: string[] }> {
  const attachments: AttachmentRef[] = []
  const rejections: string[] = []

  for (const item of message.item_list ?? []) {
    const descriptor = describeMedia(item)
    if (!descriptor) continue
    try {
      const attachment = await downloadWeixinMedia(descriptor, chatKey, store, options)
      attachments.push(attachment)
    } catch (error) {
      console.error(`[Weixin] ${descriptor.label} download failed:`, error instanceof Error ? error.message : error)
      rejections.push(`${descriptor.label}读取失败，请稍后重试。`)
    }
  }

  return { attachments, rejections }
}

async function downloadWeixinMedia(
  descriptor: MediaDescriptor,
  chatKey: string,
  store: AttachmentStore,
  options: { fetcher?: Fetcher; cdnBaseUrl?: string },
): Promise<AttachmentRef> {
  const fetcher = options.fetcher ?? fetch
  const url = resolveCdnUrl(descriptor.media, options.cdnBaseUrl ?? DEFAULT_CDN_BASE_URL)
  const response = await fetcher(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`Weixin CDN HTTP ${response.status}`)

  const maximum = descriptor.kind === 'image' ? IMAGE_MAX_BYTES : FILE_MAX_BYTES
  const announcedSize = Number(response.headers.get('content-length') || 0)
  if (announcedSize > maximum + 16) throw new Error(`media exceeds ${maximum} bytes`)

  const downloaded = Buffer.from(await response.arrayBuffer())
  const buffer = descriptor.key ? decryptWeixinMedia(downloaded, descriptor.key) : downloaded
  const mimeType = descriptor.kind === 'image'
    ? sniffImageMime(buffer)
    : descriptor.mimeType ?? mimeFromFilename(descriptor.fileName)
  const limit = checkAttachmentLimit(descriptor.kind, buffer.length, mimeType)
  if (!limit.ok) throw new Error(limit.hint)

  const extension = descriptor.kind === 'image' ? extensionForImage(mimeType) : ''
  const fileName = extension && !path.extname(descriptor.fileName)
    ? `${descriptor.fileName}${extension}`
    : descriptor.fileName
  const target = store.resolvePath('weixin', chatKey, fileName)
  await store.write(target, buffer)

  if (descriptor.kind === 'image') {
    return {
      type: 'image',
      name: fileName,
      data: buffer.toString('base64'),
      mimeType,
    }
  }
  return { type: 'file', name: fileName, path: target, mimeType }
}

function describeMedia(item: WeixinMessageItem): MediaDescriptor | null {
  if (item.type === 2 && item.image_item?.media) {
    const image = item.image_item
    const media = image.media!
    return {
      label: '图片',
      kind: 'image',
      media,
      key: image.aeskey || media.aes_key,
      fileName: `weixin-image-${Date.now()}`,
    }
  }
  if (item.type === 3 && !item.voice_item?.text && item.voice_item?.media) {
    return {
      label: '语音',
      kind: 'file',
      media: item.voice_item.media,
      key: item.voice_item.media.aes_key,
      fileName: `weixin-voice-${Date.now()}.silk`,
      mimeType: 'audio/silk',
    }
  }
  if (item.type === 4 && item.file_item?.media) {
    const fileName = path.basename(item.file_item.file_name || `weixin-file-${Date.now()}.bin`)
    return {
      label: '文件',
      kind: 'file',
      media: item.file_item.media,
      key: item.file_item.media.aes_key,
      fileName,
      mimeType: mimeFromFilename(fileName),
    }
  }
  if (item.type === 5 && item.video_item?.media) {
    return {
      label: '视频',
      kind: 'file',
      media: item.video_item.media,
      key: item.video_item.media.aes_key,
      fileName: `weixin-video-${Date.now()}.mp4`,
      mimeType: 'video/mp4',
    }
  }
  return null
}

function resolveCdnUrl(media: WeixinCdnMedia, cdnBaseUrl: string): string {
  const raw = media.full_url?.trim()
    || `${cdnBaseUrl.replace(/\/$/, '')}/download?encrypted_query_param=${encodeURIComponent(media.encrypt_query_param || '')}`
  const normalized = raw.startsWith('//') ? `https:${raw}` : raw
  const url = new URL(normalized)
  if (url.protocol !== 'https:') throw new Error('Weixin CDN URL must use HTTPS')
  if (!media.full_url && !media.encrypt_query_param) throw new Error('Weixin media has no download reference')
  return url.toString()
}

export function decryptWeixinMedia(ciphertext: Buffer, encodedKey: string): Buffer {
  const key = parseMediaKey(encodedKey)
  const decipher = createDecipheriv('aes-128-ecb', key, null)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

function parseMediaKey(value: string): Buffer {
  const trimmed = value.trim()
  if (/^[0-9a-f]{32}$/i.test(trimmed)) return Buffer.from(trimmed, 'hex')

  const decoded = Buffer.from(trimmed, 'base64')
  if (decoded.length === 16) return decoded
  const ascii = decoded.toString('ascii')
  if (decoded.length === 32 && /^[0-9a-f]{32}$/i.test(ascii)) {
    return Buffer.from(ascii, 'hex')
  }
  throw new Error('Weixin media key is invalid')
}

function sniffImageMime(buffer: Buffer): string {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return 'image/png'
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg'
  }
  if (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a') {
    return 'image/gif'
  }
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp'
  }
  throw new Error('Weixin image format is not supported')
}

function extensionForImage(mimeType: string): string {
  if (mimeType === 'image/png') return '.png'
  if (mimeType === 'image/gif') return '.gif'
  if (mimeType === 'image/webp') return '.webp'
  return '.jpg'
}

function mimeFromFilename(fileName: string): string {
  return MIME_BY_EXTENSION[path.extname(fileName).toLowerCase()] || 'application/octet-stream'
}
