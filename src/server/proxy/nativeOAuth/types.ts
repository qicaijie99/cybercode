import type {
  OpenAIChatRequest,
  OpenAIChatResponse,
} from '../transform/types.js'
import type {
  ProviderRuntimeAuth,
} from '../../services/providerOAuthService.js'

export type NativeOAuthFetch = typeof fetch

export type NativeOAuthChatInput = {
  providerId: string
  request: OpenAIChatRequest
  auth: ProviderRuntimeAuth
  stream: boolean
  signal?: AbortSignal
  fetchFn?: NativeOAuthFetch
}

export type NativeOAuthChatResult = {
  response: Response
  upstreamIsStream: boolean
}

export type NativeCompletion = {
  content: string
  toolCalls?: OpenAIChatResponse['choices'][number]['message']['tool_calls']
  usage?: OpenAIChatResponse['usage']
  model?: string
}
