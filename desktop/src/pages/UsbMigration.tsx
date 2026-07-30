import {
  Apple,
  Check,
  CircleAlert,
  Database,
  Download,
  FolderGit2,
  FolderOpen,
  HardDrive,
  Monitor,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Usb,
  X,
  type LucideIcon,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { ApiError } from '../api/client'
import {
  usbMigrationApi,
  type UsbMigrationJob,
  type UsbMigrationPlatform,
  type UsbMigrationScan,
} from '../api/usbMigration'
import {
  SettingsPage,
  Switch,
} from '../components/settings/SettingsLayout'
import { Button } from '../components/shared/Button'
import { useTranslation } from '../i18n'
import { isTauriRuntime } from '../lib/desktopRuntime'
import { formatBytes } from '../lib/formatBytes'
import { useUIStore } from '../stores/uiStore'
import { portableFolderPreview } from '../utils/usbMigration'

const PLATFORM_ORDER: UsbMigrationPlatform[] = [
  'macos-arm64',
  'macos-x64',
  'windows-x64',
  'linux-x64',
]

const PLATFORM_ICONS: Record<UsbMigrationPlatform, LucideIcon> = {
  'macos-arm64': Apple,
  'macos-x64': Apple,
  'windows-x64': Monitor,
  'linux-x64': Monitor,
}

export function UsbMigration({ embedded = false }: { embedded?: boolean } = {}) {
  const t = useTranslation()
  const addToast = useUIStore(state => state.addToast)
  const [scan, setScan] = useState<UsbMigrationScan | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [destinationPath, setDestinationPath] = useState('')
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set())
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<UsbMigrationPlatform>>(new Set())
  const [includeApplications, setIncludeApplications] = useState(true)
  const [securityConfirmed, setSecurityConfirmed] = useState(false)
  const [job, setJob] = useState<UsbMigrationJob | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [replaceConfirmation, setReplaceConfirmation] = useState(false)

  const load = useCallback(async (force = false) => {
    setLoading(true)
    setLoadError(null)
    try {
      const next = await usbMigrationApi.scan(force)
      setScan(next)
      setSelectedProjectIds(new Set(next.projects.map(project => project.id)))
      const availablePlatforms = PLATFORM_ORDER.filter(
        platform => next.release?.platforms[platform],
      )
      setSelectedPlatforms(new Set(availablePlatforms))
      setIncludeApplications(availablePlatforms.length > 0)
    } catch (error) {
      setLoadError(errorMessage(error, t('usbMigration.scanFailed')))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!job || !['queued', 'running'].includes(job.status)) return
    let disposed = false
    const refresh = async () => {
      try {
        const next = await usbMigrationApi.getJob(job.id)
        if (disposed) return
        setJob(next)
        if (next.status === 'completed') {
          addToast({
            type: 'success',
            message: t('usbMigration.completedToast'),
          })
        }
      } catch {
        // Keep the last visible progress snapshot; the next poll may reconnect.
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 500)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [addToast, job?.id, job?.status, t])

  const selectedProjects = useMemo(
    () => scan?.projects.filter(project => selectedProjectIds.has(project.id)) ?? [],
    [scan, selectedProjectIds],
  )
  const selectedPlatformList = useMemo(
    () => PLATFORM_ORDER.filter(platform => selectedPlatforms.has(platform)),
    [selectedPlatforms],
  )
  const estimatedBytes = useMemo(() => {
    if (!scan) return 0
    const projectsBytes = selectedProjects.reduce(
      (sum, project) => sum + project.sizeBytes,
      0,
    )
    const applicationBytes = includeApplications
      ? selectedPlatformList.reduce(
        (sum, platform) =>
          sum + (scan.release?.platforms[platform]?.sizeBytes ?? 0),
        0,
      )
      : 0
    return scan.configSizeBytes + projectsBytes + applicationBytes
  }, [includeApplications, scan, selectedPlatformList, selectedProjects])

  const chooseDestination = async () => {
    if (!isTauriRuntime()) return
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('usbMigration.chooseDestination'),
      })
      if (typeof selected === 'string') {
        setDestinationPath(selected)
        setStartError(null)
        setReplaceConfirmation(false)
      }
    } catch (error) {
      setStartError(errorMessage(error, t('usbMigration.destinationFailed')))
    }
  }

  const startMigration = async (replaceExisting = false) => {
    if (!scan) return
    setStartError(null)
    try {
      const next = await usbMigrationApi.start({
        destinationPath,
        projectIds: selectedProjects.map(project => project.id),
        platforms: selectedPlatformList,
        includeApplications,
        replaceExisting,
      })
      setReplaceConfirmation(false)
      setJob(next)
    } catch (error) {
      if (apiErrorCode(error) === 'PORTABLE_BUNDLE_EXISTS') {
        setReplaceConfirmation(true)
      }
      setStartError(errorMessage(error, t('usbMigration.startFailed')))
    }
  }

  const cancelMigration = async () => {
    if (!job) return
    try {
      setJob(await usbMigrationApi.cancel(job.id))
    } catch (error) {
      setStartError(errorMessage(error, t('usbMigration.cancelFailed')))
    }
  }

  const reset = () => {
    setJob(null)
    setStartError(null)
    setReplaceConfirmation(false)
  }

  const canStart = !!scan
    && !!destinationPath
    && securityConfirmed
    && (!includeApplications || (
      !!scan.release
      && selectedPlatformList.length > 0
    ))

  const content = (
    <>
      <MigrationSteps active={job ? (job.status === 'completed' ? 3 : 2) : 1} />

      {loading ? (
        <LoadingState label={t('usbMigration.scanning')} />
      ) : loadError ? (
        <ErrorState
          message={loadError}
          actionLabel={t('usbMigration.scanAgain')}
          onRetry={() => void load(true)}
        />
      ) : job ? (
        job.status === 'completed'
          ? <CompletedState job={job} onReset={reset} />
          : (
            <ProgressState
              job={job}
              error={startError}
              onCancel={() => void cancelMigration()}
              onReset={reset}
            />
          )
      ) : scan ? (
        <div className="overflow-hidden rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container)]">
          <section className="border-b border-[var(--color-border-separator)] px-[18px] py-[16px]">
            <SectionHeading
              icon={HardDrive}
              title={t('usbMigration.destination')}
              description={t('usbMigration.destinationHint')}
            />
            <div className="mt-[12px] flex min-w-0 gap-[8px]">
              <input
                value={destinationPath}
                onChange={event => {
                  setDestinationPath(event.target.value)
                  setStartError(null)
                  setReplaceConfirmation(false)
                }}
                placeholder={t('usbMigration.destinationPlaceholder')}
                aria-label={t('usbMigration.destination')}
                className="h-[40px] min-w-0 flex-1 rounded-[7px] border border-[var(--color-border)] bg-[var(--color-background)] px-[12px] text-[13px] text-[var(--color-text-primary)] outline-none transition-colors focus:border-[var(--color-border-focus)]"
              />
              <Button
                variant="secondary"
                size="md"
                icon={<FolderOpen size={16} />}
                onClick={() => void chooseDestination()}
              >
                {t('usbMigration.browse')}
              </Button>
            </div>
            {destinationPath && (
              <p className="mt-[8px] break-all text-[11px] leading-[17px] text-[var(--color-text-tertiary)]">
                {t('usbMigration.portableFolder')}: {portableFolderPreview(destinationPath)}
              </p>
            )}
          </section>

          <section className="border-b border-[var(--color-border-separator)] px-[18px] py-[16px]">
            <SectionHeading
              icon={Database}
              title={t('usbMigration.dataTitle')}
              description={t('usbMigration.dataDescription')}
              trailing={<SizeLabel value={scan.configSizeBytes} />}
            />
            <div className="mt-[12px] flex items-center gap-[10px] rounded-[7px] bg-[var(--color-surface-container-low)] px-[12px] py-[10px]">
              <span className="flex h-[20px] w-[20px] items-center justify-center rounded-full bg-[var(--color-success)] text-white">
                <Check size={13} strokeWidth={2.4} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-[var(--color-text-primary)]">
                  {t('usbMigration.dataIncluded')}
                </p>
                <p className="truncate text-[11px] text-[var(--color-text-tertiary)]">
                  {scan.configPath}
                </p>
              </div>
            </div>
          </section>

          <section className="border-b border-[var(--color-border-separator)] px-[18px] py-[16px]">
            <SectionHeading
              icon={FolderGit2}
              title={t('usbMigration.projectsTitle')}
              description={t('usbMigration.projectsDescription', {
                count: scan.projects.length,
              })}
              trailing={scan.projects.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    const allSelected = selectedProjectIds.size === scan.projects.length
                    setSelectedProjectIds(new Set(
                      allSelected ? [] : scan.projects.map(project => project.id),
                    ))
                  }}
                  className="text-[12px] font-semibold text-[var(--color-brand)] hover:underline"
                >
                  {selectedProjectIds.size === scan.projects.length
                    ? t('usbMigration.clearProjects')
                    : t('usbMigration.selectAllProjects')}
                </button>
              ) : undefined}
            />
            {scan.projects.length === 0 ? (
              <p className="mt-[12px] text-[12px] text-[var(--color-text-tertiary)]">
                {t('usbMigration.noProjects')}
              </p>
            ) : (
              <div className="mt-[12px] max-h-[220px] divide-y divide-[var(--color-border-separator)] overflow-y-auto rounded-[7px] border border-[var(--color-border-separator)] bg-[var(--color-background)]">
                {scan.projects.map(project => (
                  <ChoiceRow
                    key={project.id}
                    checked={selectedProjectIds.has(project.id)}
                    label={project.name}
                    detail={project.path}
                    meta={formatBytes(project.sizeBytes)}
                    onChange={() => {
                      setSelectedProjectIds(current => toggleSet(current, project.id))
                    }}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="border-b border-[var(--color-border-separator)] px-[18px] py-[16px]">
            <div className="flex items-start gap-[12px]">
              <div className="mt-[1px] flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[7px] bg-[var(--color-surface-container-low)] text-[var(--color-text-secondary)]">
                <Download size={17} />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-[13px] font-bold text-[var(--color-text-primary)]">
                  {t('usbMigration.appsTitle')}
                </h2>
                <p className="mt-[2px] text-[11px] leading-[17px] text-[var(--color-text-tertiary)]">
                  {t('usbMigration.appsDescription')}
                </p>
              </div>
              <Switch
                checked={includeApplications}
                disabled={!scan.release}
                ariaLabel={t('usbMigration.includeApps')}
                onChange={setIncludeApplications}
              />
            </div>

            {!scan.release ? (
              <div className="mt-[12px] flex gap-[9px] rounded-[7px] border border-[var(--color-warning)]/25 bg-[var(--color-warning)]/8 px-[11px] py-[9px] text-[11px] leading-[17px] text-[var(--color-text-secondary)]">
                <CircleAlert size={15} className="mt-[1px] shrink-0 text-[var(--color-warning)]" />
                <span>{t('usbMigration.releaseUnavailable')}</span>
              </div>
            ) : includeApplications ? (
              <>
                <div className="mt-[12px] grid grid-cols-1 gap-[8px] sm:grid-cols-2">
                  {PLATFORM_ORDER.map(platform => {
                    const asset = scan.release?.platforms[platform]
                    return (
                      <PlatformChoice
                        key={platform}
                        platform={platform}
                        checked={selectedPlatforms.has(platform)}
                        disabled={!asset}
                        sizeBytes={asset?.sizeBytes ?? null}
                        onChange={() => {
                          setSelectedPlatforms(current => toggleSet(current, platform))
                        }}
                      />
                    )
                  })}
                </div>
                <p className="mt-[9px] text-[11px] text-[var(--color-text-tertiary)]">
                  {t('usbMigration.releaseVersion', { version: scan.release.version })}
                </p>
              </>
            ) : null}
          </section>

          <section className="px-[18px] py-[16px]">
            <button
              type="button"
              role="checkbox"
              aria-checked={securityConfirmed}
              onClick={() => setSecurityConfirmed(value => !value)}
              className="flex w-full items-start gap-[10px] text-left"
            >
              <span
                className={`mt-[1px] flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-[5px] border transition-colors ${
                  securityConfirmed
                    ? 'border-[var(--color-brand)] bg-[var(--color-brand)] text-white dark:text-black'
                    : 'border-[var(--color-border)] bg-[var(--color-background)]'
                }`}
              >
                {securityConfirmed && <Check size={13} strokeWidth={2.4} />}
              </span>
              <span>
                <span className="flex items-center gap-[6px] text-[12px] font-semibold text-[var(--color-text-primary)]">
                  <ShieldAlert size={14} className="text-[var(--color-warning)]" />
                  {t('usbMigration.securityConfirm')}
                </span>
                <span className="mt-[3px] block text-[11px] leading-[17px] text-[var(--color-text-tertiary)]">
                  {t('usbMigration.securityDescription')}
                </span>
              </span>
            </button>

            {startError && (
              <div className="mt-[12px] rounded-[7px] border border-[var(--color-error)]/25 bg-[var(--color-error)]/8 px-[11px] py-[9px] text-[12px] text-[var(--color-error)]">
                {startError}
              </div>
            )}

            <div className="mt-[16px] flex flex-wrap items-center justify-between gap-[12px] border-t border-[var(--color-border-separator)] pt-[14px]">
              <div>
                <p className="text-[11px] text-[var(--color-text-tertiary)]">
                  {t('usbMigration.estimatedSize')}
                </p>
                <p className="text-[17px] font-bold text-[var(--color-text-primary)]">
                  {formatBytes(estimatedBytes)}
                </p>
              </div>
              {replaceConfirmation ? (
                <div className="flex items-center gap-[8px]">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setReplaceConfirmation(false)}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button
                    variant="primary"
                    size="md"
                    icon={<RefreshCw size={16} />}
                    onClick={() => void startMigration(true)}
                  >
                    {t('usbMigration.updateExisting')}
                  </Button>
                </div>
              ) : (
                <Button
                  variant="primary"
                  size="md"
                  disabled={!canStart}
                  icon={<Usb size={17} />}
                  onClick={() => void startMigration()}
                >
                  {t('usbMigration.start')}
                </Button>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </>
  )

  if (embedded) return content

  return (
    <SettingsPage
      title={t('usbMigration.title')}
      description={t('usbMigration.description')}
    >
      {content}
    </SettingsPage>
  )
}

function MigrationSteps({ active }: { active: 1 | 2 | 3 }) {
  const t = useTranslation()
  const steps = [
    t('usbMigration.step.configure'),
    t('usbMigration.step.transfer'),
    t('usbMigration.step.done'),
  ]
  return (
    <ol className="grid grid-cols-3 overflow-hidden rounded-[8px] border border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)]">
      {steps.map((label, index) => {
        const number = index + 1
        const reached = number <= active
        return (
          <li
            key={label}
            className={`flex h-[38px] items-center justify-center gap-[7px] border-r border-[var(--color-border-separator)] px-[8px] text-[11px] font-semibold last:border-r-0 ${
              reached
                ? 'text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-tertiary)]'
            }`}
          >
            <span
              className={`flex h-[18px] w-[18px] items-center justify-center rounded-full text-[10px] ${
                reached
                  ? 'bg-[var(--color-brand)] text-white dark:text-black'
                  : 'bg-[var(--color-surface-container)] text-[var(--color-text-tertiary)]'
              }`}
            >
              {number < active ? <Check size={11} strokeWidth={2.5} /> : number}
            </span>
            <span className="truncate">{label}</span>
          </li>
        )
      })}
    </ol>
  )
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container)] px-[18px] py-[22px]">
      <div className="flex items-center gap-[10px]">
        <RefreshCw size={17} className="animate-spin text-[var(--color-brand)]" />
        <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">
          {label}
        </span>
      </div>
      <div className="mt-[14px] h-[4px] overflow-hidden rounded-full bg-[var(--color-surface-container-low)]">
        <div className="h-full w-2/5 animate-pulse rounded-full bg-[var(--color-brand)]" />
      </div>
    </div>
  )
}

function ErrorState({
  message,
  actionLabel,
  onRetry,
}: {
  message: string
  actionLabel: string
  onRetry: () => void
}) {
  return (
    <div className="rounded-[8px] border border-[var(--color-error)]/25 bg-[var(--color-surface-container)] px-[18px] py-[18px]">
      <div className="flex items-start gap-[10px]">
        <CircleAlert size={18} className="mt-[1px] shrink-0 text-[var(--color-error)]" />
        <p className="min-w-0 flex-1 text-[12px] leading-[19px] text-[var(--color-text-secondary)]">
          {message}
        </p>
        <Button
          variant="secondary"
          size="sm"
          icon={<RefreshCw size={15} />}
          onClick={onRetry}
        >
          {actionLabel}
        </Button>
      </div>
    </div>
  )
}

function ProgressState({
  job,
  error,
  onCancel,
  onReset,
}: {
  job: UsbMigrationJob
  error: string | null
  onCancel: () => void
  onReset: () => void
}) {
  const t = useTranslation()
  const active = ['queued', 'running'].includes(job.status)
  const failed = job.status === 'failed'
  const cancelled = job.status === 'cancelled'
  return (
    <div className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container)] px-[18px] py-[18px]">
      <div className="flex items-start gap-[12px]">
        <div className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[8px] ${
          failed
            ? 'bg-[var(--color-error)]/10 text-[var(--color-error)]'
            : cancelled
              ? 'bg-[var(--color-surface-container-low)] text-[var(--color-text-tertiary)]'
              : 'bg-[var(--color-brand)]/10 text-[var(--color-brand)]'
        }`}>
          {failed ? <CircleAlert size={18} /> : cancelled ? <X size={18} /> : <Usb size={18} />}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-bold text-[var(--color-text-primary)]">
            {failed
              ? t('usbMigration.failed')
              : cancelled
                ? t('usbMigration.cancelled')
                : stageLabel(job.stage, t)}
          </h2>
          <p className="mt-[3px] truncate text-[11px] text-[var(--color-text-tertiary)]">
            {job.currentItem || job.portablePath}
          </p>
        </div>
        <span className="text-[18px] font-bold tabular-nums text-[var(--color-text-primary)]">
          {job.progressPercent}%
        </span>
      </div>

      <div className="mt-[16px] h-[6px] overflow-hidden rounded-full bg-[var(--color-surface-container-low)]">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${
            failed ? 'bg-[var(--color-error)]' : 'bg-[var(--color-brand)]'
          }`}
          style={{ width: `${job.progressPercent}%` }}
        />
      </div>
      <div className="mt-[8px] flex justify-between gap-[12px] text-[11px] text-[var(--color-text-tertiary)]">
        <span>{formatBytes(job.processedBytes)}</span>
        <span>{formatBytes(job.totalBytes)}</span>
      </div>

      {(job.error || error) && (
        <p className="mt-[12px] rounded-[7px] border border-[var(--color-error)]/20 bg-[var(--color-error)]/8 px-[11px] py-[9px] text-[12px] leading-[18px] text-[var(--color-error)]">
          {job.error || error}
        </p>
      )}
      {job.warnings.length > 0 && (
        <p className="mt-[10px] text-[11px] leading-[17px] text-[var(--color-warning)]">
          {t('usbMigration.warningCount', { count: job.warnings.length })}
        </p>
      )}

      <div className="mt-[16px] flex justify-end">
        {active ? (
          <Button variant="secondary" size="sm" onClick={onCancel}>
            {t('usbMigration.cancel')}
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            icon={<RotateCcw size={15} />}
            onClick={onReset}
          >
            {t('usbMigration.back')}
          </Button>
        )}
      </div>
    </div>
  )
}

