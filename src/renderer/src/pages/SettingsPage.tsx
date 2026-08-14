import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  Ban,
  BellRing,
  DatabaseBackup,
  FolderOpen,
  Monitor,
  Moon,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settings-store'
import { useSecurityStore } from '@/stores/security-store'
import { usePlatform } from '@/hooks/usePlatform'
import { LANGUAGES } from '@/lib/languages'
import i18next from 'i18next'
import type { ClaritySettings, SecuritySettings } from '@shared/types'

type CategoryId = 'general' | 'alerts' | 'backups' | 'cleaning' | 'exclusions' | 'security'

const CATEGORIES: Array<{ id: CategoryId; icon: LucideIcon }> = [
  { id: 'general', icon: Settings2 },
  { id: 'alerts', icon: BellRing },
  { id: 'backups', icon: DatabaseBackup },
  { id: 'cleaning', icon: Sparkles },
  { id: 'exclusions', icon: Ban },
  { id: 'security', icon: ShieldCheck },
]

/** Keys managed by this page. Everything else (schedules, game mode, allowlist…) is left untouched on reset. */
const RESET_PATCH: Partial<ClaritySettings> = {
  theme: 'dark',
  minimizeToTray: false,
  showNotificationOnComplete: true,
  showThreatNotifications: true,
  runAtStartup: false,
  autoUpdate: true,
  autoRestart: true,
  updateCheckIntervalHours: 4,
  cleaner: {
    skipRecentMinutes: 60,
    secureDelete: false,
    closeBrowsersBeforeClean: false,
    createRestorePoint: false,
    protectRecycleBin: true,
    keepDeletionLog: false,
  },
  exclusions: [],
  backupPath: '',
  backupMode: 'targeted',
  alerts: {
    enabled: true,
    showInApp: true,
    showSystem: true,
    cpuUsageThreshold: 90,
    cpuTempThreshold: 90,
    memoryThreshold: 90,
    diskSpaceThresholdGb: 10,
    batteryThreshold: 20,
    cooldownMinutes: 30,
  },
}

const SECURITY_DEFAULTS: SecuritySettings = {
  autoProbeEnabled: false,
  autoProbeIntervalHours: 6,
  customPorts: [],
  inspectAutomatically: true,
}

