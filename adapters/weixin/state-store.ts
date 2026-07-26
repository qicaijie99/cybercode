import * as fs from 'node:fs'
import * as path from 'node:path'
import { getAdapterConfigPath } from '../common/config-home.js'

type WeixinState = {
  getUpdatesBuf: string
  contextTokens: Record<string, string>
}

const EMPTY_STATE: WeixinState = { getUpdatesBuf: '', contextTokens: {} }

export class WeixinStateStore {
  private readonly filePath: string
  private state: WeixinState

  constructor(accountId: string) {
    const safeAccount = accountId.replace(/[^a-zA-Z0-9._-]/g, '_') || 'default'
    this.filePath = getAdapterConfigPath(path.join('weixin', `${safeAccount}.json`))
    this.state = this.load()
  }

  getUpdatesBuf(): string {
    return this.state.getUpdatesBuf
  }

  setUpdatesBuf(value: string): void {
    if (!value || value === this.state.getUpdatesBuf) return
    this.state.getUpdatesBuf = value
    this.save()
  }

  getContextToken(userId: string): string | undefined {
    return this.state.contextTokens[userId]
  }

  setContextToken(userId: string, token: string): void {
    if (!userId || !token || this.state.contextTokens[userId] === token) return
    this.state.contextTokens[userId] = token
    this.save()
  }

  private load(): WeixinState {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<WeixinState>
      return {
        getUpdatesBuf: typeof parsed.getUpdatesBuf === 'string' ? parsed.getUpdatesBuf : '',
        contextTokens: parsed.contextTokens && typeof parsed.contextTokens === 'object'
          ? parsed.contextTokens
          : {},
      }
    } catch {
      return { ...EMPTY_STATE, contextTokens: {} }
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 })
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`
    fs.writeFileSync(temporary, `${JSON.stringify(this.state, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    fs.renameSync(temporary, this.filePath)
  }
}
