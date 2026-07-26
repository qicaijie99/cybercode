const CLOUDFLARE_WORKERS_AI_PREFIX =
  'https://api.cloudflare.com/client/v4/accounts'
const CLOUDFLARE_WORKERS_AI_SUFFIX = 'ai/v1'

export const CLOUDFLARE_ACCOUNT_ID_PLACEHOLDER = 'ACCOUNT_ID'

export function buildCloudflareWorkersAiBaseUrl(accountId: string): string {
  const resolvedAccountId = accountId.trim() || CLOUDFLARE_ACCOUNT_ID_PLACEHOLDER
  return `${CLOUDFLARE_WORKERS_AI_PREFIX}/${resolvedAccountId}/${CLOUDFLARE_WORKERS_AI_SUFFIX}`
}

export function extractCloudflareAccountId(baseUrl: string): string {
  try {
    const pathname = new URL(baseUrl).pathname
    const match = pathname.match(
      /^\/client\/v4\/accounts\/([^/]+)\/ai\/v1\/?$/i,
    )
    const accountId = match?.[1] ?? ''
    return accountId.toUpperCase() === CLOUDFLARE_ACCOUNT_ID_PLACEHOLDER
      ? ''
      : accountId
  } catch {
    return ''
  }
}

export function isValidCloudflareAccountId(accountId: string): boolean {
  return /^[a-f0-9]{32}$/i.test(accountId.trim())
}
