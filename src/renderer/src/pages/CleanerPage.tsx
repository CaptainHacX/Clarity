import { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Monitor,
  Globe,
  AppWindow,
  Gamepad2,
  Trash2,
  Link2Off,
  Database,
  Variable,
  Search,
  Sparkles,
  AlertTriangle,
  ShieldAlert,
  Loader2,
  CheckCircle2,
  CheckSquare,
  ArrowDownWideNarrow,
  ArrowUpDown
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { ScanProgress } from '@/components/shared/ScanProgress'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { CleanSummary } from '@/components/cleaner/CleanSummary'
import { CleanerSummaryCards } from '@/components/cleaner/SummaryCards'
import { CleanerRecommendations, type CleanerCategoryMeta } from '@/components/cleaner/Recommendations'
import { CleanerResultGroups, type CleanerSortMode } from '@/components/cleaner/ResultGroups'
import { cn, formatBytes, formatNumber } from '@/lib/utils'
import { useScanStore } from '@/stores/scan-store'
import { useStatsStore } from '@/stores/stats-store'
import { useHistoryStore } from '@/stores/history-store'
import { useSettingsStore } from '@/stores/settings-store'
import { usePlatform } from '@/hooks/usePlatform'
import { ScanStatus, CleanerType } from '@shared/enums'
import type { ScanResult } from '@shared/types'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'

const categories: CleanerCategoryMeta[] = [
  { type: CleanerType.System, labelKey: 'categorySystem', icon: Monitor, descriptionKey: 'categorySystemDescription' },
  { type: CleanerType.Browser, labelKey: 'categoryBrowsers', icon: Globe, descriptionKey: 'categoryBrowsersDescription' },
  { type: CleanerType.App, labelKey: 'categoryApplications', icon: AppWindow, descriptionKey: 'categoryApplicationsDescription' },
  { type: CleanerType.Gaming, labelKey: 'categoryGaming', icon: Gamepad2, descriptionKey: 'categoryGamingDescription' },
  { type: CleanerType.RecycleBin, labelKey: 'categoryRecycleBin', icon: Trash2, descriptionKey: 'categoryRecycleBinDescription' },
  { type: CleanerType.Shortcut, labelKey: 'categoryShortcuts', icon: Link2Off, descriptionKey: 'categoryShortcutsDescription' },
  { type: CleanerType.Environment, labelKey: 'categoryEnvironment', icon: Variable, descriptionKey: 'categoryEnvironmentDescription' },
  { type: CleanerType.Database, labelKey: 'categoryDatabases', icon: Database, descriptionKey: 'categoryDatabasesDescription' }
]

export function CleanerPage() {
  const { t } = useTranslation('cleaner')
  const { platform } = usePlatform()
  const store = useScanStore()
  const recomputeStats = useStatsStore((s) => s.recompute)
  const historyStore = useHistoryStore()
  const createRestorePointEnabled = useSettingsStore((s) => s.settings.cleaner.createRestorePoint)
  const protectRecycleBin = useSettingsStore((s) => s.settings.cleaner.protectRecycleBin)
  const visibleCategories = protectRecycleBin
    ? categories.filter((c) => c.type !== CleanerType.RecycleBin)
    : categories
  const [activeCategory, setActiveCategory] = useState<CleanerType>(CleanerType.System)
  const [showConfirm, setShowConfirm] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const cleanStartRef = useRef<number>(0)
  const [scanningCategory, setScanningCategory] = useState<CleanerType | null>(null)
  const [query, setQuery] = useState('')
  const [sortMode, setSortMode] = useState<CleanerSortMode>('default')

  const scanIndexRef = useRef(0)
  const cleanIndexRef = useRef(0)
  const cleanTotalRef = useRef(1)
  const tableRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!window.clarity?.onScanProgress) return
    return window.clarity.onScanProgress((data) => {
      // Each cleaner reports 0-100% independently. Scale to overall progress
      // based on which category we're currently processing.
      if (data.phase === 'cleaning') {
        const total = cleanTotalRef.current
        const base = (cleanIndexRef.current / total) * 100
        const slice = (data.progress / total)
        store.setProgress({ ...data, progress: base + slice })
      } else {
        const total = visibleCategories.length
        const base = (scanIndexRef.current / total) * 100
        const slice = (data.progress / total)
        store.setProgress({ ...data, progress: base + slice })
      }
    })
  }, [])

  const [failedCategories, setFailedCategories] = useState<string[]>([])
  const [elevationSkipped, setElevationSkipped] = useState<string[]>([])

  const handleRelaunch = useCallback(() => {
    window.clarity.elevationRelaunch()
  }, [])

  const handleScan = useCallback(async () => {
    store.setStatus(ScanStatus.Scanning)
    store.setResults([])
    store.setCleanSummary(null)
    setExpandedGroups(new Set())
    setFailedCategories([])
    setElevationSkipped([])
    setQuery('')
    setSortMode('default')
    const failed: string[] = []
    const skippedForElevation: string[] = []
    try {
      const scanFns: Partial<Record<CleanerType, () => Promise<ScanResult[]>>> = {
        [CleanerType.System]: () => window.clarity.systemScan(),
        [CleanerType.Browser]: () => window.clarity.browserScan(),
        [CleanerType.App]: () => window.clarity.appScan(),
        [CleanerType.Gaming]: () => window.clarity.gamingScan(),
        [CleanerType.RecycleBin]: () => window.clarity.recycleBinScan(),
        [CleanerType.Shortcut]: () => window.clarity.shortcutScan(),
        [CleanerType.Environment]: () => window.clarity.environmentScan(),
        [CleanerType.Database]: () => window.clarity.databaseScan()
      }
      for (let ci = 0; ci < visibleCategories.length; ci++) {
        const cat = visibleCategories[ci]
        scanIndexRef.current = ci
        setScanningCategory(cat.type)
        try {
          const scanFn = scanFns[cat.type]
          if (!scanFn) continue
          const results = await scanFn()
          // Extract elevation-required markers before adding to store
          const elevationMarker = results.find((r) => r.subcategory === '__elevation_required')
          if (elevationMarker?.group) {
            skippedForElevation.push(...elevationMarker.group.split(', '))
          }
          store.addResults(results.filter((r) => r.subcategory !== '__elevation_required'))
        } catch {
          failed.push(t(cat.labelKey))
        }
      }
      if (failed.length > 0) setFailedCategories(failed)
      if (skippedForElevation.length > 0) setElevationSkipped(skippedForElevation)
      setScanningCategory(null)
      store.setStatus(ScanStatus.Complete)
    } catch {
      setScanningCategory(null)
      store.setStatus(ScanStatus.Error)
    }
    store.setProgress(null)
  }, [])

  const handleClean = useCallback(async () => {
    setShowConfirm(false)
    store.setStatus(ScanStatus.Cleaning)
    cleanStartRef.current = Date.now()
    try {
      // Create a system restore point before cleaning if enabled
      if (createRestorePointEnabled) {
        try {
          const rpResult = await window.clarity.createRestorePoint(
            `Clarity clean — ${new Date().toLocaleString()}`
          )
          if (rpResult.success) {
            toast.success(t('toastRestorePointCreated'))
          } else {
            toast.warning(t('toastRestorePointSkipped'), { description: rpResult.error })
          }
        } catch {
          toast.warning(t('toastRestorePointSkipped'), { description: t('toastRestorePointSkippedDescription') })
        }
      }

      const selectedIds = store.getSelectedIds()
      const cleanFns: Partial<Record<CleanerType, (ids: string[]) => Promise<any>>> = {
        [CleanerType.System]: (ids) => window.clarity.systemClean(ids),
        [CleanerType.Browser]: (ids) => window.clarity.browserClean(ids),
        [CleanerType.App]: (ids) => window.clarity.appClean(ids),
        [CleanerType.Gaming]: (ids) => window.clarity.gamingClean(ids),
        [CleanerType.RecycleBin]: () => window.clarity.recycleBinClean(),
        [CleanerType.Shortcut]: (ids) => window.clarity.shortcutClean(ids),
        [CleanerType.Environment]: (ids) => window.clarity.environmentClean(ids),
        [CleanerType.Database]: (ids) => window.clarity.databaseClean(ids)
      }
      let totalCleaned = 0, totalFiles = 0, totalSkipped = 0, anyNeedsElevation = false
      const allErrors: { path: string; reason: string }[] = []
      const categoryBreakdown: Array<{ name: string; type: string; found: number; cleaned: number; space: number }> = []

      // Compute how many categories actually have items to clean so progress
      // scales to 100% even when only a subset of categories is active.
      const activeCount = visibleCategories.filter((cat) => {
        const catItems = store.results.filter((r) => r.category === cat.type).flatMap((r) => r.items)
        return catItems.some((item) => selectedIds.includes(item.id))
      }).length
      cleanTotalRef.current = Math.max(activeCount, 1)
      let activeIndex = 0

      store.setProgress({ phase: 'cleaning', category: '', currentPath: '', progress: 0, itemsFound: 0, sizeFound: 0 })

      for (let ci = 0; ci < visibleCategories.length; ci++) {
        const cat = visibleCategories[ci]
        const catResults = store.results.filter((r) => r.category === cat.type)
        const catItemsAll = catResults.flatMap((r) => r.items)
        const catItemIds = catItemsAll
          .filter((item) => selectedIds.includes(item.id))
          .map((item) => item.id)
        if (catItemIds.length > 0) {
          cleanIndexRef.current = activeIndex
          try {
            const cleanFn = cleanFns[cat.type]
            if (!cleanFn) continue
            const result = await cleanFn(catItemIds)
            if (result) {
              totalCleaned += result.totalCleaned || 0
              totalFiles += result.filesDeleted || 0
              totalSkipped += result.filesSkipped || 0
              if (result.needsElevation) anyNeedsElevation = true
              if (result.errors?.length) allErrors.push(...result.errors)
              categoryBreakdown.push({
                name: t(cat.labelKey),
                type: cat.type,
                found: catItemsAll.length,
                cleaned: result.filesDeleted || 0,
                space: result.totalCleaned || 0
              })
            }
          } catch { /* continue */ }
          activeIndex++
        } else if (catItemsAll.length > 0) {
          categoryBreakdown.push({ name: t(cat.labelKey), type: cat.type, found: catItemsAll.length, cleaned: 0, space: 0 })
        }
      }

      const totalFound = store.results.reduce((s, r) => s + r.itemCount, 0)
      const duration = Date.now() - cleanStartRef.current
      await historyStore.addEntry({
        id: Date.now().toString(),
        type: 'cleaner',
        timestamp: new Date().toISOString(),
        duration,
        // Window the deletion log by, so History can list the exact paths this
        // run removed across all the per-category clean calls above.
        cleanedFrom: new Date(cleanStartRef.current).toISOString(),
        cleanedTo: new Date().toISOString(),
        totalItemsFound: totalFound,
        totalItemsCleaned: totalFiles,
        totalItemsSkipped: totalSkipped,
        totalSpaceSaved: totalCleaned,
        categories: categoryBreakdown.map((d) => ({
          name: d.name, itemsFound: d.found, itemsCleaned: d.cleaned, spaceSaved: d.space
        })),
        errorCount: allErrors.length
      })
      recomputeStats()

      store.setCleanSummary({
        totalCleaned,
        filesDeleted: totalFiles,
        filesSkipped: totalSkipped,
        errors: allErrors,
        needsElevation: anyNeedsElevation,
        categories: categoryBreakdown,
        duration,
        totalSizeBefore: store.getTotalSize()
      })
      store.setStatus(ScanStatus.Complete)
    } catch {
      store.setStatus(ScanStatus.Error)
    }
    store.setProgress(null)
  }, [store.results, createRestorePointEnabled])

  const categoryResults = (type: CleanerType) => store.results.filter((r) => r.category === type)
  const categoryItemCount = (type: CleanerType) => categoryResults(type).reduce((sum, r) => sum + r.itemCount, 0)

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleSubcategorySelection = (result: ScanResult) => {
    store.toggleSubcategory(result)
  }

  const isScanning = store.status === ScanStatus.Scanning
  const isCleaning = store.status === ScanStatus.Cleaning
  const hasResults = store.results.length > 0
  const totalItems = store.results.reduce((s, r) => s + r.itemCount, 0)
  const categoryCount = visibleCategories.filter((cat) => categoryItemCount(cat.type) > 0).length
  const selectedCount = store.getSelectedIds().length
  const selectedSize = store.getSelectedSize()
  const showActionable = hasResults && !store.cleanSummary && !isScanning && !isCleaning

  const handleRecommendReview = useCallback((type: CleanerType) => {
    setActiveCategory(type)
    requestAnimationFrame(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [])

  const handleRecommendClean = useCallback((type: CleanerType) => {
    store.selectAll(type)
    setActiveCategory(type)
    setShowConfirm(true)
  }, [])

  const handleSelectAll = useCallback(() => {
    const cats = new Set(store.results.map((r) => r.category))
    cats.forEach((c) => store.selectAll(c))
  }, [store.results])

  const handleClearSelection = useCallback(() => {
    const cats = new Set(store.results.map((r) => r.category))
    cats.forEach((c) => store.deselectAll(c))
  }, [store.results])

  const toggleSort = useCallback(() => {
    setSortMode((m) => (m === 'size' ? 'default' : 'size'))
  }, [])

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        action={
          <div className="flex items-center gap-2.5">
            <button
              onClick={handleScan}
              disabled={isScanning || isCleaning}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-medium transition-all disabled:opacity-40"
              style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-medium)', color: 'var(--text-secondary)' }}
            >
              <Search className="h-4 w-4" strokeWidth={1.8} />
              {t('scanButton')}
            </button>
            <button
              onClick={() => setShowConfirm(true)}
              disabled={!hasResults || isScanning || isCleaning || selectedCount === 0}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-30"
              style={{
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                color: 'var(--text-on-accent)',
                boxShadow: hasResults ? '0 4px 20px rgba(245,158,11,0.2)' : 'none'
              }}
            >
              <Sparkles className="h-4 w-4" strokeWidth={2} />
              {t('cleanButton')}
            </button>
          </div>
        }
      />

      {showActionable && (
        <CleanerSummaryCards
          totalSize={store.getTotalSize()}
          itemCount={totalItems}
          categoryCount={categoryCount}
          selectedSize={selectedSize}
          selectedCount={selectedCount}
        />
      )}

      {hasResults && store.status === ScanStatus.Complete && !store.cleanSummary && !isCleaning && (
        <CleanerRecommendations
          categories={categories}
          results={store.results}
          onReview={handleRecommendReview}
          onClean={handleRecommendClean}
        />
      )}

      <div className="flex gap-5">
        {/* Category sidebar */}
        <div className="w-56 shrink-0 space-y-1.5">
          <p className="px-3 pb-1 text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>
            {t('categorySidebarLabel')}
          </p>
          {visibleCategories.map((cat) => {
            const count = categoryItemCount(cat.type)
            const isActive = activeCategory === cat.type
            return (
              <button
                key={cat.type}
                onClick={() => setActiveCategory(cat.type)}
                aria-current={isActive ? 'page' : undefined}
                className="relative flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-all"
                style={{
                  background: isActive ? 'var(--accent-muted-bg)' : 'transparent',
                  color: isActive ? 'var(--accent-hover)' : 'var(--text-muted)'
                }}
              >
                {isActive && (
                  <div className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full" style={{ background: 'var(--accent)' }} />
                )}
                {scanningCategory === cat.type ? (
                  <Loader2 className="h-[17px] w-[17px] shrink-0 animate-spin text-amber-400" strokeWidth={1.8} aria-label={t('scanningCategory', { category: t(cat.labelKey) })} />
                ) : (
                  <cat.icon className="h-[17px] w-[17px] shrink-0" strokeWidth={1.8} aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1">
                  <span className="text-[13px] font-medium">{t(cat.labelKey)}</span>
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{t(cat.descriptionKey)}</p>
                </div>
                {count > 0 && (
                  <span
                    className="rounded-md px-1.5 py-0.5 font-mono text-[11px]"
                    style={{ background: 'var(--bg-hover-2)', color: 'var(--text-muted)' }}
                  >
                    {formatNumber(count)}
                  </span>
                )}
              </button>
            )
          })}

          {hasResults && !store.cleanSummary && (
            <div className="mt-5 rounded-2xl p-4" style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}>
              <p className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>{t('totalRecoverable')}</p>
              <p className="text-[20px] font-bold tracking-tight text-amber-400">{formatBytes(store.getTotalSize())}</p>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {t('itemsCount', { count: formatNumber(totalItems) })}
              </p>
              <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <p className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>{t('selectedLabel')}</p>
                <p className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>{formatBytes(selectedSize)}</p>
              </div>
            </div>
          )}
        </div>

        {/* Item panel */}
        <div className="min-w-0 flex-1">
          {(isScanning || isCleaning) && store.progress && (
            <ScanProgress
              status={isScanning ? 'scanning' : 'cleaning'}
              progress={store.progress.progress}
              currentPath={store.progress.currentPath}
              itemsFound={store.progress.itemsFound}
              sizeFound={store.progress.sizeFound}
              className="mb-5"
            />
          )}

          {failedCategories.length > 0 && store.status === ScanStatus.Complete && (
            <div
              className="mb-5 flex items-center gap-3 rounded-2xl px-4 py-3"
              style={{ background: 'var(--accent-muted-bg)', border: '1px solid rgba(245,158,11,0.12)' }}
            >
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" strokeWidth={1.8} aria-hidden="true" />
              <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                {t('scannersFailed')} <span className="font-medium text-amber-400">{failedCategories.join(', ')}</span>
              </p>
            </div>
          )}

          {elevationSkipped.length > 0 && store.status === ScanStatus.Complete && !store.cleanSummary && (
            <div
              className="mb-5 flex items-center gap-3 rounded-2xl px-4 py-3"
              style={{ background: 'var(--accent-muted-bg)', border: '1px solid var(--accent-muted-border)' }}
            >
              <ShieldAlert className="h-4 w-4 shrink-0 text-amber-400" strokeWidth={1.8} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] text-zinc-300">
                  <span className="font-medium">{t('categoriesSkipped', { count: elevationSkipped.length })}</span>
                  <span style={{ color: 'var(--text-muted)' }}> {t('categoriesSkippedSuffix')}</span>
                </p>
                <p className="mt-0.5 truncate text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {elevationSkipped.slice(0, 4).join(', ')}{elevationSkipped.length > 4 ? ` ${t('categoriesSkippedMore', { count: elevationSkipped.length - 4 })}` : ''}
                </p>
              </div>
              {platform !== 'darwin' && (
                <button
                  onClick={handleRelaunch}
                  className="shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-medium text-amber-400 transition-colors hover:bg-amber-500/15"
                  style={{ border: '1px solid rgba(245,158,11,0.2)' }}
                >
                  {t('relaunchAsAdmin')}
                </button>
              )}
            </div>
          )}

          {store.cleanSummary && store.status === ScanStatus.Complete && (
            <CleanSummary summary={store.cleanSummary} onRelaunchAsAdmin={handleRelaunch} platform={platform} />
          )}

          {store.status === ScanStatus.Error && (
            <div
              className="mb-5 rounded-2xl border p-6 text-center"
              style={{ background: 'var(--card-bg)', borderColor: 'rgba(239,68,68,0.2)' }}
            >
              <div
                className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
                style={{ background: 'rgba(239,68,68,0.10)' }}
                aria-hidden="true"
              >
                <ShieldAlert className="h-6 w-6 text-red-500" strokeWidth={1.8} />
              </div>
              <h3 className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>{t('scanFailedTitle')}</h3>
              <p className="mx-auto mt-1.5 max-w-sm text-[13px]" style={{ color: 'var(--text-muted)' }}>
                {t('scanFailedDescription')}
              </p>
              <button
                onClick={handleScan}
                disabled={isCleaning}
                className="mt-5 flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', color: 'var(--text-on-accent)' }}
              >
                <Search className="h-4 w-4" strokeWidth={1.8} />
                {t('tryAgain')}
              </button>
            </div>
          )}

          {!hasResults && !isScanning && store.status !== ScanStatus.Error && (
            <>
              <EmptyState
                icon={store.status === ScanStatus.Complete ? CheckCircle2 : Search}
                title={store.status === ScanStatus.Complete ? t('cleanSystemTitle') : t('noScanResultsTitle')}
                description={store.status === ScanStatus.Complete ? t('cleanSystemDescription') : t('noScanResultsDescription')}
                action={
                  <button
                    onClick={handleScan}
                    disabled={isCleaning}
                    className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-40"
                    style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', color: 'var(--text-on-accent)' }}
                  >
                    <Search className="h-4 w-4" strokeWidth={1.8} />
                    {t('startScan')}
                  </button>
                }
              />
              {store.status === ScanStatus.Idle && (
                <div className="mx-auto mt-2 max-w-2xl">
                  <p className="mb-2.5 text-center text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>
                    {t('whatGetsScanned')}
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {visibleCategories.map((cat) => (
                      <div
                        key={cat.type}
                        className="flex items-center gap-2.5 rounded-xl border px-3 py-2.5"
                        style={{ background: 'var(--card-bg)', borderColor: 'var(--border-default)' }}
                      >
                        <cat.icon className="h-4 w-4 shrink-0" style={{ color: 'var(--text-muted)' }} strokeWidth={1.8} aria-hidden="true" />
                        <span className="truncate text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>{t(cat.labelKey)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {hasResults && (
            <div key={activeCategory} ref={tableRef}>
              {/* Results toolbar */}
              <div className="mb-3 flex flex-wrap items-center gap-2 px-1">
                <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  {t('categoryItemsHeading', { category: t(categories.find((c) => c.type === activeCategory)?.labelKey ?? '') })}
                </span>

                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search
                      className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
                      style={{ color: 'var(--text-faint)' }}
                      strokeWidth={2}
                      aria-hidden="true"
                    />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={t('searchItems')}
                      aria-label={t('searchItems')}
                      className="w-44 rounded-lg border bg-transparent py-1.5 pl-8 pr-2 text-[12px] outline-none transition-colors focus:border-amber-500/40"
                      style={{ borderColor: 'var(--border-medium)', color: 'var(--text-primary)' }}
                    />
                  </div>

                  <button
                    onClick={toggleSort}
                    className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors"
                    style={{ borderColor: 'var(--border-medium)', color: 'var(--text-secondary)', background: 'var(--bg-subtle)' }}
                    aria-pressed={sortMode === 'size'}
                  >
                    {sortMode === 'size' ? (
                      <ArrowDownWideNarrow className="h-3.5 w-3.5 text-amber-500" strokeWidth={2} aria-hidden="true" />
                    ) : (
                      <ArrowUpDown className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                    )}
                    {t(sortMode === 'size' ? 'sortLargest' : 'sortDefault')}
                  </button>

                  <button
                    onClick={() => store.toggleCategory(activeCategory)}
                    className="text-[12px] font-medium text-amber-500 transition-colors hover:text-amber-400"
                  >
                    {t('toggleAll')}
                  </button>
                </div>
              </div>

              {categoryResults(activeCategory).length === 0 && (
                <div className="py-12 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
                  {t('noItemsInCategory')}
                </div>
              )}

              <CleanerResultGroups
                results={categoryResults(activeCategory)}
                selected={store.selectedItems}
                expanded={expandedGroups}
                query={query}
                sortMode={sortMode}
                onToggleGroup={toggleGroup}
                onToggleSubcategory={toggleSubcategorySelection}
                onToggleItem={store.toggleItem}
                onOpenLocation={(path) => window.clarity?.cleanerOpenLocation?.(path)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Sticky selection / action bar */}
      {showActionable && (
        <div className="glass-card sticky bottom-4 z-10 mt-6 flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3">
          <div className="flex items-center gap-2.5 text-[13px]" style={{ color: 'var(--text-primary)' }}>
            <CheckSquare className="h-4 w-4 text-amber-500" strokeWidth={1.8} aria-hidden="true" />
            <span>
              <span className="font-semibold">{formatNumber(selectedCount)}</span>{' '}
              <span style={{ color: 'var(--text-muted)' }}>{t('selectionItems')}</span>
              <span style={{ color: 'var(--text-muted)' }}> · </span>
              <span className="font-semibold text-amber-500">{formatBytes(selectedSize)}</span>
            </span>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              onClick={handleSelectAll}
              className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors"
              style={{ color: 'var(--text-secondary)' }}
            >
              {t('selectAll')}
            </button>
            <button
              onClick={handleClearSelection}
              className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors"
              style={{ color: 'var(--text-secondary)' }}
            >
              {t('clearSelection')}
            </button>
            <button
              onClick={() => setShowConfirm(true)}
              disabled={selectedCount === 0}
              className="flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-semibold transition-all disabled:opacity-30"
              style={{
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                color: 'var(--text-on-accent)',
                boxShadow: selectedCount > 0 ? '0 4px 20px rgba(245,158,11,0.2)' : 'none'
              }}
            >
              <Sparkles className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              {t('cleanSelected')}
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={showConfirm}
        onConfirm={handleClean}
        onCancel={() => setShowConfirm(false)}
        title={t('confirmCleanTitle')}
        description={t('confirmCleanDescription', { count: formatNumber(selectedCount), size: formatBytes(selectedSize) })}
        confirmLabel={t('confirmCleanLabel')}
        variant="warning"
      />
    </div>
  )
}
