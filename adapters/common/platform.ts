export const IM_PLATFORMS = ['telegram', 'feishu', 'weixin', 'qq', 'dingtalk'] as const

export type ImPlatform = (typeof IM_PLATFORMS)[number]

export function isImPlatform(value: string): value is ImPlatform {
  return IM_PLATFORMS.includes(value as ImPlatform)
}
