import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getWebSessionProvider,
  type WebSessionProviderDefinition,
} from '../../../../src/shared/webSessionProviders'
import { useSettingsStore } from '../../stores/settingsStore'
import {
  normalizeWebSessionClipboardCredential,
  WebSessionProviderDialog,
} from './WebSessionProviderDialog'

const labels = {
  connected: '已连接',
  notConfigured: '未配置',
  credential: '会话凭据',
  credentialSaved: '已保存',
  model: '网页模型',
  openWebsite: '打开网站',
  save: '保存会话',
  test: '测试',
  setDefault: '设为默认',
  defaultProvider: '当前默认',
  disconnect: '移除会话',
  riskTitle: '风险提示',
  riskBody: '网页会话存在稳定性风险。',
  compatibilityNote: '不会静默读取浏览器数据。',
  saveFailed: '保存失败',
  testPassed: '可用 · {latency}ms',
  howToGet: '如何获取会话凭据',
  hideGuide: '收起获取教程',
  exactCredential: '需要的字段',
  credentialExample: '填写格式',
  stepLogin: '1. 登录官方网站',
  stepLoginBody: '打开 {provider} 并登录。',
  stepFind: '2. 找到会话凭据',
  findCookiesBody: '进入 Cookies，查找 {credential}。',
  findCookieValueBody: '进入 Cookies，只复制 {credential} 的值。',
  findLocalStorageBody: '进入 Local Storage，查找 {credential}。',
  findNetworkBody: '进入 Network，查找 {credential}。',
  stepCopy: '3. 一键导入并验证',
  copyCookieBody: '复制 Cookie 后导入。',
  copyTokenBody: '复制令牌后导入。',
  securityNote: '只有点击按钮时读取一次剪贴板。',
  importClipboard: '从剪贴板导入',
  clipboardImported: '已从剪贴板导入',
  clipboardEmpty: '剪贴板为空',
  clipboardDenied: '无法读取剪贴板',
}

function renderDialog(
  provider: WebSessionProviderDefinition,
  connected = false,
) {
  return render(
    <WebSessionProviderDialog
      provider={provider}
      status={{
        providerId: provider.id,
        connected,
        active: false,
        modelId: provider.defaultModel,
      }}
      onClose={vi.fn()}
      onChanged={vi.fn()}
      onTestResult={vi.fn()}
      labels={labels}
    />,
  )
}

describe('normalizeWebSessionClipboardCredential', () => {
  it('removes copied Cookie headers while retaining all cookie pairs', () => {
    const kimi = getWebSessionProvider('kimi-web')!
    expect(normalizeWebSessionClipboardCredential(
      kimi,
      'Cookie: kimi-auth=abc; other=1',
    )).toBe('kimi-auth=abc; other=1')
  })

  it('accepts a copied DeepSeek local-storage assignment', () => {
    const deepseek = getWebSessionProvider('deepseek-web')!
    expect(normalizeWebSessionClipboardCredential(
      deepseek,
      'userToken="secret-token"',
    )).toBe('secret-token')
  })
})

describe('WebSessionProviderDialog credential guide', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'zh' })
  })

  it('shows cookie instructions by default and imports the clipboard value', async () => {
    const readText = vi.fn().mockResolvedValue(
      'Cookie: kimi-auth=abc; other=1',
    )
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText },
    })

    renderDialog(getWebSessionProvider('kimi-web')!)

    expect(screen.getByText('如何获取会话凭据')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '收起获取教程' }))
      .toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('进入 Cookies，查找 kimi-auth。')).toBeInTheDocument()
    expect(screen.getByText('kimi-auth=...')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '从剪贴板导入' }))

    await waitFor(() => {
      expect(readText).toHaveBeenCalledTimes(1)
      expect(screen.getByLabelText('会话凭据 · kimi-auth')).toHaveValue(
        'kimi-auth=abc; other=1',
      )
    })
    expect(screen.getByText('已从剪贴板导入')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存会话' })).toBeEnabled()
  })

  it('uses Local Storage instructions for DeepSeek', () => {
    renderDialog(getWebSessionProvider('deepseek-web')!)

    expect(
      screen.getByText('进入 Local Storage，查找 userToken。'),
    ).toBeInTheDocument()
    expect(screen.queryByText('进入 Cookies，查找 userToken。'))
      .not.toBeInTheDocument()
  })

  it('does not tell a token-only cookie provider to paste the full Cookie header', () => {
    renderDialog(getWebSessionProvider('inner-ai')!)

    expect(
      screen.getByText('进入 Cookies，只复制 token + email 的值。'),
    ).toBeInTheDocument()
    expect(screen.getByText('复制令牌后导入。')).toBeInTheDocument()
    expect(screen.queryByText('复制 Cookie 后导入。')).not.toBeInTheDocument()
  })

  it('uses the shared model picker instead of the browser native select', () => {
    const { container } = renderDialog(getWebSessionProvider('kimi-web')!)

    expect(container.querySelector('select')).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: '网页模型 K2.6 Instant' }),
    )
    fireEvent.click(
      screen.getByRole('option', { name: /K2\.6 Thinking/ }),
    )

    expect(
      screen.getByRole('button', { name: '网页模型 K2.6 Thinking' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('keeps the guide collapsed for an existing connection', () => {
    renderDialog(getWebSessionProvider('claude-web')!, true)

    expect(screen.getByRole('button', { name: '如何获取会话凭据' }))
      .toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('进入 Cookies，查找 sessionKey。'))
      .not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '如何获取会话凭据' }))
    expect(screen.getByText('进入 Cookies，查找 sessionKey。'))
      .toBeInTheDocument()
  })
})
