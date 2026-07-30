import { ArrowLeftRight, Usb, type LucideIcon } from 'lucide-react'
import { useEffect, useId, useState, type KeyboardEvent } from 'react'
import { SettingsPage } from '../components/settings/SettingsLayout'
import { useTranslation } from '../i18n'
import { AgentMigration } from './AgentMigration'
import { UsbMigration } from './UsbMigration'

export type DataMigrationTab = 'agent' | 'usb'

type DataMigrationProps = {
  initialTab?: DataMigrationTab
}

export function DataMigration({ initialTab = 'agent' }: DataMigrationProps) {
  const t = useTranslation()
  const tabId = useId()
  const [activeTab, setActiveTab] = useState<DataMigrationTab>(initialTab)
  const [visitedTabs, setVisitedTabs] = useState<Set<DataMigrationTab>>(
    () => new Set([initialTab]),
  )

  const markTabVisited = (tab: DataMigrationTab) => {
    setVisitedTabs(current => {
      if (current.has(tab)) return current
      const next = new Set(current)
      next.add(tab)
      return next
    })
  }

  const selectTab = (tab: DataMigrationTab) => {
    setActiveTab(tab)
    markTabVisited(tab)
  }

  useEffect(() => {
    setActiveTab(initialTab)
    markTabVisited(initialTab)
  }, [initialTab])

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentTab: DataMigrationTab,
  ) => {
    const nextTab = event.key === 'Home'
      ? 'agent'
      : event.key === 'End'
        ? 'usb'
        : event.key === 'ArrowLeft' || event.key === 'ArrowRight'
          ? currentTab === 'agent' ? 'usb' : 'agent'
          : null
    if (!nextTab) return

    event.preventDefault()
    selectTab(nextTab)
    document.getElementById(`${tabId}-${nextTab}-tab`)?.focus()
  }

  const tabs: Array<{
    value: DataMigrationTab
    label: string
    icon: LucideIcon
  }> = [
    {
      value: 'agent',
      label: t('dataMigration.tab.agent'),
      icon: ArrowLeftRight,
    },
    {
      value: 'usb',
      label: t('dataMigration.tab.usb'),
      icon: Usb,
    },
  ]

  return (
    <SettingsPage
      title={t('dataMigration.title')}
      description={t('dataMigration.description')}
    >
      <div
        role="tablist"
        aria-label={t('dataMigration.tabs')}
        className="grid h-[52px] grid-cols-2 gap-[4px] rounded-[10px] border border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] p-[4px]"
      >
        {tabs.map(tab => {
          const active = tab.value === activeTab
          const TabIcon = tab.icon
          return (
            <button
              key={tab.value}
              id={`${tabId}-${tab.value}-tab`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`${tabId}-${tab.value}-panel`}
              tabIndex={active ? 0 : -1}
              onClick={() => selectTab(tab.value)}
              onKeyDown={event => handleTabKeyDown(event, tab.value)}
              className={`flex min-w-0 items-center justify-center gap-[8px] rounded-[7px] px-[12px] text-[13px] font-semibold transition-[background-color,color,box-shadow] duration-150 focus:outline-none focus-visible:shadow-[var(--shadow-focus-ring)] ${
                active
                  ? 'bg-[var(--color-background)] text-[var(--color-text-primary)] shadow-[0_1px_3px_rgba(0,0,0,0.08)]'
                  : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]'
              }`}
            >
              <TabIcon
                size={16}
                strokeWidth={1.8}
                className={active ? 'text-[var(--color-brand)]' : undefined}
              />
              <span className="truncate">{tab.label}</span>
            </button>
          )
        })}
      </div>

      {visitedTabs.has('agent') && (
        <div
          id={`${tabId}-agent-panel`}
          role="tabpanel"
          aria-labelledby={`${tabId}-agent-tab`}
          hidden={activeTab !== 'agent'}
          className="flex flex-col gap-[20px]"
          data-testid="agent-migration-tab-panel"
        >
          <AgentMigration embedded />
        </div>
      )}

      {visitedTabs.has('usb') && (
        <div
          id={`${tabId}-usb-panel`}
          role="tabpanel"
          aria-labelledby={`${tabId}-usb-tab`}
          hidden={activeTab !== 'usb'}
          className="flex flex-col gap-[20px]"
          data-testid="usb-migration-tab-panel"
        >
          <UsbMigration embedded />
        </div>
      )}
    </SettingsPage>
  )
}
