const SECRET_PATTERNS = [
  /(__Secure-[^=;\s]+|sessionKey|access_token|userToken|token|cookie)\s*[=:]\s*([^;\s]+)/gi,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
]

export function sanitizeErrorMessage(message: unknown): string {
  let text = message instanceof Error ? message.message : String(message ?? '')
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, (_match, name) => name ? `${name}=<redacted>` : '<redacted>')
  }
  return text.slice(0, 2_000)
}

export function buildErrorBody(
  statusCode: number,
  message: string,
  details?: unknown,
): Record<string, unknown> {
  return {
    error: {
      message: sanitizeErrorMessage(message),
      type: statusCode === 401 || statusCode === 403
        ? 'authentication_error'
        : statusCode === 429
          ? 'rate_limit_error'
          : 'web_session_error',
      ...(details === undefined ? {} : { details }),
    },
  }
}

export function errorResponse(statusCode: number, message: string): Response {
  return Response.json(buildErrorBody(statusCode, message), { status: statusCode })
}

export function makeExecutorErrorResult(
  statusCode: number,
  message: string,
  body: unknown,
  url = '',
) {
  return {
    response: errorResponse(statusCode, message),
    url,
    headers: {},
    transformedBody: body,
  }
}

export function normalizeCookie(raw: string): string {
  return String(raw ?? '')
    .trim()
    .replace(/^cookie:\s*/i, '')
    .replace(/^bearer\s+/i, '')
    .trim()
}
