import * as path from 'node:path'
import type { QQBotInboundMessage } from '@tencent-connect/qqbot-nodejs'
import { checkAttachmentLimit, FILE_MAX_BYTES, IMAGE_MAX_BYTES } from '../common/attachment/attachment-limits.js'
import { AttachmentStore } from '../common/attachment/attachment-store.js'
import type { AttachmentRef } from '../common/ws-bridge.js'

type QQAttachment = NonNullable<QQBotInboundMessage['attachments']>[number]

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'audio/wav': '.wav',
  'audio/mpeg': '.mp3',
  'video/mp4': '.mp4',
  'application/pdf': '.pdf',
}

export async function collectQQAttachments(
  message: QQBotInboundMessage,
  chatKey: string,
  store: AttachmentStore,
): Promise<{ attachments: AttachmentRef[]; rejections: string[]; voiceText: string[] }> {
  const attachments: AttachmentRef[] = []
  const rejections: string[] = []
  const voiceText: string[] = []

  for (const remote of message.attachments ?? []) {
    if (remote.asr_refer_text?.trim()) voiceText.push(remote.asr_refer_text.trim())
    try {
      const downloaded = await downloadQQAttachment(remote, chatKey, store)
      if (!downloaded) continue
      attachments.push(downloaded)
    } catch (error) {
      console.error('[QQ] attachment download failed:', error instanceof Error ? error.message : error)
      rejections.push('附件下载失败，请稍后重试。')
    }
  }
  return { attachments, rejections, voiceText }
}

async function downloadQQAttachment(
  remote: QQAttachment,
  chatKey: string,
  store: AttachmentStore,
): Promise<AttachmentRef | null> {
  const mimeType = remote.content_type?.split(';')[0]?.trim().toLowerCase() || 'application/octet-stream'
  const kind = mimeType.startsWith('image/') ? 'image' : 'file'
  const announcedSize = remote.size ?? 0
  const announcedCheck = checkAttachmentLimit(kind, announcedSize, mimeType)
  if (announcedSize > 0 && !announcedCheck.ok) throw new Error(announcedCheck.hint)

  const rawUrl = remote.voice_wav_url || remote.url
  const url = normalizeQQMediaUrl(rawUrl)
  if (!url) return null
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`QQ media HTTP ${response.status}`)

  const contentLength = Number(response.headers.get('content-length') || 0)
  const maximum = kind === 'image' ? IMAGE_MAX_BYTES : FILE_MAX_BYTES
  if (contentLength > maximum) throw new Error(`attachment exceeds ${maximum} bytes`)
  const buffer = Buffer.from(await response.arrayBuffer())
  const check = checkAttachmentLimit(kind, buffer.length, mimeType)
  if (!check.ok) throw new Error(check.hint)

  const fallbackName = `qq-${Date.now()}${MIME_EXTENSIONS[mimeType] || ''}`
  const fileName = path.basename(remote.filename || fallbackName)
  const target = store.resolvePath('qq', chatKey, fileName)
  await store.write(target, buffer)

  if (kind === 'image') {
    return {
      type: 'image',
      name: fileName,
      data: buffer.toString('base64'),
      mimeType,
    }
  }
  return { type: 'file', name: fileName, path: target, mimeType }
}

export function normalizeQQMediaUrl(value?: string): string | null {
  if (!value?.trim()) return null
  const raw = value.startsWith('//') ? `https:${value}` : value
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}