interface SearchEntry {
  id: string
  category: CategoryId
  label: string
  keywords: string[]
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function SettingsPage() {
  const { t } = useTranslation('settings')
  const { t: tSec } = useTranslation('security')
  const { features, platform } = usePlatform()
  const { settings, setSettings, updateSettings } = useSettingsStore()
  const secSettings = useSecurityStore((s) => s.settings)
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<CategoryId>('general')
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [resetOpen, setResetOpen] = useState(false)

  useEffect(() => { window.clarity?.settingsGet?.().then(setSettings).catch(() => {}) }, [setSettings])
  useEffect(() => { void useSecurityStore.getState().loadSettings() }, [])

  const save = (partial: Partial<typeof settings>) => {
    updateSettings(partial)
    window.clarity?.settingsSet?.(partial).catch(() => {})
  }

  const saveStartup = async (enabled: boolean) => {
    save({ runAtStartup: enabled })
    try {
      await window.clarity?.applyStartup?.(enabled)
    } catch {
      // Revert the toggle — the OS rejected the change
      save({ runAtStartup: !enabled })
      toast.error(t('startupSettingFailedToast'), {
        description: t('startupSettingFailedDesc'),
        action: {
          label: t('startupSettingFailedAction'),
          onClick: () => window.open('https://clarity.app/help/startup-failed', '_blank'),
        },
      })
    }
  }

  const saveTray = (enabled: boolean) => {
    save({ minimizeToTray: enabled })
    window.clarity?.applyTray?.(enabled)
  }

  const handleReset = async () => {
    const patch = { ...RESET_PATCH, language: settings.language }
    try {
      await window.clarity?.settingsSet?.(patch)
      setSettings({ ...settings, ...patch })
    } catch {
      toast.error(t('resetFailed'), { description: t('resetFailedDesc') })
      return
    }
    window.clarity?.applyStartup?.(patch.runAtStartup ?? false).catch(() => {})
    window.clarity?.applyTray?.(patch.minimizeToTray ?? false)
    try {
      const next = await window.clarity?.securitySettingsSet?.(SECURITY_DEFAULTS)
      if (next) useSecurityStore.setState({ settings: next })
    } catch {
      // Non-fatal — settings were already restored
    }
    toast.success(t('resetToast'), { description: t('resetToastDesc') })
  }

  const selectCategory = (id: CategoryId) => {
    setActiveCategory(id)
    setHighlightId(null)
    document.getElementById('main-content')?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const results = useMemo(() => {
    const entries: SearchEntry[] = [
      { id: 's-theme', category: 'general', label: t('themeLabel'), keywords: ['appearance', 'dark', 'light', 'system'] },
      { id: 's-language', category: 'general', label: t('languageLabel'), keywords: ['locale', 'translation'] },
      { id: 's-startup', category: 'general', label: t('runAtStartupLabel'), keywords: ['boot', 'launch', 'autostart'] },
      { id: 's-tray', category: 'general', label: t('minimizeToTrayLabel'), keywords: ['system tray', 'background', 'close'] },
      { id: 's-notifications', category: 'general', label: t('showNotificationsLabel'), keywords: ['toast', 'popup', 'complete'] },
      { id: 's-threats', category: 'general', label: t('threatDetectionAlertsLabel'), keywords: ['network', 'warning', 'security'] },
      { id: 's-autoupdate', category: 'general', label: t('autoUpdateLabel'), keywords: ['update', 'install'] },
      { id: 's-autorestart', category: 'general', label: t('autoRestartLabel'), keywords: ['update', 'restart', 'install'] },
      { id: 's-updateinterval', category: 'general', label: t('updateCheckIntervalLabel'), keywords: ['update', 'frequency', 'check'] },
      { id: 's-alerts-master', category: 'alerts', label: t('alertsEnabledLabel'), keywords: ['monitor', 'watch', 'health'] },
      { id: 's-alerts-inapp', category: 'alerts', label: t('alertsInAppLabel'), keywords: ['toast', 'notification'] },
      { id: 's-alerts-system', category: 'alerts', label: t('alertsSystemLabel'), keywords: ['os', 'native', 'notification'] },
      { id: 's-alerts-cpu', category: 'alerts', label: t('alertsCpuUsageLabel'), keywords: ['processor', 'load', 'performance'] },
      { id: 's-alerts-cpu-temp', category: 'alerts', label: t('alertsCpuTempLabel'), keywords: ['processor', 'heat', 'thermal'] },
      { id: 's-alerts-memory', category: 'alerts', label: t('alertsMemoryLabel'), keywords: ['ram', 'usage'] },
      { id: 's-alerts-disk', category: 'alerts', label: t('alertsDiskLabel'), keywords: ['storage', 'space', 'drive'] },
      { id: 's-alerts-battery', category: 'alerts', label: t('alertsBatteryLabel'), keywords: ['power', 'laptop'] },
      { id: 's-alerts-cooldown', category: 'alerts', label: t('alertsCooldownLabel'), keywords: ['repeat', 'throttle', 'frequency'] },
      { id: 's-backup-folder', category: 'backups', label: t('backupFolderLabel'), keywords: ['restore', 'location', 'folder'] },
      { id: 's-backup-mode', category: 'backups', label: t('backupModeLabel'), keywords: ['registry', 'targeted', 'full', 'hive'] },
      { id: 's-cleaning-recycle', category: 'cleaning', label: t('protectRecycleBinLabel'), keywords: ['recycle bin', 'trash', 'recover'] },
      { id: 's-cleaning-secure', category: 'cleaning', label: t('secureDeleteLabel'), keywords: ['wipe', 'overwrite', 'shred'] },
      { id: 's-cleaning-browsers', category: 'cleaning', label: t('closeBrowsersLabel'), keywords: ['cache', 'browser'] },
      { id: 's-cleaning-restore', category: 'cleaning', label: t('createRestorePointLabel'), keywords: ['system restore', 'rollback'] },
      { id: 's-cleaning-log', category: 'cleaning', label: t('keepDeletionLogLabel'), keywords: ['history', 'log', 'deleted'] },
      { id: 's-cleaning-skip', category: 'cleaning', label: t('skipRecentFilesLabel'), keywords: ['recent', 'time', 'modified'] },
      { id: 's-exclusion-add', category: 'exclusions', label: t('exclusionEmptyTitle'), keywords: ['ignore', 'skip', 'path', 'extension'] },
      { id: 's-security-scan-toggle', category: 'security', label: tSec('autoProbeLabel'), keywords: ['scan', 'catalog', 'scheduled'] },
      { id: 's-security-scan-interval', category: 'security', label: tSec('intervalHours'), keywords: ['scan', 'frequency', 'scheduled'] },
      { id: 's-security-inspect', category: 'security', label: tSec('inspectAutoLabel'), keywords: ['risk inspector', 'auto open'] },
      { id: 's-security-ports', category: 'security', label: tSec('customPortsTitle'), keywords: ['port', 'monitor', 'network'] },
    ]
    const q = query.trim().toLowerCase()
    if (!q) return []
    return entries.filter((e) => {
      const hay = [e.label, ...e.keywords].join(' ').toLowerCase()
      return q.split(/\s+/).every((part) => hay.includes(part))
    })
  }, [query, t, tSec])

  const navigateTo = (entry: SearchEntry) => {
    setQuery('')
    setActiveCategory(entry.category)
    setHighlightId(entry.id)
  }

  // Scroll the target row into view once its panel has rendered, then fade the ring out.
  useEffect(() => {
    if (!highlightId) return
    const timer = setTimeout(() => {
      document.getElementById(highlightId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 80)
    const clearTimer = setTimeout(() => setHighlightId(null), 3600)
    return () => { clearTimeout(timer); clearTimeout(clearTimer) }
  }, [highlightId, activeCategory])

  const categoryLabel = (id: CategoryId) => t(`category${cap(id)}`)

  return (
    <div className="animate-fade-in mx-auto max-w-3xl">
      <PageHeader title={t('pageTitle')} description={t('pageDescription')} />

      {/* Search */}
      <div className="relative mb-6 max-w-xl">
        <div
          className="flex items-center gap-3 rounded-xl px-4 py-2.5"
          style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)' }}
        >
          <Search className="h-4 w-4 shrink-0" style={{ color: 'var(--text-faint)' }} strokeWidth={1.8} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('')
              if (e.key === 'Enter' && results.length > 0) navigateTo(results[0])
            }}
            placeholder={t('searchPlaceholder')}
            className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-zinc-700"
            style={{ color: 'var(--text-primary)' }}
            role="combobox"
            aria-expanded={query.trim().length > 0}
            aria-controls="settings-search-results"
            aria-autocomplete="list"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="rounded-md p-1 transition-colors"
              style={{ color: 'var(--text-faint)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {query.trim().length > 0 && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setQuery('')} aria-hidden="true" />
            <div
              id="settings-search-results"
              role="listbox"
              className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-xl"
              style={{
                background: 'var(--card-bg)',
                border: '1px solid var(--border-default)',
                boxShadow: '0 16px 48px rgba(0,0,0,0.45)',
              }}
            >
              {results.length === 0 ? (
                <p className="px-4 py-4 text-[13px]" style={{ color: 'var(--text-muted)' }}>{t('searchNoResults', { query })}</p>
              ) : (
                <>
                  <p
                    className="border-b px-4 py-2 text-[11px] font-medium uppercase tracking-widest"
                    style={{ color: 'var(--text-faint)', borderColor: 'var(--border-subtle)' }}
                  >
                    {t('searchResultCount', { count: results.length })}
                  </p>
                  <ul className="max-h-[320px] overflow-y-auto py-1" role="presentation">
                    {results.map((r) => {
                      const Icon = CATEGORIES.find((c) => c.id === r.category)?.icon ?? Settings2
                      return (
                        <li key={r.id}>
                          <button
                            role="option"
                            aria-selected="false"
                            onClick={() => navigateTo(r)}
                            className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors"
                            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                          >
                            <Icon className="h-4 w-4 shrink-0" style={{ color: 'var(--text-faint)' }} strokeWidth={1.8} />
                            <span className="min-w-0 flex-1 truncate text-[13px]" style={{ color: 'var(--text-primary)' }}>{r.label}</span>
                            <span
                              className="shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
                              style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-faint)' }}
                            >
                              {categoryLabel(r.category)}
                            </span>
                            <ArrowRight className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--text-faint)' }} strokeWidth={1.8} />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Category chips */}
      <div className="mb-7 flex flex-wrap gap-2" role="tablist" aria-label="Settings categories">
        {CATEGORIES.map((c) => {
          const active = c.id === activeCategory
          const Icon = c.icon
          return (
            <button
              key={c.id}
              role="tab"
              aria-selected={active}
              onClick={() => selectCategory(c.id)}
              className="flex items-center gap-2 rounded-xl px-3.5 py-2 text-[13px] font-medium transition-all"
              style={{
                background: active ? 'var(--accent)' : 'var(--bg-subtle-2)',
                color: active ? 'var(--text-on-accent)' : 'var(--text-muted)',
                border: active ? '1px solid transparent' : '1px solid var(--border-medium)',
              }}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
              {categoryLabel(c.id)}
            </button>
          )
        })}
      </div>

      {/* At a glance */}
      {activeCategory === 'general' && (
        <div className="mb-7 rounded-2xl p-5" style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}>
          <p className="mb-3 text-[11px] font-medium uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{t('overviewLabel')}</p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <OverviewPill label={t('overviewTheme')} value={cap(settings.theme)} />
            <OverviewPill label={t('overviewNotifications')} value={settings.showNotificationOnComplete ? t('overviewOn') : t('overviewOff')} />
            <OverviewPill label={t('overviewAutoUpdate')} value={settings.autoUpdate ? t('overviewOn') : t('overviewOff')} />
            <OverviewPill label={t('overviewAlerts')} value={settings.alerts.enabled ? t('overviewOn') : t('overviewOff')} />
            <OverviewPill
              label={t('overviewScheduledScan')}
              value={secSettings?.autoProbeEnabled ? `${secSettings.autoProbeIntervalHours}${tSec('intervalHoursUnit', 'h')}` : t('overviewDisabled')}
            />
          </div>
        </div>
      )}

      {activeCategory === 'general' && (
        <GeneralPanel settings={settings} save={save} saveStartup={saveStartup} saveTray={saveTray} highlightId={highlightId} />
      )}
      {activeCategory === 'alerts' && (
        <AlertsPanel settings={settings} save={save} highlightId={highlightId} />
      )}
      {activeCategory === 'backups' && (
        <BackupsPanel settings={settings} save={save} features={features} highlightId={highlightId} />
      )}
      {activeCategory === 'cleaning' && (
        <CleaningPanel settings={settings} save={save} features={features} platform={platform} highlightId={highlightId} />
      )}
      {activeCategory === 'exclusions' && (
        <ExclusionsPanel settings={settings} save={save} platform={platform} highlightId={highlightId} />
      )}
      {activeCategory === 'security' && <SecurityPanel highlightId={highlightId} />}

      {/* Reset */}
      <div className="mt-8 rounded-2xl border p-5" style={{ background: 'var(--card-bg)', borderColor: 'var(--border-default)' }}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: 'rgba(239,68,68,0.1)' }}>
              <RotateCcw className="h-[18px] w-[18px]" style={{ color: '#ef4444' }} strokeWidth={1.8} />
            </div>
            <div>
              <p className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>{t('resetButton')}</p>
              <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{t('resetButtonDesc')}</p>
            </div>
          </div>
          <button
            onClick={() => setResetOpen(true)}
            className="shrink-0 rounded-xl px-4 py-2 text-[13px] font-medium transition-colors"
            style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.2)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.12)' }}
          >
            {t('resetButton')}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={resetOpen}
        title={t('resetDialogTitle')}
        description={t('resetDialogDesc')}
        confirmLabel={t('resetConfirm')}
        variant="danger"
        onCancel={() => setResetOpen(false)}
        onConfirm={() => { setResetOpen(false); void handleReset() }}
      />
    </div>
  )
}

/* ─────────────────────────────── General ─────────────────────────────── */

function GeneralPanel({ settings, save, saveStartup, saveTray, highlightId }: {
  settings: ClaritySettings
  save: (p: Partial<ClaritySettings>) => void
  saveStartup: (v: boolean) => void
  saveTray: (v: boolean) => void
  highlightId: string | null
}) {
  const { t } = useTranslation('settings')
  const highlight = (id: string) => highlightId === id

  return (
    <>
      <Section title={t('groupAppearance')}>
        <Row id="s-theme" label={t('themeLabel')} desc={t('themeDesc')} highlight={highlight('s-theme')}>
          <ThemeSelector value={settings.theme} onChange={(v) => save({ theme: v })} />
        </Row>
        <Row id="s-language" label={t('languageLabel')} desc={t('languageDesc')} last highlight={highlight('s-language')}>
          <SelectField
            value={settings.language}
            label={t('languageLabel')}
            options={LANGUAGES.map((l) => ({ value: l.code, label: `${l.nativeName} (${l.name})` }))}
            onChange={(v) => {
              save({ language: v })
              i18next.changeLanguage(v)
            }}
          />
        </Row>
      </Section>

      <Section title={t('groupApplication')}>
        <Row id="s-startup" label={t('runAtStartupLabel')} desc={t('runAtStartupDesc')} highlight={highlight('s-startup')}>
          <Toggle checked={settings.runAtStartup} label={t('runAtStartupLabel')} onChange={saveStartup} />
        </Row>
        <Row id="s-tray" label={t('minimizeToTrayLabel')} desc={t('minimizeToTrayDesc')} last highlight={highlight('s-tray')}>
          <Toggle checked={settings.minimizeToTray} label={t('minimizeToTrayLabel')} onChange={saveTray} />
        </Row>
      </Section>

      <Section title={t('groupNotifications')}>
        <Row id="s-notifications" label={t('showNotificationsLabel')} desc={t('showNotificationsDesc')} highlight={highlight('s-notifications')}>
          <Toggle checked={settings.showNotificationOnComplete} label={t('showNotificationsLabel')} onChange={(v) => save({ showNotificationOnComplete: v })} />
        </Row>
        <Row id="s-threats" label={t('threatDetectionAlertsLabel')} desc={t('threatDetectionAlertsDesc')} last highlight={highlight('s-threats')}>
          <Toggle checked={settings.showThreatNotifications} label={t('threatDetectionAlertsLabel')} onChange={(v) => save({ showThreatNotifications: v })} />
        </Row>
      </Section>

      <Section title={t('groupUpdates')}>
        <Row id="s-autoupdate" label={t('autoUpdateLabel')} desc={t('autoUpdateDesc')} highlight={highlight('s-autoupdate')}>
          <Toggle checked={settings.autoUpdate} label={t('autoUpdateLabel')} onChange={(v) => save({ autoUpdate: v })} />
        </Row>
        <Row
          id="s-autorestart"
          label={t('autoRestartLabel')}
          desc={t('autoRestartDesc')}
          disabled={!settings.autoUpdate}
          disabledNote={t('dependsOn', { setting: t('autoUpdateLabel') })}
          highlight={highlight('s-autorestart')}
        >
          <Toggle checked={settings.autoRestart} label={t('autoRestartLabel')} disabled={!settings.autoUpdate} onChange={(v) => save({ autoRestart: v })} />
        </Row>
        <Row id="s-updateinterval" label={t('updateCheckIntervalLabel')} desc={t('updateCheckIntervalDesc')} last highlight={highlight('s-updateinterval')}>
          <SelectField
            value={settings.updateCheckIntervalHours}
            label={t('updateCheckIntervalLabel')}
            options={[
              { value: 1, label: t('updateCheckEveryHour') },
              { value: 4, label: t('updateCheckEvery4Hours') },
              { value: 12, label: t('updateCheckEvery12Hours') },
              { value: 24, label: t('updateCheckOnceADay') },
            ]}
            onChange={(v) => save({ updateCheckIntervalHours: v })}
          />
        </Row>
      </Section>
    </>
  )
}

/* ─────────────────────────────── Alerts ─────────────────────────────── */

function AlertsPanel({ settings, save, highlightId }: {
  settings: ClaritySettings
  save: (p: Partial<ClaritySettings>) => void
  highlightId: string | null
}) {
  const { t } = useTranslation('settings')
  const alerts = settings.alerts
  const active = alerts.enabled
  const note = t('dependsOn', { setting: t('alertsEnabledLabel') })
  const highlight = (id: string) => highlightId === id
  const setAlert = (patch: Partial<ClaritySettings['alerts']>) => save({ alerts: { ...alerts, ...patch } })

  return (
    <>
      <Section title={t('groupNotificationChannels')}>
        <Row id="s-alerts-master" label={t('alertsEnabledLabel')} desc={t('alertsEnabledDesc')} highlight={highlight('s-alerts-master')}>
          <Toggle checked={alerts.enabled} label={t('alertsEnabledLabel')} onChange={(v) => setAlert({ enabled: v })} />
        </Row>
        <Row id="s-alerts-inapp" label={t('alertsInAppLabel')} desc={t('alertsInAppDesc')} disabled={!active} disabledNote={note} highlight={highlight('s-alerts-inapp')}>
          <Toggle checked={alerts.showInApp} label={t('alertsInAppLabel')} disabled={!active} onChange={(v) => setAlert({ showInApp: v })} />
        </Row>
        <Row id="s-alerts-system" label={t('alertsSystemLabel')} desc={t('alertsSystemDesc')} disabled={!active} disabledNote={note} last highlight={highlight('s-alerts-system')}>
          <Toggle checked={alerts.showSystem} label={t('alertsSystemLabel')} disabled={!active} onChange={(v) => setAlert({ showSystem: v })} />
        </Row>
      </Section>

      <Section title={t('groupThresholds')}>
        <Row id="s-alerts-cpu" label={t('alertsCpuUsageLabel')} desc={t('alertsCpuUsageDesc')} disabled={!active} disabledNote={note} highlight={highlight('s-alerts-cpu')}>
          <ThresholdSlider value={alerts.cpuUsageThreshold} min={50} max={100} step={1} unit="%" label={t('alertsCpuUsageLabel')} disabled={!active} onChange={(v) => setAlert({ cpuUsageThreshold: v })} />
        </Row>
        <Row id="s-alerts-cpu-temp" label={t('alertsCpuTempLabel')} desc={t('alertsCpuTempDesc')} disabled={!active} disabledNote={note} highlight={highlight('s-alerts-cpu-temp')}>
          <ThresholdSlider value={alerts.cpuTempThreshold} min={60} max={100} step={1} unit="°C" label={t('alertsCpuTempLabel')} disabled={!active} onChange={(v) => setAlert({ cpuTempThreshold: v })} />
        </Row>
        <Row id="s-alerts-memory" label={t('alertsMemoryLabel')} desc={t('alertsMemoryDesc')} disabled={!active} disabledNote={note} highlight={highlight('s-alerts-memory')}>
          <ThresholdSlider value={alerts.memoryThreshold} min={50} max={100} step={1} unit="%" label={t('alertsMemoryLabel')} disabled={!active} onChange={(v) => setAlert({ memoryThreshold: v })} />
        </Row>
        <Row id="s-alerts-disk" label={t('alertsDiskLabel')} desc={t('alertsDiskDesc')} disabled={!active} disabledNote={note} highlight={highlight('s-alerts-disk')}>
          <ThresholdSlider value={alerts.diskSpaceThresholdGb} min={1} max={100} step={1} unit=" GB" label={t('alertsDiskLabel')} disabled={!active} onChange={(v) => setAlert({ diskSpaceThresholdGb: v })} />
        </Row>
        <Row id="s-alerts-battery" label={t('alertsBatteryLabel')} desc={t('alertsBatteryDesc')} disabled={!active} disabledNote={note} highlight={highlight('s-alerts-battery')}>
          <ThresholdSlider value={alerts.batteryThreshold} min={5} max={50} step={1} unit="%" label={t('alertsBatteryLabel')} disabled={!active} onChange={(v) => setAlert({ batteryThreshold: v })} />
        </Row>
      </Section>

      <Section title={t('groupAlertBehavior')}>
        <Row id="s-alerts-cooldown" label={t('alertsCooldownLabel')} desc={t('alertsCooldownDesc')} disabled={!active} disabledNote={note} last highlight={highlight('s-alerts-cooldown')}>
          <ThresholdSlider value={alerts.cooldownMinutes} min={1} max={120} step={1} unit={t('alertsCooldownUnit')} label={t('alertsCooldownLabel')} disabled={!active} onChange={(v) => setAlert({ cooldownMinutes: v })} />
        </Row>
      </Section>
    </>
  )
}

/* ─────────────────────────────── Backups ─────────────────────────────── */

function BackupsPanel({ settings, save, features, highlightId }: {
  settings: ClaritySettings
  save: (p: Partial<ClaritySettings>) => void
  features: { registry: boolean }
  highlightId: string | null
}) {
  const { t } = useTranslation('settings')

  if (!features.registry) {
    return (
      <div className="rounded-2xl p-10 text-center" style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}>
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: 'var(--bg-subtle)' }}>
          <DatabaseBackup className="h-6 w-6" style={{ color: 'var(--text-faint)' }} strokeWidth={1.5} />
        </div>
        <p className="mx-auto max-w-sm text-[13px]" style={{ color: 'var(--text-muted)' }}>{t('backupsWindowsOnlyHint')}</p>
        <span
          className="mt-4 inline-block rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide"
          style={{ borderColor: 'var(--border-medium)', color: 'var(--text-faint)' }}
        >
          {t('windowsOnly')}
        </span>
      </div>
    )
  }

  return (
    <>
      <Section title={t('groupBackupLocation')}>
        <BackupFolderRow
          settings={settings}
          highlight={highlightId === 's-backup-folder'}
          onPick={async () => {
            const picked = await window.clarity?.settingsSelectBackupDir?.()
            if (picked) {
              save({ backupPath: picked })
              toast.success(t('backupFolderUpdatedToast'), {
                description: t('backupFolderUpdatedDesc'),
              })
            }
          }}
          onOpen={() => { window.clarity?.settingsOpenBackupDir?.().catch(() => {}) }}
          onReset={() => save({ backupPath: '' })}
        />
      </Section>

      <Section title={t('groupRegistryBackups')}>
        <Row id="s-backup-mode" label={t('backupModeLabel')} desc={t('backupModeDesc')} last highlight={highlightId === 's-backup-mode'}>
          <SelectField
            value={settings.backupMode ?? 'targeted'}
            label={t('backupModeLabel')}
            options={[
              { value: 'targeted' as const, label: t('backupModeTargeted') },
              { value: 'full' as const, label: t('backupModeFull') },
            ]}
            onChange={(v) => save({ backupMode: v })}
          />
        </Row>
      </Section>
    </>
  )
}

