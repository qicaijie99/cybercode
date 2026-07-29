import {
  startQrConnect,
  type QrConnectCallbacks,
  type QrConnectOptions,
} from '@tencent-connect/qqbot-connector'

export function startQQQrConnect(
  callbacks: QrConnectCallbacks,
  options: QrConnectOptions,
): () => void {
  return startQrConnect(callbacks, options)
}
