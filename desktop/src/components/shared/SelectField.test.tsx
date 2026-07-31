import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, expect, it, vi } from 'vitest'
import { SelectField } from './SelectField'

const longModelName = 'A deliberately long model display name that must stay inside a compact settings field'

function SelectFieldHarness() {
  const [value, setValue] = useState<'fast' | 'long'>('fast')
  return (
    <SelectField
      label="Model"
      value={value}
      onChange={setValue}
      options={[
        { value: 'fast', label: 'Fast model', description: 'provider/fast' },
        { value: 'long', label: longModelName, description: 'provider/long-model-id' },
      ]}
    />
  )
}

describe('SelectField', () => {
  it('selects an option without using a native select and truncates long labels', () => {
    const { container } = render(<SelectFieldHarness />)

    expect(container.querySelector('select')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Model Fast model' }))

    const longOption = screen.getByRole('option', { name: /A deliberately long model/ })
    expect(longOption.querySelector('[title]')).toHaveClass('truncate')
    fireEvent.click(longOption)

    const trigger = screen.getByRole('button', {
      name: `Model ${longModelName}`,
    })
    expect(trigger).toBeInTheDocument()
    expect(screen.getByTitle(longModelName)).toHaveClass('truncate')
  })

  it('keeps disabled fields closed', () => {
    const onChange = vi.fn()
    render(
      <SelectField
        label="Model"
        value="fast"
        onChange={onChange}
        disabled
        options={[{ value: 'fast', label: 'Fast model' }]}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'Model Fast model' })
    expect(trigger).toBeDisabled()
    fireEvent.click(trigger)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })
})
