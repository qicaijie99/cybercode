import { describe, expect, test } from 'bun:test'
import { AdapterLoginService } from '../services/adapterLoginService.js'

describe('AdapterLoginService', () => {
  test('returns a preparing session before QR generation finishes', async () => {
    const service = new AdapterLoginService()
    let finishPreparation!: () => void
    const preparation = new Promise<void>((resolve) => {
      finishPreparation = resolve
    })

    const testService = service as unknown as {
      startWeixin: () => Promise<void>
    }
    testService.startWeixin = () => preparation

    const state = await service.start('weixin')

    expect(state.status).toBe('preparing')
    expect(state.sessionId.length).toBeGreaterThan(0)
    finishPreparation()
  })
})
