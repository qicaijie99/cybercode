export const WEB_SESSION_PRESET_PREFIX = 'web-session:'

export type WebSessionProviderId =
  | 'chatgpt-web'
  | 'claude-web'
  | 'gemini-web'
  | 'deepseek-web'
  | 'grok-web'
  | 'perplexity-web'
  | 'copilot-web'
  | 'kimi-web'
  | 'qwen-web'
  | 'yuanbao-web'
  | 'poe-web'
  | 'huggingchat'
  | 'muse-spark-web'
  | 'lmarena'
  | 't3-web'
  | 'blackbox-web'
  | 'v0-vercel-web'
  | 'doubao-web'
  | 'gemini-business'
  | 'copilot-m365-web'
  | 'zenmux-free'
  | 'adapta-web'
  | 'inner-ai'
  | 'venice-web'

export type WebSessionLocale = 'en' | 'zh' | 'ja' | 'ko'

export type WebSessionModel = {
  id: string
  label: string
}

export type WebSessionCredentialSource = 'cookies' | 'local-storage' | 'network'

export type WebSessionProviderDefinition = {
  id: WebSessionProviderId
  names: Record<WebSessionLocale, string>
  logoProviderId: string
  website: string
  defaultModel: string
  models: readonly WebSessionModel[]
  credentialKind: 'cookie' | 'token'
  credentialName: string
  credentialPlaceholder: string
  acceptsFullCookieHeader: boolean
  credentialSource?: WebSessionCredentialSource
  freeTier: boolean
}

function names(
  en: string,
  zh: string,
  ja: string,
  ko: string,
): Record<WebSessionLocale, string> {
  return { en, zh, ja, ko }
}

function models(...items: Array<[string, string]>): readonly WebSessionModel[] {
  return items.map(([id, label]) => ({ id, label }))
}

