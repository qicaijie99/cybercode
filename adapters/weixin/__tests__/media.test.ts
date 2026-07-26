import { afterEach, describe, expect, test } from 'bun:test'
import { createCipheriv, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AttachmentStore } from '../../common/attachment/attachment-store.js'
import { collectWeixinAttachments, decryptWeixinMedia } from '../media.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Weixin encrypted CDN media', () => {
  test('decrypts AES-128-ECB media keys in raw hex form', () => {
    const key = randomBytes(16)
    const plain = Buffer.from('cybercode-weixin-media')
    const cipher = createCipheriv('aes-128-ecb', key, null)
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()])

    expect(decryptWeixinMedia(encrypted, key.toString('hex'))).toEqual(plain)
  })

  test('downloads an encrypted image and forwards it as an image attachment', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cyber-weixin-media-'))
    tempDirs.push(root)
    const key = randomBytes(16)
    const png = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      Buffer.from('test-image-body'),
    ])
    const cipher = createCipheriv('aes-128-ecb', key, null)
    const encrypted = Buffer.concat([cipher.update(png), cipher.final()])

    const result = await collectWeixinAttachments({
      item_list: [{
        type: 2,
        image_item: {
          aeskey: key.toString('hex'),
          media: { full_url: 'https://example.test/image' },
        },
      }],
    }, 'chat-1', new AttachmentStore({ root }), {
      fetcher: async () => new Response(encrypted),
    })

    expect(result.rejections).toEqual([])
    expect(result.attachments).toHaveLength(1)
    expect(result.attachments[0]).toMatchObject({
      type: 'image',
      mimeType: 'image/png',
      data: png.toString('base64'),
    })
  })

  test('keeps encrypted files as local paths for the agent', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cyber-weixin-file-'))
    tempDirs.push(root)
    const key = randomBytes(16)
    const plain = Buffer.from('# Weixin file\n')
    const cipher = createCipheriv('aes-128-ecb', key, null)
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()])
    const encodedHexKey = Buffer.from(key.toString('hex'), 'ascii').toString('base64')

    const result = await collectWeixinAttachments({
      item_list: [{
        type: 4,
        file_item: {
          file_name: 'notes.md',
          media: {
            full_url: 'https://example.test/file',
            aes_key: encodedHexKey,
          },
        },
      }],
    }, 'chat-2', new AttachmentStore({ root }), {
      fetcher: async () => new Response(encrypted),
    })

    expect(result.rejections).toEqual([])
    expect(result.attachments[0]?.type).toBe('file')
    expect(readFileSync(result.attachments[0]!.path!)).toEqual(plain)
  })
})
