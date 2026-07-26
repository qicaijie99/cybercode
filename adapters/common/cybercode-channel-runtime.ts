import * as path from 'node:path'
import { enqueue } from './chat-queue.js'
import { MessageDedup } from './message-dedup.js'
import { formatImHelp, formatImStatus, formatPermissionRequest, splitMessage } from './format.js'
import { AdapterHttpClient } from './http-client.js'
import { isAllowedUser, tryPair } from './pairing.js'
import type { ImPlatform } from './platform.js'
import { SessionStore } from './session-store.js'
import { WsBridge, type AttachmentRef, type ServerMessage } from './ws-bridge.js'

type ChatRuntimeState = {
  state: 'idle' | 'thinking' | 'streaming' | 'tool_executing' | 'permission_pending'
  verb?: string
  model?: string
  pendingPermissionCount: number
}

export type ChannelTransport = {
  textLimit: number
  sendText: (chatKey: string, text: string) => Promise<void>
  sendTyping?: (chatKey: string) => Promise<void>
  sendPermissionRequest?: (
    chatKey: string,
    text: string,
    requestId: string,
  ) => Promise<void>
}

export type ChannelInboundMessage = {
  messageId: string
  chatKey: string
  userId: string | number
  displayName: string
  text: string
  attachments?: AttachmentRef[]
}

export type ParsedImCommand = {
  name: 'help' | 'new' | 'projects' | 'status' | 'stop' | 'clear' | 'allow' | 'deny'
  argument?: string
}

export function parseImCommand(text: string): ParsedImCommand | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const aliases: Record<string, ParsedImCommand['name']> = {
    '/start': 'help',
    '/help': 'help',
    '/new': 'new',
    '/projects': 'projects',
    '/status': 'status',
    '/stop': 'stop',
    '/clear': 'clear',
    '/allow': 'allow',
    '/deny': 'deny',
    '帮助': 'help',
    '新会话': 'new',
    '项目': 'projects',
    '状态': 'status',
    '停止': 'stop',
    '清空': 'clear',
  }

  const [rawName, ...rest] = trimmed.split(/\s+/)
  const name = aliases[rawName!.toLowerCase()] ?? aliases[rawName!]
  if (!name) return null
  const argument = rest.join(' ').trim()
  return { name, argument: argument || undefined }
}

export class CyberCodeChannelRuntime {
  private readonly bridge: WsBridge
  private readonly dedup = new MessageDedup()
  private readonly sessionStore: SessionStore
  private readonly httpClient: AdapterHttpClient
  private readonly pendingProjectSelection = new Set<string>()
  private readonly runtimeStates = new Map<string, ChatRuntimeState>()
  private readonly accumulatedText = new Map<string, string>()
  private readonly pendingPermissions = new Map<string, string>()

  constructor(private readonly options: {
    platform: ImPlatform
    serverUrl: string
    defaultProjectDir: string
    transport: ChannelTransport
    sessionStore?: SessionStore
    httpClient?: AdapterHttpClient
    bridge?: WsBridge
  }) {
    this.bridge = options.bridge ?? new WsBridge(options.serverUrl, options.platform)
    this.sessionStore = options.sessionStore ?? new SessionStore()
    this.httpClient = options.httpClient ?? new AdapterHttpClient(options.serverUrl)
  }

  async handleIncoming(message: ChannelInboundMessage): Promise<void> {
    if (!this.dedup.tryRecord(`${message.chatKey}:${message.messageId}`)) return

    if (!isAllowedUser(this.options.platform, message.userId)) {
      const paired = tryPair(
        message.text,
        { userId: message.userId, displayName: message.displayName },
        this.options.platform,
      )
      await this.sendText(
        message.chatKey,
        paired
          ? '配对成功。现在可以直接向 CyberCode 发送消息。'
          : '尚未授权。请先在 CyberCode 桌面端连接此账号，或生成配对码后发送给我。',
      )
      return
    }

    await enqueue(message.chatKey, async () => {
      const command = parseImCommand(message.text)
      if (command) {
        await this.handleCommand(message.chatKey, command)
        return
      }

      if (this.pendingProjectSelection.has(message.chatKey)) {
        if (message.text.trim()) {
          await this.startNewSession(message.chatKey, message.text.trim())
        }
        return
      }

      const ready = await this.ensureSession(message.chatKey)
      if (!ready) return
      const attachments = message.attachments ?? []
      const content = message.text || (attachments.length > 0 ? '(用户发送了附件)' : '')
      if (!content && attachments.length === 0) return

      const sent = this.bridge.sendUserMessage(
        message.chatKey,
        content,
        attachments.length > 0 ? attachments : undefined,
      )
      if (!sent) {
        await this.sendText(message.chatKey, '消息发送失败，连接可能已断开。请发送 /new 重新开始。')
      }
    })
  }