// Popularity order is intentional. Keep this list stable because both the
// settings catalog and "test all" progress use it.
export const WEB_SESSION_PROVIDERS: readonly WebSessionProviderDefinition[] = [
  {
    id: 'chatgpt-web',
    names: names('ChatGPT Web', 'ChatGPT 网页版', 'ChatGPT Web版', 'ChatGPT 웹'),
    logoProviderId: 'openai',
    website: 'https://chatgpt.com',
    defaultModel: 'gpt-5.6-thinking',
    models: models(
      ['gpt-5.6-thinking', 'GPT-5.6 Thinking'],
      ['gpt-5.5', 'GPT-5.5 Instant'],
      ['o3', 'o3'],
    ),
    credentialKind: 'cookie',
    credentialName: '__Secure-next-auth.session-token',
    credentialPlaceholder: '__Secure-next-auth.session-token=...',
    acceptsFullCookieHeader: true,
    freeTier: false,
  },
  {
    id: 'claude-web',
    names: names('Claude Web', 'Claude 网页版', 'Claude Web版', 'Claude 웹'),
    logoProviderId: 'official',
    website: 'https://claude.ai',
    defaultModel: 'claude-sonnet-5',
    models: models(
      ['claude-sonnet-5', 'Claude 5 Sonnet'],
      ['claude-sonnet-4-6', 'Claude 4.6 Sonnet'],
      ['claude-haiku-4-5', 'Claude 4.5 Haiku'],
    ),
    credentialKind: 'cookie',
    credentialName: 'sessionKey',
    credentialPlaceholder: 'sessionKey=... or full Cookie header',
    acceptsFullCookieHeader: true,
    freeTier: false,
  },
  {
    id: 'gemini-web',
    names: names('Gemini Web', 'Gemini 网页版', 'Gemini Web版', 'Gemini 웹'),
    logoProviderId: 'google',
    website: 'https://gemini.google.com',
    defaultModel: 'gemini-3.1-pro',
    models: models(
      ['gemini-3.1-pro', 'Gemini 3.1 Pro'],
      ['gemini-3.5-flash', 'Gemini 3.5 Flash'],
      ['gemini-3.1-flash-lite', 'Gemini 3.1 Flash-Lite'],
    ),
    credentialKind: 'cookie',
    credentialName: '__Secure-1PSID',
    credentialPlaceholder: '__Secure-1PSID=...; __Secure-1PSIDTS=...',
    acceptsFullCookieHeader: true,
    freeTier: true,
  },
  {
    id: 'deepseek-web',
    names: names('DeepSeek Web', 'DeepSeek 网页版', 'DeepSeek Web版', 'DeepSeek 웹'),
    logoProviderId: 'deepseek',
    website: 'https://chat.deepseek.com',
    defaultModel: 'deepseek-v4-flash',
    models: models(
      ['deepseek-v4-pro', 'DeepSeek V4 Pro'],
      ['deepseek-v4-pro-think', 'DeepSeek V4 Pro Think'],
      ['deepseek-v4-flash', 'DeepSeek V4 Flash'],
    ),
    credentialKind: 'token',
    credentialName: 'userToken',
    credentialPlaceholder: 'Paste userToken from Local Storage',
    acceptsFullCookieHeader: false,
    credentialSource: 'local-storage',
    freeTier: true,
  },
  {
    id: 'grok-web',
    names: names('Grok Web', 'Grok 网页版', 'Grok Web版', 'Grok 웹'),
    logoProviderId: 'xai',
    website: 'https://grok.com',
    defaultModel: 'fast',
    models: models(
      ['fast', 'Grok 4.20'],
      ['expert', 'Grok 4.20 Thinking'],
      ['heavy', 'Grok 4.20 Multi Agent'],
    ),
    credentialKind: 'cookie',
    credentialName: 'sso + sso-rw',
    credentialPlaceholder: 'sso=...; sso-rw=...',
    acceptsFullCookieHeader: true,
    freeTier: false,
  },
  {
    id: 'perplexity-web',
    names: names('Perplexity Web', 'Perplexity 网页版', 'Perplexity Web版', 'Perplexity 웹'),
    logoProviderId: 'perplexity',
    website: 'https://www.perplexity.ai',
    defaultModel: 'pplx-auto',
    models: models(
      ['pplx-auto', 'Perplexity Best'],
      ['pplx-sonar', 'Sonar'],
      ['pplx-sonnet', 'Claude via Perplexity'],
    ),
    credentialKind: 'cookie',
    credentialName: '__Secure-next-auth.session-token',
    credentialPlaceholder: '__Secure-next-auth.session-token=...',
    acceptsFullCookieHeader: true,
    freeTier: false,
  },
  {
    id: 'copilot-web',
    names: names(
      'Microsoft Copilot Web',
      'Microsoft Copilot 网页版',
      'Microsoft Copilot Web版',
      'Microsoft Copilot 웹',
    ),
    logoProviderId: 'copilot-web',
    website: 'https://copilot.microsoft.com',
    defaultModel: 'copilot-pro',
    models: models(
      ['copilot-pro', 'Copilot Pro'],
      ['gpt-4-turbo', 'GPT-4 Turbo'],
      ['gpt-4', 'GPT-4'],
    ),
    credentialKind: 'token',
    credentialName: 'access_token',
    credentialPlaceholder: 'access_token=...',
    acceptsFullCookieHeader: false,
    credentialSource: 'network',
    freeTier: true,
  },
  {
    id: 'kimi-web',
    names: names('Kimi Web', 'Kimi 网页版', 'Kimi Web版', 'Kimi 웹'),
    logoProviderId: 'kimi',
    website: 'https://www.kimi.com',
    defaultModel: 'k2d6',
    models: models(
      ['k2d6', 'K2.6 Instant'],
      ['k2d6-thinking', 'K2.6 Thinking'],
    ),
    credentialKind: 'cookie',
    credentialName: 'kimi-auth',
    credentialPlaceholder: 'kimi-auth=...',
    acceptsFullCookieHeader: true,
    freeTier: true,
  },
  {
    id: 'qwen-web',
    names: names('Qwen Web', '通义千问网页版', 'Qwen Web版', 'Qwen 웹'),
    logoProviderId: 'qwen',
    website: 'https://chat.qwen.ai',
    defaultModel: 'qwen3.7-max',
    models: models(
      ['qwen3.7-max', 'Qwen3.7 Max'],
      ['qwen3.7-plus', 'Qwen3.7 Plus'],
      ['qwen3.6-plus', 'Qwen3.6 Plus'],
    ),
    credentialKind: 'cookie',
    credentialName: 'Cookie header with token',
    credentialPlaceholder: 'cna=...; token=...; ssxmod_itna=...',
    acceptsFullCookieHeader: true,
    freeTier: true,
  },
  {
    id: 'yuanbao-web',
    names: names('Tencent Yuanbao', '腾讯元宝', 'Tencent Yuanbao', 'Tencent Yuanbao'),
    logoProviderId: 'yuanbao-web',
    website: 'https://yuanbao.tencent.com',
    defaultModel: 'deepseek-v3',
    models: models(
      ['deepseek-v3', 'DeepSeek V3'],
      ['deepseek-r1', 'DeepSeek R1'],
      ['hunyuan', 'Hunyuan'],
    ),
    credentialKind: 'cookie',
    credentialName: 'hy_user + hy_token',
    credentialPlaceholder: 'hy_user=...; hy_token=...',
    acceptsFullCookieHeader: true,
    freeTier: true,
  },
  {
    id: 'poe-web',
    names: names('Poe Web', 'Poe 网页版', 'Poe Web版', 'Poe 웹'),
    logoProviderId: 'poe',
    website: 'https://poe.com',
    defaultModel: 'poe-default',
    models: models(
      ['poe-default', 'Poe Assistant'],
      ['gpt-4o', 'GPT-4o'],
      ['claude-3.5-sonnet', 'Claude 3.5 Sonnet'],
    ),
    credentialKind: 'cookie',
    credentialName: 'p-b',
    credentialPlaceholder: 'p-b=...',
    acceptsFullCookieHeader: true,
    freeTier: false,
  },
  {
    id: 'huggingchat',
    names: names('HuggingChat', 'HuggingChat', 'HuggingChat', 'HuggingChat'),
    logoProviderId: 'huggingchat',
    website: 'https://huggingface.co/chat',
    defaultModel: 'deepseek-ai/DeepSeek-V4-Flash',
    models: models(
      ['deepseek-ai/DeepSeek-V4-Flash', 'DeepSeek V4 Flash'],
      ['moonshotai/Kimi-K2.7-Code', 'Kimi K2.7 Code'],
      ['Qwen/Qwen3.5-397B-A17B', 'Qwen3.5 397B'],
    ),
    credentialKind: 'cookie',
    credentialName: 'hf-chat + token',
    credentialPlaceholder: 'hf-chat=...; token=...; aws-waf-token=...',
    acceptsFullCookieHeader: true,
    freeTier: true,
  },
  {
    id: 'muse-spark-web',
    names: names('Meta AI Web', 'Meta AI 网页版', 'Meta AI Web版', 'Meta AI 웹'),
    logoProviderId: 'muse-spark-web',
    website: 'https://www.meta.ai',
    defaultModel: 'muse-spark',
    models: models(
      ['muse-spark', 'Meta AI'],
      ['muse-spark-thinking', 'Meta AI Thinking'],
    ),
    credentialKind: 'cookie',
    credentialName: 'ecto_1_sess',
    credentialPlaceholder: 'ecto_1_sess=...',
    acceptsFullCookieHeader: true,
    freeTier: true,
  },
  {
    id: 'lmarena',
    names: names('Arena', 'Arena 模型竞技场', 'Arena モデルアリーナ', 'Arena 모델 아레나'),
    logoProviderId: 'lmarena',
    website: 'https://arena.ai',
    defaultModel: 'claude-sonnet-5',
    models: models(
      ['claude-sonnet-5', 'Claude 5 Sonnet'],
      ['gemini-3.1-pro-preview', 'Gemini 3.1 Pro'],
      ['deepseek-v4-pro-thinking', 'DeepSeek V4 Pro Thinking'],
    ),
    credentialKind: 'cookie',
    credentialName: 'full Arena Cookie header',
    credentialPlaceholder: 'arena-auth-prod-v1.0=...; arena-auth-prod-v1.1=...',
    acceptsFullCookieHeader: true,
    freeTier: true,
  },
  {
    id: 't3-web',
    names: names('t3.chat Web', 't3.chat 网页版', 't3.chat Web版', 't3.chat 웹'),
    logoProviderId: 't3-web',
    website: 'https://t3.chat',
    defaultModel: 'claude-sonnet-4',
    models: models(
      ['claude-sonnet-4', 'Claude Sonnet'],
      ['gpt-5', 'GPT-5'],
      ['gemini-2.5-pro', 'Gemini 2.5 Pro'],
    ),
    credentialKind: 'cookie',
    credentialName: 'convex-session-id + Cookie header',
    credentialPlaceholder: 'convex-session-id=...; other-cookie=...',
    acceptsFullCookieHeader: true,
    freeTier: true,
  },
  {
    id: 'blackbox-web',
    names: names('Blackbox Web', 'Blackbox 网页版', 'Blackbox Web版', 'Blackbox 웹'),
    logoProviderId: 'blackbox-web',
    website: 'https://app.blackbox.ai',
    defaultModel: 'gpt-4-turbo',
    models: models(
      ['gpt-4-turbo', 'GPT-4 Turbo'],
      ['claude-3-opus', 'Claude 3 Opus'],
      ['gemini-pro', 'Gemini Pro'],
    ),
    credentialKind: 'cookie',
    credentialName: '__Secure-authjs.session-token',
    credentialPlaceholder: '__Secure-authjs.session-token=...',
    acceptsFullCookieHeader: true,
    freeTier: false,
  },
  {
    id: 'v0-vercel-web',
    names: names('v0 Web', 'v0 网页版', 'v0 Web版', 'v0 웹'),
    logoProviderId: 'v0-vercel-web',
    website: 'https://v0.dev',
    defaultModel: 'v0-default',
    models: models(['v0-default', 'v0 Default']),
    credentialKind: 'cookie',
    credentialName: '__vercel_session',
    credentialPlaceholder: '__vercel_session=...',
    acceptsFullCookieHeader: true,
    freeTier: false,
  },
  {
    id: 'doubao-web',
    names: names('Dola Web', 'Dola 网页版（字节跳动）', 'Dola Web版', 'Dola 웹'),
    logoProviderId: 'doubao-web',
    website: 'https://www.dola.com',
    defaultModel: 'dola-speed',
    models: models(
      ['dola-speed', 'Dola Speed'],
      ['dola-pro', 'Dola Pro'],
    ),
    credentialKind: 'cookie',
    credentialName: 'sessionid + ttwid + s_v_web_id',
    credentialPlaceholder: 'sessionid=...; ttwid=...; s_v_web_id=...',
    acceptsFullCookieHeader: true,
    freeTier: true,
  },
  {
    id: 'gemini-business',
    names: names(
      'Gemini Business',
      'Gemini 企业版',
      'Gemini Business',
      'Gemini Business',
    ),
    logoProviderId: 'google',
    website: 'https://business.gemini.google',
    defaultModel: 'gemini-3.1-pro',
    models: models(
      ['gemini-3.1-pro', 'Gemini 3.1 Pro'],
      ['gemini-3.5-flash', 'Gemini 3.5 Flash'],
    ),
    credentialKind: 'cookie',
    credentialName: '__Secure-1PSID + __Secure-1PSIDTS',
    credentialPlaceholder: '__Secure-1PSID=...; __Secure-1PSIDTS=...',
    acceptsFullCookieHeader: true,
    freeTier: true,
  },
  {
    id: 'copilot-m365-web',
    names: names(
      'Microsoft 365 Copilot',
      'Microsoft 365 Copilot',
      'Microsoft 365 Copilot',
      'Microsoft 365 Copilot',
    ),
    logoProviderId: 'copilot-m365-web',
    website: 'https://m365.cloud.microsoft/chat',
    defaultModel: 'copilot-m365',
    models: models(['copilot-m365', 'Microsoft 365 Copilot']),
    credentialKind: 'token',
    credentialName: 'access_token + chathubPath',
    credentialPlaceholder: 'access_token=...; chathubPath=...',
    acceptsFullCookieHeader: false,
    credentialSource: 'network',
    freeTier: false,
  },
  {
    id: 'zenmux-free',
    names: names('ZenMux Free', 'ZenMux 免费版', 'ZenMux 無料版', 'ZenMux 무료'),
    logoProviderId: 'zenmux-free',
    website: 'https://zenmux.ai',
    defaultModel: 'deepseek/deepseek-chat',
    models: models(
      ['deepseek/deepseek-chat', 'DeepSeek V3.2'],
      ['deepseek/deepseek-reasoner', 'DeepSeek V3.2 Thinking'],
      ['z-ai/glm-4.7-flash-free', 'GLM 4.7 Flash Free'],
    ),
    credentialKind: 'cookie',
    credentialName: 'full Cookie header',
    credentialPlaceholder: 'Paste the full Cookie header from zenmux.ai',
    acceptsFullCookieHeader: true,
    freeTier: true,
  },
  {
    id: 'adapta-web',
    names: names('Adapta One Web', 'Adapta One 网页版', 'Adapta One Web版', 'Adapta One 웹'),
    logoProviderId: 'adapta-web',
    website: 'https://agent.adapta.one',
    defaultModel: 'adapta-one',
    models: models(
      ['adapta-one', 'Adapta ONE'],
      ['adapta-claude', 'Claude via Adapta'],
      ['adapta-gemini', 'Gemini via Adapta'],
    ),
    credentialKind: 'cookie',
    credentialName: '__client',
    credentialPlaceholder: '__client=...',
    acceptsFullCookieHeader: true,
    freeTier: false,
  },
  {
    id: 'inner-ai',
    names: names('Inner.ai Web', 'Inner.ai 网页版', 'Inner.ai Web版', 'Inner.ai 웹'),
    logoProviderId: 'inner-ai',
    website: 'https://app.innerai.com',
    defaultModel: 'gpt-4o',
    models: models(
      ['gpt-4o', 'GPT-4o'],
      ['claude-sonnet-4-5', 'Claude Sonnet'],
      ['gemini-2.5-pro', 'Gemini 2.5 Pro'],
    ),
    credentialKind: 'token',
    credentialName: 'token + email',
    credentialPlaceholder: 'token_value user@example.com',
    acceptsFullCookieHeader: false,
    credentialSource: 'cookies',
    freeTier: false,
  },
  {
    id: 'venice-web',
    names: names('Venice Web', 'Venice 网页版', 'Venice Web版', 'Venice 웹'),
    logoProviderId: 'venice-web',
    website: 'https://venice.ai',
    defaultModel: 'venice-default',
    models: models(['venice-default', 'Venice Default']),
    credentialKind: 'cookie',
    credentialName: 'session',
    credentialPlaceholder: 'session=... or full Cookie header',
    acceptsFullCookieHeader: true,
    freeTier: true,
  },
] as const

