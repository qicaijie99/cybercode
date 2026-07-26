import { registerBundledSkill } from '../bundledSkills.js'
import {
  GOAL_MODE_MARKER,
  GOAL_STATUS_TOOL_NAME,
} from '../goalMode.js'

const MISSING_OBJECTIVE_MESSAGE = `Provide the objective CyberCode should keep pursuing.

Examples:
  /goal fix the checkout flow and verify it end to end
  /goal migrate this project to React 19 without regressions
  /goal make all tests pass and confirm the production build`

export function buildGoalPrompt(objective: string): string {
  return `${GOAL_MODE_MARKER}

# Goal Mode

You are now responsible for carrying the following objective through to a verified result.

## Objective

${objective}

## Operating Contract

1. Keep the full objective active for this entire run. Do not quietly narrow, replace, or weaken it.
2. Derive concrete completion criteria from the objective and inspect the current state before relying on assumptions or earlier progress.
3. Work autonomously. Continue exploring, editing, running tools, fixing failures, and re-verifying while useful work remains.
4. Do not stop at analysis, a plan, a partial implementation, or a plausible-looking result. Do not end the turn merely because one attempt failed.
5. For multi-step work, maintain a task list and keep it current. Treat tests and builds as evidence only when they cover the requested behavior.
6. Before declaring success, perform a requirement-by-requirement completion audit against authoritative evidence such as source files, command output, tests, builds, or rendered behavior.
7. If evidence is missing or indirect, continue working. Only conclude that the goal is complete when every explicit requirement is satisfied and verified.
8. If a true external blocker remains after exhausting viable alternatives, report the exact blocker and the concrete work already completed. Do not use uncertainty or difficulty as a reason to stop.

## Completion Protocol

- This run continues automatically until you resolve it with ${GOAL_STATUS_TOOL_NAME}.
- After the completion audit passes, call ${GOAL_STATUS_TOOL_NAME} as the only tool in that response, with \`status: "complete"\` and a concise evidence summary.
- If and only if a true external blocker remains after viable alternatives are exhausted, call ${GOAL_STATUS_TOOL_NAME} with \`status: "blocked"\` and describe the exact blocker and attempted alternatives.
- Do not call ${GOAL_STATUS_TOOL_NAME} for plans, progress updates, partial work, fixable failures, or uncertainty.

Do not deliver a final answer until ${GOAL_STATUS_TOOL_NAME} has accepted the verified completion or true external blocker.`
}

export function registerGoalSkill(): void {
  registerBundledSkill({
    name: 'goal',
    description:
      'Keep working autonomously until an objective is fully implemented and verified.',
    whenToUse:
      'Use when the user explicitly wants CyberCode to persist until a concrete objective is achieved.',
    argumentHint: '<objective>',
    allowedTools: [GOAL_STATUS_TOOL_NAME],
    userInvocable: true,
    disableModelInvocation: true,
    async getPromptForCommand(args) {
      const objective = args.trim()
      if (!objective) {
        return [{ type: 'text', text: MISSING_OBJECTIVE_MESSAGE }]
      }
      return [{ type: 'text', text: buildGoalPrompt(objective) }]
    },
  })
}
