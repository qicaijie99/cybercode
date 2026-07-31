import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getMediaProvider } from '../../../../src/shared/mediaProviders'
import { useSettingsStore } from '../../stores/settingsStore'
import { MediaProviderDialog } from './MediaProviderDialog'

const labels = {
  connected: '已连接',
  inherited: '复用提供商 Key',
  localReady: '本地端点',
  noAuthReady: '无需 Key',
  notConfigured: '未配置',
  model: '媒体模型',
  openWebsite: '打开网站',
  save: '保存',
  test: '测试',
  disconnect: '断开连接',
  credentialSaved: '已保存',
  connectionNote: '填写凭据后即可使用。',
  inheritedNote: '正在复用提供商凭据。',
  localNote: '本地端点已就绪。',
  noAuthNote: '此提供商无需凭据。',
  saveFailed: '保存失败',
  testPassed: '凭据有效 · {latency}ms',
  reachabilityPassed: '端点可达 · {latency}ms',
  imageGeneration: '图像生成',
  imageEdit: '图像编辑',
  videoGeneration: '视频生成',
  speechToText: '语音转文字',
  textToSpeech: '文字转语音',
  musicGeneration: '音乐生成',
}

describe('MediaProviderDialog model picker', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'zh' })
  })

  it('uses the shared picker and keeps service and model ID visible in the menu', () => {
    const provider = getMediaProvider('image', 'alibaba-wan-image')!
    const { container } = render(
      <MediaProviderDialog
        provider={provider}
        onClose={vi.fn()}
        onChanged={vi.fn()}
        onTestResult={vi.fn()}
        labels={labels}
      />,
    )

    expect(container.querySelector('select')).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: '媒体模型 Wan 2.6 Image' }),
    )

    expect(
      screen.getByRole('option', {
        name: 'Wanx 2.1 Turbo 图像生成 · wanx2.1-t2i-turbo',
      }),
    ).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('option', { name: /Wanx 2\.1 Turbo/ }),
    )
    expect(
      screen.getByRole('button', { name: '媒体模型 Wanx 2.1 Turbo' }),
    ).toBeInTheDocument()
  })
})