  async resolvePermission(
    chatKey: string,
    requestId: string,
    allowed: boolean,
    always = false,
  ): Promise<boolean> {
    if (this.pendingPermissions.get(requestId) !== chatKey) return false
    const sent = this.bridge.sendPermissionResponse(
      chatKey,
      requestId,
      allowed,
      allowed && always ? 'always' : undefined,
    )
    if (!sent) return false

    this.pendingPermissions.delete(requestId)
    const runtime = this.getRuntimeState(chatKey)
    runtime.pendingPermissionCount = Math.max(0, runtime.pendingPermissionCount - 1)
    runtime.state = runtime.pendingPermissionCount > 0 ? 'permission_pending' : 'thinking'
    return true
  }

  destroy(): void {
    this.bridge.destroy()
    this.dedup.destroy()
  }

  private getRuntimeState(chatKey: string): ChatRuntimeState {
    let state = this.runtimeStates.get(chatKey)
    if (!state) {
      state = { state: 'idle', pendingPermissionCount: 0 }
      this.runtimeStates.set(chatKey, state)
    }
    return state
  }

  private clearTransientState(chatKey: string): void {
    this.accumulatedText.delete(chatKey)
    const runtime = this.getRuntimeState(chatKey)
    runtime.state = 'idle'
    runtime.verb = undefined
    runtime.pendingPermissionCount = 0
    for (const [requestId, owner] of this.pendingPermissions) {
      if (owner === chatKey) this.pendingPermissions.delete(requestId)
    }
  }

  private async handleCommand(chatKey: string, command: ParsedImCommand): Promise<void> {
    switch (command.name) {
      case 'help':
        await this.sendText(chatKey, `CyberCode Bot 已就绪。\n\n${formatImHelp()}\n/allow <编号> — 允许一次\n/deny <编号> — 拒绝`)
        return
      case 'new':
        await this.startNewSession(chatKey, command.argument)
        return
      case 'projects':
        await this.showProjectPicker(chatKey)
        return
      case 'status':
        await this.sendText(chatKey, await this.buildStatusText(chatKey))
        return
      case 'stop': {
        const stored = await this.ensureExistingSession(chatKey)
        if (!stored) {
          await this.sendText(chatKey, formatImStatus(null))
          return
        }
        this.bridge.sendStopGeneration(chatKey)
        await this.sendText(chatKey, '已发送停止信号。')
        return
      }
      case 'clear': {
        const stored = await this.ensureExistingSession(chatKey)
        if (!stored) {
          await this.sendText(chatKey, formatImStatus(null))
          return
        }
        this.clearTransientState(chatKey)
        if (!this.bridge.sendUserMessage(chatKey, '/clear')) {
          await this.sendText(chatKey, '无法发送 /clear，请先发送 /new 重新连接会话。')
          return
        }
        await this.sendText(chatKey, '已清空当前会话上下文。')
        return
      }
      case 'allow':
      case 'deny': {
        if (!command.argument) {
          await this.sendText(chatKey, `请发送 /${command.name} <权限编号>。`)
          return
        }
        const resolved = await this.resolvePermission(
          chatKey,
          command.argument,
          command.name === 'allow',
        )
        await this.sendText(chatKey, resolved ? '权限选择已提交。' : '权限请求已失效或不属于当前会话。')
      }
    }
  }

  private async ensureExistingSession(chatKey: string): Promise<{ sessionId: string; workDir: string } | null> {
    const stored = this.sessionStore.get(chatKey)
    if (!stored) return null
    if (!this.bridge.hasSession(chatKey)) {
      this.bridge.connectSession(chatKey, stored.sessionId)
      this.bridge.onServerMessage(chatKey, (message) => {
        void this.handleServerMessage(chatKey, message)
      })
      if (!await this.bridge.waitForOpen(chatKey)) return null
    }
    return stored
  }

  private async ensureSession(chatKey: string): Promise<boolean> {
    if (this.bridge.hasSession(chatKey)) return true
    const stored = this.sessionStore.get(chatKey)
    if (stored) {
      this.bridge.connectSession(chatKey, stored.sessionId)
      this.bridge.onServerMessage(chatKey, (message) => {
        void this.handleServerMessage(chatKey, message)
      })
      return await this.bridge.waitForOpen(chatKey)
    }
    if (this.options.defaultProjectDir) {
      return await this.createSession(chatKey, this.options.defaultProjectDir)
    }
    await this.showProjectPicker(chatKey)
    return false
  }

  private async createSession(chatKey: string, workDir: string): Promise<boolean> {
    try {
      this.bridge.resetSession(chatKey)
      const sessionId = await this.httpClient.createSession(workDir)
      this.sessionStore.set(chatKey, sessionId, workDir)
      this.bridge.connectSession(chatKey, sessionId)
      this.bridge.onServerMessage(chatKey, (message) => {
        void this.handleServerMessage(chatKey, message)
      })
      if (!await this.bridge.waitForOpen(chatKey)) {
        await this.sendText(chatKey, '连接本地服务超时，请重试。')
        return false
      }
      return true
    } catch (error) {
      await this.sendText(
        chatKey,
        `无法创建会话：${error instanceof Error ? error.message : String(error)}`,
      )
      return false
    }
  }

