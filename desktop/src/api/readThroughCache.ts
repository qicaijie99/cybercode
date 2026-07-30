export type CachedReadOptions = {
  force?: boolean
}

export function createReadThroughCache<T>(
  loader: () => Promise<T>,
  maxAgeMs = 30_000,
) {
  let value: T | undefined
  let updatedAt = 0
  let generation = 0
  let inFlight: { generation: number; promise: Promise<T> } | null = null

  const read = (options: CachedReadOptions = {}): Promise<T> => {
    const fresh = value !== undefined && Date.now() - updatedAt < maxAgeMs
    if (!options.force && fresh) return Promise.resolve(value as T)
    if (inFlight?.generation === generation) return inFlight.promise

    const requestGeneration = generation
    const request = loader()
      .then((next) => {
        if (generation === requestGeneration) {
          value = next
          updatedAt = Date.now()
        }
        return next
      })
      .finally(() => {
        if (inFlight?.promise === request) inFlight = null
      })
    inFlight = { generation: requestGeneration, promise: request }
    return request
  }

  return {
    read,
    peek: () => value,
    invalidate: () => {
      generation += 1
      updatedAt = 0
      inFlight = null
    },
    prime: (next: T) => {
      generation += 1
      value = next
      updatedAt = Date.now()
      inFlight = null
    },
  }
}
