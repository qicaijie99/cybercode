import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import type { MediaProviderKind } from '../../../../src/shared/mediaProviders'
import { MediaProviderCatalog } from './MediaProviderCatalog'

const labels = {
  title: '图像、视频与音频提供商',
  description: '中国服务和中国模型优先排列。',
  configuredCount: '已连接 {connected}/{total}',
  image: '图像',
  video: '视频',
  audio: '音频',
  connectedWithModel: '已连接 · {model}',
  inheritedWithModel: '复用提供商 Key · {model}',
  localWithModel: '本地端点 · {model}',
  noAuthWithModel: '无需 Key · {model}',
  notConfiguredWithModel: '未配置 · {model}',
  testing: '正在检查连接…',
  testPassed: '凭据有效 · {latency}ms',
  reachabilityPassed: '端点可达 · {latency}ms',
  testFailed: '不可用 · {error}',
  chinaFirst: '中国优先',
}

function CatalogHarness({
  locale = 'zh',
}: {
  locale?: 'en' | 'zh' | 'ja' | 'ko'
}) {
  const [activeKind, setActiveKind] = useState<MediaProviderKind>('video')
  return (
    <MediaProviderCatalog
      locale={locale}
      activeKind={activeKind}
      onKindChange={setActiveKind}
      statuses={new Map()}
      testResults={new Map()}
      testingKeys={new Set()}
      onSelectProvider={vi.fn()}
      labels={labels}
    />
  )
}

function catalogCards(container: HTMLElement) {
  return [...container.querySelectorAll('[data-provider-card-layout="catalog"]')]
}

describe('MediaProviderCatalog', () => {
  it('opens on video and puts Seedance and Chinese providers first', () => {
    const { container } = render(<CatalogHarness />)
    const catalog = container.querySelector('[data-provider-catalog="media"]')
    const cards = catalogCards(container)

    expect(catalog).toHaveAttribute('data-provider-catalog-kind', 'video')
    expect(cards).toHaveLength(15)
    expect(cards.slice(0, 5).map((card) => card.textContent)).toEqual([
      expect.stringContaining('KIE（Seedance 2.0 / 可灵 / 万相）'),
      expect.stringContaining('火山引擎 Seedance'),
      expect.stringContaining('MiniMax 海螺'),
      expect.stringContaining('阿里云万相视频'),
      expect.stringContaining('腾讯云 AI 视频'),
    ])
    expect(
      screen.getByText('Replicate 视频')
        .closest('[data-provider-card-layout="catalog"]')
        ?.querySelector('[data-provider-logo]'),
    ).toHaveStyle({ background: '#111111' })
    expect(screen.getByText('已连接 0/61')).toBeInTheDocument()
    expect(screen.getAllByText('中国优先')).toHaveLength(5)
  })

  it('switches between image, video, and audio catalogs without mixing chat models', () => {
    const { container } = render(<CatalogHarness />)

    fireEvent.click(screen.getByRole('tab', { name: '图像' }))
    expect(container.querySelector('[data-provider-catalog="media"]'))
      .toHaveAttribute('data-provider-catalog-kind', 'image')
    expect(catalogCards(container)).toHaveLength(26)
    expect(catalogCards(container)[0]).toHaveTextContent('火山引擎 Seedream')

    fireEvent.click(screen.getByRole('tab', { name: '音频' }))
    expect(container.querySelector('[data-provider-catalog="media"]'))
      .toHaveAttribute('data-provider-catalog-kind', 'audio')
    expect(catalogCards(container)).toHaveLength(20)
    expect(catalogCards(container).slice(0, 3).map((card) => card.textContent)).toEqual([
      expect.stringContaining('MiniMax 语音与音乐'),
      expect.stringContaining('小米 MiMo 语音'),
      expect.stringContaining('通义千问语音（本地）'),
    ])
  }, 15_000)

  it('highlights configured cards and forwards the selected provider', () => {
    const onSelectProvider = vi.fn()
    const statuses = new Map([
      ['video:kie', {
        key: 'video:kie',
        kind: 'video' as const,
        providerId: 'kie',
        connected: true,
        configured: true,
        credentialSource: 'media' as const,
        modelId: 'bytedance/seedance-2',
      }],
    ])
    render(
      <MediaProviderCatalog
        locale="en"
        activeKind="video"
        onKindChange={vi.fn()}
        statuses={statuses}
        testResults={new Map()}
        testingKeys={new Set()}
        onSelectProvider={onSelectProvider}
        labels={{ ...labels, configuredCount: '{connected}/{total} connected' }}
      />,
    )

    const kieCard = screen
      .getByText('KIE (Seedance 2.0 / Kling / Wan)')
      .closest('[data-provider-card-layout="catalog"]')
    const volcengineCard = screen
      .getByText('Volcengine Seedance')
      .closest('[data-provider-card-layout="catalog"]')

    expect(kieCard).toHaveClass('border-[#1473e6]/30')
    expect(volcengineCard).toHaveClass('border-[var(--color-border-separator)]')
    expect(screen.getByText('1/61 connected')).toBeInTheDocument()

    fireEvent.click(kieCard!.querySelector('button')!)
    expect(onSelectProvider).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'video',
      id: 'kie',
      defaultModel: 'bytedance/seedance-2',
    }))
  })
})
