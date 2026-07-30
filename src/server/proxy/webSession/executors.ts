import type { ExecuteInput } from './vendor/omniroute/open-sse/executors/base.ts'
import { sanitizeErrorMessage } from './vendor/omniroute/open-sse/utils/error.ts'
import type { WebSessionProviderId } from '../../../shared/webSessionProviders.js'
import { ProviderService } from '../../services/providerService.js'

type WebSessionExecutor = {
  execute(input: ExecuteInput): Promise<
    | Response
    | {
        response: Response
        url?: string
        headers?: Record<string, string>
        transformedBody?: unknown
      }
  >
}

type WebSessionExecutorLoader = () => Promise<WebSessionExecutor>

const executorLoaders: Record<WebSessionProviderId, WebSessionExecutorLoader> = {
  'chatgpt-web': async () => new (
    await import('./vendor/omniroute/open-sse/executors/chatgpt-web.ts')
  ).ChatGptWebExecutor(),
  'claude-web': async () => new (
    await import('./vendor/omniroute/open-sse/executors/claude-web.ts')
  ).ClaudeWebExecutor(),
  'gemini-web': async () => new (
    await import('./vendor/omniroute/open-sse/executors/gemini-web.ts')
  ).GeminiWebExecutor(),
  'deepseek-web': async () => new (
    await import('./vendor/omniroute/open-sse/executors/deepseek-web.ts')
  ).DeepSeekWebExecutor(),
  'grok-web': async () => new (
    await import('./vendor/omniroute/open-sse/executors/grok-web.ts')
  ).GrokWebExecutor(),
  'perplexity-web': async () => new (
    await import('./vendor/omniroute/open-sse/executors/perplexity-web.ts')
  ).PerplexityWebExecutor(),
  'copilot-web': async () => new (
    await import('./vendor/omniroute/open-sse/executors/copilot-web.ts')
  ).CopilotWebExecutor(),
  'kimi-web': async () => new (
    await import('./vendor/omniroute/open-sse/executors/kimi-web.ts')
  ).KimiWebExecutor(),
  'qwen-web': async () => new (
    await import('./vendor/omniroute/open-sse/executors/qwen-web.ts')
  ).QwenWebExecutor(),
  'yuanbao-web': async () => new (
    await import('./vendor/omniroute/open-sse/executors/yuanbao-web.ts')
  ).YuanbaoWebExecutor(),
  'poe-web': async () => new (
    await import('./vendor/omniroute/open-sse/executors/poe-web.ts')
  ).PoeWebExecutor(),
  huggingchat: async () => new (
    await import('./vendor/omniroute/open-sse/executors/huggingchat.ts')
  ).HuggingChatExecutor(),
  'muse-spark-web': async () => new (
    await import('./vendor/omniroute/open-sse/executors/muse-spark-web.ts')
  ).MuseSparkWebExecutor(),
  lmarena: async () => new (
    await import('./vendor/omniroute/open-sse/executors/lmarena.ts')
  ).LMArenaExecutor(),
  't3-web': async () => new (
    await import('./vendor/omniroute/open-sse/executors/t3-chat-web.ts')
  ).T3ChatWebExecutor(),
  'blackbox-web': async () => new (
    await import('./vendor/omniroute/open-sse/executors/blackbox-web.ts')
  ).BlackboxWebExecutor(),
  'v0-vercel-web': async () => new (
    await import('./vendor/omniroute/open-sse/executors/v0-vercel-web.ts')
  ).V0VercelWebExecutor(),
  'doubao-web': async () => new (
    await import('./vendor/omniroute/open-sse/executors/doubao-web.ts')
  ).DoubaoWebExecutor(),
  'gemini-business': async () => new (
    await import('./vendor/omniroute/open-sse/executors/gemini-business.ts')
  ).GeminiBusinessExecutor(),
  'copilot-m365-web': async () => new (
    await import('./vendor/omniroute/open-sse/executors/copilot-m365-web.ts')
  ).CopilotM365WebExecutor(),
  'zenmux-free': async () => new (
    await import('./vendor/omniroute/open-sse/executors/zenmux-free.ts')
  ).ZenmuxFreeExecutor(),
  'adapta-web': async () => new (
    await import('./vendor/omniroute/open-sse/executors/adapta-web.ts')
  ).AdaptaWebExecutor(),
  'inner-ai': async () => new (
    await import('./vendor/omniroute/open-sse/executors/inner-ai.ts')
  ).InnerAiExecutor(),
  'venice-web': async () => new (
    await import('./vendor/omniroute/open-sse/executors/venice-web.ts')
  ).VeniceWebExecutor(),
}

const executorPromises = new Map<WebSessionProviderId, Promise<WebSessionExecutor>>()
const providerService = new ProviderService()

function loadExecutor(providerId: WebSessionProviderId): Promise<WebSessionExecutor> {
  const cached = executorPromises.get(providerId)
  if (cached) return cached

  const loading = executorLoaders[providerId]()
  executorPromises.set(providerId, loading)
  void loading.catch(() => {
    if (executorPromises.get(providerId) === loading) {
      executorPromises.delete(providerId)
    }
  })
  return loading
}

function parseCredentialParts(credential: string): Record<string, string> {
  const parts: Record<string, string> = {}
  for (const segment of credential.split(/[;\n]/)) {
    const separator = segment.indexOf('=')
    if (separator <= 0) continue
    const key = segment.slice(0, separator).trim()
    const value = segment.slice(separator + 1).trim()
    if (key && value) parts[key] = value
  }
  return parts
}

function normalizeExecutorCredential(
  providerId: WebSessionProviderId,
  credential: string,
): string {
  if (providerId !== 'perplexity-web') return credential
  const parts = parseCredentialParts(credential)
  return parts['__Secure-next-auth.session-token'] ?? credential
}

export async function executeWebSessionProvider(input: {
  providerId: WebSessionProviderId
  providerRecordId: string
  credential: string
  model: string
  body: unknown
  stream: boolean
  signal?: AbortSignal
}): Promise<Response> {
  const executor = await loadExecutor(input.providerId)
  const credential = normalizeExecutorCredential(input.providerId, input.credential)
  const parts = parseCredentialParts(input.credential)
  const result = await executor.execute({
    model: input.model,
    body: input.body,
    stream: input.stream,
    signal: input.signal,
    credentials: {
      apiKey: credential,
      accessToken: parts.access_token ?? parts.accessToken,
      cookie: input.credential,
      connectionId: input.providerRecordId,
      providerSpecificData: {
        ...parts,
        cookie: input.credential,
      },
    },
    log: {
      warn: (tag, message) => {
        console.warn(`[web-session:${tag}] ${sanitizeErrorMessage(message)}`)
      },
      error: (tag, message) => {
        console.error(`[web-session:${tag}] ${sanitizeErrorMessage(message)}`)
      },
    },
    onCredentialsRefreshed: async (credentials) => {
      const refreshedCredential = typeof credentials.apiKey === 'string'
        ? credentials.apiKey.trim()
        : ''
      if (!refreshedCredential || refreshedCredential === input.credential) return

      try {
        await providerService.refreshWebSessionCredential(
          input.providerRecordId,
          refreshedCredential,
        )
      } catch (error) {
        console.warn(
          `[web-session:credential-refresh] ${sanitizeErrorMessage(error)}`,
        )
      }
    },
  })
  return result instanceof Response ? result : result.response
}
