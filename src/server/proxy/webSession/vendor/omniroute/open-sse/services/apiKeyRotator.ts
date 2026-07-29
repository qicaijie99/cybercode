const indexes = new Map<string, number>()

export function getRotatingApiKey(
  connectionId: string,
  primaryKey: string,
  extraKeys: string[] = [],
): string {
  const keys = [primaryKey, ...extraKeys].map((key) => key.trim()).filter(Boolean)
  if (keys.length <= 1) return keys[0] ?? ''
  const index = indexes.get(connectionId) ?? 0
  indexes.set(connectionId, index + 1)
  return keys[index % keys.length]!
}
