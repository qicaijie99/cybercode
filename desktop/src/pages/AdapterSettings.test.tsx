import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { adaptersApi } from '../api/adapters'
import { useSettingsStore } from '../stores/settingsStore'
import { useAdapterStore } from '../stores/adapterStore'
import { AdapterSettings } from './AdapterSettings'

vi.mock('../api/adapters', () => ({
  adaptersApi: {
    getConfig: vi.fn(),
    updateConfig: vi.fn(),
    startLogin: vi.fn(),
    getLoginStatus: vi.fn(),
    submitWeixinVerification: vi.fn(),
    cancelLogin: vi.fn(),
  },
}))

describe('AdapterSettings', () => {
  beforeEach(() => {
    vi.mocked(adaptersApi.getConfig).mockResolvedValue({})
    vi.mocked(adaptersApi.updateConfig).mockResolvedValue({})
    useSettingsStore.setState({ locale: 'zh' })
    useAdapterStore.setState({
      config: {},
      isLoading: false,
      error: null,
    })
  })

  it('shows one contextual setup guide for the active IM adapter', async () => {
    render(<AdapterSettings />)

    expect(
      await screen.findByText('通过微信、QQ、钉钉或 Telegram 远程使用 CyberCode。'),
    ).toBeInTheDocument()
    expect(await screen.findByText('微信接入教程')).toBeInTheDocument()
    expect(screen.queryByText('QQ 机器人接入教程')).not.toBeInTheDocument()
    expect(screen.queryByText('飞书接入教程')).not.toBeInTheDocument()
    expect(screen.queryByText('Telegram 接入教程')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '飞书 (Feishu)' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '查看完整接入教程' })).toHaveLength(1)
  })

  it('does not expose or overwrite legacy Feishu configuration', async () => {
    const legacyConfig = {
      feishu: {
        appId: 'legacy-app',
        appSecret: 'legacy-secret',
        pairedUsers: [{
          userId: 'ou_legacy',
          displayName: 'Legacy Feishu User',
          pairedAt: Date.now(),
        }],
      },
    }
    vi.mocked(adaptersApi.getConfig).mockResolvedValue(legacyConfig)
    useAdapterStore.setState({ config: legacyConfig })

    render(<AdapterSettings />)

    await screen.findByText('通过微信、QQ、钉钉或 Telegram 远程使用 CyberCode。')
    expect(screen.queryByRole('tab', { name: '飞书 (Feishu)' })).not.toBeInTheDocument()
    expect(screen.queryByText('Legacy Feishu User')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(adaptersApi.updateConfig).toHaveBeenCalled())
    const updateCalls = vi.mocked(adaptersApi.updateConfig).mock.calls
    const patch = updateCalls[updateCalls.length - 1]?.[0]
    expect(patch).not.toHaveProperty('feishu')
  })

  it('opens the Telegram full setup guide from the visible button', async () => {
    render(<AdapterSettings />)

    fireEvent.click(await screen.findByRole('tab', { name: 'Telegram' }))
    await screen.findByText('Telegram 接入教程')
    fireEvent.click(screen.getByRole('button', { name: '查看完整接入教程' }))

    expect(
      screen.getByRole('dialog', { name: 'Telegram 连接教程' }),
    ).toBeInTheDocument()
  })

  it('starts the official Weixin QR flow from the channel panel', async () => {
    let resolveLogin!: (value: Awaited<ReturnType<typeof adaptersApi.startLogin>>) => void
    vi.mocked(adaptersApi.startLogin).mockImplementation(() => new Promise((resolve) => {
      resolveLogin = resolve
    }))

    render(<AdapterSettings />)
    fireEvent.click(await screen.findByRole('button', { name: '扫码连接' }))

    expect(await screen.findByRole('dialog', { name: '连接微信' })).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: '正在生成连接二维码' })).toBeInTheDocument()
    expect(screen.getByText('正在向官方服务申请二维码，通常需要几秒，请不要关闭此窗口。')).toBeInTheDocument()

    await act(async () => {
      resolveLogin({
        sessionId: 'login-1',
        platform: 'weixin',
        status: 'waiting',
        message: '请使用手机微信扫码连接',
        qrDataUrl: 'data:image/png;base64,abc',
        updatedAt: Date.now(),
      })
    })

    expect(await screen.findByAltText('连接微信二维码')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('shows a busy state while disconnecting an IM account', async () => {
    const connectedConfig = {
      weixin: {
        enabled: true,
        accountId: 'wx-account',
        botToken: 'wx-token',
      },
    }
    let resolveUpdate!: (value: typeof connectedConfig) => void
    vi.mocked(adaptersApi.getConfig).mockResolvedValue(connectedConfig)
    vi.mocked(adaptersApi.updateConfig).mockImplementation(() => new Promise((resolve) => {
      resolveUpdate = resolve as (value: typeof connectedConfig) => void
    }))
    useAdapterStore.setState({ config: connectedConfig })

    render(<AdapterSettings />)
    const disconnectButton = await screen.findByRole('button', { name: '断开' })
    fireEvent.click(disconnectButton)

    expect(disconnectButton).toBeDisabled()

    await act(async () => {
      resolveUpdate(connectedConfig)
    })

    await waitFor(() => expect(adaptersApi.updateConfig).toHaveBeenCalled())
  })

  it('enables QQ when complete manual credentials are saved for the first time', async () => {
    vi.mocked(adaptersApi.updateConfig).mockImplementation(async (patch) => patch)

    render(<AdapterSettings />)
    fireEvent.click(await screen.findByRole('tab', { name: 'QQ' }))
    fireEvent.change(screen.getByLabelText('App ID'), { target: { value: '102000001' } })
    fireEvent.change(screen.getByLabelText('App Secret'), { target: { value: 'secret-value' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(adaptersApi.updateConfig).toHaveBeenCalledWith(expect.objectContaining({
        qq: expect.objectContaining({
          enabled: true,
          appId: '102000001',
          appSecret: 'secret-value',
        }),
      }))
    })
  })

  it('saves DingTalk Stream credentials and allowed users', async () => {
    vi.mocked(adaptersApi.updateConfig).mockImplementation(async (patch) => patch)

    render(<AdapterSettings />)
    fireEvent.click(await screen.findByRole('tab', { name: '钉钉' }))
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'ding-client-id' } })
    fireEvent.change(screen.getByLabelText('Client Secret'), { target: { value: 'ding-client-secret' } })
    fireEvent.change(screen.getByLabelText('允许的用户'), { target: { value: 'staff-1, staff-2' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(adaptersApi.updateConfig).toHaveBeenCalledWith(expect.objectContaining({
        dingtalk: {
          clientId: 'ding-client-id',
          clientSecret: 'ding-client-secret',
          allowedUsers: ['staff-1', 'staff-2'],
        },
      }))
    })
  })
})
