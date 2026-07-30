import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'crypto'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { handleAdaptersApi } from '../api/adapters.js'
import { adapterService } from '../services/adapterService.js'
import {
  _resetConfigHomeDirForTesting,
  _setConfigHomeDirHomeForTesting,
} from '../../utils/envUtils.js'

describe('AdapterService', () => {
  let tmpHome: string
  let originalCyberConfigDir: string | undefined
  let originalClaudeConfigDir: string | undefined

  beforeEach(async () => {
    tmpHome = join(tmpdir(), `adapter-service-test-${randomUUID()}`)
    await mkdir(tmpHome, { recursive: true })
    originalCyberConfigDir = process.env.CYBER_CONFIG_DIR
    originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
    delete process.env.CYBER_CONFIG_DIR
    delete process.env.CLAUDE_CONFIG_DIR
    _setConfigHomeDirHomeForTesting(tmpHome)
    _resetConfigHomeDirForTesting()
  })

  afterEach(async () => {
    if (originalCyberConfigDir === undefined) delete process.env.CYBER_CONFIG_DIR
    else process.env.CYBER_CONFIG_DIR = originalCyberConfigDir

    if (originalClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir

    _setConfigHomeDirHomeForTesting(undefined)
    _resetConfigHomeDirForTesting()
    await rm(tmpHome, { recursive: true, force: true })
  })

  test('reads legacy adapter config when the new file is absent', async () => {
    await mkdir(join(tmpHome, '.cyber'), { recursive: true })
    await mkdir(join(tmpHome, '.claude'), { recursive: true })
    await writeFile(
      join(tmpHome, '.claude', 'adapters.json'),
      JSON.stringify({ telegram: { botToken: 'legacy-token' } }),
    )

    const config = await adapterService.getRawConfig()

    expect(config.telegram?.botToken).toBe('legacy-token')
  })

  test('merges legacy adapter config and writes updates to ~/.cyber', async () => {
    await mkdir(join(tmpHome, '.cyber'), { recursive: true })
    await mkdir(join(tmpHome, '.claude'), { recursive: true })
    await writeFile(
      join(tmpHome, '.claude', 'adapters.json'),
      JSON.stringify({ feishu: { appId: 'legacy-app', appSecret: 'legacy-secret' } }),
    )

    await adapterService.updateConfig({ telegram: { botToken: 'new-token' } })

    const written = JSON.parse(
      await readFile(join(tmpHome, '.cyber', 'adapters.json'), 'utf-8'),
    )
    expect(written.feishu.appId).toBe('legacy-app')
    expect(written.telegram.botToken).toBe('new-token')
  })

  test('masks and preserves Weixin, QQ, and DingTalk credentials', async () => {
    await mkdir(join(tmpHome, '.cyber'), { recursive: true })
    await writeFile(
      join(tmpHome, '.cyber', 'adapters.json'),
      JSON.stringify({
        weixin: { enabled: true, accountId: 'wx-bot', botToken: 'weixin-secret-token' },
        qq: { enabled: true, appId: 'qq-app', appSecret: 'qq-secret-value' },
        dingtalk: { clientId: 'ding-app', clientSecret: 'dingtalk-secret-value' },
      }),
    )

    const masked = await adapterService.getConfig()
    expect(masked.weixin?.botToken).toBe('****oken')
    expect(masked.qq?.appSecret).toBe('****alue')
    expect(masked.dingtalk?.clientSecret).toBe('****alue')

    await adapterService.updateConfig({
      weixin: { enabled: false, botToken: masked.weixin?.botToken },
      qq: { groupEnabled: false, appSecret: masked.qq?.appSecret },
      dingtalk: {
        allowedUsers: ['staff-42'],
        clientSecret: masked.dingtalk?.clientSecret,
      },
    })
    const raw = await adapterService.getRawConfig()
    expect(raw.weixin?.botToken).toBe('weixin-secret-token')
    expect(raw.weixin?.enabled).toBe(false)
    expect(raw.qq?.appSecret).toBe('qq-secret-value')
    expect(raw.qq?.groupEnabled).toBe(false)
    expect(raw.dingtalk?.clientSecret).toBe('dingtalk-secret-value')
    expect(raw.dingtalk?.allowedUsers).toEqual(['staff-42'])
  })

  test('accepts combined Weixin, QQ, and DingTalk updates from desktop settings', async () => {
    const url = new URL('http://localhost/api/adapters')
    const request = new Request(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        defaultProjectDir: '/tmp/cybercode-project',
        weixin: { enabled: true, allowedUsers: ['wx-user'] },
        qq: { enabled: true, allowedUsers: ['qq-user'], groupEnabled: true },
        dingtalk: {
          clientId: 'ding-client',
          clientSecret: 'ding-secret',
          allowedUsers: ['ding-user'],
        },
      }),
    })

    const response = await handleAdaptersApi(request, url, ['api', 'adapters'])

    expect(response.status).toBe(200)
    const raw = await adapterService.getRawConfig()
    expect(raw.weixin?.allowedUsers).toEqual(['wx-user'])
    expect(raw.qq?.allowedUsers).toEqual(['qq-user'])
    expect(raw.dingtalk?.clientId).toBe('ding-client')
  })
})
