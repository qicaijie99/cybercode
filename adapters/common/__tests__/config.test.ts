import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../config.js'

const ENV_KEYS = [
  'CYBER_CONFIG_DIR',
  'WEIXIN_ACCOUNT_ID',
  'WEIXIN_BOT_TOKEN',
  'QQBOT_APP_ID',
  'QQBOT_APP_SECRET',
  'DINGTALK_CLIENT_ID',
  'DINGTALK_CLIENT_SECRET',
] as const

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
const tempDirs: string[] = []

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('loadConfig official IM channels', () => {
  it('enables channels when complete credentials come from environment variables', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'cyber-adapter-config-'))
    tempDirs.push(configDir)
    process.env.CYBER_CONFIG_DIR = configDir
    process.env.WEIXIN_ACCOUNT_ID = 'wx-account'
    process.env.WEIXIN_BOT_TOKEN = 'wx-token'
    process.env.QQBOT_APP_ID = 'qq-app'
    process.env.QQBOT_APP_SECRET = 'qq-secret'
    process.env.DINGTALK_CLIENT_ID = 'ding-app'
    process.env.DINGTALK_CLIENT_SECRET = 'ding-secret'

    const config = loadConfig()

    expect(config.weixin.enabled).toBe(true)
    expect(config.qq.enabled).toBe(true)
    expect(config.dingtalk.clientId).toBe('ding-app')
    expect(config.dingtalk.clientSecret).toBe('ding-secret')
  })
})
