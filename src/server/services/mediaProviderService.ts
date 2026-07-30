import * as fs from 'fs/promises'
import * as path from 'path'
import { z } from 'zod'
import {
  MEDIA_PROVIDERS,
  getMediaProvider,
  getMediaProviderKey,
  type MediaProviderDefinition,
  type MediaProviderKind,
} from '../../shared/mediaProviders.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { ApiError } from '../middleware/errorHandler.js'
import { ProviderService } from './providerService.js'

const StoredMediaCredentialSchema = z.object({
  groupId: z.string().min(1),
  values: z.record(z.string(), z.string()),
  updatedAt: z.string(),
})

const StoredMediaSelectionSchema = z.object({
  key: z.string().min(1),
  modelId: z.string().min(1),
  updatedAt: z.string(),
})

const MediaProviderIndexSchema = z.object({
  credentials: z.array(StoredMediaCredentialSchema).default([]),
  selections: z.array(StoredMediaSelectionSchema).default([]),
})

type MediaProviderIndex = z.infer<typeof MediaProviderIndexSchema>
type StoredMediaCredential = z.infer<typeof StoredMediaCredentialSchema>

export type MediaCredentialSource =
  | 'media'
  | 'provider'
  | 'local'
  | 'not-required'
  | 'missing'

export type MediaProviderStatus = {
  key: string
  kind: MediaProviderKind
  providerId: string
  connected: boolean
  configured: boolean
  credentialSource: MediaCredentialSource
  modelId: string
}

export type ResolvedMediaProviderConnection = {
  definition: MediaProviderDefinition
  credentials: Record<string, string>
  credentialSource: MediaCredentialSource
  modelId: string
  connected: boolean
}

export type MediaProviderTestResult = {
  key: string
  kind: MediaProviderKind
  providerId: string
  success: boolean
  latencyMs: number
  verification: 'credential' | 'reachability'
  httpStatus?: number
  error?: string
}

const DEFAULT_INDEX: MediaProviderIndex = {
  credentials: [],
  selections: [],
}

export class MediaProviderService {
  private readonly providerService = new ProviderService()

  private getMediaProviderPath(): string {
    return path.join(getClaudeConfigHomeDir(), 'cybercode', 'media-providers.json')
  }

