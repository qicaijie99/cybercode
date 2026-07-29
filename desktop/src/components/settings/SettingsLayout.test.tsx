import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, expect, it, vi } from 'vitest'
import { SegmentedControl, SettingsRow } from './SettingsLayout'

describe('compact settings layout hooks', () => {
  it('lets rows and segmented controls collapse against their content container', () => {
    const { container } = render(
      <SettingsRow label="Language" hint="Choose a language">
        <SegmentedControl
          items={[
            { value: 'en', label: 'English' },
            { value: 'zh', label: '中文' },
          ]}
          value="en"
          onChange={vi.fn()}
        />
      </SettingsRow>,
    )

    expect(container.querySelector('.settings-row')).toBeInTheDocument()
    expect(container.querySelector('.settings-row-control')).toHaveClass('min-w-0')
    expect(screen.getByRole('button', { name: 'English' }).parentElement).toHaveClass(
      'settings-segmented-control',
      'max-w-full',
      'overflow-x-auto',
    )
  })
})
