import { useId } from 'react'
import { ChevronDown } from 'lucide-react'
import {
  Dropdown,
  type DropdownItem,
} from './Dropdown'

export type SelectFieldOption<T extends string> = DropdownItem<T>

type SelectFieldProps<T extends string> = {
  label?: string
  value: T
  options: readonly SelectFieldOption<T>[]
  onChange: (value: T) => void
  required?: boolean
  disabled?: boolean
  className?: string
  ariaLabel?: string
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  required = false,
  disabled = false,
  className = '',
  ariaLabel,
}: SelectFieldProps<T>) {
  const generatedId = useId()
  const labelId = `${generatedId}-label`
  const valueId = `${generatedId}-value`
  const selectedOption = options.find((option) => option.value === value)
  const selectedLabel = selectedOption?.label ?? value

  return (
    <div className={`flex min-w-0 flex-col gap-[6px] ${className}`}>
      {label && (
        <span
          id={labelId}
          className="text-[13px] font-bold tracking-normal text-[var(--color-text-primary)]"
          style={{ fontFamily: 'var(--font-label)' }}
        >
          {label}
          {required && <span className="ml-0.5 text-[var(--color-error)]">*</span>}
        </span>
      )}

      <Dropdown
        items={options}
        value={value}
        onChange={onChange}
        width="100%"
        className="block w-full"
        disabled={disabled}
        ariaLabel={ariaLabel ?? label}
        trigger={({ open, menuId }) => (
          <button
            type="button"
            disabled={disabled}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? menuId : undefined}
            aria-labelledby={label ? `${labelId} ${valueId}` : valueId}
            className={`
              group flex h-[42px] w-full min-w-0 items-center gap-[10px] rounded-[8px]
              border bg-[var(--color-surface-container-lowest)] px-[12px] text-left
              text-[13px] font-medium text-[var(--color-text-primary)] outline-none
              transition-[border-color,background-color,box-shadow] duration-150
              hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-container-low)]
              focus-visible:border-[var(--color-border-focus)] focus-visible:shadow-[var(--shadow-focus-ring)]
              disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-[var(--color-border)]
              ${open
                ? 'border-[var(--color-border-focus)] shadow-[var(--shadow-focus-ring)]'
                : 'border-[var(--color-border)]'
              }
            `}
          >
            {selectedOption?.icon && (
              <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[var(--color-text-secondary)]">
                {selectedOption.icon}
              </span>
            )}
            <span
              id={valueId}
              title={selectedLabel}
              className="min-w-0 flex-1 truncate"
            >
              {selectedLabel}
            </span>
            <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[6px] text-[var(--color-text-tertiary)] transition-colors group-hover:bg-[var(--color-surface-hover)] group-hover:text-[var(--color-text-primary)]">
              <ChevronDown
                size={16}
                strokeWidth={2}
                className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </span>
          </button>
        )}
      />
    </div>
  )
}
