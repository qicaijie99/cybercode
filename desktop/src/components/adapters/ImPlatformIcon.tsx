import type { CSSProperties } from 'react'
import type { ImPlatform } from '../../types/adapter'

const PLATFORM_ICONS: Record<ImPlatform, { label: string; src: string }> = {
  weixin: { label: '微信', src: '/im-icons/weixin.svg' },
  qq: { label: 'QQ', src: '/im-icons/qq.png' },
  feishu: { label: '飞书', src: '/im-icons/feishu.png' },
  dingtalk: { label: '钉钉', src: '/im-icons/dingtalk.svg' },
  telegram: { label: 'Telegram', src: '/im-icons/telegram.svg' },
}

type ImPlatformIconProps = {
  platform: ImPlatform
  size?: number
  decorative?: boolean
  className?: string
}

export function ImPlatformIcon({
  platform,
  size = 20,
  decorative = true,
  className = '',
}: ImPlatformIconProps) {
  const icon = PLATFORM_ICONS[platform]
  const dimensions = { width: size, height: size } as CSSProperties

  return (
    <span
      data-im-platform-icon={platform}
      className={`inline-flex shrink-0 items-center justify-center ${className}`}
      style={dimensions}
    >
      <img
        src={icon.src}
        alt={decorative ? '' : `${icon.label} logo`}
        aria-hidden={decorative ? true : undefined}
        className="block h-full w-full select-none object-contain"
        decoding="async"
        draggable={false}
      />
    </span>
  )
}
