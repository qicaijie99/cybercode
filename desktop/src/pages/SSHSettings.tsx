import { useCallback, useEffect, useRef, useState } from 'react'
import type { Terminal as XTermTerminal } from '@xterm/xterm'
import type { FitAddon as XTermFitAddon } from '@xterm/addon-fit'
import { useTranslation } from '../i18n'
import { sshApi, type SSHConnectionConfig } from '../api/ssh'
import { Icon } from '../components/shared/Icon'
import { Button } from '../components/shared/Button'
import { Input } from '../components/shared/Input'

type SSHStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error' | 'unavailable'

function generateId(): string {
  return `ssh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

const EMPTY_FORM: Omit<SSHConnectionConfig, 'id'> = {
  name: '',
  host: '',
  port: 22,
  username: '',
  authType: 'key',
  identityFile: '~/.ssh/id_rsa',
  password: '',
}

export function SSHSettings() {
  const t = useTranslation()
  const [connections, setConnections] = useState<SSHConnectionConfig[]>(() => sshApi.getConnections())
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [activeSession, setActiveSession] = useState<{ id: string; config: SSHConnectionConfig } | null>(null)

  const refreshConnections = useCallback(() => {
    setConnections(sshApi.getConnections())
  }, [])

  const handleSave = useCallback(() => {
    if (!form.name || !form.host || !form.username) return
    const config: SSHConnectionConfig = {
      id: editingId ?? generateId(),
      name: form.name,
      host: form.host,
      port: form.port || 22,
      username: form.username,
      authType: form.authType,
      identityFile: form.authType === 'key' ? form.identityFile : undefined,
      password: form.authType === 'password' ? form.password : undefined,
    }
    sshApi.saveConnection(config)
    refreshConnections()
    setShowForm(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
  }, [form, editingId, refreshConnections])

  const handleEdit = useCallback((conn: SSHConnectionConfig) => {
    setForm({
      name: conn.name,
      host: conn.host,
      port: conn.port,
      username: conn.username,
      authType: conn.authType,
      identityFile: conn.identityFile ?? '~/.ssh/id_rsa',
      password: conn.password ?? '',
    })
    setEditingId(conn.id)
    setShowForm(true)
  }, [])

  const handleDelete = useCallback((id: string) => {
    sshApi.removeConnection(id)
    refreshConnections()
  }, [refreshConnections])

  const handleConnect = useCallback((conn: SSHConnectionConfig) => {
    setActiveSession({ id: conn.id, config: conn })
  }, [])

  const handleDisconnect = useCallback(() => {
    setActiveSession(null)
  }, [])

  if (activeSession) {
    return (
      <SSHTerminal
        config={activeSession.config}
        onDisconnect={handleDisconnect}
      />
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-bold text-[var(--color-text-primary)]">
            {t('settings.ssh.title')}
          </h1>
          <p className="mt-1 text-[13px] text-[var(--color-text-tertiary)]">
            {t('settings.ssh.description')}
          </p>
        </div>
        <Button
          type="button"
          onClick={() => { setShowForm(true); setEditingId(null); setForm(EMPTY_FORM) }}
        >
          <Icon name="add" size={16} />
          {t('settings.ssh.addConnection')}
        </Button>
      </div>

      {showForm && (
        <div className="mb-4 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-4">
          <h3 className="mb-3 text-[14px] font-bold text-[var(--color-text-primary)]">
            {editingId ? t('settings.ssh.editConnection') : t('settings.ssh.newConnection')}
          </h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-[12px] font-medium text-[var(--color-text-secondary)]">
                {t('settings.ssh.name')}
              </label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="My Server"
              />
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium text-[var(--color-text-secondary)]">
                {t('settings.ssh.host')}
              </label>
              <Input
                value={form.host}
                onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
                placeholder="192.168.1.100"
              />
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium text-[var(--color-text-secondary)]">
                {t('settings.ssh.port')}
              </label>
              <Input
                type="number"
                value={String(form.port)}
                onChange={(e) => setForm((f) => ({ ...f, port: Number(e.target.value) || 22 }))}
                placeholder="22"
              />
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium text-[var(--color-text-secondary)]">
                {t('settings.ssh.username')}
              </label>
              <Input
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                placeholder="root"
              />
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium text-[var(--color-text-secondary)]">
                {t('settings.ssh.authType')}
              </label>
              <select
                value={form.authType}
                onChange={(e) => setForm((f) => ({ ...f, authType: e.target.value as 'key' | 'password' }))}
                className="h-9 w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)]"
              >
                <option value="key">{t('settings.ssh.authKey')}</option>
                <option value="password">{t('settings.ssh.authPassword')}</option>
              </select>
            </div>
            {form.authType === 'key' ? (
              <div>
                <label className="mb-1 block text-[12px] font-medium text-[var(--color-text-secondary)]">
                  {t('settings.ssh.identityFile')}
                </label>
                <Input
                  value={form.identityFile ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, identityFile: e.target.value }))}
                  placeholder="~/.ssh/id_rsa"
                />
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-[12px] font-medium text-[var(--color-text-secondary)]">
                  {t('settings.ssh.password')}
                </label>
                <Input
                  type="password"
                  value={form.password ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder="••••••••"
                />
              </div>
            )}
          </div>
          <div className="mt-4 flex gap-2">
            <Button type="button" onClick={handleSave}>
              {t('common.save')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => { setShowForm(false); setEditingId(null) }}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {connections.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-[12px] border border-dashed border-[var(--color-border)] p-12 text-center">
            <Icon name="dns" size={32} className="mb-3 text-[var(--color-text-tertiary)]" />
            <p className="text-[14px] font-medium text-[var(--color-text-primary)]">
              {t('settings.ssh.noConnections')}
            </p>
            <p className="mt-1 text-[13px] text-[var(--color-text-tertiary)]">
              {t('settings.ssh.noConnectionsHint')}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {connections.map((conn) => (
              <div
                key={conn.id}
                className="group rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-4 transition-colors hover:border-[var(--color-primary)]/40"
              >
                <div className="mb-2 flex items-start justify-between">
                  <div className="min-w-0">
                    <h3 className="truncate text-[14px] font-bold text-[var(--color-text-primary)]">
                      {conn.name}
                    </h3>
                    <p className="mt-0.5 truncate font-mono text-[12px] text-[var(--color-text-tertiary)]">
                      {conn.username}@{conn.host}:{conn.port}
                    </p>
                  </div>
                  <span className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                    conn.authType === 'key'
                      ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                      : 'bg-[var(--color-warning)]/10 text-[var(--color-warning)]'
                  }`}>
                    {conn.authType === 'key' ? 'KEY' : 'PWD'}
                  </span>
                </div>
                <div className="mt-3 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => handleConnect(conn)}
                    className="inline-flex h-7 items-center gap-1 rounded-full bg-[var(--color-primary)] px-3 text-[11px] font-bold text-white transition-opacity hover:opacity-90"
                  >
                    <Icon name="play_arrow" size={14} />
                    {t('settings.ssh.connect')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleEdit(conn)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--color-border)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                  >
                    <Icon name="edit" size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(conn.id)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--color-border)] text-[var(--color-error)] transition-colors hover:bg-[var(--color-error)]/10"
                  >
                    <Icon name="delete" size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SSHTerminal({
  config,
  onDisconnect,
}: {
  config: SSHConnectionConfig
  onDisconnect: () => void
}) {
  const t = useTranslation()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<XTermTerminal | null>(null)
  const fitRef = useRef<XTermFitAddon | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const disconnectWsRef = useRef<(() => void) | null>(null)
  const [status, setStatus] = useState<SSHStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const resizeSession = useCallback(() => {
    const terminal = terminalRef.current
    const fit = fitRef.current
    if (!terminal || !fit) return
    fit.fit()
  }, [])

  const connect = useCallback(async () => {
    const host = hostRef.current
    if (!host) return

    setError(null)
    setStatus('connecting')

    if (sessionIdRef.current) {
      await sshApi.disconnect(sessionIdRef.current).catch(() => {})
      sessionIdRef.current = null
    }
    if (disconnectWsRef.current) {
      disconnectWsRef.current()
      disconnectWsRef.current = null
    }
    terminalRef.current?.dispose()
    fitRef.current = null
    host.innerHTML = ''

    const [{ Terminal }, { FitAddon }] = await Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
    ])

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: false,
      fontFamily: "var(--font-mono), 'SFMono-Regular', Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 4000,
      theme: {
        background: '#1a1b26',
        foreground: '#a9b1d6',
        cursor: '#c0caf5',
        selectionBackground: '#33467c',
        black: '#15161e',
        red: '#f7768e',
        green: '#9ece6a',
        yellow: '#e0af68',
        blue: '#7aa2f7',
        magenta: '#bb9af7',
        cyan: '#7dcfff',
        white: '#a9b1d6',
        brightBlack: '#414868',
        brightRed: '#f7768e',
        brightGreen: '#9ece6a',
        brightYellow: '#e0af68',
        brightBlue: '#7aa2f7',
        brightMagenta: '#bb9af7',
        brightCyan: '#7dcfff',
        brightWhite: '#c0caf5',
      },
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(host)
    terminalRef.current = terminal
    fitRef.current = fit
    fit.fit()

    terminal.onData((data) => {
      const sessionId = sessionIdRef.current
      if (sessionId) {
        sshApi.write(sessionId, data)
      }
    })

    try {
      const result = await sshApi.connect({
        host: config.host,
        port: config.port,
        username: config.username,
        identityFile: config.identityFile,
      })
      sessionIdRef.current = result.session_id

      const disconnectWs = sshApi.connectWebSocket(result.session_id, {
        onOutput: (data) => terminal.write(data),
        onExit: (code) => {
          setStatus('disconnected')
          terminal.writeln(`\r\n[SSH session closed: ${code}]`)
          sessionIdRef.current = null
        },
      })
      disconnectWsRef.current = disconnectWs
      setStatus('connected')
      resizeSession()
    } catch (err) {
      terminal.dispose()
      terminalRef.current = null
      fitRef.current = null
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }, [config, resizeSession])

  useEffect(() => {
    void connect()

    const observer = new ResizeObserver(() => resizeSession())
    if (hostRef.current) observer.observe(hostRef.current)

    return () => {
      observer.disconnect()
      const sessionId = sessionIdRef.current
      if (sessionId) {
        void sshApi.disconnect(sessionId).catch(() => {})
      }
      if (disconnectWsRef.current) {
        disconnectWsRef.current()
        disconnectWsRef.current = null
      }
      terminalRef.current?.dispose()
      terminalRef.current = null
      fitRef.current = null
      sessionIdRef.current = null
    }
  }, [connect, resizeSession])

  const statusColor =
    status === 'connected'
      ? 'bg-[var(--color-success)]'
      : status === 'error'
        ? 'bg-[var(--color-error)]'
        : status === 'connecting'
          ? 'bg-[var(--color-warning)]'
          : 'bg-[var(--color-text-tertiary)]'

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onDisconnect}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-2.5 text-[12px] font-bold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
          >
            <Icon name="arrow_back" size={16} />
            {t('settings.ssh.backToList')}
          </button>
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${statusColor}`} />
            <span className="font-mono text-[13px] text-[var(--color-text-primary)]">
              {config.username}@{config.host}:{config.port}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void connect()}
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-2.5 text-[12px] font-bold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
        >
          <Icon name="restart_alt" size={16} />
          {t('settings.ssh.reconnect')}
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-[12px] border border-[var(--color-error)]/20 bg-[var(--color-error)]/10 px-3 py-2 text-[14px] text-[var(--color-error)]">
          {error}
        </div>
      )}

      {status === 'unavailable' ? (
        <div className="flex flex-1 items-center justify-center rounded-[12px] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-8 text-center">
          <div>
            <Icon name="cloud_off" size={18} className="mb-3 block text-[32px] text-[var(--color-text-tertiary)]" />
            <p className="text-[14px] font-medium text-[var(--color-text-primary)]">
              {t('settings.ssh.unavailableTitle')}
            </p>
            <p className="mt-1 text-[14px] text-[var(--color-text-tertiary)]">
              {t('settings.ssh.unavailableBody')}
            </p>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden rounded-[12px] border border-[var(--color-terminal-border)] bg-[#1a1b26]">
          <div className="flex h-8 items-center gap-2 border-b border-[var(--color-terminal-border)] bg-[var(--color-terminal-header)] px-3">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-terminal-danger)]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-terminal-warning)]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-terminal-accent)]" />
            <span className="ml-2 truncate font-mono text-[11px] text-[var(--color-terminal-muted)]">
              SSH — {config.name}
            </span>
          </div>
          <div
            ref={hostRef}
            data-testid="ssh-terminal-host"
            className="h-[calc(100%-2rem)] w-full overflow-hidden p-2"
          />
        </div>
      )}
    </div>
  )
}
