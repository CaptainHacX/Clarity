import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpDown,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  Eye,
  EyeOff,
  Filter,
  Loader2,
  Package,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { StatCard } from '@/components/shared/StatCard'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { useUpdaterStore, severityOrder, appKey } from '@/stores/updater-store'
import { useHistoryStore } from '@/stores/history-store'
import { useSettingsStore } from '@/stores/settings-store'
import { usePlatform } from '@/hooks/usePlatform'
import { cn } from '@/lib/utils'
import type { UpdateProgress, UpdatableApp, UpToDateApp, WindowsPackageManager } from '@shared/types'

/** Windows managers Clarity can aggregate, with their display labels. */
const WINDOWS_MANAGER_OPTIONS: { id: WindowsPackageManager; label: string }[] = [
  { id: 'winget', label: 'winget' },
  { id: 'choco', label: 'Chocolatey' },
  { id: 'scoop', label: 'Scoop' },
  { id: 'npm', label: 'npm' },
]
const DEFAULT_WINDOWS_MANAGERS: WindowsPackageManager[] = ['winget', 'choco', 'scoop', 'npm']

const SEVERITY_STYLES_BASE: Record<UpdatableApp['severity'], { bg: string; border: string; text: string; labelKey: string }> = {
  major: {
    bg: 'rgba(239,68,68,0.08)',
    border: 'rgba(239,68,68,0.18)',
    text: '#f87171',
    labelKey: 'softwareUpdater.severityMajor',
  },
  minor: {
    bg: 'rgba(245,158,11,0.08)',
    border: 'rgba(245,158,11,0.18)',
    text: '#fbbf24',
    labelKey: 'softwareUpdater.severityMinor',
  },
  patch: {
    bg: 'rgba(34,197,94,0.08)',
    border: 'rgba(34,197,94,0.18)',
    text: '#4ade80',
    labelKey: 'softwareUpdater.severityPatch',
  },
  unknown: {
    bg: 'rgba(113,113,122,0.08)',
    border: 'rgba(113,113,122,0.18)',
    text: '#a1a1aa',
    labelKey: 'softwareUpdater.severityUnknown',
  },
}

const SORT_LABEL_KEYS: Record<string, string> = {
  name: 'softwareUpdater.sortName',
  severity: 'softwareUpdater.sortSeverity',
  source: 'softwareUpdater.sortSource',
  currentVersion: 'softwareUpdater.sortCurrentVersion',
  availableVersion: 'softwareUpdater.sortAvailableVersion',
}

const FILTER_LABEL_KEYS: Record<string, string> = {
  all: 'softwareUpdater.filterAll',
  major: 'softwareUpdater.filterMajor',
  minor: 'softwareUpdater.filterMinor',
  patch: 'softwareUpdater.filterPatch',
  unknown: 'softwareUpdater.filterUnknown',
}

/** Numeric-aware semver-ish comparison so 12.10.0 sorts after 12.2.0. */
function compareVersions(a: string, b: string): number {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na !== nb) return na - nb
  }
  return 0
}

/** Skeleton bar for loading rows (shimmer keyframe is theme-aware). */
function SkeletonBar({ className }: { className?: string }) {
  return (
    <div
      className={cn('animate-shimmer rounded-md', className)}
      style={{
        background:
          'linear-gradient(90deg, var(--bg-subtle) 25%, var(--bg-hover) 50%, var(--bg-subtle) 75%)',
        backgroundSize: '200% 100%',
      }}
    />
  )
}

