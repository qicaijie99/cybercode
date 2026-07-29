import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import {
  getInvokedSkillsForAgent,
  removeInvokedSkill,
} from '../bootstrap/state.js'

export const GOAL_SKILL_NAME = 'goal'
export const GOAL_STATUS_TOOL_NAME = 'GoalStatus'
export const GOAL_MODE_MARKER = '<cybercode-goal-mode active="true">'

export type GoalResolution = {
  status: 'complete' | 'blocked'
  summary: string
}

export function isGoalModeActive(
  agentId: string | undefined | null,
): boolean {
  return [...getInvokedSkillsForAgent(agentId).values()].some(
    skill =>
      skill.skillName === GOAL_SKILL_NAME &&
      skill.content.includes(GOAL_MODE_MARKER),
  )
}

export function deactivateGoalMode(
  agentId: string | undefined | null,
): void {
  removeInvokedSkill(GOAL_SKILL_NAME, agentId)
}

export function getGoalResolution(
  toolUseBlocks: readonly ToolUseBlock[],
): GoalResolution | undefined {
  if (
    toolUseBlocks.length !== 1 ||
    toolUseBlocks[0]?.name !== GOAL_STATUS_TOOL_NAME
  ) {
    return undefined
  }

  for (let i = toolUseBlocks.length - 1; i >= 0; i--) {
    const block = toolUseBlocks[i]
    if (
      block?.name !== GOAL_STATUS_TOOL_NAME ||
      typeof block.input !== 'object' ||
      block.input === null
    ) {
      continue
    }

    const input = block.input as Record<string, unknown>
    if (
      (input.status === 'complete' || input.status === 'blocked') &&
      typeof input.summary === 'string' &&
      input.summary.trim()
    ) {
      return {
        status: input.status,
        summary: input.summary.trim(),
      }
    }
  }
  return undefined
}

export function buildGoalContinuationPrompt(): string {
  return `Goal Mode remains active because ${GOAL_STATUS_TOOL_NAME} has not confirmed completion or a true external blocker.

Continue working on the original objective now. Re-check the completion criteria, use tools where useful, fix remaining gaps, and verify the result. Do not repeat a progress summary as a final answer. Call ${GOAL_STATUS_TOOL_NAME} only after the completion audit passes, or after viable alternatives have been exhausted by a genuine external blocker.`
}
