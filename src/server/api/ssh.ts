import { spawn, type Subprocess } from 'bun'

export type SSHSessionInfo = {
  id: string
  host: string
  port: number
  username: string
  pid: number
  startedAt: number
}

type SSHSession = {
  info: SSHSessionInfo
  proc: Subprocess
  onOutput: ((data: string) => void) | null
  onExit: ((code: number) => void) | null
}

const sessions = new Map<string, SSHSession>()
let counter = 0

function generateSessionId(): string {
  return `ssh-${Date.now()}-${++counter}`
}

function buildSSHArgs(input: {
  host: string
  port: number
  username: string
  identityFile?: string
}): string[] {
  const args: string[] = [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    '-o', 'ConnectTimeout=15',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    '-tt',
  ]

  if (input.port && input.port !== 22) {
    args.push('-p', String(input.port))
  }

  if (input.identityFile) {
    args.push('-i', input.identityFile)
  }

  args.push(`${input.username}@${input.host}`)
  return args
}

export function createSSHSession(input: {
  host: string
  port: number
  username: string
  identityFile?: string
}): SSHSessionInfo {
  const id = generateSessionId()
  const args = buildSSHArgs(input)

  const proc = spawn(['ssh', ...args], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, TERM: 'xterm-256color' },
  })

  const session: SSHSession = {
    info: {
      id,
      host: input.host,
      port: input.port,
      username: input.username,
      pid: proc.pid,
      startedAt: Date.now(),
    },
    proc,
    onOutput: null,
    onExit: null,
  }

  const pump = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value && session.onOutput) {
          session.onOutput(decoder.decode(value, { stream: true }))
        }
      }
    } catch {
      // stream closed
    }
  }

  if (proc.stdout) pump(proc.stdout)
  if (proc.stderr) pump(proc.stderr)

  proc.exited.then((code) => {
    if (session.onExit) session.onExit(code)
    sessions.delete(id)
  })

  sessions.set(id, session)
  return session.info
}

export function writeToSSHSession(id: string, data: string): boolean {
  const session = sessions.get(id)
  if (!session) return false
  const encoder = new TextEncoder()
  const stdin = session.proc.stdin
  if (stdin && typeof stdin.write === 'function') {
    stdin.write(encoder.encode(data))
    return true
  }
  return false
}

export function killSSHSession(id: string): boolean {
  const session = sessions.get(id)
  if (!session) return false
  session.proc.kill()
  sessions.delete(id)
  return true
}

export function getSSHSession(id: string): SSHSession | undefined {
  return sessions.get(id)
}

export function listSSHSessions(): SSHSessionInfo[] {
  return Array.from(sessions.values()).map((s) => s.info)
}

export function setSSHSessionCallbacks(
  id: string,
  onOutput: ((data: string) => void) | null,
  onExit: ((code: number) => void) | null,
): boolean {
  const session = sessions.get(id)
  if (!session) return false
  session.onOutput = onOutput
  session.onExit = onExit
  return true
}

export async function handleSSHApi(req: Request, url: URL, segments: string[]): Promise<Response> {
  const method = req.method

  if (method === 'POST' && segments[2] === 'connect') {
    const body = await req.json() as {
      host: string
      port?: number
      username: string
      identityFile?: string
    }
    if (!body.host || !body.username) {
      return Response.json({ error: 'host and username are required' }, { status: 400 })
    }
    const info = createSSHSession({
      host: body.host,
      port: body.port ?? 22,
      username: body.username,
      identityFile: body.identityFile,
    })
    return Response.json(info)
  }

  if (method === 'POST' && segments[2] === 'write') {
    const body = await req.json() as { sessionId: string; data: string }
    const ok = writeToSSHSession(body.sessionId, body.data)
    if (!ok) return Response.json({ error: 'Session not found' }, { status: 404 })
    return Response.json({ ok: true })
  }

  if (method === 'POST' && segments[2] === 'disconnect') {
    const body = await req.json() as { sessionId: string }
    const ok = killSSHSession(body.sessionId)
    if (!ok) return Response.json({ error: 'Session not found' }, { status: 404 })
    return Response.json({ ok: true })
  }

  if (method === 'GET' && segments[2] === 'sessions') {
    return Response.json(listSSHSessions())
  }

  if (method === 'POST' && segments[2] === 'exec') {
    const body = await req.json() as {
      host: string
      port?: number
      username: string
      identityFile?: string
      command: string
      timeout?: number
    }
    if (!body.host || !body.username || !body.command) {
      return Response.json({ error: 'host, username, and command are required' }, { status: 400 })
    }

    const args = buildSSHArgs({
      host: body.host,
      port: body.port ?? 22,
      username: body.username,
      identityFile: body.identityFile,
    })
    args.push(body.command)

    const timeoutMs = Math.min(body.timeout ?? 30000, 120000)

    try {
      const proc = spawn(['ssh', ...args], {
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, TERM: 'dumb' },
      })

      const timeoutId = setTimeout(() => proc.kill(), timeoutMs)
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])
      clearTimeout(timeoutId)

      return Response.json({ stdout, stderr, exitCode, host: body.host })
    } catch (error) {
      return Response.json({
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 255,
        host: body.host,
      })
    }
  }

  return Response.json({ error: 'Not found' }, { status: 404 })
}