  private async readIndex(): Promise<MediaProviderIndex> {
    try {
      const filePath = this.getMediaProviderPath()
      const raw = await fs.readFile(filePath, 'utf-8')
      await fs.chmod(filePath, 0o600).catch(() => {})
      return MediaProviderIndexSchema.parse(JSON.parse(raw))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {
          credentials: [],
          selections: [],
        }
      }
      if (error instanceof z.ZodError || error instanceof SyntaxError) {
        throw ApiError.internal(`Invalid media provider configuration: ${error.message}`)
      }
      throw ApiError.internal(`Failed to read media provider configuration: ${error}`)
    }
  }

  private async writeIndex(index: MediaProviderIndex): Promise<void> {
    const filePath = this.getMediaProviderPath()
    const directory = path.dirname(filePath)
    await fs.mkdir(directory, { recursive: true, mode: 0o700 })
    await fs.chmod(directory, 0o700).catch(() => {})

    const tmpPath = `${filePath}.tmp.${Date.now()}`
    try {
      await fs.writeFile(tmpPath, `${JSON.stringify(index, null, 2)}\n`, {
        encoding: 'utf-8',
        mode: 0o600,
      })
      await fs.rename(tmpPath, filePath)
      await fs.chmod(filePath, 0o600).catch(() => {})
    } catch (error) {
      await fs.unlink(tmpPath).catch(() => {})
      throw ApiError.internal(`Failed to save media provider configuration: ${error}`)
    }
  }

  async getStatuses(): Promise<MediaProviderStatus[]> {
    const [index, providerIndex] = await Promise.all([
      this.readIndex(),
      this.providerService.listProviders(),
    ])

    return MEDIA_PROVIDERS.map((definition) => {
      const resolved = this.resolveFromIndexes(definition, index, providerIndex.providers)
      return this.toStatus(resolved)
    })
  }

  async resolveConnection(
    kind: MediaProviderKind,
    providerId: string,
  ): Promise<ResolvedMediaProviderConnection> {
    const definition = getMediaProvider(kind, providerId)
    if (!definition) throw ApiError.notFound(`Unknown media provider: ${kind}/${providerId}`)

    const [index, providerIndex] = await Promise.all([
      this.readIndex(),
      this.providerService.listProviders(),
    ])
    return this.resolveFromIndexes(definition, index, providerIndex.providers)
  }

  async saveConnection(
    kind: MediaProviderKind,
    providerId: string,
    input: {
      credentials?: Record<string, string>
      modelId?: string
    },
  ): Promise<MediaProviderStatus> {
    const definition = getMediaProvider(kind, providerId)
    if (!definition) throw ApiError.notFound(`Unknown media provider: ${kind}/${providerId}`)

    const selectedModel = input.modelId?.trim() || definition.defaultModel
    if (!definition.models.some((model) => model.id === selectedModel)) {
      throw ApiError.badRequest(`Unsupported model for ${kind}/${providerId}: ${selectedModel}`)
    }

    const [index, providerIndex] = await Promise.all([
      this.readIndex(),
      this.providerService.listProviders(),
    ])
    const knownFields = new Set(definition.credentialFields.map((field) => field.id))
    for (const fieldId of Object.keys(input.credentials ?? {})) {
      if (!knownFields.has(fieldId)) {
        throw ApiError.badRequest(`Unknown credential field for ${providerId}: ${fieldId}`)
      }
    }

    const currentCredential = index.credentials.find(
      (credential) => credential.groupId === definition.credentialGroupId,
    )
    const nextValues = { ...(currentCredential?.values ?? {}) }
    for (const [fieldId, rawValue] of Object.entries(input.credentials ?? {})) {
      const value = rawValue.trim()
      if (value) nextValues[fieldId] = value
    }

    const now = new Date().toISOString()
    if (Object.keys(nextValues).length > 0) {
      const credential: StoredMediaCredential = {
        groupId: definition.credentialGroupId,
        values: nextValues,
        updatedAt: now,
      }
      const credentialIndex = index.credentials.findIndex(
        (entry) => entry.groupId === definition.credentialGroupId,
      )
      if (credentialIndex >= 0) index.credentials[credentialIndex] = credential
      else index.credentials.push(credential)
    }

    const key = getMediaProviderKey(kind, providerId)
    const selection = { key, modelId: selectedModel, updatedAt: now }
    const selectionIndex = index.selections.findIndex((entry) => entry.key === key)
    if (selectionIndex >= 0) index.selections[selectionIndex] = selection
    else index.selections.push(selection)

    const resolved = this.resolveFromIndexes(definition, index, providerIndex.providers)
    if (!resolved.connected) {
      throw ApiError.badRequest('Required media provider credentials are missing')
    }

    await this.writeIndex(index)
    return this.toStatus(resolved)
  }

  async disconnect(
    kind: MediaProviderKind,
    providerId: string,
  ): Promise<void> {
    const definition = getMediaProvider(kind, providerId)
    if (!definition) throw ApiError.notFound(`Unknown media provider: ${kind}/${providerId}`)

    const index = await this.readIndex()
    const key = getMediaProviderKey(kind, providerId)
    index.credentials = index.credentials.filter(
      (credential) => credential.groupId !== definition.credentialGroupId,
    )
    index.selections = index.selections.filter((selection) => selection.key !== key)
    await this.writeIndex(index)
  }

  async testConnection(
    kind: MediaProviderKind,
    providerId: string,
    signal?: AbortSignal,
  ): Promise<MediaProviderTestResult> {
    const resolved = await this.resolveConnection(kind, providerId)
    const key = getMediaProviderKey(kind, providerId)
    if (!resolved.connected) {
      return {
        key,
        kind,
        providerId,
        success: false,
        latencyMs: 0,
        verification: 'reachability',
        error: 'Media provider is not configured',
      }
    }

    const test = resolved.definition.test ?? {
      url: new URL(resolved.definition.baseUrl).origin,
      method: 'HEAD' as const,
      auth: { type: 'none' as const },
    }
    const headers = this.buildTestHeaders(test.auth, resolved.credentials)
    const startedAt = Date.now()
    const timeoutSignal = AbortSignal.timeout(12_000)
    const requestSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal

    try {
      const response = await fetch(test.url, {
        method: test.method ?? 'GET',
        headers,
        redirect: 'follow',
        signal: requestSignal,
      })
      const latencyMs = Date.now() - startedAt
      const rejected = [401, 403, 407].includes(response.status)
      const serverFailure = response.status >= 500
      const sentCredential = test.auth.type !== 'none'
      const verifiedCredential = sentCredential && response.ok

      if (rejected || serverFailure) {
        return {
          key,
          kind,
          providerId,
          success: false,
          latencyMs,
          verification: sentCredential ? 'credential' : 'reachability',
          httpStatus: response.status,
          error: `HTTP ${response.status}`,
        }
      }

      return {
        key,
        kind,
        providerId,
        success: true,
        latencyMs,
        verification: verifiedCredential ? 'credential' : 'reachability',
        httpStatus: response.status,
      }
    } catch (error) {
      return {
        key,
        kind,
        providerId,
        success: false,
        latencyMs: Date.now() - startedAt,
        verification: test.auth.type === 'none' ? 'reachability' : 'credential',
        error: this.sanitizeError(error instanceof Error ? error.message : String(error)),
      }
    }
  }

  private resolveFromIndexes(
    definition: MediaProviderDefinition,
    index: MediaProviderIndex,
    savedProviders: Array<{ presetId: string; apiKey: string }>,
  ): ResolvedMediaProviderConnection {
    const key = getMediaProviderKey(definition.kind, definition.id)
    const modelId = index.selections.find((selection) => selection.key === key)?.modelId ??
      definition.defaultModel

    if (definition.connectionMode === 'none') {
      return {
        definition,
        credentials: {},
        credentialSource: 'not-required',
        modelId,
        connected: true,
      }
    }

    if (definition.connectionMode === 'local') {
      return {
        definition,
        credentials: {},
        credentialSource: 'local',
        modelId,
        connected: true,
      }
    }

    const stored = index.credentials.find(
      (credential) => credential.groupId === definition.credentialGroupId,
    )
    if (stored && this.hasRequiredCredentials(definition, stored.values)) {
      return {
        definition,
        credentials: stored.values,
        credentialSource: 'media',
        modelId,
        connected: true,
      }
    }

    const sharedProvider = savedProviders.find(
      (provider) => (
        definition.sharedPresetIds.includes(provider.presetId) &&
        Boolean(provider.apiKey.trim())
      ),
    )
    const sharedCredentials = sharedProvider
      ? { apiKey: sharedProvider.apiKey.trim() }
      : {}
    if (this.hasRequiredCredentials(definition, sharedCredentials)) {
      return {
        definition,
        credentials: sharedCredentials,
        credentialSource: 'provider',
        modelId,
        connected: true,
      }
    }

    return {
      definition,
      credentials: stored?.values ?? {},
      credentialSource: 'missing',
      modelId,
      connected: false,
    }
  }

  private hasRequiredCredentials(
    definition: MediaProviderDefinition,
    credentials: Record<string, string>,
  ): boolean {
    return definition.credentialFields.every(
      (field) => !field.required || Boolean(credentials[field.id]?.trim()),
    )
  }

  private toStatus(resolved: ResolvedMediaProviderConnection): MediaProviderStatus {
    return {
      key: getMediaProviderKey(resolved.definition.kind, resolved.definition.id),
      kind: resolved.definition.kind,
      providerId: resolved.definition.id,
      connected: resolved.connected,
      configured: (
        resolved.credentialSource === 'media' ||
        resolved.credentialSource === 'provider'
      ),
      credentialSource: resolved.credentialSource,
      modelId: resolved.modelId,
    }
  }

  private buildTestHeaders(
    auth: NonNullable<MediaProviderDefinition['test']>['auth'],
    credentials: Record<string, string>,
  ): Headers {
    const headers = new Headers({ Accept: 'application/json' })
    if (auth.type === 'none') return headers

    const credential = credentials[auth.fieldId]?.trim()
    if (!credential) return headers
    if (auth.type === 'bearer') {
      headers.set('Authorization', `Bearer ${credential}`)
    } else if (auth.type === 'basic') {
      headers.set('Authorization', `Basic ${Buffer.from(credential).toString('base64')}`)
    } else {
      headers.set(auth.headerName, `${auth.prefix ?? ''}${credential}`)
    }
    return headers
  }

  private sanitizeError(value: string): string {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer <redacted>')
      .replace(/(api[-_ ]?key|secret(?:id|key)?)\s*[=:]\s*[^;\s"']+/gi, '$1=<redacted>')
      .slice(0, 500)
  }
}
