import { AlertTriangle } from 'lucide-react'
import { useTranslation } from '../../i18n'

type Props = {
  providerName: string
}

export function OAuthRiskNotice({ providerName }: Props) {
  const t = useTranslation()

  return (
    <div
      role="alert"
      className="rounded-[8px] border border-amber-500/35 bg-amber-500/[0.09] px-[14px] py-[13px]"
    >
      <div className="flex items-start gap-[10px]">
        <AlertTriangle
          size={19}
          className="mt-[1px] shrink-0 text-amber-600 dark:text-amber-400"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <div className="text-[12px] font-bold text-[var(--color-text-primary)]">
            {t('settings.routing.oauthDialog.riskTitle')}
          </div>
          <p className="mt-[5px] text-[11px] leading-[1.65] text-[var(--color-text-secondary)]">
            {t('settings.routing.oauthDialog.riskBody', {
              provider: providerName,
            })}
          </p>
          <p className="mt-[6px] text-[11px] font-semibold leading-[1.6] text-amber-700 dark:text-amber-300">
            {t('settings.routing.oauthDialog.riskLimits')}
          </p>
        </div>
      </div>
    </div>
  )
}
