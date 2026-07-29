import { describe, expect, test } from 'bun:test'
import { parseImCommand } from '../cybercode-channel-runtime.js'

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
