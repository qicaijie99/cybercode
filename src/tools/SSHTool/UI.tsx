import React from 'react'
import { MessageResponse } from '../../components/MessageResponse.js'
import { TOOL_SUMMARY_MAX_LENGTH } from '../../constants/toolLimits.js'
import { Box, Text } from '../../ink.js'
import type { ToolProgressData } from '../../Tool.js'
import type { ProgressMessage } from '../../types/message.js'
import { truncate } from '../../utils/format.js'
import type { Output } from './SSHTool.js'

export function renderToolUseMessage(
  { host, username, command }: Partial<{ host: string; username: string; command: string }>,
  { verbose }: { theme?: string; verbose: boolean },
): React.ReactNode {
  if (!host) return null
  const target = `${username ?? 'user'}@${host}`
  if (verbose) {
    return `ssh ${target}: "${command ?? ''}"`
  }
  return `${target}`
}

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Text dimColor>Connecting via SSH…</Text>
    </MessageResponse>
  )
}

export function renderToolResultMessage(
  { stdout, stderr, exitCode }: Output,
  _progressMessages: ProgressMessage<ToolProgressData>[],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  if (verbose) {
    return (
      <Box flexDirection="column">
        <MessageResponse height={1}>
          <Text>
            Exit code: <Text bold>{exitCode}</Text>
          </Text>
        </MessageResponse>
        {stdout ? (
          <Box flexDirection="column">
            <Text>{stdout}</Text>
          </Box>
        ) : null}
        {stderr ? (
          <Box flexDirection="column">
            <Text color="red">{stderr}</Text>
          </Box>
        ) : null}
      </Box>
    )
  }
  return (
    <MessageResponse height={1}>
      <Text>
        SSH completed with exit code <Text bold>{exitCode}</Text>
      </Text>
    </MessageResponse>
  )
}

export function renderToolUseErrorMessage(input: {
  host?: string
  command?: string
}): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Text color="red">
        SSH to {input.host ?? 'unknown'} failed
      </Text>
    </MessageResponse>
  )
}

export function getToolUseSummary(
  input: Partial<{ host: string; username: string; command: string }> | undefined,
): string | null {
  if (!input?.host) return null
  const target = `${input.username ?? 'user'}@${input.host}`
  if (input.command) {
    return truncate(`${target}: ${input.command}`, TOOL_SUMMARY_MAX_LENGTH)
  }
  return target
}
