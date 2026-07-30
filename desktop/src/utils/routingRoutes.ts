import type { RouteProfile, RoutingStrategy } from '../types/routing'

export type RouteBuilderMode = 'balanced' | 'reliable' | 'economy' | 'ordered'

const LEGACY_ROUTES: Record<string, {
  name: string
  strategy: RoutingStrategy
  strictFree: boolean
}> = {
  balanced: { name: 'Balanced', strategy: 'auto', strictFree: false },
  'coding-first': { name: 'Coding first', strategy: 'headroom', strictFree: false },
  'free-first': { name: 'Free first', strategy: 'cost-optimized', strictFree: true },
  fastest: { name: 'Fastest', strategy: 'p2c', strictFree: false },
  stable: { name: 'Stable', strategy: 'lkgp', strictFree: false },
}

export function isUneditedLegacyRouteProfile(
  profile: Pick<RouteProfile, 'id' | 'name' | 'strategy' | 'strictFree'>,
): boolean {
  const legacyRoute = LEGACY_ROUTES[profile.id]
  return (
    legacyRoute?.name === profile.name &&
    legacyRoute.strategy === profile.strategy &&
    legacyRoute.strictFree === profile.strictFree
  )
}

export function routeBuilderModeFor(strategy: RoutingStrategy): RouteBuilderMode {
  if (strategy === 'cost-optimized') return 'economy'
  if (['priority', 'fill-first', 'context-relay'].includes(strategy)) return 'ordered'
  if (['lkgp', 'reset-aware', 'reset-window', 'headroom'].includes(strategy)) return 'reliable'
  return 'balanced'
}

export function createRouteId(name: string, existingIds: string[]): string {
  const base = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'route'
  const used = new Set(existingIds)
  if (!used.has(base)) return base
  let suffix = 2
  while (used.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}
