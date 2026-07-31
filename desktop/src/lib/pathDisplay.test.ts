import { describe, expect, it } from 'vitest'
import { basenameForDisplay, compactPathForDisplay } from './pathDisplay'

describe('path display helpers', () => {
  it('handles POSIX and Windows separators consistently', () => {
    expect(basenameForDisplay('/workspace/cybercode')).toBe('cybercode')
    expect(basenameForDisplay('C:\\workspace\\cybercode')).toBe('cybercode')
    expect(compactPathForDisplay('C:\\workspace\\cybercode')).toBe('.../workspace/cybercode')
  })
})
