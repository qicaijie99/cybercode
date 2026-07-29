import { getBaseUrl, getAuthToken } from './client'

export type SSHConnectionConfig = {
  id: string
  name: string
  host: string
  port: number
  username: string
  authType: 'key' | 'password'
  identityFile?: string
  password?: string
}

export type SSHSessionResult = {
  session_id: string
  host: string
  username: string
}

type SSHWebSocketCallbacks = {
  onOutput: (data: string) => void
  onExit: (code: number) => void
}

const STORAGE_KEY = 'cybercode-ssh-connections'

function loadConnections(): SSHConnectionConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as SSHConnectionConfig[]
  } catch {
    return []
  }
}

function saveConnections(connections: SSHConnectionConfig[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(connections))
  } catch { /* noop */ }
}

async function sshFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${getBaseUrl()}${path}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  }
  const token = getAuthToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(url, { ...options, headers })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(body || `SSH API error ${res.status}`)
  }
  return res.json() as Promise<T>
}

const activeWebSockets = new Map<string, WebSocket>()

export const sshApi = {
  isAvailable: () => true,

  getConnections(): SSHConnectionConfig[] {
    return loadConnections()
  },

  saveConnection(config: SSHConnectionConfig) {
    const connections = loadConnections()
    const idx = connections.findIndex((c) => c.id === config.id)
    if (idx >= 0) {
      connections[idx] = config
    } else {
      connections.push(config)
    }
    saveConnections(connections)
  },

  removeConnection(id: string) {
    const connections = loadConnections().filter((c) => c.id !== id)
    saveConnections(connections)
  },

  async connect(input: {
    host: string
    port: number
    username: string
    identityFile?: string
  }): Promise<SSHSessionResult> {
    const result = await sshFetch<{ id: string; host: string; username: string }>('/api/ssh/connect', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    return {
      session_id: result.id,
      host: result.host,
      username: result.username,
    }
  },

  connectWebSocket(sessionId: string, callbacks: SSHWebSocketCallbacks): () => void {
    const wsUrl = getBaseUrl().replace(/^http/, 'ws')
    const token = getAuthToken()
    const url = token
      ? `${wsUrl}/ws-ssh/${sessionId}?token=${token}`
      : `${wsUrl}/ws-ssh/${sessionId}`

    const ws = new WebSocket(url)
    activeWebSockets.set(sessionId, ws)

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string)
        if (msg.type === 'ssh_output') {
          callbacks.onOutput(msg.data)
        } else if (msg.type === 'ssh_exit') {
          callbacks.onExit(msg.code)
        }
      } catch { /* ignore parse errors */ }
    }

    ws.onclose = () => {
      activeWebSockets.delete(sessionId)
      callbacks.onExit(-1)
    }

    ws.onerror = () => {
      callbacks.onExit(-1)
    }

    return () => {
      ws.close()
      activeWebSockets.delete(sessionId)
    }
  },

  write(sessionId: string, data: string) {
    const ws = activeWebSockets.get(sessionId)
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ssh_input', data }))
    }
  },

  resize(_sessionId: string, _cols: number, _rows: number) {
    // resize handled by xterm escape sequences sent through write
  },

  async disconnect(sessionId: string) {
    const ws = activeWebSockets.get(sessionId)
    if (ws) {
      ws.close()
      activeWebSockets.delete(sessionId)
    }
    await sshFetch('/api/ssh/disconnect', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    }).catch(() => {})
  },

  async exec(input: {
    host: string
    port?: number
    username: string
    identityFile?: string
    command: string
    timeout?: number
  }): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return sshFetch('/api/ssh/exec', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },
}