/* ─────────────────────────────── Cleaning ─────────────────────────────── */

function CleaningPanel({ settings, save, features, platform, highlightId }: {
  settings: ClaritySettings
  save: (p: Partial<ClaritySettings>) => void
  features: { restorePoint: boolean }
  platform: string
  highlightId: string | null
}) {
  const { t } = useTranslation('settings')
  const c = settings.cleaner
  const highlight = (id: string) => highlightId === id
  const setCleaner = (patch: Partial<ClaritySettings['cleaner']>) => save({ cleaner: { ...c, ...patch } })

  return (
    <>
      <Section title={t('groupSafety')}>
        <Row
          id="s-cleaning-recycle"
          label={t('protectRecycleBinLabel')}
          desc={t('protectRecycleBinDesc')}
          tag={platform !== 'win32' ? t('windowsOnly') : undefined}
          highlight={highlight('s-cleaning-recycle')}
        >
          <Toggle checked={c.protectRecycleBin} label={t('protectRecycleBinLabel')} onChange={(v) => setCleaner({ protectRecycleBin: v })} />
        </Row>
      </Section>

      <Section title={t('groupDataSecurity')}>
        <Row id="s-cleaning-secure" label={t('secureDeleteLabel')} desc={t('secureDeleteDesc')} highlight={highlight('s-cleaning-secure')}>
          <Toggle checked={c.secureDelete} label={t('secureDeleteLabel')} onChange={(v) => setCleaner({ secureDelete: v })} />
        </Row>
      </Section>

      <Section title={t('groupBrowserHandling')}>
        <Row id="s-cleaning-browsers" label={t('closeBrowsersLabel')} desc={t('closeBrowsersDesc')} last highlight={highlight('s-cleaning-browsers')}>
          <Toggle checked={c.closeBrowsersBeforeClean} label={t('closeBrowsersLabel')} onChange={(v) => setCleaner({ closeBrowsersBeforeClean: v })} />
        </Row>
      </Section>

      {features.restorePoint && (
        <Section title={t('groupSystemProtection')}>
          <Row id="s-cleaning-restore" label={t('createRestorePointLabel')} desc={t('createRestorePointDesc')} last highlight={highlight('s-cleaning-restore')}>
            <Toggle checked={c.createRestorePoint} label={t('createRestorePointLabel')} onChange={(v) => setCleaner({ createRestorePoint: v })} />
          </Row>
        </Section>
      )}

      <Section title={t('groupHistory')}>
        <Row id="s-cleaning-log" label={t('keepDeletionLogLabel')} desc={t('keepDeletionLogDesc')} last highlight={highlight('s-cleaning-log')}>
          <Toggle checked={c.keepDeletionLog} label={t('keepDeletionLogLabel')} onChange={(v) => setCleaner({ keepDeletionLog: v })} />
        </Row>
      </Section>

      <Section title={t('groupCleanupRules')}>
        <Row id="s-cleaning-skip" label={t('skipRecentFilesLabel')} desc={t('skipRecentFilesDesc')} last highlight={highlight('s-cleaning-skip')}>
          <SelectField
            value={c.skipRecentMinutes}
            label={t('skipRecentFilesLabel')}
            options={[
              { value: 30, label: t('skipRecent30Min') },
              { value: 60, label: t('skipRecent1Hour') },
              { value: 120, label: t('skipRecent2Hours') },
              { value: 1440, label: t('skipRecent24Hours') },
            ]}
            onChange={(v) => setCleaner({ skipRecentMinutes: v })}
          />
        </Row>
      </Section>
    </>
  )
}

