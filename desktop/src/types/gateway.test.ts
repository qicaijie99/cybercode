import { describe, expect, it } from 'vitest'
import { normalizeGatewayStatus } from './gateway'

describe('normalizeGatewayStatus', () => {
  it('migrates a legacy nested single-key status', () => {
    const status = normalizeGatewayStatus({
      baseUrl: 'http://127.0.0.1:3456/v1',
      enabled: true,
      key: {
        id: 'legacy-key',
        name: 'Legacy user',
        prefix: 'cc_legacy',
        createdAt: '2026-07-28T00:00:00.000Z',
        monthlyRequestLimit: 80,
        allowedTargets: ['route/coding'],
        defaultTarget: 'route/coding',
      },
      usage: { month: '2026-07', requests: 9 },
      targets: [{
        id: 'route/coding',
        kind: 'route',
        label: 'Coding',
        description: 'Quality first',
        available: true,
      }],
    })

    expect(status).toMatchObject({
      baseUrl: 'http://127.0.0.1:3456/v1',
      anthropicBaseUrl: 'http://127.0.0.1:3456',
      modelsUrl: 'http://127.0.0.1:3456/v1/models',
      enabled: true,
      keys: [{
        id: 'legacy-key',
        name: 'Legacy user',
        prefix: 'cc_legacy',
        monthlyRequestLimit: 80,
        allowedTargets: ['route/coding'],
        defaultTarget: 'route/coding',
        usage: { month: '2026-07', requests: 9 },
      }],
      targets: [{
        id: 'route/coding',
        publicId: 'route/coding',
      }],
    })
  })

  it('returns a usable empty-key status for an older cache without key fields', () => {
    expect(normalizeGatewayStatus({
      baseUrl: 'http://127.0.0.1:3456/v1',
      enabled: false,
    })).toMatchObject({
      enabled: false,
      keys: [],
      targets: [],
    })
  })

  it('rejects an old model target cache that would expose an internal provider UUID', () => {
    const legacyTarget = {
      id: 'model/9f607f3e-60ad-4c82-b55c-c82f3d9c1d15/kimi-k2.6',
      kind: 'model',
      label: 'kimi-k2.6',
      description: 'Kimi',
      available: true,
      providerId: '9f607f3e-60ad-4c82-b55c-c82f3d9c1d15',
      modelId: 'kimi-k2.6',
    }
    const base = {
      baseUrl: 'http://127.0.0.1:3456/v1',
      enabled: true,
      keys: [],
    }

    expect(normalizeGatewayStatus({
      ...base,
      targets: [legacyTarget],
    })).toBeNull()
    expect(normalizeGatewayStatus({
      ...base,
      targets: [{
        ...legacyTarget,
        publicId: legacyTarget.id,
      }],
    })).toBeNull()
  })

  it('rejects data that cannot be interpreted as a node status', () => {
    expect(normalizeGatewayStatus({ enabled: true })).toBeNull()
    expect(normalizeGatewayStatus(null)).toBeNull()
  })
})