const WEB_SESSION_PROVIDER_BY_ID = new Map(
  WEB_SESSION_PROVIDERS.map((provider) => [provider.id, provider]),
)

export function getWebSessionProvider(
  providerId: string,
): WebSessionProviderDefinition | undefined {
  return WEB_SESSION_PROVIDER_BY_ID.get(providerId as WebSessionProviderId)
}

export function isWebSessionProviderId(
  providerId: string,
): providerId is WebSessionProviderId {
  return WEB_SESSION_PROVIDER_BY_ID.has(providerId as WebSessionProviderId)
}

export function getWebSessionPresetId(providerId: WebSessionProviderId): string {
  return `${WEB_SESSION_PRESET_PREFIX}${providerId}`
}

export function getWebSessionProviderIdFromPreset(
  presetId: string,
): WebSessionProviderId | null {
  if (!presetId.startsWith(WEB_SESSION_PRESET_PREFIX)) return null
  const providerId = presetId.slice(WEB_SESSION_PRESET_PREFIX.length)
  return isWebSessionProviderId(providerId) ? providerId : null
}

export function getWebSessionProviderName(
  provider: WebSessionProviderDefinition,
  locale: string,
): string {
  const normalized = locale === 'zh-CN' ? 'zh' : locale.split('-')[0]
  return provider.names[normalized as WebSessionLocale] ?? provider.names.en
}

export function getWebSessionCredentialSource(
  provider: WebSessionProviderDefinition,
): WebSessionCredentialSource {
  if (provider.credentialSource) return provider.credentialSource
  return provider.credentialKind === 'cookie' ? 'cookies' : 'network'
}
