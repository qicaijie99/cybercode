/**
 * Shared attachment types for IM adapters.
 */

import type { AttachmentRef } from '../ws-bridge.js'
import type { ImPlatform } from '../platform.js'
export type { AttachmentRef }
export type { ImPlatform }

/** Result of downloading an IM resource into the local stage dir. */
export interface LocalAttachment {
  kind: 'image' | 'file'
  name: string        // original filename, or synthesized if none
  path: string        // absolute path on disk (under ~/.cyber/im-downloads)
  size: number        // bytes
  mimeType: string    // detected or provided
  buffer: Buffer      // raw bytes (kept so caller can choose base64 vs path)
}

/** Pending outbound media found in Agent stream output. */
export interface PendingUpload {
  id: string          // fingerprint, used for dedup
  source:
    | { kind: 'base64'; data: string; mime: string }
    | { kind: 'path'; path: string; mime?: string }
    | { kind: 'url'; url: string; mime?: string }
  alt?: string
}
