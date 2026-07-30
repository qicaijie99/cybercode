import { useEffect, useRef, useState } from 'react'
import type { SourceCostClass } from '../../types/routing'
import { Icon } from '../shared/Icon'

export type ProviderAuthFilter =
  | 'api-key'
  | 'oauth'
  | 'aggregator'
  | 'no-auth'
  | 'web-session'
  | 'local-custom'

export type ProviderModalityFilter =
  | 'language'
  | 'multimodal'
  | 'image'
  | 'video'
  | 'audio'

export type ProviderCatalogFilterState = {
  auth: ProviderAuthFilter[]
  cost: SourceCostClass[]
  modality: ProviderModalityFilter[]
}

export type ProviderCatalogFilterGroup = keyof ProviderCatalogFilterState
export type ProviderCatalogFilterValue =
  | ProviderAuthFilter
  | SourceCostClass
  | ProviderModalityFilter

export type ProviderCatalogFilterCandidate = {
  primarySearchTerms?: readonly (string | undefined)[]
  searchTerms: readonly (string | undefined)[]
  endpointSearchTerms?: readonly (string | undefined)[]
  auth: readonly ProviderAuthFilter[]
  costs: readonly SourceCostClass[]
  modalities: readonly ProviderModalityFilter[]
}

export type RankedProviderCatalogResult = {
  key: string
  score: number
}

export const EMPTY_PROVIDER_CATALOG_FILTERS: ProviderCatalogFilterState = {
  auth: [],
  cost: [],
  modality: [],
}

export const MAX_PROVIDER_SEARCH_RESULTS = 12

export function normalizeProviderSearchQuery(value: string): string {
  return value.trim().normalize('NFKC').toLocaleLowerCase()
}

export function countProviderCatalogFilters(filters: ProviderCatalogFilterState): number {
  return filters.auth.length + filters.cost.length + filters.modality.length
}

function scoreSearchTerm(
  term: string | undefined,
  normalizedQuery: string,
  primary: boolean,
): number {
  if (!term) return 0
  const normalizedTerm = normalizeProviderSearchQuery(term)
  if (!normalizedTerm) return 0

  if (normalizedTerm === normalizedQuery) return primary ? 1_000 : 650
  if (normalizedTerm.startsWith(normalizedQuery)) return primary ? 880 : 560

  const words = normalizedTerm.split(/[\s\-_/.:()[\]{}]+/u).filter(Boolean)
  if (words.some((word) => word.startsWith(normalizedQuery))) {
    return primary ? 820 : 500
  }

  if (normalizedQuery.length >= 3 && normalizedTerm.includes(normalizedQuery)) {
    return primary ? 700 : 360
  }

  const queryWords = normalizedQuery.split(/\s+/u).filter(Boolean)
  if (
    queryWords.length > 1 &&
    queryWords.every((word) => normalizedTerm.includes(word))
  ) {
    return primary ? 660 : 340
  }

  return 0
}

export function scoreProviderCatalogCandidate(
  candidate: ProviderCatalogFilterCandidate,
  normalizedQuery: string,
): number {
  if (!normalizedQuery) return 1

  let bestScore = 0
  for (const term of candidate.primarySearchTerms ?? []) {
    bestScore = Math.max(bestScore, scoreSearchTerm(term, normalizedQuery, true))
  }
  for (const term of candidate.searchTerms) {
    bestScore = Math.max(bestScore, scoreSearchTerm(term, normalizedQuery, false))
  }
  if (/[./:]/u.test(normalizedQuery)) {
    for (const term of candidate.endpointSearchTerms ?? []) {
      bestScore = Math.max(bestScore, scoreSearchTerm(term, normalizedQuery, false))
    }
  }
  return bestScore
}

