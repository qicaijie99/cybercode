export function stripCookieInputPrefix(rawValue: string): string {
  return String(rawValue ?? '')
    .trim()
    .replace(/^bearer\s+/i, '')
    .replace(/^cookie:\s*/i, '')
    .trim()
}

export function normalizeSessionCookieHeader(
  rawValue: string,
  defaultCookieName: string,
): string {
  const normalized = stripCookieInputPrefix(rawValue)
  if (!normalized || normalized.includes('=')) return normalized
  return `${defaultCookieName}=${normalized}`
}

export function extractCookieValue(rawValue: string, cookieName: string): string {
  const normalized = stripCookieInputPrefix(rawValue)
  if (!normalized) return ''
  if (!normalized.includes(';')) {
    const prefix = `${cookieName}=`
    return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized
  }
  const escaped = cookieName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return normalized.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;\\s]+)`))?.[1] ?? ''
}

export function buildGrokCookieHeader(rawValue: string): string {
  const sso = extractCookieValue(rawValue, 'sso')
  if (!sso) return ''
  const parts = [`sso=${sso}`]
  for (const name of ['sso-rw', 'cf_clearance', '__cf_bm']) {
    if (!new RegExp(`(?:^|;\\s*)${name}=`).test(rawValue)) continue
    const value = extractCookieValue(rawValue, name)
    if (value) parts.push(`${name}=${value}`)
  }
  return parts.join('; ')
}

export function buildQwenCookieHeader(rawValue: string): string {
  const normalized = stripCookieInputPrefix(rawValue)
  return normalized.includes('=') ? normalized : ''
}

export function extractQwenToken(rawValue: string): string {
  const normalized = stripCookieInputPrefix(rawValue)
  if (!normalized.includes('=')) return normalized
  return normalized.match(/(?:^|;\s*)token=([^;\s]+)/)?.[1] ?? ''
}

export function extractKimiJwt(rawValue: string): string {
  const normalized = stripCookieInputPrefix(rawValue)
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(normalized)) {
    return normalized
  }
  return normalized.match(/(?:^|[\s;])kimi-auth=([^;\s]+)/)?.[1] ?? ''
}

export function normalizeSessionCookieHeaders(
  rawValues: Array<string | null | undefined>,
  defaultCookieName: string,
): string[] {
  return [...new Set(
    rawValues
      .filter((value): value is string => typeof value === 'string')
      .map((value) => normalizeSessionCookieHeader(value, defaultCookieName))
      .filter(Boolean),
  )]
}
