export type ProviderCredentials = {
  accessToken?: string
  refreshToken?: string
  apiKey?: string
  connectionId?: string
  providerSpecificData?: Record<string, unknown>
  [key: string]: unknown
}

export type ExecutorLog = {
  debug?: (tag: string, message: string) => void
  info?: (tag: string, message: string) => void
  warn?: (tag: string, message: string) => void
  error?: (tag: string, message: string) => void
}

export type ExecuteInput = {
  model: string
  body: unknown
  stream: boolean
  credentials: ProviderCredentials
  signal?: AbortSignal | null
  log?: ExecutorLog | null
  upstreamExtraHeaders?: Record<string, string> | null
  clientHeaders?: Record<string, string> | null
  onCredentialsRefreshed?: (
    credentials: ProviderCredentials,
  ) => Promise<void> | void
}

export function mergeAbortSignals(
  primary: AbortSignal,
  secondary: AbortSignal,
): AbortSignal {
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([primary, secondary])
  }

  const controller = new AbortController()
  const abort = (signal: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(signal.reason)
  }
  if (primary.aborted) abort(primary)
  else primary.addEventListener('abort', () => abort(primary), { once: true })
  if (secondary.aborted) abort(secondary)
  else secondary.addEventListener('abort', () => abort(secondary), { once: true })
  return controller.signal
}

export function mergeUpstreamExtraHeaders(
  headers: Record<string, string>,
  extra?: Record<string, string> | null,
): void {
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (!key || typeof value !== 'string') continue
    headers[key] = value
  }
}

export class BaseExecutor {
  provider: string
  config: Record<string, unknown>

  constructor(provider: string, config: Record<string, unknown>) {
    this.provider = provider
    this.config = config
  }
}