/* ─────────────────────────────── Exclusions ─────────────────────────────── */

const MAX_EXCLUSIONS = 200

function ExclusionsPanel({ settings, save, platform, highlightId }: {
  settings: ClaritySettings
  save: (p: Partial<ClaritySettings>) => void
  platform: string
  highlightId: string | null
}) {
  const { t } = useTranslation('settings')
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const add = () => {
    const v = value.trim()
    if (!v) return
    if (settings.exclusions.length >= MAX_EXCLUSIONS) {
      toast.error(t('exclusionMaxReached'))
      return
    }
    const isDrivePath = /^[A-Za-z]:[\\/]/.test(v)
    const isUncPath = /^\\\\[A-Za-z0-9]/.test(v)
    const isUnixPath = /^\/[A-Za-z0-9]/.test(v)
    const isGlob = /^\*\.[A-Za-z0-9]+$/.test(v)
    if (v.includes('..') || (!isDrivePath && !isUncPath && !isUnixPath && !isGlob)) {
      toast.error(t('exclusionInvalid'))
      return
    }
    if (settings.exclusions.some((e) => e.toLowerCase() === v.toLowerCase())) {
      toast.error(t('exclusionDuplicate'))
      return
    }
    save({ exclusions: [...settings.exclusions, v] })
    setValue('')
    toast.success(t('exclusionAdded'))
  }

  const remove = (index: number) => {
    save({ exclusions: settings.exclusions.filter((_, j) => j !== index) })
    toast.success(t('exclusionRemoved'))
  }

  const isGlob = (v: string) => /^\*\.[A-Za-z0-9]+$/.test(v)

  return (
    <div id="s-exclusion-add" className={cn('mb-7 rounded-2xl p-5', highlightId === 's-exclusion-add' && 'setting-highlight')} style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}>
      {settings.exclusions.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title={t('exclusionEmptyTitle')}
          description={t('exclusionEmptyDesc')}
          className="py-10"
          action={
            <button
              onClick={() => inputRef.current?.focus()}
              className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-[13px] font-medium transition-colors"
              style={{ background: 'var(--bg-subtle-2)', border: '1px solid var(--border-medium)', color: 'var(--text-muted)' }}
            >
              <Plus className="h-3.5 w-3.5" /> {t('addButton')}
            </button>
          }
        />
      ) : (
        <div className="space-y-2">
          <p className="pb-1 text-[12px]" style={{ color: 'var(--text-faint)' }}>{t('exclusionEmptyDesc')}</p>
          {settings.exclusions.map((exc, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 rounded-xl px-4 py-2.5"
              style={{ background: 'var(--bg-subtle)' }}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <FolderOpen className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--text-muted)' }} strokeWidth={1.8} />
                <span className="truncate font-mono text-[12px]" style={{ color: 'var(--text-primary)' }}>{exc}</span>
                <span
                  className="shrink-0 rounded px-1.5 py-px text-[10px] uppercase tracking-wide"
                  style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-faint)' }}
                >
                  {isGlob(exc) ? t('exclusionTypeExtension') : t('exclusionTypePath')}
                </span>
              </div>
              <button
                onClick={() => remove(i)}
                aria-label={t('exclusionRemove')}
                className="shrink-0 rounded-lg p-1.5 transition-colors"
                style={{ color: 'var(--text-muted)' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center gap-2.5">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder={platform === 'win32' ? t('exclusionPlaceholderWindows') : t('exclusionPlaceholderOther')}
          className="flex-1 rounded-xl px-4 py-2.5 text-[13px] outline-none placeholder:text-zinc-700"
          style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
        />
        <button
          onClick={add}
          className="flex shrink-0 items-center gap-1.5 rounded-xl px-4 py-2.5 text-[13px] font-medium transition-colors"
          style={{ background: 'var(--bg-subtle-2)', border: '1px solid var(--border-medium)', color: 'var(--text-muted)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-subtle-2)' }}
        >
          <Plus className="h-3.5 w-3.5" /> {t('addButton')}
        </button>
      </div>
    </div>
  )
}

/* ─────────────────────────────── Security ─────────────────────────────── */

function SecurityPanel({ highlightId }: { highlightId: string | null }) {
  const { t } = useTranslation('security')
  const { t: ts } = useTranslation('settings')
  const settings = useSecurityStore((s) => s.settings)
  const loadSettings = useSecurityStore((s) => s.loadSettings)
  const updateSettings = useSecurityStore((s) => s.updateSettings)
  const [newPort, setNewPort] = useState('')
  const [newDesc, setNewDesc] = useState('')

  useEffect(() => { void loadSettings() }, [loadSettings])

  const highlight = (id: string) => highlightId === id
  const enabled = settings?.autoProbeEnabled ?? false
  const ports = settings?.customPorts ?? []

  const save = (patch: Partial<SecuritySettings>) => {
    void updateSettings(patch)
  }

  const addPort = () => {
    const port = Number.parseInt(newPort, 10)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      toast.error(t('customInvalid'))
      return
    }
    if (ports.some((c) => c.port === port)) {
      toast.error(t('customDuplicate', { port }))
      return
    }
    save({ customPorts: [...ports, { port, description: newDesc.trim() }] })
    setNewPort('')
    setNewDesc('')
    toast.success(t('customAdded', { port }))
  }

  const removePort = (port: number) => {
    save({ customPorts: ports.filter((c) => c.port !== port) })
    toast.success(t('customRemoved'))
  }

  return (
    <>
      <Section title={ts('groupScheduledScans')}>
        <Row id="s-security-scan-toggle" label={t('autoProbeLabel')} desc={t('autoProbeDesc')} highlight={highlight('s-security-scan-toggle')}>
          <Toggle checked={enabled} label={t('autoProbeLabel')} onChange={(v) => save({ autoProbeEnabled: v })} />
        </Row>
        <Row
          id="s-security-scan-interval"
          label={t('intervalHours')}
          desc={t('autoProbeDesc')}
          disabled={!enabled}
          disabledNote={t('intervalInactive')}
          last
          highlight={highlight('s-security-scan-interval')}
        >
          <SelectField
            value={settings?.autoProbeIntervalHours ?? 6}
            label={t('intervalHours')}
            disabled={!enabled}
            options={[1, 3, 6, 12, 24, 168].map((h) => ({ value: h, label: `${h} ${t('intervalHoursUnit', 'h')}` }))}
            onChange={(v) => save({ autoProbeIntervalHours: v })}
          />
        </Row>
      </Section>

      <Section title={ts('groupRiskInspector')}>
        <Row id="s-security-inspect" label={t('inspectAutoLabel')} desc={t('inspectAutoDesc')} last highlight={highlight('s-security-inspect')}>
          <Toggle checked={settings?.inspectAutomatically ?? true} label={t('inspectAutoLabel')} onChange={(v) => save({ inspectAutomatically: v })} />
        </Row>
      </Section>

      <Section title={ts('groupCustomPorts')}>
        <div id="s-security-ports" className={cn(highlightId === 's-security-ports' && 'setting-highlight')}>
          <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{t('customPortsDesc')}</p>
          <div className="mt-3 space-y-2">
            {ports.length === 0 && (
              <p className="rounded-xl px-4 py-3 text-[12px]" style={{ background: 'var(--bg-subtle)', color: 'var(--text-faint)' }}>
                {t('customPortsEmpty')}
              </p>
            )}
            {ports.map((c) => (
              <div key={c.port} className="flex items-center justify-between gap-3 rounded-xl px-4 py-2.5" style={{ background: 'var(--bg-subtle)' }}>
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="shrink-0 font-mono text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>{c.port}</span>
                  {c.description && <span className="truncate text-[12px]" style={{ color: 'var(--text-muted)' }}>{c.description}</span>}
                  <span className="shrink-0 rounded px-1.5 py-px text-[10px] uppercase tracking-wide" style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-faint)' }}>
                    {t('customMonitored')}
                  </span>
                </div>
                <button
                  onClick={() => removePort(c.port)}
                  aria-label={t('customRemove')}
                  className="shrink-0 rounded-lg p-1.5 transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2.5">
              <input
                type="text"
                value={newPort}
                onChange={(e) => setNewPort(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && addPort()}
                inputMode="numeric"
                placeholder={t('customPortPlaceholder')}
                aria-label={t('customPortPlaceholder')}
                className="w-28 rounded-xl px-4 py-2.5 font-mono text-[13px] outline-none placeholder:text-zinc-700"
                style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
              />
              <input
                type="text"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addPort()}
                placeholder={t('customDescPlaceholder')}
                className="min-w-0 flex-1 rounded-xl px-4 py-2.5 text-[13px] outline-none placeholder:text-zinc-700"
                style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
              />
              <button
                onClick={addPort}
                className="flex shrink-0 items-center gap-1.5 rounded-xl px-4 py-2.5 text-[13px] font-medium transition-colors"
                style={{ background: 'var(--bg-subtle-2)', border: '1px solid var(--border-medium)', color: 'var(--text-muted)' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-subtle-2)' }}
              >
                <Plus className="h-3.5 w-3.5" /> {t('customAdd')}
              </button>
            </div>
          </div>
        </div>
      </Section>
    </>
  )
}

/* ─────────────────────────────── Shared UI ─────────────────────────────── */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-7">
      <h3 className="mb-3 text-[11px] font-medium uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{title}</h3>
      <div className="rounded-2xl p-5" style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}>{children}</div>
    </div>
  )
}

function Row({ id, label, desc, tag, children, last, disabled, disabledNote, highlight }: {
  id: string
  label: string
  desc?: string
  tag?: string
  children: ReactNode
  last?: boolean
  disabled?: boolean
  disabledNote?: string
  highlight?: boolean
}) {
  const { t } = useTranslation('settings')
  return (
    <div
      id={id}
      className={cn(
        'flex items-center justify-between gap-6 py-3.5',
        !last && 'border-b',
        highlight && 'setting-highlight',
        disabled && 'opacity-55'
      )}
      style={!last ? { borderColor: 'var(--border-subtle)' } : undefined}
      aria-disabled={disabled || undefined}
    >
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>
          {label}
          {tag && (
            <span className="rounded border px-1.5 py-px text-[10px] uppercase tracking-wide" style={{ borderColor: 'var(--border-medium)', color: 'var(--text-faint)' }}>
              {tag}
            </span>
          )}
        </p>
        {disabled && disabledNote ? (
          <p className="mt-0.5 flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--text-faint)' }}>
            <span className="rounded border px-1.5 py-px text-[10px] uppercase tracking-wide" style={{ borderColor: 'var(--border-medium)', color: 'var(--text-faint)' }}>
              {t('inactiveBadge')}
            </span>
            {disabledNote}
          </p>
        ) : desc ? (
          <p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>{desc}</p>
        ) : null}
      </div>
      <div className={cn('shrink-0', disabled && 'pointer-events-none')}>{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange, label, disabled }: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative h-[26px] w-[46px] shrink-0 rounded-full transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed"
      style={{ background: checked ? 'var(--accent)' : 'var(--bg-active)' }}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-[3px] h-5 w-5 rounded-full bg-white shadow-sm transition-[left] duration-200',
          checked ? 'left-[23px]' : 'left-[3px]'
        )}
      />
    </button>
  )
}