function CompletedState({
  job,
  onReset,
}: {
  job: UsbMigrationJob
  onReset: () => void
}) {
  const t = useTranslation()
  return (
    <div className="rounded-[8px] border border-[var(--color-success)]/25 bg-[var(--color-surface-container)] px-[18px] py-[18px]">
      <div className="flex items-start gap-[12px]">
        <div className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-[8px] bg-[var(--color-success)]/10 text-[var(--color-success)]">
          <PackageCheck size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-bold text-[var(--color-text-primary)]">
            {t('usbMigration.completed')}
          </h2>
          <p className="mt-[3px] text-[12px] leading-[18px] text-[var(--color-text-secondary)]">
            {t('usbMigration.completedDescription')}
          </p>
        </div>
      </div>
      <div className="mt-[14px] rounded-[7px] border border-[var(--color-border-separator)] bg-[var(--color-background)] px-[12px] py-[10px]">
        <p className="text-[10px] font-semibold text-[var(--color-text-tertiary)]">
          {t('usbMigration.portablePath')}
        </p>
        <p className="mt-[3px] break-all text-[12px] font-medium text-[var(--color-text-primary)]">
          {job.portablePath}
        </p>
      </div>
      <div className="mt-[12px] grid gap-[6px] text-[11px] leading-[17px] text-[var(--color-text-secondary)] sm:grid-cols-3">
        <LaunchHint label="macOS" command="Start-CyberCode.command" />
        <LaunchHint label="Windows" command="Start-CyberCode.cmd" />
        <LaunchHint label="Linux" command="Start-CyberCode.sh" />
      </div>
      <p className="mt-[12px] text-[11px] leading-[17px] text-[var(--color-warning)]">
        {t('usbMigration.ejectWarning')}
      </p>
      <div className="mt-[16px] flex justify-end">
        <Button
          variant="secondary"
          size="sm"
          icon={<RotateCcw size={15} />}
          onClick={onReset}
        >
          {t('usbMigration.createAnother')}
        </Button>
      </div>
    </div>
  )
}

