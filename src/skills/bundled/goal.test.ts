import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { clearBundledSkills, getBundledSkills } from '../bundledSkills.js'
import { registerGoalSkill } from './goal.js'

describe('bundled /goal', () => {
  beforeEach(() => {
    clearBundledSkills()
  })

  afterEach(() => {
    clearBundledSkills()
  })

  test('is exposed as a user-invocable TUI command', () => {
    registerGoalSkill()

    expect(getBundledSkills()).toContainEqual(
      expect.objectContaining({
        name: 'goal',
        source: 'bundled',
        userInvocable: true,
        argumentHint: '<objective>',
      }),
    )
  })

  test('requires an objective', async () => {
    registerGoalSkill()
    const command = getBundledSkills().find((item) => item.name === 'goal')

    const blocks = await command!.getPromptForCommand('   ', {} as never)

    expect(blocks).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('/goal fix the checkout flow'),
      }),
    ])
  })

  test('turns the objective into a verified persistence contract', async () => {
    registerGoalSkill()
    const command = getBundledSkills().find((item) => item.name === 'goal')

    const blocks = await command!.getPromptForCommand(
      'ship the editor without regressions',
      {} as never,
    )
    const text = blocks[0]?.type === 'text' ? blocks[0].text : ''

    expect(text).toContain('ship the editor without regressions')
    expect(text).toContain('Continue exploring, editing, running tools')
    expect(text).toContain('requirement-by-requirement completion audit')
    expect(text).toContain('This run continues automatically')
    expect(text).toContain('Do not deliver a final answer until GoalStatus')
  })
})