export function selectMostRelevantProviderResults(
  results: readonly RankedProviderCatalogResult[],
  normalizedQuery: string,
  limit = MAX_PROVIDER_SEARCH_RESULTS,
): ReadonlySet<string> | null {
  if (!normalizedQuery) return null

  const sorted = results
    .filter((result) => result.score > 0)
    .map((result, order) => ({ ...result, order }))
    .sort((left, right) => right.score - left.score || left.order - right.order)
  const bestScore = sorted[0]?.score ?? 0
  const minimumRelevantScore = Math.max(340, bestScore - 320)

  return new Set(
    sorted
      .filter((result) => result.score >= minimumRelevantScore)
      .slice(0, limit)
      .map((result) => result.key),
  )
}

export function matchesProviderCatalogCandidate(
  candidate: ProviderCatalogFilterCandidate,
  normalizedQuery: string,
  filters: ProviderCatalogFilterState,
): boolean {
  if (
    filters.auth.length > 0 &&
    !filters.auth.some((value) => candidate.auth.includes(value))
  ) {
    return false
  }

  if (
    filters.cost.length > 0 &&
    !filters.cost.some((value) => candidate.costs.includes(value))
  ) {
    return false
  }

  if (
    filters.modality.length > 0 &&
    !filters.modality.some((value) => candidate.modalities.includes(value))
  ) {
    return false
  }

  if (!normalizedQuery) return true

  return scoreProviderCatalogCandidate(candidate, normalizedQuery) > 0
}

type FilterOption = {
  value: ProviderCatalogFilterValue
  label: string
}

type FilterGroup = {
  key: ProviderCatalogFilterGroup
  label: string
  options: FilterOption[]
}

type Props = {
  query: string
  filters: ProviderCatalogFilterState
  resultCount: number
  onQueryChange: (query: string) => void
  onToggle: (
    group: ProviderCatalogFilterGroup,
    value: ProviderCatalogFilterValue,
  ) => void
  onClear: () => void
  labels: {
    searchPlaceholder: string
    clearSearch: string
    filter: string
    filterTitle: string
    clearFilters: string
    resultCount: string
    auth: string
    cost: string
    modality: string
    authOptions: Record<ProviderAuthFilter, string>
    costOptions: Record<SourceCostClass, string>
    modalityOptions: Record<ProviderModalityFilter, string>
  }
}

function isSelected(
  filters: ProviderCatalogFilterState,
  group: ProviderCatalogFilterGroup,
  value: ProviderCatalogFilterValue,
): boolean {
  if (group === 'auth') return filters.auth.includes(value as ProviderAuthFilter)
  if (group === 'cost') return filters.cost.includes(value as SourceCostClass)
  return filters.modality.includes(value as ProviderModalityFilter)
}