function SectionHeading({
  icon: IconComponent,
  title,
  description,
  trailing,
}: {
  icon: LucideIcon
  title: string
  description: string
  trailing?: ReactNode
}) {
  return (
    <div className="flex items-start gap-[12px]">
      <div className="mt-[1px] flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[7px] bg-[var(--color-surface-container-low)] text-[var(--color-text-secondary)]">
        <IconComponent size={17} />
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="text-[13px] font-bold text-[var(--color-text-primary)]">
          {title}
        </h2>
        <p className="mt-[2px] text-[11px] leading-[17px] text-[var(--color-text-tertiary)]">
          {description}
        </p>
      </div>
      {trailing}
    </div>
  )
}

function SizeLabel({ value }: { value: number }) {
  return (
    <span className="shrink-0 text-[11px] font-semibold tabular-nums text-[var(--color-text-secondary)]">
      {formatBytes(value)}
    </span>
  )
}

function ChoiceRow({
  checked,
  label,
  detail,
  meta,
  onChange,
}: {
  checked: boolean
  label: string
  detail: string
  meta: string
  onChange: () => void
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onChange}
      className="flex min-h-[52px] w-full items-center gap-[10px] px-[11px] py-[8px] text-left transition-colors hover:bg-[var(--color-surface-hover)]"
    >
      <span className={`flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-[5px] border ${
        checked
          ? 'border-[var(--color-brand)] bg-[var(--color-brand)] text-white dark:text-black'
          : 'border-[var(--color-border)] bg-[var(--color-background)]'
      }`}>
        {checked && <Check size={12} strokeWidth={2.4} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-semibold text-[var(--color-text-primary)]">
          {label}
        </p>
        <p className="truncate text-[10px] text-[var(--color-text-tertiary)]">
          {detail}
        </p>
      </div>
      <span className="shrink-0 text-[10px] tabular-nums text-[var(--color-text-tertiary)]">
        {meta}
      </span>
    </button>
  )
}

