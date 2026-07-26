import { ProviderCatalogCard } from './ProviderCatalogCard'
import type { ProviderOAuthCapability } from '../../api/providerOAuth'

export type OAuthProviderCatalogItem = {
  id: string
  name: string
}

export const OAUTH_PROVIDER_CATALOG: OAuthProviderCatalogItem[] = [
  { id: 'codex', name: 'OpenAI Codex' },
  { id: 'claude', name: 'Claude Code' },
  { id: 'kimi-coding', name: 'Kimi Coding' },
  { id: 'gemini-cli', name: 'Gemini CLI' },
  { id: 'github', name: 'GitHub Copilot' },
  { id: 'cursor', name: 'Cursor' },
  { id: 'antigravity', name: 'Antigravity' },
  { id: 'kilocode', name: 'Kilo Code' },
  { id: 'cline', name: 'Cline' },
  { id: 'qoder', name: 'Qoder' },
  { id: 'windsurf', name: 'Windsurf' },
  { id: 'gitlab-duo', name: 'GitLab Duo' },
  { id: 'amazon-q', name: 'Amazon Q' },
  { id: 'trae', name: 'Trae' },
  { id: 'grok-cli', name: 'Grok Build' },
  { id: 'codebuddy-cn', name: 'CodeBuddy CN' },
]

type Props = {
  claudeConnected: boolean
  connectedProviderIds?: ReadonlySet<string>
  capabilities?: ReadonlyMap<string, ProviderOAuthCapability>
  onSelectProvider?: (provider: OAuthProviderCatalogItem) => void
  labels: {
    title: string
    description: string
    connectedCount: string
    connected: string
    nativeReady: string
    pending: string
    openLogin: string
  }
}

export function OAuthProviderCatalog({
  claudeConnected,
  connectedProviderIds = new Set(),
  capabilities = new Map(),
  onSelectProvider,
  labels,
}: Props) {
  return (
    <section aria-labelledby="oauth-provider-catalog-title">
      <div className="mb-[12px] flex flex-wrap items-end justify-between gap-[10px]">
        <div className="min-w-0">
          <div className="flex items-center gap-[8px]">
            <h2
              id="oauth-provider-catalog-title"
              className="text-[15px] font-semibold text-[var(--color-text-primary)]"
            >
              {labels.title}
            </h2>
            <span className="text-[12px] font-semibold text-[#1473e6] dark:text-[#68adff]">
              {labels.connectedCount}
            </span>
          </div>
          <p className="mt-[3px] text-[12px] leading-[1.55] text-[var(--color-text-secondary)]">
            {labels.description}
          </p>
        </div>
      </div>

      <div
        data-provider-catalog="oauth"
        data-provider-catalog-layout="comfortable"
        className="grid grid-cols-1 gap-[9px] sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
      >
        {OAUTH_PROVIDER_CATALOG.map((provider) => {
          const isClaude = provider.id === 'claude'
          const isConnected = isClaude
            ? claudeConnected
            : connectedProviderIds.has(provider.id)
          const isSupported = isClaude || capabilities.has(provider.id)

          return (
            <ProviderCatalogCard
              key={provider.id}
              name={provider.name}
              providerId={provider.id}
              status={isConnected
                ? labels.connected
                : isSupported
                  ? labels.nativeReady
                  : labels.pending}
              statusTone={isConnected ? 'accent' : 'muted'}
              active={isConnected}
              emphasized={isConnected}
              ariaLabel={isClaude
                ? labels.openLogin
                : `${provider.name}: ${isSupported ? labels.nativeReady : labels.pending}`}
              onClick={() => onSelectProvider?.(provider)}
            />
          )
        })}
      </div>
    </section>
  )
}