export function ProviderCatalogFilterBar({
  query,
  filters,
  resultCount,
  onQueryChange,
  onToggle,
  onClear,
  labels,
}: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const activeFilterCount = countProviderCatalogFilters(filters)
  const groups: FilterGroup[] = [
    {
      key: 'auth',
      label: labels.auth,
      options: ([
        'api-key',
        'oauth',
        'aggregator',
        'no-auth',
        'web-session',
        'local-custom',
      ] as const).map((value) => ({ value, label: labels.authOptions[value] })),
    },
    {
      key: 'cost',
      label: labels.cost,
      options: ([
        'paid',
        'uncapped',
        'recurring-free',
        'signup-credit',
        'mixed',
        'unknown',
      ] as const).map((value) => ({ value, label: labels.costOptions[value] })),
    },
    {
      key: 'modality',
      label: labels.modality,
      options: ([
        'language',
        'multimodal',
        'image',
        'video',
        'audio',
      ] as const).map((value) => ({ value, label: labels.modalityOptions[value] })),
    },
  ]

  useEffect(() => {
    if (!open) return

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <div className="grid min-w-0 grid-cols-1 gap-[8px] lg:grid-cols-[1fr_minmax(320px,56%)_1fr] lg:items-center">
      <div aria-hidden="true" className="hidden lg:block" />

      <div className="relative min-w-0 w-full max-w-[640px] justify-self-center">
        <Icon
          name="search"
          size={17}
          className="pointer-events-none absolute left-[13px] top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={labels.searchPlaceholder}
          aria-label={labels.searchPlaceholder}
          className="h-[42px] w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] pl-[40px] pr-[42px] text-[13px] font-medium text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)] focus:shadow-[var(--shadow-focus-ring)]"
        />
        {query && (
          <button
            type="button"
            aria-label={labels.clearSearch}
            title={labels.clearSearch}
            onClick={() => onQueryChange('')}
            className="absolute right-[8px] top-1/2 flex h-[28px] w-[28px] -translate-y-1/2 items-center justify-center rounded-[6px] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
          >
            <Icon name="close" size={14} />
          </button>
        )}
      </div>

      <div className="flex min-w-0 items-center justify-between gap-[8px] lg:justify-end">
        <div ref={rootRef} className="relative shrink-0">
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
            className={`flex h-[42px] min-w-[108px] items-center justify-center gap-[8px] rounded-[8px] border px-[13px] text-[13px] font-semibold transition-colors ${
              open || activeFilterCount > 0
                ? 'border-[#1473e6]/45 bg-[#1473e6]/[0.08] text-[#0b63c9] dark:border-[#68adff]/45 dark:bg-[#68adff]/[0.10] dark:text-[#8bc0ff]'
                : 'border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            <Icon name="filter_list" size={16} />
            <span>{labels.filter}</span>
            {activeFilterCount > 0 && (
              <span className="flex min-w-[20px] items-center justify-center rounded-full bg-[#1473e6] px-[6px] py-[1px] text-[11px] font-bold leading-[18px] text-white dark:bg-[#68adff] dark:text-[#10243d]">
                {activeFilterCount}
              </span>
            )}
          </button>

          {open && (
            <div
              role="dialog"
              aria-label={labels.filterTitle}
              className="absolute right-0 top-[48px] z-[80] w-[min(440px,calc(100vw-48px))] rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-[14px] shadow-[var(--shadow-dropdown)]"
            >
              <div className="mb-[12px] flex items-center justify-between gap-[12px]">
                <div className="min-w-0">
                  <h3 className="text-[14px] font-semibold text-[var(--color-text-primary)]">
                    {labels.filterTitle}
                  </h3>
                  <p className="mt-[2px] text-[11px] text-[var(--color-text-tertiary)]">
                    {labels.resultCount.replace('{count}', String(resultCount))}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={activeFilterCount === 0}
                  onClick={onClear}
                  className="shrink-0 text-[12px] font-semibold text-[#0b63c9] transition-opacity hover:opacity-75 disabled:cursor-default disabled:opacity-35 dark:text-[#8bc0ff]"
                >
                  {labels.clearFilters}
                </button>
              </div>

              <div className="flex flex-col divide-y divide-[var(--color-border-separator)]">
                {groups.map((group) => (
                  <fieldset key={group.key} className="py-[12px] first:pt-0 last:pb-0">
                    <legend className="mb-[8px] text-[12px] font-semibold text-[var(--color-text-secondary)]">
                      {group.label}
                    </legend>
                    <div className="grid grid-cols-2 gap-x-[16px] gap-y-[4px]">
                      {group.options.map((option) => (
                        <label
                          key={option.value}
                          className="flex min-h-[32px] min-w-0 cursor-pointer items-center gap-[8px] rounded-[6px] px-[6px] text-[12px] font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                        >
                          <input
                            type="checkbox"
                            checked={isSelected(filters, group.key, option.value)}
                            onChange={() => onToggle(group.key, option.value)}
                            className="h-[14px] w-[14px] shrink-0 accent-[#1473e6]"
                          />
                          <span className="min-w-0 truncate">{option.label}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
            </div>
          )}
        </div>

        <span
          aria-live="polite"
          className="shrink-0 text-[11px] font-medium tabular-nums text-[var(--color-text-tertiary)] min-w-[76px] text-right"
        >
          {labels.resultCount.replace('{count}', String(resultCount))}
        </span>
      </div>
    </div>
  )
}
