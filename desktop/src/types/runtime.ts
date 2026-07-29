export type DirectRuntimeSelection = {
  kind?: 'direct'
  providerId: string | null
  routeId?: never
  modelId: string
  contextWindow?: number
}

export type RouteRuntimeSelection = {
  kind: 'route'
  providerId: null
  routeId: string
  modelId: string
  contextWindow?: number
}

export type RuntimeSelection = DirectRuntimeSelection | RouteRuntimeSelection
