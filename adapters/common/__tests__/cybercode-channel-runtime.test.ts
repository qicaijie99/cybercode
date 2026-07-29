import { describe, expect, test } from 'bun:test'
import {
  CyberCodeChannelRuntime,
  parseImCommand,
  type ParsedImCommand,
} from '../cybercode-channel-runtime.js'

describe('parseImCommand', () => {
  test('parses slash commands and their arguments', () => {
    expect(parseImCommand('/new cybercode')).toEqual({ name: 'new', argument: 'cybercode' })
    expect(parseImCommand('/allow req-123')).toEqual({ name: 'allow', argument: 'req-123' })
  })

  test('accepts common Chinese command aliases', () => {
    expect(parseImCommand('状态')).toEqual({ name: 'status', argument: undefined })
    expect(parseImCommand('新会话')).toEqual({ name: 'new', argument: undefined })
  })

  test('does not consume ordinary messages', () => {
    expect(parseImCommand('帮我修改这个项目')).toBeNull()
  })
})

describe('CyberCodeChannelRuntime commands', () => {
  test('/new without a default project returns the project picker', async () => {
    const sent: string[] = []
    let deletedChatKey: string | undefined
    let resetChatKey: string | undefined
    let projectRequests = 0
    const runtime = new CyberCodeChannelRuntime({
      platform: 'weixin',
      serverUrl: 'ws://127.0.0.1:3456',
      defaultProjectDir: '',
      transport: {
        textLimit: 1800,
        sendText: async (_chatKey, text) => {
          sent.push(text)
        },
      },
      bridge: {
        resetSession: (chatKey: string) => {
          resetChatKey = chatKey
        },
        destroy: () => {},
      } as any,
      sessionStore: {
        delete: (chatKey: string) => {
          deletedChatKey = chatKey
        },
      } as any,
      httpClient: {
        listRecentProjects: async () => {
          projectRequests += 1
          return [{
            projectPath: '-repo-cybercode',
            realPath: '/repo/cybercode',
            projectName: 'cybercode',
            isGit: true,
            repoName: 'cybercode',
            branch: 'main',
            modifiedAt: new Date().toISOString(),
            sessionCount: 2,
          }]
        },
      } as any,
    })

    try {
      await (runtime as unknown as {
        handleCommand: (chatKey: string, command: ParsedImCommand) => Promise<void>
      }).handleCommand('weixin:account:user', { name: 'new' })

      expect(resetChatKey).toBe('weixin:account:user')
      expect(deletedChatKey).toBe('weixin:account:user')
      expect(projectRequests).toBe(1)
      expect(sent).toHaveLength(1)
      expect(sent[0]).toContain('选择项目')
      expect(sent[0]).toContain('cybercode (main)')
    } finally {
      runtime.destroy()
    }
  })
})
