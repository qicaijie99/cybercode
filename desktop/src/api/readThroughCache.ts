export type CachedReadOptions = {
  force?: boolean
}

export function createReadThroughCache<T>(
  loader: () => Promise<T>,
  maxAgeMs = 30_000,
) {
  let value: T | undefined
  let updatedAt = 0
  let inFlight: Promise<T> | null = null

  const read = (options: CachedReadOptions = {}): Promise<T> => {
    const fresh = value !== undefined && Date.now() - updatedAt < maxAgeMs
    if (!options.force && fresh) return Promise.resolve(value as T)
    if (inFlight) return inFlight

    const request = loader()
      .then((next) => {
        value = next
        updatedAt = Date.now()
        return next
      })
      .finally(() => {
        if (inFlight === request) inFlight = null
      })
    inFlight = request
    return request
  }

  return {
    read,
    peek: () => value,
    invalidate: () => {
      updatedAt = 0
    },
    prime: (next: T) => {
      value = next
      updatedAt = Date.now()
    },
  }
}