function ThresholdSlider({ value, min, max, step = 1, unit, label, onChange, disabled }: {
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  label: string
  onChange: (v: number) => void
  disabled?: boolean
}) {
  const pct = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
  return (
    <div className="flex w-[240px] items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="setting-slider min-w-0 flex-1"
        style={{ '--fill': `${pct}%` } as CSSProperties}
      />
      <span className="w-[54px] shrink-0 rounded-md px-1.5 py-0.5 text-center font-mono text-[12px] font-medium tabular-nums" style={{ background: 'var(--bg-subtle)', color: 'var(--text-primary)' }}>
        {value}{unit}
      </span>
    </div>
  )
}

function SelectField<T extends string | number>({ value, options, onChange, label, disabled }: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (v: T) => void
  label: string
  disabled?: boolean
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      aria-label={label}
      onChange={(e) => {
        const next = options.find((o) => String(o.value) === e.target.value)
        if (next) onChange(next.value)
      }}
      className="rounded-lg px-3 py-1.5 text-[12px] font-medium outline-none disabled:cursor-not-allowed"
      style={{
        background: 'var(--bg-subtle)',
        color: 'var(--text-primary)',
        border: '1px solid var(--border-medium)',
      }}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

function ThemeSelector({ value, onChange }: { value: 'dark' | 'light' | 'system'; onChange: (v: 'dark' | 'light' | 'system') => void }) {
  const options: Array<{ id: 'dark' | 'light' | 'system'; icon: LucideIcon; label: string }> = [
    { id: 'dark', icon: Moon, label: 'Dark' },
    { id: 'light', icon: Sun, label: 'Light' },
    { id: 'system', icon: Monitor, label: 'System' },
  ]
  return (
    <div className="flex gap-1 rounded-lg p-0.5" style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)' }}>
      {options.map((opt) => {
        const active = value === opt.id
        const Icon = opt.icon
        return (
          <button
            key={opt.id}
            onClick={() => onChange(opt.id)}
            aria-pressed={active}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-all"
            style={{
              background: active ? 'var(--accent)' : 'transparent',
              color: active ? 'var(--text-on-accent)' : 'var(--text-muted)',
            }}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function OverviewPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl px-3.5 py-2.5" style={{ background: 'var(--bg-subtle)' }}>
      <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{label}</p>
      <p className="mt-0.5 text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</p>
    </div>
  )
}

function BackupFolderRow({ settings, highlight, onPick, onOpen, onReset }: {
  settings: ClaritySettings
  highlight: boolean
  onPick: () => void
  onOpen: () => void
  onReset: () => void
}) {
  const { t } = useTranslation('settings')
  const isCustom = settings.backupPath.length > 0
  const displayPath = isCustom ? settings.backupPath : t('backupFolderDefaultLabel')

  return (
    <div id="s-backup-folder" className={cn('space-y-3', highlight && 'setting-highlight')}>
      <div>
        <p className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>{t('backupFolderLabel')}</p>
        <p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>{t('backupFolderDesc')}</p>
      </div>
      <div className="flex items-center gap-2.5">
        <div
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-4 py-2.5"
          style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)' }}
        >
          <FolderOpen className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--text-muted)' }} strokeWidth={1.8} />
          <span className="truncate font-mono text-[12px]" style={{ color: 'var(--text-muted)' }} title={displayPath}>{displayPath}</span>
        </div>
        <button
          onClick={onOpen}
          title={t('backupFolderOpenAction')}
          aria-label={t('backupFolderOpenAction')}
          className="shrink-0 rounded-xl p-2.5 transition-colors"
          style={{ background: 'var(--bg-subtle-2)', border: '1px solid var(--border-medium)', color: 'var(--text-muted)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-subtle-2)' }}
        >
          <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
        {isCustom && (
          <button
            onClick={onReset}
            title={t('backupFolderResetTooltip')}
            aria-label={t('backupFolderResetTooltip')}
            className="shrink-0 rounded-xl p-2.5 transition-colors"
            style={{ background: 'var(--bg-subtle-2)', border: '1px solid var(--border-medium)', color: 'var(--text-muted)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-subtle-2)' }}
          >
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
        )}
        <button
          onClick={onPick}
          className="shrink-0 rounded-xl px-4 py-2.5 text-[13px] font-medium transition-colors"
          style={{ background: 'var(--bg-subtle-2)', border: '1px solid var(--border-medium)', color: 'var(--text-muted)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-subtle-2)' }}
        >
          {t('backupFolderChooseButton')}
        </button>
      </div>
    </div>
  )
}
