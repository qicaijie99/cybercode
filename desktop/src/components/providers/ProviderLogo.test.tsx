import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, expect, it } from 'vitest'

import { ProviderLogo } from './ProviderLogo'
import { resolveProviderIdentity } from './providerIdentity'

describe('ProviderLogo', () => {
  it('uses preset provider assets inside the unified logo frame', () => {
    render(<ProviderLogo name="DeepSeek" providerId="deepseek" />)

    expect(screen.getByAltText('DeepSeek logo')).toHaveAttribute('src', '/provider-icons/brands/deepseek-color.svg')
    expect(screen.getByAltText('DeepSeek logo')).toHaveStyle({
      objectFit: 'contain',
    })
    expect(screen.getByAltText('DeepSeek logo').parentElement).toHaveAttribute('data-provider-logo', 'deepseek')
  })

  it('infers common model vendors from base URLs and model IDs', () => {
    expect(resolveProviderIdentity({
      name: 'Production gateway',
      baseUrl: 'https://api.openai.com/v1',
      modelId: 'gpt-5',
    }).id).toBe('openai')

    expect(resolveProviderIdentity({
      name: 'Local',
      modelId: 'qwen3.6',
    }).id).toBe('qwen')
  })

  it('uses exact company and product assets for first-party API providers', () => {
    const { rerender } = render(<ProviderLogo name="OpenAI" providerId="openai" />)

    const openAiLogo = screen.getByAltText('OpenAI logo')
    expect(openAiLogo).toHaveAttribute('src', '/provider-icons/brands/openai.svg')
    expect(openAiLogo.parentElement).toHaveAttribute('data-provider-logo-kind', 'asset')
    expect(openAiLogo).not.toHaveStyle({ filter: expect.stringContaining('drop-shadow') })

    rerender(<ProviderLogo name="Gemini" providerId="google" />)

    const geminiLogo = screen.getByAltText('Gemini logo')
    expect(geminiLogo).toHaveAttribute('src', '/provider-icons/brands/gemini-color.svg')
    expect(geminiLogo.parentElement).toHaveAttribute('data-provider-logo-kind', 'asset')
    expect(geminiLogo).not.toHaveStyle({ filter: expect.stringContaining('drop-shadow') })

    const exactApiAssets = [
      ['anthropic-api', 'anthropic.svg'],
      ['perplexity', 'perplexity-color.svg'],
      ['cohere', 'cohere-color.svg'],
      ['ai21', 'ai21-brand-color.svg'],
    ] as const

    for (const [providerId, asset] of exactApiAssets) {
      expect(resolveProviderIdentity({ providerId, name: providerId }).assetSrc)
        .toBe(`/provider-icons/brands/${asset}`)
    }
  })

  it('maps OAuth products to bundled official assets and keeps Kimi visible', () => {
    const oauthAssets = [
      ['codex', 'codex-color.svg'],
      ['gemini-cli', 'geminicli-color.svg'],
      ['github', 'githubcopilot.svg'],
      ['cursor', 'cursor.svg'],
      ['antigravity', 'antigravity-color.svg'],
      ['kilocode', 'kilocode.svg'],
      ['cline', 'cline.svg'],
      ['qoder', 'qoder-color.svg'],
      ['windsurf', 'windsurf.svg'],
      ['gitlab-duo', 'gitlab-color.svg'],
      ['amazon-q', 'amazonq-color.svg'],
      ['trae', 'trae-color.svg'],
      ['grok-cli', 'grok.svg'],
      ['codebuddy-cn', 'codebuddy-color.svg'],
    ] as const

    for (const [providerId, asset] of oauthAssets) {
      expect(resolveProviderIdentity({ providerId, name: providerId }).assetSrc)
        .toBe(`/provider-icons/brands/${asset}`)
    }

    const { container } = render(<ProviderLogo name="Kimi Coding" providerId="kimi-coding" />)
    expect(screen.getByAltText('Kimi Coding logo')).toHaveAttribute(
      'src',
      '/provider-icons/brands/kimi-color.svg',
    )
    expect(container.firstChild).toHaveStyle({ background: '#111111' })
  })

  it('maps aggregator gateways to their own assets or stable brand marks', () => {
    expect(resolveProviderIdentity({
      providerId: 'alibaba',
      name: '阿里云百炼',
    }).assetSrc).toBe('/provider-icons/brands/bailian-color.svg')
    expect(resolveProviderIdentity({
      providerId: 'qianfan',
      name: '百度千帆',
    }).assetSrc).toBe('/provider-icons/brands/baiducloud-color.svg')
    expect(resolveProviderIdentity({
      providerId: 'synthetic',
      name: 'Synthetic',
    }).assetSrc).toBe('/provider-icons/brands/synthetic.svg')
    expect(resolveProviderIdentity({
      providerId: 'kilo-gateway',
      name: 'Kilo Gateway',
    }).assetSrc).toBe('/provider-icons/brands/kilo-gateway.svg')
    expect(resolveProviderIdentity({
      providerId: 'nanogpt',
      name: 'NanoGPT',
    }).assetSrc).toBe('/provider-icons/brands/nanogpt.png')

    const freeTierAssets = [
      ['cloudflare-ai', 'cloudflare.svg'],
      ['ollama-cloud', 'ollama.svg'],
      ['llm7', 'llm7.svg'],
      ['opencode-free', 'opencode.svg'],
    ] as const
    for (const [providerId, asset] of freeTierAssets) {
      expect(resolveProviderIdentity({ providerId, name: providerId }).assetSrc)
        .toBe(`/provider-icons/brands/${asset}`)
    }

    const fallback = resolveProviderIdentity({
      providerId: 'freetheai',
      name: 'FreeTheAi',
    })
    expect(fallback.id).toBe('freetheai')
    expect(fallback.assetSrc).toBeUndefined()
    expect(fallback.initials).toBe('FA')
  })

  it('keeps web-session brands independent from the selected model vendor', () => {
    const webSessionAssets = [
      ['yuanbao-web', 'web-yuanbao.svg'],
      ['huggingchat', 'web-huggingchat.svg'],
      ['muse-spark-web', 'web-metaai.svg'],
      ['lmarena', 'web-lmarena.svg'],
      ['v0-vercel-web', 'web-v0.svg'],
      ['copilot-m365-web', 'web-copilot.svg'],
      ['venice-web', 'web-venice.png'],
    ] as const

    for (const [providerId, asset] of webSessionAssets) {
      const identity = resolveProviderIdentity({
        providerId,
        name: providerId,
        modelId: 'deepseek-v4-pro',
      })
      expect(identity.id).toBe(providerId)
      expect(identity.assetSrc).toBe(`/provider-icons/brands/${asset}`)
    }
  })

  it('prefers provider identity over a model vendor for custom endpoints', () => {
    expect(resolveProviderIdentity({
      name: '火山',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      modelId: 'glm-5.1',
    }).id).toBe('volcengine')

    expect(resolveProviderIdentity({
      name: '百度千帆',
      baseUrl: 'https://qianfan.baidubce.com/anthropic/coding',
      modelId: 'glm-5.1',
    }).id).toBe('qianfan')

    expect(resolveProviderIdentity({
      name: 'Production gateway',
      baseUrl: 'https://models.github.ai/inference',
      modelId: 'openai/gpt-5',
    }).id).toBe('github-models')
  })

  it('can prefer a recognized model brand while retaining the provider fallback', () => {
    expect(resolveProviderIdentity({
      providerId: 'anthropic-api',
      name: 'Claude-compatible gateway',
      modelId: 'deepseek-v4-pro',
      identityPriority: 'model',
    }).id).toBe('deepseek')

    expect(resolveProviderIdentity({
      providerId: 'qianfan',
      name: 'Baidu Qianfan',
      modelId: 'private-coding-model',
      identityPriority: 'model',
    }).id).toBe('qianfan')
  })

  it('renders unknown custom providers as generated monograms', () => {
    render(<ProviderLogo name="Acme Lab" providerId="custom" />)

    const logo = screen.getByRole('img', { name: 'Acme Lab logo' })
    expect(logo).toHaveAttribute('data-provider-logo-kind', 'generated')
    expect(logo).toHaveTextContent('AL')
  })
})
