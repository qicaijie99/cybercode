import { describe, expect, test } from 'bun:test'
import { describeUnsupportedWeixinItems, extractWeixinText } from '../message.js'

describe('Weixin inbound normalization', () => {
  test('extracts text and voice transcription', () => {
    expect(extractWeixinText({ item_list: [
      { type: 1, text_item: { text: '你好' } },
      { type: 3, voice_item: { text: '打开项目' } },
    ] })).toBe('你好\n打开项目')
  })

  test('describes media when no readable text is present', () => {
    expect(describeUnsupportedWeixinItems({ item_list: [{ type: 2 }, { type: 4 }] }))
      .toContain('图片、文件')
  })
})
