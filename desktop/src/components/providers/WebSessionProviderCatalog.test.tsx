import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import type { WebSessionProviderId } from '../../../../src/shared/webSessionProviders'
import { WebSessionProviderCatalog } from './WebSessionProviderCatalog'

const labels = {
  title: '网页 Cookie 提供商',
  description: '使用浏览器会话 Cookie 或网页令牌接入。',
  configuredCount: '已配置 {connected}/{total}',
  testAll: '测试全部',
  connected: '会话已保存',
  active: '当前默认提供商',
  notConfigured: '未配置',
  testing: '正在测试会话…',
  testPassed: '可用 · {latency}ms',
  testFailed: '不可用 · {error}',
  free: '有免费额度',
}

describe('WebSessionProviderCatalog', () => {
  it('renders all 24 providers in popularity order using the selected language', () => {
    const { container } = render(
      <WebSessionProviderCatalog
        locale="zh"
        statuses={new Map()}
        testResults={new Map()}
        testingProviderIds={new Set()}
        isTestingAll={false}
        onSelectProvider={vi.fn()}
        onTestAll={vi.fn()}
        labels={labels}
      />,
    )

    const cards = [...container.querySelectorAll('[data-provider-card-layout="catalog"]')]
    expect(cards).toHaveLength(24)
    expect(cards.slice(0, 4).map((card) => card.textContent)).toEqual([
      expect.stringContaining('ChatGPT 网页版'),
      expect.stringContaining('Claude 网页版'),
      expect.stringContaining('Gemini 网页版'),
      expect.stringContaining('DeepSeek 网页版'),
    ])
    expect(screen.getByText('通义千问网页版')).toBeInTheDocument()
    expect(screen.getByText('已配置 0/24')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '测试全部' })).toBeDisabled()

    const yuanbaoCard = screen
      .getByText('腾讯元宝')
      .closest('[data-provider-card-layout="catalog"]')
    const huggingChatCard = screen
      .getByText('HuggingChat')
      .closest('[data-provider-card-layout="catalog"]')
    expect(yuanbaoCard?.querySelector('[data-provider-logo]'))
      .toHaveAttribute('data-provider-logo', 'yuanbao-web')
    expect(huggingChatCard?.querySelector('[data-provider-logo]'))
      .toHaveAttribute('data-provider-logo', 'huggingchat')
  }, 15_000)

  it('highlights only connected cards and forwards provider selection', () => {
    const onSelectProvider = vi.fn()
    const statuses = new Map<WebSessionProviderId, {
      providerId: WebSessionProviderId
      connected: boolean
      active: boolean
      modelId?: string
    }>([
      ['kimi-web', {
        providerId: 'kimi-web',
        connected: true,
        active: true,
        modelId: 'k2d6-thinking',
      }],
    ])

    render(
      <WebSessionProviderCatalog
        locale="en"
        statuses={statuses}
        testResults={new Map()}
        testingProviderIds={new Set()}
        isTestingAll={false}
        onSelectProvider={onSelectProvider}
        onTestAll={vi.fn()}
        labels={{ ...labels, configuredCount: '{connected}/{total} configured' }}
      />,
    )

    const kimiCard = screen
      .getByText('Kimi Web')
      .closest('[data-provider-card-layout="catalog"]')
    const chatGptCard = screen
      .getByText('ChatGPT Web')
      .closest('[data-provider-card-layout="catalog"]')

    expect(kimiCard).toHaveClass('border-[#1473e6]/30')
    expect(chatGptCard).toHaveClass('border-[var(--color-border-separator)]')
    expect(screen.getByText('1/24 configured')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '测试全部' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Kimi Web: 当前默认提供商' }))
    expect(onSelectProvider).toHaveBeenCalledWith(expect.objectContaining({
      id: 'kimi-web',
    }))
  }, 15_000)
})
