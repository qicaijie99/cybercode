import type { WeixinMessage } from './ilink-client.js'

export function extractWeixinText(message: WeixinMessage): string {
  const parts: string[] = []
  for (const item of message.item_list ?? []) {
    if (item.type === 1 && item.text_item?.text) parts.push(item.text_item.text)
    if (item.type === 3 && item.voice_item?.text) parts.push(item.voice_item.text)
  }
  return parts.join('\n').trim()
}

export function describeUnsupportedWeixinItems(message: WeixinMessage): string {
  const types = new Set((message.item_list ?? []).map((item) => item.type))
  const labels: string[] = []
  if (types.has(2)) labels.push('图片')
  if (types.has(3) && !extractWeixinText(message)) labels.push('语音')
  if (types.has(4)) labels.push('文件')
  if (types.has(5)) labels.push('视频')
  return labels.length > 0 ? `收到${labels.join('、')}，但微信未提供可下载的附件内容。` : ''
}
