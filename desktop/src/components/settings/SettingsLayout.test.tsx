import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, expect, it } from 'vitest'
import { SettingsPage } from './SettingsLayout'

describe('SettingsPage', () => {
  it('renders text-only page headers even when an icon prop is provided', () => {
    const { container } = render(
      <SettingsPage icon="dns" title="大模型" description="配置模型供应商">
        <div>content</div>
      </SettingsPage>,
    )

    expect(screen.getByRole('heading', { name: '大模型' })).toBeInTheDocument()
    expect(screen.getByText('配置模型供应商')).toBeInTheDocument()
    expect(container.querySelector('.codicon')).toBeNull()
    expect(container.firstElementChild).toHaveClass('settings-page', 'gap-[20px]')
    expect(screen.getByRole('heading', { name: '大模型' })).toHaveClass('settings-page-title')
    expect(screen.getByRole('heading', { name: '大模型' }).closest('header'))
      .toHaveClass('settings-page-header', 'min-h-[60px]')
  })

  it('supports a full-width workspace layout', () => {
    const { container } = render(
      <SettingsPage title="大模型" layout="workspace">
        <div>模型来源</div>
      </SettingsPage>,
    )

    expect(container.firstElementChild).toHaveAttribute('data-settings-layout', 'workspace')
    expect(container.firstElementChild).toHaveClass('max-w-none')
    expect(container.firstElementChild).not.toHaveClass('max-w-[896px]')
  })
})
