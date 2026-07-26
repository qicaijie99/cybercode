import { executeAmazonQ } from './amazonQ.js'
import { executeAntigravity } from './antigravity.js'
import { executeCursor } from './cursor.js'
import { executeGitLabDuo } from './gitlabDuo.js'
import { executeQoder } from './qoder.js'
import { executeTrae } from './trae.js'
import { executeWindsurf } from './windsurf.js'
import type {
  NativeOAuthChatInput,
  NativeOAuthChatResult,
} from './types.js'

export async function executeNativeOAuthChat(
  input: NativeOAuthChatInput,
): Promise<NativeOAuthChatResult | null> {
  if (input.providerId === 'antigravity' || input.providerId === 'gemini-cli') {
    return executeAntigravity(input)
  }
  if (input.providerId === 'amazon-q') return executeAmazonQ(input)
  if (input.providerId === 'cursor') return executeCursor(input)
  if (input.providerId === 'qoder' && input.auth.token.startsWith('pt-')) {
    return executeQoder(input)
  }
  if (input.providerId === 'trae') return executeTrae(input)
  if (input.providerId === 'windsurf') return executeWindsurf(input)
  if (input.providerId === 'gitlab-duo') return executeGitLabDuo(input)
  return null
}

export type {
  NativeOAuthChatInput,
  NativeOAuthChatResult,
} from './types.js'
