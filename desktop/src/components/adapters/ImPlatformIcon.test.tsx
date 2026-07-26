import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, expect, it } from 'vitest'

import type { ImPlatform } from '../../types/adapter'
import { ImPlatformIcon } from './ImPlatformIcon'

describe('ImPlatformIcon', () => {
  const platforms: Array<[ImPlatform, string]> = [
    ['weixin', '/im-icons/weixin.svg'],
    ['qq', '/im-icons/qq.png'],
    ['feishu', '/im-icons/feishu.png'],
    ['dingtalk', '/im-icons/dingtalk.svg'],
    ['telegram', '/im-icons/telegram.svg'],
  ]

  it.each(platforms)('uses the bundled official %s asset', (platform, src) => {
    render(<ImPlatformIcon platform={platform} decorative={false} />)

    expect(screen.getByRole('img')).toHaveAttribute('src', src)
  })
})
