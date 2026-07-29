import {
  listAutoSyncProviders,
  syncProviderModels,
} from './providerModelSyncService.js'
import { registerCleanup } from '../../utils/cleanupRegistry.js'
import { warmModelsDevCatalog } from './modelsDevCatalog.js'

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000
const STARTUP_DELAY_MS = 5_000

let intervalTimer: ReturnType<typeof setInterval> | null = null
let startupTimer: ReturnType<typeof setTimeout> | null = null
let isRunning = false
let cleanupRegistered = false

function configuredIntervalMs(): number {
  const hours = Number.parseInt(process.env.MODEL_SYNC_INTERVAL_HOURS ?? '', 10)
  return Number.isFinite(hours) && hours > 0
    ? hours * 60 * 60 * 1000
    : DEFAULT_INTERVAL_MS
}

export async function runProviderModelSyncCycle(): Promise<void> {
  if (isRunning) return
  isRunning = true
  try {
    await warmModelsDevCatalog().catch((error) => {
      console.warn(
        '[provider-model-sync] Shared model catalog:',
        error instanceof Error ? error.message : error,
      )
    })
    const providers = await listAutoSyncProviders()
    // providers.json is one shared file, so synchronize sequentially.
    for (const provider of providers) {
      try {
        await syncProviderModels(provider.id, { force: true })
      } catch (error) {
        console.warn(
          `[provider-model-sync] ${provider.name}:`,
          error instanceof Error ? error.message : error,
        )
      }
    }
  } finally {
    isRunning = false
  }
}

export function startProviderModelSyncScheduler(): void {
  if (intervalTimer || startupTimer) return
  if (!cleanupRegistered) {
    cleanupRegistered = true
    registerCleanup(async () => {
      stopProviderModelSyncScheduler()
    })
  }

  void warmModelsDevCatalog().catch(() => {
    // Saved provider synchronization still has live endpoints and bundled fallbacks.
  })

  startupTimer = setTimeout(() => {
    startupTimer = null
    void runProviderModelSyncCycle()
  }, STARTUP_DELAY_MS)
  startupTimer.unref?.()

  intervalTimer = setInterval(() => {
    void runProviderModelSyncCycle()
  }, configuredIntervalMs())
  intervalTimer.unref?.()
}

export function stopProviderModelSyncScheduler(): void {
  if (startupTimer) clearTimeout(startupTimer)
  if (intervalTimer) clearInterval(intervalTimer)
  startupTimer = null
  intervalTimer = null
}