export function SoftwareUpdaterPage({ embedded }: { embedded?: boolean }) {
  const { t } = useTranslation('updates')
  const apps = useUpdaterStore((s) => s.apps)
  const loading = useUpdaterStore((s) => s.loading)
  const updating = useUpdaterStore((s) => s.updating)
  const progress = useUpdaterStore((s) => s.progress)
  const updateResult = useUpdaterStore((s) => s.updateResult)
  const error = useUpdaterStore((s) => s.error)
  const hasChecked = useUpdaterStore((s) => s.hasChecked)
  const packageManagerAvailable = useUpdaterStore((s) => s.packageManagerAvailable)
  const packageManagerName = useUpdaterStore((s) => s.packageManagerName)
  const managers = useUpdaterStore((s) => s.managers)
  const searchQuery = useUpdaterStore((s) => s.searchQuery)
  const sortField = useUpdaterStore((s) => s.sortField)
  const sortDirection = useUpdaterStore((s) => s.sortDirection)
  const severityFilter = useUpdaterStore((s) => s.severityFilter)
  const upToDate = useUpdaterStore((s) => s.upToDate)
  const ignoredApps = useUpdaterStore((s) => s.ignoredApps)

  const { platform } = usePlatform()
  const windowsPackageManagers = useSettingsStore((s) => s.settings.windowsPackageManagers)
  const enabledManagers = windowsPackageManagers ?? DEFAULT_WINDOWS_MANAGERS

  const [showSortMenu, setShowSortMenu] = useState(false)
  const [showFilterMenu, setShowFilterMenu] = useState(false)
  const [showUpToDate, setShowUpToDate] = useState(false)
  const [showIgnored, setShowIgnored] = useState(false)
  const [singleUpdateKey, setSingleUpdateKey] = useState<string | null>(null)
  const sortMenuRef = useRef<HTMLDivElement>(null)
  const filterMenuRef = useRef<HTMLDivElement>(null)

  // Listen for progress events
  useEffect(() => {
    const cleanup = window.clarity.onSoftwareUpdateProgress((data: UpdateProgress) => {
      useUpdaterStore.getState().setProgress(data)
    })
    return () => {
      cleanup()
    }
  }, [])

  // Load persisted ignore list from settings, then auto-scan on first visit
  useEffect(() => {
    window.clarity
      .settingsGet()
      .then((settings) => {
        if (settings.ignoredSoftwareUpdates?.length) {
          useUpdaterStore.getState().loadIgnoredIds(settings.ignoredSoftwareUpdates)
        }
      })
      .catch(() => {})
      .finally(() => {
        const s = useUpdaterStore.getState()
        if (!s.hasChecked && !s.loading) handleCheck()
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Close menus on outside click
  useEffect(() => {
    if (!showSortMenu && !showFilterMenu) return
    const handler = (e: globalThis.MouseEvent) => {
      if (showSortMenu && sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node))
        setShowSortMenu(false)
      if (
        showFilterMenu &&
        filterMenuRef.current &&
        !filterMenuRef.current.contains(e.target as Node)
      )
        setShowFilterMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showSortMenu, showFilterMenu])

  // ─── Check for updates ──────────────────────────────────────
  const handleCheck = useCallback(async () => {
    const store = useUpdaterStore.getState()
    store.setLoading(true)
    store.setError(null)
    store.setUpdateResult(null)

    try {
      const result = await window.clarity.softwareUpdateCheck()
      const s = useUpdaterStore.getState()
      s.setApps(result.apps)
      s.setUpToDate(result.upToDate)
      s.setPackageManagerAvailable(result.packageManagerAvailable)
      s.setPackageManagerName(result.packageManagerName)
      s.setManagers(result.managers)
      s.setHasChecked(true)

      // Use the visible (non-ignored) count for the toast
      const visibleCount = useUpdaterStore.getState().apps.length
      if (
        result.packageManagerAvailable &&
        visibleCount === 0 &&
        useUpdaterStore.getState().ignoredApps.length === 0
      ) {
        toast.success(t('softwareUpdater.toastAllUpToDate'))
      } else if (visibleCount > 0) {
        toast.info(
          visibleCount !== 1
            ? t('softwareUpdater.toastUpdatesFoundPlural', { count: visibleCount })
            : t('softwareUpdater.toastUpdatesFound', { count: visibleCount }),
        )
      }
    } catch (err) {
      console.error('Update check failed:', err)
      useUpdaterStore.getState().setError(t('softwareUpdater.errorCheckFailed'))
    } finally {
      useUpdaterStore.getState().setLoading(false)
    }
  }, [])

  // ─── Run updates ────────────────────────────────────────────
  const handleUpdate = useCallback(
    async (appsToUpdate: UpdatableApp[]) => {
      if (appsToUpdate.length === 0) return
      const store = useUpdaterStore.getState()
      store.setUpdating(true)
      store.setUpdateResult(null)
      store.setError(null)
      store.setProgress(null)

      const startTime = Date.now()
      const items = appsToUpdate.map((a) => ({ id: a.id, source: a.source }))

      try {
        const result = await window.clarity.softwareUpdateRun(items)
        const s = useUpdaterStore.getState()
        s.setUpdateResult(result)
        s.setProgress(null)

        if (result.succeeded > 0) {
          // Remove successfully updated apps from the list (by composite key).
          // Match failures by source+id when the manager reported a source, so
          // a failed choco/git doesn't also strip a succeeded scoop/git.
          const failedKeys = new Set(
            result.errors.map((e) =>
              e.source ? appKey({ id: e.appId, source: e.source }) : e.appId,
            ),
          )
          const succeededKeys = appsToUpdate
            .filter((a) => !failedKeys.has(appKey(a)) && !failedKeys.has(a.id))
            .map(appKey)
          s.removeApps(succeededKeys)
          toast.success(
            result.succeeded !== 1
              ? t('softwareUpdater.toastUpdateSuccessPlural', { count: result.succeeded })
              : t('softwareUpdater.toastUpdateSuccess', { count: result.succeeded }),
          )
        }
        if (result.failed > 0) {
          toast.error(
            result.failed !== 1
              ? t('softwareUpdater.toastUpdateFailedPlural', { count: result.failed })
              : t('softwareUpdater.toastUpdateFailed', { count: result.failed }),
          )
        }

        // Log to history
        const bySeverity: Record<string, { found: number; updated: number }> = {}
        const failedKeysForHistory = new Set(
          result.errors.map((e) =>
            e.source ? appKey({ id: e.appId, source: e.source }) : e.appId,
          ),
        )
        for (const app of appsToUpdate) {
          const sev = app.severity
          if (!bySeverity[sev]) bySeverity[sev] = { found: 0, updated: 0 }
          bySeverity[sev].found++
          if (!failedKeysForHistory.has(appKey(app)) && !failedKeysForHistory.has(app.id))
            bySeverity[sev].updated++
        }
        await useHistoryStore.getState().addEntry({
          id: Date.now().toString(),
          type: 'software-update',
          timestamp: new Date().toISOString(),
          duration: Date.now() - startTime,
          totalItemsFound: appsToUpdate.length,
          totalItemsCleaned: result.succeeded,
          totalItemsSkipped: 0,
          totalSpaceSaved: 0,
          categories: Object.entries(bySeverity).map(([name, d]) => ({
            name: `${name} updates`,
            itemsFound: d.found,
            itemsCleaned: d.updated,
            spaceSaved: 0,
          })),
          errorCount: result.failed,
        })
      } catch (err) {
        console.error('Update failed:', err)
        useUpdaterStore.getState().setError(t('softwareUpdater.errorUpdateFailed'))
      } finally {
        useUpdaterStore.getState().setUpdating(false)
      }
    },
    [],
  )

  // Per-app update so only the active row shows an inline spinner
  const handleSingleUpdate = useCallback(
    async (app: UpdatableApp) => {
      const key = appKey(app)
      setSingleUpdateKey(key)
      try {
        await handleUpdate([app])
      } finally {
        setSingleUpdateKey(null)
      }
    },
    [handleUpdate],
  )

  const handleUpdateSelected = useCallback(() => {
    const selectedApps = useUpdaterStore.getState().apps.filter((a) => a.selected)
    handleUpdate(selectedApps)
  }, [handleUpdate])

  // Re-run only the apps that failed (they are still in the list)
  const handleRetryFailed = useCallback(() => {
    if (!updateResult) return
    const failedApps = updateResult.errors
      .map((e): UpdatableApp | undefined => {
        const src = e.source
        const apps = useUpdaterStore.getState().apps
        if (src) return apps.find((a) => appKey(a) === appKey({ id: e.appId, source: src }))
        return apps.find((a) => a.id === e.appId)
      })
      .filter((a): a is UpdatableApp => Boolean(a))
    if (failedApps.length > 0) handleUpdate(failedApps)
  }, [updateResult, handleUpdate])

  // ─── Toggle a Windows manager on/off (aggregation) ──────────
  const handleToggleManager = useCallback(
    async (manager: WindowsPackageManager) => {
      const current =
        useSettingsStore.getState().settings.windowsPackageManagers ?? DEFAULT_WINDOWS_MANAGERS
      const next = current.includes(manager)
        ? current.filter((m) => m !== manager)
        : [...current, manager]
      // Keep at least one manager enabled
      if (next.length === 0) return
      useSettingsStore.getState().updateSettings({ windowsPackageManagers: next })
      await window.clarity.settingsSet({ windowsPackageManagers: next })
      handleCheck()
    },
    [handleCheck],
  )

  // ─── Filtered & sorted list ─────────────────────────────────
  const filteredApps = useMemo(() => {
    let list = apps

    if (severityFilter !== 'all') {
      list = list.filter((a) => a.severity === severityFilter)
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      list = list.filter(
        (a) => a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q),
      )
    }

    const dir = sortDirection === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      switch (sortField) {
        case 'severity':
          return (severityOrder[a.severity] - severityOrder[b.severity]) * dir
        case 'source':
          return a.source.localeCompare(b.source) * dir
        case 'currentVersion':
          return compareVersions(a.currentVersion, b.currentVersion) * dir
        case 'availableVersion':
          return compareVersions(a.availableVersion, b.availableVersion) * dir
        default:
          return a.name.localeCompare(b.name) * dir
      }
    })
  }, [apps, searchQuery, sortField, sortDirection, severityFilter])

  const selectedCount = apps.filter((a) => a.selected).length
  const allSelected = apps.length > 0 && selectedCount === apps.length
  const isBusy = loading || updating

  const majorCount = apps.filter((a) => a.severity === 'major').length
  const minorCount = apps.filter((a) => a.severity === 'minor').length
  const patchCount = apps.filter((a) => a.severity === 'patch').length

  const showStats = hasChecked && packageManagerAvailable
  const totalStatusCount = apps.length + upToDate.length + ignoredApps.length
  const statusSegments = showStats && totalStatusCount > 0
    ? [
        {
          count: apps.length,
          gradient: 'linear-gradient(90deg, #f59e0b 0%, #fbbf24 100%)',
          dot: '#f59e0b',
          label: t('softwareUpdater.statusOutdated'),
        },
        {
          count: upToDate.length,
          gradient: 'linear-gradient(90deg, #22c55e 0%, #4ade80 100%)',
          dot: '#22c55e',
          label: t('softwareUpdater.statusUpToDate'),
        },
        {
          count: ignoredApps.length,
          gradient: 'var(--bg-hover-2)',
          dot: 'var(--text-dim)',
          label: t('softwareUpdater.statusIgnored'),
        },
      ].filter((s) => s.count > 0)
    : []

  return (
    <div className={embedded ? '' : 'animate-fade-in'}>
      {!embedded && (
        <PageHeader
          title={t('softwareUpdater.pageTitle')}
          description={t('softwareUpdater.pageDescription')}
        />
      )}

      {/* Toolbar */}
      <div className="glass-card mb-5 rounded-2xl p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={handleCheck}
            disabled={isBusy}
            className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all hover:brightness-110 disabled:opacity-40"
            style={{
              background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
              color: 'var(--text-on-accent)',
            }}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
            ) : (
              <RefreshCw className="h-4 w-4" strokeWidth={2} />
            )}
            {loading
              ? t('softwareUpdater.checkingButton')
              : hasChecked
                ? t('softwareUpdater.recheckButton')
                : t('softwareUpdater.checkForUpdatesButton')}
          </button>

          {/* Package manager toggles (Windows only) — aggregate across managers */}
          {platform === 'win32' && (
            <div
              className="flex items-center gap-1.5 rounded-xl px-2 py-1.5"
              style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)' }}
              role="group"
              aria-label={t('softwareUpdater.packageManagerLabel')}
            >
              {WINDOWS_MANAGER_OPTIONS.map(({ id, label }) => {
                const enabled = enabledManagers.includes(id)
                const status = managers.find((m) => m.name === id)
                const notInstalled = hasChecked && enabled && status && !status.available
                return (
                  <button
                    key={id}
                    onClick={() => handleToggleManager(id)}
                    disabled={isBusy}
                    title={
                      notInstalled
                        ? t('softwareUpdater.managerNotInstalled', { manager: label })
                        : enabled
                          ? t('softwareUpdater.managerEnabledHint', { manager: label })
                          : t('softwareUpdater.managerDisabledHint', { manager: label })
                    }
                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-medium transition-all disabled:opacity-40"
                    style={{
                      background: enabled ? 'var(--accent-muted-bg)' : 'transparent',
                      color: enabled ? 'var(--accent)' : 'var(--text-muted)',
                      border: `1px solid ${enabled ? 'var(--accent-muted-border, transparent)' : 'transparent'}`,
                      opacity: notInstalled ? 0.5 : 1,
                    }}
                  >
                    {enabled ? (
                      <Check className="h-3 w-3" strokeWidth={2.5} />
                    ) : (
                      <Package className="h-3 w-3" strokeWidth={2} />
                    )}
                    {label}
                    {notInstalled && <span className="text-[10px] text-red-400">·</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Search / filter / sort */}
        {hasChecked && apps.length > 0 && (
          <div
            className="mt-3 flex flex-wrap items-center gap-2.5 border-t pt-3"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            {/* Search */}
            <div
              className="flex flex-1 items-center gap-2 rounded-xl px-4 py-2.5 min-w-48"
              style={{
                background: 'var(--bg-subtle)',
                border: '1px solid var(--border-medium)',
              }}
            >
              <Search className="h-4 w-4 text-zinc-500" strokeWidth={1.8} aria-hidden="true" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => useUpdaterStore.getState().setSearchQuery(e.target.value)}
                placeholder={t('softwareUpdater.searchPlaceholder')}
                className="w-full bg-transparent text-[13px] outline-none"
                style={{ color: 'var(--text-primary)' }}
              />
              {searchQuery && (
                <button
                  onClick={() => useUpdaterStore.getState().setSearchQuery('')}
                  aria-label={t('softwareUpdater.clearSearch')}
                  className="rounded-md p-0.5 transition-colors hover:bg-white/5"
                  style={{ color: 'var(--text-dim)' }}
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                </button>
              )}
            </div>

            {/* Severity filter */}
            <div className="relative" ref={filterMenuRef}>
              <button
                onClick={() => setShowFilterMenu(!showFilterMenu)}
                className={cn(
                  'flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium transition-all',
                  severityFilter !== 'all' && 'ring-1 ring-inset ring-[--accent-muted-border]',
                )}
                style={{
                  background: 'var(--bg-subtle)',
                  border: '1px solid var(--border-medium)',
                  color: severityFilter !== 'all' ? 'var(--accent)' : 'var(--text-muted)',
                }}
              >
                <Filter className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                {t(FILTER_LABEL_KEYS[severityFilter])}
                <ChevronDown className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
              </button>
              <AnimatePresence>
                {showFilterMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.97 }}
                    transition={{ duration: 0.14, ease: 'easeOut' }}
                    className="absolute top-full left-0 z-50 mt-1.5 rounded-xl py-1 shadow-xl"
                    style={{
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-strong)',
                      minWidth: 128,
                      boxShadow: 'var(--glass-shadow)',
                    }}
                  >
                    {Object.entries(FILTER_LABEL_KEYS).map(([key, labelKey]) => (
                      <button
                        key={key}
                        onClick={() => {
                          useUpdaterStore.getState().setSeverityFilter(key as never)
                          setShowFilterMenu(false)
                        }}
                        className="flex w-full items-center gap-2 px-4 py-2 text-[12px] transition-colors hover:bg-white/5"
                        style={{ color: severityFilter === key ? 'var(--accent)' : 'var(--text-secondary)' }}
                      >
                        {t(labelKey)}
                        {severityFilter === key && (
                          <Check className="ml-auto h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
                        )}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Sort */}
            <div className="relative" ref={sortMenuRef}>
              <button
                onClick={() => setShowSortMenu(!showSortMenu)}
                className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium transition-all"
                style={{
                  background: 'var(--bg-subtle)',
                  border: '1px solid var(--border-medium)',
                  color: 'var(--text-muted)',
                }}
              >
                <ArrowUpDown className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                {t(SORT_LABEL_KEYS[sortField])}
                <ChevronDown className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
              </button>
              <AnimatePresence>
                {showSortMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.97 }}
                    transition={{ duration: 0.14, ease: 'easeOut' }}
                    className="absolute top-full left-0 z-50 mt-1.5 rounded-xl py-1 shadow-xl"
                    style={{
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-strong)',
                      minWidth: 156,
                      boxShadow: 'var(--glass-shadow)',
                    }}
                  >
                    {Object.entries(SORT_LABEL_KEYS).map(([field, labelKey]) => (
                      <button
                        key={field}
                        onClick={() => {
                          const store = useUpdaterStore.getState()
                          if (sortField === field) {
                            store.setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
                          } else {
                            store.setSortField(field as never)
                            store.setSortDirection('asc')
                          }
                          setShowSortMenu(false)
                        }}
                        className="flex w-full items-center gap-2 px-4 py-2 text-[12px] transition-colors hover:bg-white/5"
                        style={{ color: sortField === field ? 'var(--accent)' : 'var(--text-secondary)' }}
                      >
                        {t(labelKey)}
                        {sortField === field && (
                          <span className="ml-auto text-[10px] text-amber-400">
                            {sortDirection === 'asc'
                              ? t('softwareUpdater.sortAsc')
                              : t('softwareUpdater.sortDesc')}
                          </span>
                        )}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>

      {/* Package manager not available warning */}
      {hasChecked && !packageManagerAvailable && (
        <div
          className="mb-5 flex items-start gap-3 rounded-2xl px-5 py-4"
          style={{
            background: 'rgba(239,68,68,0.04)',
            border: '1px solid rgba(239,68,68,0.1)',
          }}
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" strokeWidth={1.8} aria-hidden="true" />
          <p className="text-[12px] text-zinc-400">
            {platform === 'win32' ? (
              <>
                <span className="font-semibold text-red-400">{t('softwareUpdater.packageManagerNotFound.noWindowsManager')}</span> — {t('softwareUpdater.packageManagerNotFound.windowsManagerHint')}
              </>
            ) : packageManagerName === 'brew' ? (
              <>
                <span className="font-semibold text-red-400">{t('softwareUpdater.packageManagerNotFound.brewNotFound')}</span> — {t('softwareUpdater.packageManagerNotFound.brewRequired')}{' '}
                <span className="text-zinc-300">{t('softwareUpdater.packageManagerNotFound.brewSite')}</span>.
              </>
            ) : packageManagerName === 'winget' ? (
              <>
                <span className="font-semibold text-red-400">{t('softwareUpdater.packageManagerNotFound.wingetNotFound')}</span> — {t('softwareUpdater.packageManagerNotFound.wingetRequired')}{' '}
                <span className="text-zinc-300">{t('softwareUpdater.packageManagerNotFound.wingetStore')}</span> {t('softwareUpdater.packageManagerNotFound.wingetSearchTerm')}
              </>
            ) : packageManagerName === 'choco' ? (
              <>
                <span className="font-semibold text-red-400">{t('softwareUpdater.packageManagerNotFound.chocoNotFound')}</span> — {t('softwareUpdater.packageManagerNotFound.chocoRequired')}{' '}
                <span className="text-zinc-300">{t('softwareUpdater.packageManagerNotFound.chocoSite')}</span>.
              </>
            ) : packageManagerName === 'apt' ? (
              <>
                <span className="font-semibold text-red-400">{t('softwareUpdater.packageManagerNotFound.aptNotFound')}</span> — {t('softwareUpdater.packageManagerNotFound.aptRequired')}
              </>
            ) : packageManagerName === 'dnf' ? (
              <>
                <span className="font-semibold text-red-400">{t('softwareUpdater.packageManagerNotFound.dnfNotFound')}</span> — {t('softwareUpdater.packageManagerNotFound.dnfRequired')}
              </>
            ) : packageManagerName === 'pacman' ? (
              <>
                <span className="font-semibold text-red-400">{t('softwareUpdater.packageManagerNotFound.pacmanNotFound')}</span> — {t('softwareUpdater.packageManagerNotFound.pacmanRequired')}
              </>
            ) : (
              <span className="font-semibold text-red-400">
                {t('softwareUpdater.packageManagerNotFound.noPackageManager')}
              </span>
            )}
          </p>
        </div>
      )}

      {/* Errors */}
      {error && (
        <ErrorAlert
          message={error}
          onDismiss={() => useUpdaterStore.getState().setError(null)}
          className="mb-5"
        />
      )}

      {/* Stat cards */}
      {showStats && (
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <StatCard icon={Package} label={t('softwareUpdater.statOutdatedApps')} value={apps.length} variant="accent" />
          <StatCard icon={AlertTriangle} label={t('softwareUpdater.statMajorUpdates')} value={majorCount} variant="danger" />
          <StatCard icon={SlidersHorizontal} label={t('softwareUpdater.statMinorUpdates')} value={minorCount} variant="default" />
          <StatCard icon={CheckCircle2} label={t('softwareUpdater.statPatches')} value={patchCount} variant="success" />
          <StatCard icon={ShieldCheck} label={t('softwareUpdater.statUpToDate')} value={upToDate.length} variant="default" />
        </div>
      )}

      {/* Status overview */}
      {showStats && statusSegments.length > 0 && (
        <section
          aria-label={t('softwareUpdater.statusOverview')}
          className="glass-card mb-5 rounded-2xl p-4"
        >
          <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
            {statusSegments.map((seg) => (
              <motion.div
                key={seg.label}
                initial={{ width: 0 }}
                animate={{ width: `${(seg.count / totalStatusCount) * 100}%` }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
                style={{ background: seg.gradient }}
                title={`${seg.label}: ${seg.count}`}
              />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5">
            {statusSegments.map((seg) => (
              <div key={seg.label} className="flex items-center gap-1.5 text-[11px] font-medium">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: seg.dot }}
                  aria-hidden="true"
                />
                <span style={{ color: 'var(--text-muted)' }}>{seg.label}</span>
                <span style={{ color: 'var(--text-secondary)' }}>{seg.count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Update progress */}
      <AnimatePresence>
        {updating && progress && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: 'auto', marginBottom: 20 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div
              role="status"
              aria-live="polite"
              className="rounded-2xl p-4"
              style={{
                background: 'rgba(245,158,11,0.04)',
                border: '1px solid var(--accent-muted-bg)',
              }}
            >
              <div className="mb-2.5 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-400" strokeWidth={2} aria-hidden="true" />
                  <span className="truncate text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>
                    {t('softwareUpdater.updatingProgress', {
                      app: progress.currentApp,
                      current: progress.current,
                      total: progress.total,
                    })}
                  </span>
                </div>
                <span className="shrink-0 font-mono text-[12px]" style={{ color: 'var(--text-muted)' }}>
                  {progress.percent}%
                </span>
              </div>
              <div
                className="h-1.5 w-full overflow-hidden rounded-full"
                style={{ background: 'var(--bg-hover-2)' }}
              >
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${progress.percent}%`,
                    background: 'linear-gradient(90deg, #f59e0b 0%, #fbbf24 100%)',
                  }}
                />
              </div>
              {progress.status === 'failed' && (
                <p className="mt-2 text-[11px] text-red-400">
                  {t('softwareUpdater.failedToUpdate', { app: progress.currentApp })}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Update result banner */}
      <AnimatePresence>
        {updateResult && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="mb-5 flex items-start gap-3 rounded-2xl p-4"
            style={{
              background:
                updateResult.failed === 0
                  ? 'rgba(34,197,94,0.06)'
                  : 'rgba(239,68,68,0.06)',
              border: `1px solid ${updateResult.failed === 0 ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)'}`,
            }}
          >
            {updateResult.failed === 0 ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-500" strokeWidth={1.8} aria-hidden="true" />
            ) : (
              <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" strokeWidth={1.8} aria-hidden="true" />
            )}
            <div className="flex-1 text-[13px]" style={{ color: 'var(--text-primary)' }}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {updateResult.succeeded > 0 && (
                  <span className="text-green-400">
                    {updateResult.succeeded !== 1
                      ? t('softwareUpdater.updateResultAppsUpdatedPlural', { count: updateResult.succeeded })
                      : t('softwareUpdater.updateResultAppsUpdated', { count: updateResult.succeeded })}
                  </span>
                )}
                {updateResult.succeeded > 0 && updateResult.failed > 0 && <span>—</span>}
                {updateResult.failed > 0 && (
                  <span className="text-red-400">
                    {t('softwareUpdater.updateResultFailed', { count: updateResult.failed })}
                  </span>
                )}
              </div>
              {updateResult.errors.length > 0 && (
                <div className="mt-2">
                  {updateResult.errors.map((e) => {
                    const isInstallerChange = e.reason.toLowerCase().includes('installer type changed')
                    return (
                      <div key={`${e.appId}-${e.source ?? ''}`} className="mt-1.5">
                        <div className="flex items-start gap-2 text-[12px]">
                          <span style={{ color: 'var(--text-muted)' }} className="min-w-0 flex-1">
                            <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>{e.name}</span>
                            {': '}
                            {e.reason}
                          </span>
                          <button
                            onClick={handleRetryFailed}
                            disabled={updating}
                            className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all hover:bg-white/5 disabled:opacity-40"
                            style={{ color: 'var(--accent)', border: '1px solid var(--accent-muted-border)' }}
                          >
                            <RotateCcw className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                            {t('softwareUpdater.retryButton')}
                          </button>
                        </div>
                        {isInstallerChange && packageManagerName && (
                          <div
                            className="mt-1.5 select-all cursor-text rounded-lg px-3 py-2 font-mono text-[11px]"
                            style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)', color: 'var(--text-secondary)' }}
                          >
                            {packageManagerName} uninstall {e.appId}
                            <br />
                            {packageManagerName} install {e.appId}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Selection controls + Update button */}
      {hasChecked && apps.length > 0 && !loading && (
        <div className="mb-4 flex items-center gap-3">
          <button
            onClick={() => {
              const store = useUpdaterStore.getState()
              allSelected ? store.deselectAll() : store.selectAll()
            }}
            disabled={updating}
            className="flex items-center gap-2 text-[12px] font-medium transition-colors hover:text-amber-400 disabled:opacity-40"
            style={{ color: allSelected ? 'var(--accent)' : 'var(--text-muted)' }}
          >
            <div
              className="flex h-4 w-4 items-center justify-center rounded"
              style={{
                background: allSelected ? 'var(--accent)' : 'var(--bg-hover-2)',
                border: allSelected ? 'none' : '1px solid var(--border-stronger)',
              }}
            >
              {allSelected && (
                <Check className="h-3 w-3" style={{ color: 'var(--text-on-accent)' }} strokeWidth={3} aria-hidden="true" />
              )}
            </div>
            {allSelected ? t('softwareUpdater.deselectAll') : t('softwareUpdater.selectAll')}
          </button>

          {selectedCount > 0 && (
            <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {t('softwareUpdater.selectedCount', { count: selectedCount })}
            </span>
          )}

          <div className="flex-1" />

          <button
            onClick={handleUpdateSelected}
            disabled={selectedCount === 0 || updating}
            className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all hover:brightness-110 disabled:opacity-30"
            style={{
              background:
                selectedCount > 0
                  ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)'
                  : 'var(--bg-hover)',
              color: selectedCount > 0 ? '#052e16' : 'var(--text-muted)',
              border: selectedCount > 0 ? 'none' : '1px solid var(--border-medium)',
            }}
          >
            <Download className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            {t('softwareUpdater.updateSelectedButton', { count: selectedCount })}
          </button>
        </div>
      )}

      {/* Empty state — before first check */}
      {!hasChecked && !loading && (
        <EmptyState
          icon={RefreshCw}
          title={t('softwareUpdater.emptyStateTitle')}
          description={t('softwareUpdater.emptyStateDescription')}
          action={
            <button
              onClick={handleCheck}
              disabled={isBusy}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all hover:brightness-110 disabled:opacity-40"
              style={{
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                color: 'var(--text-on-accent)',
              }}
            >
              <RefreshCw className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              {t('softwareUpdater.checkForUpdatesButton')}
            </button>
          }
        />
      )}

      {/* Loading state — skeleton rows */}
      {loading && (
        <div className="mb-6">
          <div className="mb-3 flex items-center justify-center gap-2 text-[13px]" style={{ color: 'var(--text-muted)' }}>
            <Loader2 className="h-4 w-4 animate-spin text-amber-400" strokeWidth={2} aria-hidden="true" />
            {t('softwareUpdater.checkingForUpdates')}
          </div>
          <div className="grid grid-cols-1 gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="glass-card flex items-center gap-4 rounded-2xl px-5 py-4"
                style={{ border: '1px solid var(--border-subtle)' }}
              >
                <SkeletonBar className="h-[18px] w-[18px] rounded" />
                <SkeletonBar className="h-10 w-10 rounded-xl" />
                <div className="min-w-0 flex-1">
                  <SkeletonBar className="mb-2 h-3.5 w-1/3" />
                  <SkeletonBar className="h-3 w-1/4" />
                </div>
                <SkeletonBar className="hidden h-3.5 w-24 sm:block" />
                <SkeletonBar className="hidden h-6 w-16 sm:block" />
                <SkeletonBar className="h-8 w-16" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All up to date */}
      {hasChecked && !loading && apps.length === 0 && ignoredApps.length === 0 && packageManagerAvailable && (
        <EmptyState
          icon={Sparkles}
          title={t('softwareUpdater.allUpToDateTitle')}
          description={t('softwareUpdater.allUpToDateDescription')}
        />
      )}

      {/* No results from filter/search */}
      {hasChecked && !loading && filteredApps.length === 0 && apps.length > 0 && (
        <div className="flex flex-col items-center justify-center py-16">
          <div
            className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: 'var(--bg-subtle)' }}
            aria-hidden="true"
          >
            <Search className="h-6 w-6" style={{ color: 'var(--text-faint)' }} strokeWidth={1.5} />
          </div>
          <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
            {t('softwareUpdater.noAppsMatchFilters')}
          </p>
          {searchQuery && (
            <button
              onClick={() => useUpdaterStore.getState().setSearchQuery('')}
              className="mt-2 text-[12px] font-medium transition-colors hover:text-amber-400"
              style={{ color: 'var(--accent)' }}
            >
              {t('softwareUpdater.clearSearch')}
            </button>
          )}
        </div>
      )}

      {/* App list */}
      {hasChecked && !loading && filteredApps.length > 0 && (
        <div className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
              {t('softwareUpdater.availableUpdatesHeading', { count: filteredApps.length })}
            </h2>
          </div>
          <AnimatePresence initial={false}>
            {filteredApps.map((app) => (
              <motion.div
                key={appKey(app)}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="mb-2"
              >
                <AppRow
                  app={app}
                  updating={updating}
                  isUpdatingThis={updating && singleUpdateKey === appKey(app)}
                  onToggle={() => useUpdaterStore.getState().toggleAppSelected(appKey(app))}
                  onUpdate={() => handleSingleUpdate(app)}
                  onIgnore={() => {
                    useUpdaterStore.getState().ignoreApp(app)
                    toast.info(t('softwareUpdater.toastIgnored', { name: app.name }))
                  }}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Ignored apps */}
      {hasChecked && !loading && ignoredApps.length > 0 && (
        <div className="mb-6">
          <button
            onClick={() => setShowIgnored(!showIgnored)}
            className="mb-3 flex items-center gap-2 text-[13px] font-semibold transition-colors hover:text-amber-400"
            style={{ color: 'var(--text-muted)' }}
          >
            <ChevronDown
              className={cn('h-4 w-4 transition-transform', showIgnored && 'rotate-180')}
              strokeWidth={2}
              aria-hidden="true"
            />
            <EyeOff className="h-4 w-4 text-zinc-500" strokeWidth={1.8} aria-hidden="true" />
            {t('softwareUpdater.ignoredSection', { count: ignoredApps.length })}
          </button>

          <AnimatePresence initial={false}>
            {showIgnored && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-1 gap-1.5">
                  {ignoredApps.map((app) => (
                    <IgnoredRow
                      key={appKey(app)}
                      app={app}
                      onUnignore={() => {
                        useUpdaterStore.getState().unignoreApp(app)
                        toast.success(t('softwareUpdater.toastRestored', { name: app.name }))
                      }}
                    />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Up to date apps */}
      {hasChecked && !loading && packageManagerAvailable && upToDate.length > 0 && (
        <div className="mb-6">
          <button
            onClick={() => setShowUpToDate(!showUpToDate)}
            className="mb-3 flex items-center gap-2 text-[13px] font-semibold transition-colors hover:text-amber-400"
            style={{ color: 'var(--text-muted)' }}
          >
            <ChevronDown
              className={cn('h-4 w-4 transition-transform', showUpToDate && 'rotate-180')}
              strokeWidth={2}
              aria-hidden="true"
            />
            <CheckCircle2 className="h-4 w-4 text-green-500" strokeWidth={1.8} aria-hidden="true" />
            {t('softwareUpdater.upToDateSection', { count: upToDate.length })}
          </button>

          <AnimatePresence initial={false}>
            {showUpToDate && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-1 gap-1.5">
                  {upToDate.map((app) => (
                    <UpToDateRow key={app.id} app={app} />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

function AppRow({
  app,
  updating,
  isUpdatingThis,
  onToggle,
  onUpdate,
  onIgnore,
}: {
  app: UpdatableApp
  updating: boolean
  isUpdatingThis: boolean
  onToggle: () => void
  onUpdate: () => void
  onIgnore: () => void
}) {
  const { t } = useTranslation('updates')
  const base = SEVERITY_STYLES_BASE[app.severity]
  const severity = { ...base, label: t(base.labelKey) }

  return (
    <div
      className={cn(
        'glass-card group flex items-center gap-4 rounded-2xl px-5 py-4 transition-colors',
        app.selected && 'ring-1 ring-inset ring-[var(--accent-muted-border)]',
      )}
      style={{
        background: app.selected ? 'rgba(245,158,11,0.03)' : undefined,
        border: `1px solid ${app.selected ? 'rgba(245,158,11,0.15)' : 'var(--border-subtle)'}`,
      }}
    >
      {/* Checkbox */}
      <button
        onClick={onToggle}
        disabled={updating}
        aria-pressed={app.selected}
        aria-label={app.name}
        className="shrink-0 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 disabled:opacity-40"
      >
        <div
          className="flex items-center justify-center rounded transition-all duration-150"
          style={{
            background: app.selected ? 'var(--accent)' : 'var(--bg-hover-2)',
            border: app.selected ? 'none' : '1px solid var(--border-stronger)',
            width: 18,
            height: 18,
          }}
        >
          {app.selected && (
            <Check className="h-3 w-3" style={{ color: 'var(--text-on-accent)' }} strokeWidth={3} aria-hidden="true" />
          )}
        </div>
      </button>

      {/* App icon */}
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-105"
        style={{ background: severity.bg }}
      >
        <Package className="h-5 w-5" style={{ color: severity.text }} strokeWidth={1.8} aria-hidden="true" />
      </div>

      {/* App info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5">
          <span className="truncate text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>
            {app.name}
          </span>
          <span
            className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium"
            style={{
              background: severity.bg,
              border: `1px solid ${severity.border}`,
              color: severity.text,
            }}
          >
            {severity.label}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {app.id}
        </p>
      </div>

      {/* Version comparison */}
      <div className="hidden shrink-0 items-center gap-2.5 md:flex">
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[9px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
            {t('softwareUpdater.currentVersionLabel')}
          </span>
          <span className="font-mono text-[12px]" style={{ color: 'var(--text-muted)' }}>
            {app.currentVersion}
          </span>
        </div>
        <ArrowRight className="h-3 w-3 text-zinc-600" strokeWidth={2} aria-hidden="true" />
        <div className="flex flex-col items-start gap-0.5">
          <span className="text-[9px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
            {t('softwareUpdater.availableVersionLabel')}
          </span>
          <span className="font-mono text-[12px] font-medium" style={{ color: severity.text }}>
            {app.availableVersion}
          </span>
        </div>
      </div>

      {/* Source badge */}
      <span
        className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium"
        style={{ background: 'var(--bg-hover)', color: 'var(--text-muted)' }}
      >
        {app.source}
      </span>

      {/* Ignore button */}
      <button
        onClick={onIgnore}
        disabled={updating}
        title={t('softwareUpdater.ignoreButton')}
        className="shrink-0 rounded-lg p-2 text-[11px] font-medium transition-all hover:bg-white/5 disabled:opacity-30"
        style={{ border: '1px solid var(--border-medium)', color: 'var(--text-dim)' }}
      >
        <EyeOff className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
      </button>

      {/* Update button */}
      <button
        onClick={onUpdate}
        disabled={updating}
        className={cn(
          'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-all hover:bg-green-500/10 disabled:opacity-30',
          isUpdatingThis && 'border-transparent',
        )}
        style={{
          border: '1px solid rgba(34,197,94,0.15)',
          color: isUpdatingThis ? 'var(--text-muted)' : '#4ade80',
        }}
      >
        {isUpdatingThis ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} aria-hidden="true" />
            {t('softwareUpdater.updatingApp', { app: app.name })}
          </>
        ) : (
          <>
            <Download className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
            {t('softwareUpdater.updateButton')}
          </>
        )}
      </button>
    </div>
  )
}

function IgnoredRow({ app, onUnignore }: { app: UpdatableApp; onUnignore: () => void }) {
  const { t } = useTranslation('updates')
  const base = SEVERITY_STYLES_BASE[app.severity]
  return (
    <div
      className="flex items-center gap-4 rounded-xl px-5 py-3 transition-colors hover:bg-white/[0.02]"
      style={{
        background: 'var(--bg-subtle)',
        border: '1px solid var(--border-subtle)',
        opacity: 0.7,
      }}
    >
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
        style={{ background: 'rgba(113,113,122,0.08)' }}
      >
        <EyeOff className="h-4 w-4 text-zinc-500" strokeWidth={1.8} aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
          {app.name}
        </span>
        <span className="block truncate text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {app.id}
        </span>
      </div>
      <div className="hidden shrink-0 items-center gap-2 sm:flex">
        <span className="font-mono text-[11px] text-zinc-600">{app.currentVersion}</span>
        <ArrowRight className="h-3 w-3 text-zinc-700" strokeWidth={2} aria-hidden="true" />
        <span className="font-mono text-[11px]" style={{ color: base.text }}>
          {app.availableVersion}
        </span>
      </div>
      <span
        className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium"
        style={{ background: 'var(--bg-hover)', color: 'var(--text-muted)' }}
      >
        {app.source}
      </span>
      <button
        onClick={onUnignore}
        className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-all hover:bg-white/5"
        style={{ border: '1px solid var(--border-medium)', color: 'var(--text-secondary)' }}
      >
        <Eye className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
        {t('softwareUpdater.unignoreButton')}
      </button>
    </div>
  )
}

function UpToDateRow({ app }: { app: UpToDateApp }) {
  const { t } = useTranslation('updates')
  return (
    <div
      className="flex items-center gap-4 rounded-xl px-5 py-3 transition-colors hover:bg-white/[0.02]"
      style={{
        background: 'var(--bg-subtle)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
        style={{ background: 'rgba(34,197,94,0.08)' }}
      >
        <CheckCircle2 className="h-4 w-4 text-green-500" strokeWidth={1.8} aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
          {app.name}
        </span>
        <span className="block truncate text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {app.id}
        </span>
      </div>
      <span className="shrink-0 font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
        {app.version}
      </span>
      <span
        className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium"
        style={{
          background: 'rgba(34,197,94,0.06)',
          color: '#4ade80',
          border: '1px solid rgba(34,197,94,0.1)',
        }}
      >
        {t('softwareUpdater.latestBadge')}
      </span>
    </div>
  )
}
