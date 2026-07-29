import { execFile } from 'child_process'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { expandPath } from '../../utils/path.js'
import {
  getSSHPrompt,
  SSH_TOOL_NAME,
} from './prompt.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
} from './UI.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    host: z.string().describe('The hostname or IP address of the remote server'),
    username: z.string().describe('The SSH username for authentication'),
    command: z.string().describe('The command to execute on the remote server'),
    port: z
      .number()
      .optional()
      .describe('SSH port number (default: 22)'),
    identityFile: z
      .string()
      .optional()
      .describe('Path to the private key file for key-based authentication'),
    password: z
      .string()
      .optional()
      .describe('Password for password-based authentication (prefer key-based auth)'),
    timeout: z
      .number()
      .optional()
      .describe('Connection timeout in milliseconds (default: 30000)'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    stdout: z.string().describe('Standard output from the remote command'),
    stderr: z.string().describe('Standard error output from the remote command'),
    exitCode: z.number().describe('Exit code of the remote command'),
    host: z.string().describe('The host that was connected to'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 120_000

function buildSSHArgs(input: {
  host: string
  username: string
  command: string
  port?: number
  identityFile?: string
}): string[] {
  const args: string[] = [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
  ]

  if (input.port) {
    args.push('-p', String(input.port))
  }

  if (input.identityFile) {
    args.push('-i', expandPath(input.identityFile))
  }

  args.push(`${input.username}@${input.host}`, input.command)
  return args
}

function executeSSH(
  args: string[],
  timeoutMs: number,
  signal: AbortSignal,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'ssh',
      args,
      {
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        signal,
      },
      (error, stdout, stderr) => {
        if (error && !('code' in error)) {
          reject(error)
          return
        }
        const exitCode = error && 'code' in error ? (error.code as number) : error ? 1 : 0
        resolve({
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          exitCode,
        })
      },
    )
    child.on('error', reject)
  })
}

export const SSHTool = buildTool({
  name: SSH_TOOL_NAME,
  searchHint: 'execute commands on remote servers via SSH',
  maxResultSizeChars: 30_000,

  async description({ host, username }) {
    return `SSH to ${username}@${host}`
  },

  async prompt() {
    return getSSHPrompt()
  },

  isEnabled() {
    return true
  },

  userFacingName() {
    return 'SSH'
  },

  getToolUseSummary,

  getActivityDescription(input) {
    const summary = getToolUseSummary(input)
    return summary ? `Running SSH: ${summary}` : 'Running SSH command'
  },

  get inputSchema(): InputSchema {
    return inputSchema()
  },

  get outputSchema(): OutputSchema {
    return outputSchema()
  },

  isConcurrencySafe() {
    return true
  },

  isReadOnly() {
    return false
  },

  toAutoClassifierInput(input) {
    return `${input.username}@${input.host}: ${input.command}`
  },

  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolResultMessage,
  renderToolUseErrorMessage,

  extractSearchText({ stdout, stderr }) {
    return stderr ? `${stdout}\n${stderr}` : stdout
  },

  mapToolResultToToolResultBlockParam(
    { stdout, stderr, exitCode, host },
    toolUseID,
  ) {
    const parts = [
      stdout ? `<stdout>\n${stdout}\n</stdout>` : '',
      stderr ? `<stderr>\n${stderr}\n</stderr>` : '',
      `Exit code: ${exitCode}`,
      `Host: ${host}`,
    ].filter(Boolean)

    return {
      tool_use_id: toolUseID,
      type: 'tool_result' as const,
      content: parts.join('\n'),
      is_error: exitCode !== 0,
    }
  },

  async call(input, toolUseContext) {
    const { abortController } = toolUseContext
    const timeoutMs = Math.min(
      input.timeout ?? DEFAULT_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    )

    const args = buildSSHArgs(input)

    try {
      const result = await executeSSH(args, timeoutMs, abortController.signal)
      const data: Output = {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        host: input.host,
      }
      return { data }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const data: Output = {
        stdout: '',
        stderr: `SSH connection failed: ${message}`,
        exitCode: 255,
        host: input.host,
      }
      return { data }
    }
  },
} satisfies ToolDef<InputSchema, Output, never>)
