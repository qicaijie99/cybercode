import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  addInvokedSkill,
  getInvokedSkillsForAgent,
  resetStateForTests,
} from '../bootstrap/state.js'
import {
  GOAL_MODE_MARKER,
  GOAL_STATUS_TOOL_NAME,
  buildGoalContinuationPrompt,
  deactivateGoalMode,
  getGoalResolution,
  isGoalModeActive,
} from './goalMode.js'

describe('Goal mode state', () => {
  beforeEach(() => {
    resetStateForTests()
  })

  afterEach(() => {
    resetStateForTests()
  })

  test('activates only for a goal prompt with the mode marker', () => {
    addInvokedSkill('goal', 'bundled:goal', 'Usage: /goal <objective>', null)
    expect(isGoalModeActive(null)).toBe(false)

    addInvokedSkill(
      'goal',
      'bundled:goal',
      `${GOAL_MODE_MARKER}\nship the editor`,
      null,
    )
    expect(isGoalModeActive(undefined)).toBe(true)
  })

  test('extracts the latest valid GoalStatus resolution', () => {
    expect(
      getGoalResolution([
        {
          type: 'tool_use',
          id: 'goal-1',
          name: GOAL_STATUS_TOOL_NAME,
          input: {
            status: 'complete',
            summary: '  Tests and production build passed.  ',
          },
        },
      ]),
    ).toEqual({
      status: 'complete',
      summary: 'Tests and production build passed.',
    })
  })

  test('does not resolve while other work is still being requested', () => {
    expect(
      getGoalResolution([
        {
          type: 'tool_use',
          id: 'edit-1',
          name: 'Edit',
          input: { file_path: 'src/app.ts' },
        },
        {
          type: 'tool_use',
          id: 'goal-1',
          name: GOAL_STATUS_TOOL_NAME,
          input: {
            status: 'complete',
            summary: 'Done.',
          },
        },
      ]),
    ).toBeUndefined()
  })

  test('deactivation removes only the goal skill for the current agent', () => {
    addInvokedSkill(
      'goal',
      'bundled:goal',
      `${GOAL_MODE_MARKER}\nship`,
      null,
    )
    addInvokedSkill('remember', 'bundled:remember', 'remember this', null)

    deactivateGoalMode(null)

    expect(isGoalModeActive(null)).toBe(false)
    expect(
      [...getInvokedSkillsForAgent(null).values()].map(skill => skill.skillName),
    ).toEqual(['remember'])
  })

  test('continuation nudge requires work instead of another partial summary', () => {
    const prompt = buildGoalContinuationPrompt()

    expect(prompt).toContain('remains active')
    expect(prompt).toContain('Continue working on the original objective')
    expect(prompt).toContain(GOAL_STATUS_TOOL_NAME)
  })
})
