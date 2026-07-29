import { beforeEach, describe, expect, test } from 'bun:test'
import {
  addInvokedSkill,
  resetStateForTests,
} from '../../bootstrap/state.js'
import { GOAL_MODE_MARKER } from '../../skills/goalMode.js'
import { GoalStatusTool } from './GoalStatusTool.js'

describe('GoalStatusTool', () => {
  beforeEach(() => {
    resetStateForTests()
  })

  test('rejects use outside Goal mode', async () => {
    const result = await GoalStatusTool.validateInput?.(
      { status: 'complete', summary: 'done' },
      { agentId: undefined } as never,
    )

    expect(result).toEqual(
      expect.objectContaining({
        result: false,
        message: expect.stringContaining('/goal'),
      }),
    )
  })

  test('records a verified completion during Goal mode', async () => {
    addInvokedSkill(
      'goal',
      'bundled:goal',
      `${GOAL_MODE_MARKER}\nship`,
      null,
    )
    const input = {
      status: 'complete' as const,
      summary: 'Tests and build passed.',
    }

    expect(
      await GoalStatusTool.validateInput?.(input, {
        agentId: undefined,
      } as never),
    ).toEqual({ result: true })

    const result = await GoalStatusTool.call(
      input,
      {} as never,
      {} as never,
      {} as never,
    )
    expect(result.data).toEqual(input)
    expect(
      GoalStatusTool.mapToolResultToToolResultBlockParam(
        result.data,
        'goal-status-1',
      ),
    ).toEqual(
      expect.objectContaining({
        type: 'tool_result',
        tool_use_id: 'goal-status-1',
        content: expect.stringContaining('Goal completion recorded'),
      }),
    )
  })
})
