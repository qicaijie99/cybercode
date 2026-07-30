import React from 'react'
import { ProviderSetupWizard } from '../../components/providers/ProviderSetupWizard.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { stripSignatureBlocks } from '../../utils/messages.js'
import {
  setProviderModelAutoSync,
  supportsProviderModelSync,
  syncProviderModels,
} from '../../server/services/providerModelSyncService.js'
import { ProviderService } from '../../server/services/providerService.js'
import type { SavedProvider } from '../../server/types/provider.js'

const PROVIDER_USAGE = [
  'Usage:',
  '/provider',
  '/provider status',
  '/provider sync [provider id or name]',
  '/provider auto-sync on|off [provider id or name]',
].join('\n')

async function resolveProvider(selection: string): Promise<SavedProvider> {
  const { providers, activeId } = await new ProviderService().listProviders()
  const requested = selection.trim()
  const provider = requested
    ? providers.find(item => (
        item.id === requested ||
        item.name.toLowerCase() === requested.toLowerCase()
      ))
    : providers.find(item => item.id === activeId)

  if (!provider) {
    throw new Error(
      requested
        ? `Provider not found: ${requested}`
        : 'No active saved provider. Choose one with /provider first.',
    )
  }
  return provider
}

function formatProviderStatus(providers: SavedProvider[], activeId: string | null): string {
  if (providers.length === 0) {
    return 'No saved model providers. Run /provider to configure one.'
  }
  const lines = providers.map(provider => {
    const active = provider.id === activeId ? '*' : ' '
    const supported = supportsProviderModelSync(provider)
    const sync = !supported
      ? 'sync unavailable'
      : provider.modelSync?.enabled
        ? 'auto-sync on'
        : 'auto-sync off'
    const lastSync = provider.modelSync?.lastSyncedAt
      ? `, last ${new Date(provider.modelSync.lastSyncedAt).toLocaleString()}`
      : ''
    return `${active} ${provider.name} [${provider.id}] · ${provider.models.main} · ${sync}${lastSync}`
  })
  return `Model providers:\n${lines.join('\n')}`
}

export async function runProviderArgs(args: string): Promise<string | null> {
  const trimmed = args.trim()
  if (!trimmed) return null

  const [actionRaw, optionRaw, ...selectionParts] = trimmed.split(/\s+/)
  const action = actionRaw?.toLowerCase()
  if (action === 'status' || action === 'list') {
    const { providers, activeId } = await new ProviderService().listProviders()
    return formatProviderStatus(providers, activeId)
  }

  if (action === 'sync') {
    const provider = await resolveProvider([optionRaw, ...selectionParts].filter(Boolean).join(' '))
    const result = await syncProviderModels(provider.id, { force: true })
    return [
      `Synchronized ${provider.name}: ${result.total} models.`,
      `${result.added} added, ${result.updated} updated, ${result.removed} removed.`,
      `Source: ${result.endpoint}`,
    ].join(' ')
  }

  if (action === 'auto-sync') {
    const enabled = optionRaw?.toLowerCase() === 'on'
      ? true
      : optionRaw?.toLowerCase() === 'off'
        ? false
        : null
    if (enabled === null) return PROVIDER_USAGE
    const provider = await resolveProvider(selectionParts.join(' '))
    await setProviderModelAutoSync(provider.id, enabled)
    if (!enabled) return `Automatic model synchronization is off for ${provider.name}.`

    try {
      const result = await syncProviderModels(provider.id, { force: true })
      return `Automatic model synchronization is on for ${provider.name}; synchronized ${result.total} models now.`
    } catch (error) {
      return `Automatic model synchronization is on for ${provider.name}, but the first sync failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    }
  }

  return PROVIDER_USAGE
}

export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  try {
    const result = await runProviderArgs(args)
    if (result !== null) {
      onDone(result, { display: 'system' })
      return null
    }
  } catch (error) {
    onDone(
      `Provider command failed: ${error instanceof Error ? error.message : String(error)}`,
      { display: 'system' },
    )
    return null
  }

  return <Dialog
    title="Model provider"
    color="permission"
    onCancel={() => onDone('Provider setup dismissed', { display: 'system' })}
  >
    <ProviderSetupWizard
      onComplete={result => {
        context.onChangeAPIKey()
        context.setMessages(stripSignatureBlocks)
        context.setAppState(previous => ({
          ...previous,
          mainLoopModel: result.model,
          mainLoopModelForSession: null,
        }))
        onDone(
          result.isOfficial
            ? 'Switched to Claude Official. Run /login if you are not signed in.'
            : `Switched to ${result.name} (${result.model})`,
          { display: 'system' },
        )
      }}
      onCancel={() => onDone('Provider setup dismissed', { display: 'system' })}
    />
  </Dialog>
}
