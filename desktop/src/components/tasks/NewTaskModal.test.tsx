import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAdapterStore } from '../../stores/adapterStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTaskStore } from '../../stores/taskStore'
import { NewTaskModal } from './NewTaskModal'

vi.mock('./PromptEditor', () => ({
  PromptEditor: () => null,
}))

describe('NewTaskModal', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'zh' })
    useSessionStore.setState({
      sessions: [],
      activeSessionId: null,
    })
    useAdapterStore.setState({
      config: {
        feishu: {
          appId: 'legacy-app',
          appSecret: 'legacy-secret',
          allowedUsers: ['ou_legacy'],
        },
      },
      isLoading: false,
      error: null,
      fetchConfig: vi.fn().mockResolvedValue(undefined),
    })
    useTaskStore.setState({
      createTask: vi.fn().mockResolvedValue(undefined),
      updateTask: vi.fn().mockResolvedValue(undefined),
    })
  })

  it('does not offer the retired Feishu notification channel', () => {
    render(<NewTaskModal open onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('checkbox', { name: /完成后推送通知/ }))

    expect(screen.queryByText(/飞书/)).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Telegram/ })).toBeDisabled()
  })
})