  private async startNewSession(chatKey: string, query?: string): Promise<void> {
    this.bridge.resetSession(chatKey)
    this.sessionStore.delete(chatKey)
    this.pendingProjectSelection.delete(chatKey)
    this.clearTransientState(chatKey)

    if (query) {
      try {
        const { project, ambiguous } = await this.httpClient.matchProject(query)
        if (project) {
          if (await this.createSession(chatKey, project.realPath)) {
            await this.sendText(chatKey, `已新建会话：${project.projectName}${project.branch ? ` (${project.branch})` : ''}`)
          }
          return
        }
        if (ambiguous) {
          const choices = ambiguous.map((project, index) => `${index + 1}. ${project.projectName} — ${project.realPath}`)
          await this.sendText(chatKey, `匹配到多个项目，请输入更精确的名称：\n\n${choices.join('\n')}`)
          return
        }
        await this.sendText(chatKey, `未找到匹配“${query}”的项目。发送 /projects 查看项目列表。`)
      } catch (error) {
        await this.sendText(chatKey, error instanceof Error ? error.message : String(error))
      }
      return
    }

    if (this.options.defaultProjectDir) {
      if (await this.createSession(chatKey, this.options.defaultProjectDir)) {
        await this.sendText(chatKey, '已新建会话，可以开始对话了。')
      }
      return
    }
    await this.showProjectPicker(chatKey)
  }

  private async showProjectPicker(chatKey: string): Promise<void> {
    try {
      const projects = await this.httpClient.listRecentProjects()
      if (projects.length === 0) {
        await this.sendText(chatKey, '没有找到最近项目。请先在桌面端打开项目，或在 IM 设置中配置默认项目。')
        return
      }
      const lines = projects.slice(0, 10).map((project, index) =>
        `${index + 1}. ${project.projectName}${project.branch ? ` (${project.branch})` : ''}\n   ${project.realPath}`,
      )
      this.pendingProjectSelection.add(chatKey)
      await this.sendText(chatKey, `选择项目（回复编号或名称）：\n\n${lines.join('\n\n')}`)
    } catch (error) {
      await this.sendText(chatKey, `无法获取项目列表：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async buildStatusText(chatKey: string): Promise<string> {
    const stored = await this.ensureExistingSession(chatKey)
    if (!stored) return formatImStatus(null)

    const runtime = this.getRuntimeState(chatKey)
    let projectName = path.basename(stored.workDir) || stored.workDir
    let branch: string | null = null
    try {
      const gitInfo = await this.httpClient.getGitInfo(stored.sessionId)
      projectName = gitInfo.repoName || path.basename(gitInfo.workDir) || projectName
      branch = gitInfo.branch
    } catch {
      // Non-git projects still have a useful local status.
    }

    return formatImStatus({
      sessionId: stored.sessionId,
      projectName,
      branch,
      model: runtime.model,
      state: runtime.state,
      verb: runtime.verb,
      pendingPermissionCount: runtime.pendingPermissionCount,
    })
  }

  private async handleServerMessage(chatKey: string, message: ServerMessage): Promise<void> {
    const runtime = this.getRuntimeState(chatKey)
    switch (message.type) {
      case 'status':
        runtime.state = message.state
        runtime.verb = typeof message.verb === 'string' ? message.verb : undefined
        if (message.state === 'thinking') {
          await this.options.transport.sendTyping?.(chatKey).catch(() => {})
        }
        return
      case 'content_delta':
        if (typeof message.text === 'string') {
          runtime.state = 'streaming'
          this.accumulatedText.set(chatKey, (this.accumulatedText.get(chatKey) ?? '') + message.text)
        }
        return
      case 'permission_request': {
        runtime.state = 'permission_pending'
        runtime.pendingPermissionCount += 1
        this.pendingPermissions.set(message.requestId, chatKey)
        const text = `${formatPermissionRequest(message.toolName, message.input, message.requestId)}\n\n也可回复 /allow ${message.requestId} 或 /deny ${message.requestId}`
        if (this.options.transport.sendPermissionRequest) {
          await this.options.transport.sendPermissionRequest(chatKey, text, message.requestId)
        } else {
          await this.sendText(chatKey, text)
        }
        return
      }
      case 'message_complete': {
        runtime.state = 'idle'
        runtime.verb = undefined
        const text = this.accumulatedText.get(chatKey)?.trim()
        this.accumulatedText.delete(chatKey)
        if (text) await this.sendText(chatKey, text)
        return
      }
      case 'error':
        runtime.state = 'idle'
        runtime.verb = undefined
        this.accumulatedText.delete(chatKey)
        await this.sendText(chatKey, `执行失败：${message.message || '未知错误'}`)
        return
      case 'system_notification':
        if (message.subtype === 'init' && message.data && typeof message.data === 'object') {
          const model = (message.data as Record<string, unknown>).model
          if (typeof model === 'string' && model.trim()) runtime.model = model
        }
        return
    }
  }

  private async sendText(chatKey: string, text: string): Promise<void> {
    for (const chunk of splitMessage(text, this.options.transport.textLimit)) {
      await this.options.transport.sendText(chatKey, chunk)
    }
  }
}
