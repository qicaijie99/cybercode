export class TlsClientUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TlsClientUnavailableError'
  }
}

export type TlsFetchOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
  signal?: AbortSignal | null
  stream?: boolean
  streamEofSymbol?: string
  byteResponse?: boolean
  proxyUrl?: string
}

export type TlsFetchResult = {
  status: number
  headers: Headers
  text: string | null
  body: ReadableStream<Uint8Array> | null
}

export async function fetchWithBrowserSessionCompatibility(
  url: string,
  options: TlsFetchOptions = {},
): Promise<TlsFetchResult> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 300_000)
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: options.headers,
    body: options.body,
    redirect: 'follow',
    signal,
  })

  if (options.stream) {
    return {
      status: response.status,
      headers: response.headers,
      text: null,
      body: response.body,
    }
  }

  return {
    status: response.status,
    headers: response.headers,
    text: await response.text(),
    body: null,
  }
}

export function isCloudflareChallenge(text: string | null | undefined): boolean {
  const normalized = String(text ?? '').toLowerCase()
  return (
    normalized.includes('cf-chl-') ||
    normalized.includes('cloudflare') ||
    normalized.includes('challenge-platform') ||
    normalized.includes('request rejected by anti-bot')
  )
}
