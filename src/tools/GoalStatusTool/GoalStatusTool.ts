import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import {
  GOAL_STATUS_TOOL_NAME,
  isGoalModeActive,
} from '../../skills/goalMode.js'
import { lazySchema } from '../../utils/lazySchema.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    status: z
      .enum(['complete', 'blocked'])
      .describe(
        'Use complete only after every requirement is verified. Use blocked only for a genuine external blocker after viable alternatives are exhausted.',
      ),
    summary: z
      .string()
      .min(1)
      .describe(
        'Concise evidence for completion, or the exact blocker and alternatives already attempted.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.strictObject({
    status: z.enum(['complete', 'blocked']),
    summary: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

const PROMPT = `Resolve an active Goal Mode run.

Call this tool exactly once, as the only tool call in the response, when either:
- every explicit requirement in the original goal is complete and supported by authoritative verification; or
- a genuine external blocker remains after viable alternatives have been exhausted.

Do not call it for plans, progress updates, partial implementations, ordinary uncertainty, test failures that can still be fixed, or work that merely takes more time.`

export const GoalStatusTool = buildTool({
  name: GOAL_STATUS_TOOL_NAME,
  searchHint: 'finish persistent goal mode',
  maxResultSizeChars: 10_000,
  strict: true,
  alwaysLoad: true,
  async description() {
    return PROMPT
  },
  async prompt() {
    return PROMPT
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
    return true
  },
  async validateInput(_input, context) {
    if (isGoalModeActive(context.agentId)) {
      return { result: true }
    }
    return {
      result: false,
      message: 'GoalStatus is available only during an active /goal run.',
      errorCode: 1,
    }
  },
  renderToolUseMessage() {
    return null
  },
  async call(input) {
    return { data: input }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const nextStep =
      output.status === 'complete'
        ? 'Goal completion recorded. Give the user the concise final result and verification evidence.'
        : 'External blocker recorded. Give the user the exact blocker and the work already completed.'
    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: `${nextStep}\n\n${output.summary}`,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