function PlatformChoice({
  platform,
  checked,
  disabled,
  sizeBytes,
  onChange,
}: {
  platform: UsbMigrationPlatform
  checked: boolean
  disabled: boolean
  sizeBytes: number | null
  onChange: () => void
}) {
  const t = useTranslation()
  const IconComponent = PLATFORM_ICONS[platform]
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={`flex h-[48px] items-center gap-[9px] rounded-[7px] border px-[10px] text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        checked
          ? 'border-[var(--color-brand)]/50 bg-[var(--color-brand)]/7'
          : 'border-[var(--color-border-separator)] bg-[var(--color-background)] hover:bg-[var(--color-surface-hover)]'
      }`}
    >
      <IconComponent size={16} className="shrink-0 text-[var(--color-text-secondary)]" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-semibold text-[var(--color-text-primary)]">
          {t(`usbMigration.platform.${platform}` as never)}
        </span>
        <span className="block text-[10px] text-[var(--color-text-tertiary)]">
          {sizeBytes === null
            ? t('usbMigration.notAvailable')
            : formatBytes(sizeBytes)}
        </span>
      </span>
      <span className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full ${
        checked
          ? 'bg-[var(--color-brand)] text-white dark:text-black'
          : 'border border-[var(--color-border)]'
      }`}>
        {checked && <Check size={11} strokeWidth={2.4} />}
      </span>
    </button>
  )
}

function LaunchHint({ label, command }: { label: string; command: string }) {
  return (
    <div className="rounded-[7px] bg-[var(--color-surface-container-low)] px-[9px] py-[7px]">
      <span className="font-semibold text-[var(--color-text-primary)]">{label}</span>
      <span className="mt-[1px] block truncate font-mono text-[10px]">{command}</span>
    </div>
  )
}

function stageLabel(
  stage: UsbMigrationJob['stage'],
  t: ReturnType<typeof useTranslation>,
): string {
  return t(`usbMigration.stage.${stage}` as never)
}

function toggleSet<T>(current: Set<T>, value: T): Set<T> {
  const next = new Set(current)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

function apiErrorCode(error: unknown): string | null {
  if (!(error instanceof ApiError) || !error.body || typeof error.body !== 'object') {
    return null
  }
  const code = (error.body as Record<string, unknown>).error
  return typeof code === 'string' ? code : null
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
