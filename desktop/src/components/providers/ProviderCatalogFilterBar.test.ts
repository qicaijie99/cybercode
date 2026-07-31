import { describe, expect, it } from 'vitest'
import {
  MAX_PROVIDER_SEARCH_RESULTS,
  matchesProviderCatalogCandidate,
  normalizeProviderSearchQuery,
  scoreProviderCatalogCandidate,
  selectMostRelevantProviderResults,
  type ProviderCatalogFilterCandidate,
} from './ProviderCatalogFilterBar'

function candidate(
  primarySearchTerms: string[],
  searchTerms: string[] = [],
): ProviderCatalogFilterCandidate {
  return {
    primarySearchTerms,
    searchTerms,
    auth: ['api-key'],
    costs: ['paid'],
    modalities: ['language'],
  }
}

describe('provider catalog relevance', () => {
  it('applies selected filters without requiring a search query', () => {
    const oauthCandidate: ProviderCatalogFilterCandidate = {
      ...candidate(['Claude']),
      auth: ['oauth'],
      costs: ['recurring-free'],
      modalities: ['language', 'multimodal'],
    }

    expect(matchesProviderCatalogCandidate(oauthCandidate, '', {
      auth: ['oauth'],
      cost: [],
      modality: [],
    })).toBe(true)
    expect(matchesProviderCatalogCandidate(oauthCandidate, '', {
      auth: [],
      cost: ['recurring-free'],
      modality: [],
    })).toBe(true)
    expect(matchesProviderCatalogCandidate(oauthCandidate, '', {
      auth: [],
      cost: [],
      modality: ['multimodal'],
    })).toBe(true)
    expect(matchesProviderCatalogCandidate(oauthCandidate, '', {
      auth: ['api-key'],
      cost: [],
      modality: [],
    })).toBe(false)
  })

  it('keeps custom and local access filters independent', () => {
    const customCandidate: ProviderCatalogFilterCandidate = {
      ...candidate(['Company Gateway']),
      auth: ['custom'],
    }
    const localCandidate: ProviderCatalogFilterCandidate = {
      ...candidate(['LM Studio']),
      auth: ['local'],
      costs: ['uncapped'],
    }

    expect(matchesProviderCatalogCandidate(customCandidate, '', {
      auth: ['custom'],
      cost: [],
      modality: [],
    })).toBe(true)
    expect(matchesProviderCatalogCandidate(localCandidate, '', {
      auth: ['custom'],
      cost: [],
      modality: [],
    })).toBe(false)
    expect(matchesProviderCatalogCandidate(localCandidate, '', {
      auth: ['local'],
      cost: [],
      modality: [],
    })).toBe(true)
    expect(matchesProviderCatalogCandidate(customCandidate, '', {
      auth: ['local'],
      cost: [],
      modality: [],
    })).toBe(false)
  })

  it('prioritizes exact provider names over incidental model or endpoint matches', () => {
    const query = normalizeProviderSearchQuery('OpenAI')
    const exactProviderScore = scoreProviderCatalogCandidate(
      candidate(['OpenAI']),
      query,
    )
    const modelScore = scoreProviderCatalogCandidate(
      candidate(['Example Gateway'], ['openai-compatible-model']),
      query,
    )

    expect(exactProviderScore).toBeGreaterThan(modelScore)
    expect(selectMostRelevantProviderResults([
      { key: 'exact', score: exactProviderScore },
      { key: 'incidental', score: modelScore },
    ], query)).toEqual(new Set(['exact']))
  })

  it('keeps only the highest-ranked result group and caps broad searches', () => {
    const results = Array.from(
      { length: MAX_PROVIDER_SEARCH_RESULTS + 6 },
      (_, index) => ({ key: `provider-${index}`, score: 700 - index }),
    )

    const selected = selectMostRelevantProviderResults(results, 'provider')

    expect(selected?.size).toBe(MAX_PROVIDER_SEARCH_RESULTS)
    expect(selected?.has('provider-0')).toBe(true)
    expect(selected?.has(`provider-${MAX_PROVIDER_SEARCH_RESULTS}`)).toBe(false)
  })

  it('does not treat a two-character middle substring as a useful match', () => {
    expect(scoreProviderCatalogCandidate(
      candidate(['Example Provider']),
      normalizeProviderSearchQuery('amp'),
    )).toBeGreaterThan(0)
    expect(scoreProviderCatalogCandidate(
      candidate(['Example Provider']),
      normalizeProviderSearchQuery('am'),
    )).toBe(0)
  })

  it('uses endpoint text only for an address-shaped query', () => {
    const endpointCandidate: ProviderCatalogFilterCandidate = {
      ...candidate(['DeepSeek']),
      endpointSearchTerms: ['https://api.deepseek.com'],
    }

    expect(scoreProviderCatalogCandidate(
      endpointCandidate,
      normalizeProviderSearchQuery('api'),
    )).toBe(0)
    expect(scoreProviderCatalogCandidate(
      endpointCandidate,
      normalizeProviderSearchQuery('deepseek.com'),
    )).toBeGreaterThan(0)
  })
})
