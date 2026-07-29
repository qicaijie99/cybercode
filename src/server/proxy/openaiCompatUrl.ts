export type OpenAICompatibleEndpoint = 'chat/completions' | 'responses' | 'models'

function isExplicitApiRoot(hostname: string, pathname: string): boolean {
  return (
    (hostname === 'models.github.ai' && pathname === '/inference') ||
    (hostname === 'chatgpt.com' && pathname === '/backend-api/codex')
  )
}

function isPerplexityApi(hostname: string): boolean {
  return hostname === 'api.perplexity.ai'
}

export function buildOpenAICompatibleUrl(baseUrl: string, endpoint: OpenAICompatibleEndpoint): string {
  const base = baseUrl.replace(/\/+$/, '')

  try {
    const parsed = new URL(base)
    if (isPerplexityApi(parsed.hostname)) {
      parsed.pathname = endpoint === 'chat/completions'
        ? '/chat/completions'
        : `/v1/${endpoint}`
      parsed.search = ''
      parsed.hash = ''
      return parsed.toString()
    }

    const path = parsed.pathname.replace(/\/+$/, '')
    const alreadyVersioned =
      /\/v\d+(?:beta)?(?:\/openai)?$/.test(path) ||
      isExplicitApiRoot(parsed.hostname, path)
    const suffix = alreadyVersioned ? endpoint : `v1/${endpoint}`

    parsed.pathname = `${path}/${suffix}`.replace(/\/{2,}/g, '/')
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString()
  } catch {
    const alreadyVersioned = /\/v\d+(?:beta)?(?:\/openai)?$/.test(base)
    return `${base}/${alreadyVersioned ? endpoint : `v1/${endpoint}`}`
  }
}
