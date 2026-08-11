import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Package,
  Search,
  Loader2,
  CheckCircle2,
  Shield,
  Trash2,
  RefreshCw,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Clock,
  CheckSquare,
  Square,
  MinusSquare,
  Building2,
  Tag,
  CalendarDays,
  HardDrive,
  Folder,
  KeyRound,
  SearchX,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { useHistoryStore } from '@/stores/history-store'
import { useStatsStore } from '@/stores/stats-store'
import { useUninstallerStore, UNUSED_THRESHOLD_DAYS } from '@/stores/uninstaller-store'
import { formatBytes } from '@/lib/utils'
import type { InstalledProgram, UninstallProgress } from '@shared/types'

function formatDate(raw: string): string {
  if (!raw || raw.length !== 8) return ''
  const year = raw.substring(0, 4)
  const month = raw.substring(4, 6)
  const day = raw.substring(6, 8)
  return `${year}-${month}-${day}`
}

const UNUSED_THRESHOLD_MS = UNUSED_THRESHOLD_DAYS * 24 * 60 * 60 * 1000

function isUnused(prog: InstalledProgram): boolean {
  if (prog.lastUsed === -1) return false // unknown (Prefetch unavailable)
  if (prog.lastUsed === 0) return true // Prefetch available but never seen
  return Date.now() - prog.lastUsed > UNUSED_THRESHOLD_MS
}

function formatLastUsed(ts: number, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (ts <= 0) return t('lastUsedNeverDetected')
  const days = Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000))
  if (days === 0) return t('lastUsedToday')
  if (days === 1) return t('lastUsedYesterday')
  if (days < 30) return t('lastUsedDaysAgo', { days })
  const months = Math.floor(days / 30)
  if (months < 12) return t('lastUsedMonthsAgo', { months })
  const years = Math.floor(months / 12)
  return t('lastUsedYearsAgo', { years })
}

const SORT_LABEL_KEYS: Record<string, string> = {
  displayName: 'sortByName',
  estimatedSize: 'sortBySize',
  installDate: 'sortByDate',
  publisher: 'sortByPublisher',
}

/** Deterministic gradient hue derived from the app name for the avatar tile. */
function appAvatarStyle(name: string): CSSProperties {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return {
    background: `linear-gradient(135deg, hsl(${h} 62% 44%), hsl(${(h + 48) % 360} 68% 30%))`,
    boxShadow: `inset 0 1px 0 0 rgba(255,255,255,0.18), 0 4px 14px hsl(${h} 60% 30% / 0.35)`,
  }
}

const EASE = [0.16, 1, 0.3, 1] as const

function StatCard({ icon, label, value, hue }: {
  icon: React.ReactNode
  label: string
  value: string
  hue: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE }}
      className="glass-card flex items-center gap-3 rounded-2xl px-5 py-4"
    >
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
        style={{ background: hue }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          {label}
        </p>
        <p className="mt-0.5 text-[17px] font-semibold leading-tight text-zinc-100">{value}</p>
      </div>
    </motion.div>
  )
}

function DetailRow({ label, value, mono = false, icon }: {
  label: string
  value: string
  mono?: boolean
  icon: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md" style={{ background: 'var(--bg-hover)' }}>
        <span className="flex h-3.5 w-3.5 items-center justify-center text-zinc-500 [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
      </span>
      <div className="min-w-0">
        <p className="text-[10.5px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          {label}
        </p>
        <p className={`mt-0.5 text-[12.5px] text-zinc-300 break-all ${mono ? 'font-mono' : ''}`}>{value}</p>
      </div>
    </div>
  )
}

export function UninstallerPage() {
  const { t } = useTranslation('uninstaller')
  const programs = useUninstallerStore((s) => s.programs)
  const loading = useUninstallerStore((s) => s.loading)
  const uninstalling = useUninstallerStore((s) => s.uninstalling)
  const progress = useUninstallerStore((s) => s.progress)
  const uninstallResult = useUninstallerStore((s) => s.uninstallResult)
  const error = useUninstallerStore((s) => s.error)
  const hasLoaded = useUninstallerStore((s) => s.hasLoaded)
  const searchQuery = useUninstallerStore((s) => s.searchQuery)
  const sortField = useUninstallerStore((s) => s.sortField)
  const sortDirection = useUninstallerStore((s) => s.sortDirection)
  const filterMode = useUninstallerStore((s) => s.filterMode)

  const selectedIds = useUninstallerStore((s) => s.selectedIds)

  const [confirmProgram, setConfirmProgram] = useState<InstalledProgram | null>(null)
  const [confirmForceRemove, setConfirmForceRemove] = useState<InstalledProgram | null>(null)
  const [confirmBatch, setConfirmBatch] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showSortMenu, setShowSortMenu] = useState(false)
  const sortMenuRef = useRef<HTMLDivElement>(null)
  const uninstallStartRef = useRef<number>(0)
  const lastFailedProgramRef = useRef<InstalledProgram | null>(null)
  const historyStore = useHistoryStore()
  const recomputeStats = useStatsStore((s) => s.recompute)

  // Listen for progress events
  useEffect(() => {
    const cleanup = window.clarity.onUninstallerProgress((data: UninstallProgress) => {
      useUninstallerStore.getState().setProgress(data)
    })
    return () => { cleanup() }
  }, [])

  // Auto-load on first visit
  useEffect(() => {
    if (!hasLoaded && !loading) handleLoad()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Close sort menu on click outside
  useEffect(() => {
    if (!showSortMenu) return
    const handler = (e: globalThis.MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setShowSortMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showSortMenu])

  // ─── Load programs ─────────────────────────────────────────
  const handleLoad = useCallback(async () => {
    const store = useUninstallerStore.getState()
    store.setLoading(true)
    store.setError(null)
    store.setUninstallResult(null)

    try {
      const result = await window.clarity.uninstallerList()
      const s = useUninstallerStore.getState()
      s.setPrograms(result.programs)
      s.setHasLoaded(true)
    } catch (err) {
      console.error('Failed to list programs:', err)
      toast.error(t('failedToLoadToast'))
      useUninstallerStore.getState().setError(t('failedToLoadError'))
    } finally {
      useUninstallerStore.getState().setLoading(false)
    }
  }, [])

  // ─── Uninstall a program ──────────────────────────────────
  const handleUninstall = useCallback(async () => {
    if (!confirmProgram) return
    const program = confirmProgram
    setConfirmProgram(null)

    const store = useUninstallerStore.getState()
    store.setUninstalling(true)
    store.setUninstallResult(null)
    store.setError(null)
    store.setProgress(null)
    uninstallStartRef.current = Date.now()
    lastFailedProgramRef.current = program

    try {
      const result = await window.clarity.uninstallerUninstall(program.id)
      const s = useUninstallerStore.getState()
      s.setUninstallResult(result)
      s.setProgress(null)

      if (result.success) {
        lastFailedProgramRef.current = null
        // Remove from list
        s.removeProgram(program.id)

        // Record in history if leftovers were cleaned
        if (result.leftoversCleaned > 0) {
          await historyStore.addEntry({
            id: Date.now().toString(),
            type: 'cleaner',
            timestamp: new Date().toISOString(),
            duration: Date.now() - uninstallStartRef.current,
            totalItemsFound: result.leftoversFound,
            totalItemsCleaned: result.leftoversCleaned,
            totalItemsSkipped: result.leftoversFound - result.leftoversCleaned,
            totalSpaceSaved: result.leftoversSize,
            categories: [
              {
                name: `Uninstall: ${result.programName}`,
                itemsFound: result.leftoversFound,
                itemsCleaned: result.leftoversCleaned,
                spaceSaved: result.leftoversSize,
              },
            ],
            errorCount: 0,
          })
          recomputeStats()
        }
      }
    } catch (err) {
      console.error('Uninstall failed:', err)
      toast.error(t('uninstallFailedToast'))
      useUninstallerStore.getState().setError(t('uninstallFailedError'))
    } finally {
      useUninstallerStore.getState().setUninstalling(false)
    }
  }, [confirmProgram, historyStore, recomputeStats])

  // ─── Batch uninstall selected programs ─────────────────────
  const handleBatchUninstall = useCallback(async () => {
    setConfirmBatch(false)
    const store = useUninstallerStore.getState()
    const toUninstall = store.programs.filter((p) => store.selectedIds.has(p.id))
    if (toUninstall.length === 0) return

    store.setUninstalling(true)
    store.setUninstallResult(null)
    store.setError(null)
    store.setProgress(null)
    uninstallStartRef.current = Date.now()
    lastFailedProgramRef.current = null

    let successCount = 0
    let failCount = 0
    let totalLeftoversCleaned = 0
    let totalLeftoversSize = 0

    for (const program of toUninstall) {
      try {
        const result = await window.clarity.uninstallerUninstall(program.id)
        const s = useUninstallerStore.getState()

        if (result.success) {
          successCount++
          s.removeProgram(program.id)
          totalLeftoversCleaned += result.leftoversCleaned
          totalLeftoversSize += result.leftoversSize

          if (result.leftoversCleaned > 0) {
            await historyStore.addEntry({
              id: Date.now().toString(),
              type: 'cleaner',
              timestamp: new Date().toISOString(),
              duration: Date.now() - uninstallStartRef.current,
              totalItemsFound: result.leftoversFound,
              totalItemsCleaned: result.leftoversCleaned,
              totalItemsSkipped: result.leftoversFound - result.leftoversCleaned,
              totalSpaceSaved: result.leftoversSize,
              categories: [
                {
                  name: `Uninstall: ${result.programName}`,
                  itemsFound: result.leftoversFound,
                  itemsCleaned: result.leftoversCleaned,
                  spaceSaved: result.leftoversSize,
                },
              ],
              errorCount: 0,
            })
          }
        } else {
          failCount++
        }
      } catch {
        failCount++
      }
    }

    const s = useUninstallerStore.getState()
    s.clearSelected()
    s.setProgress(null)
    s.setUninstalling(false)

    if (failCount === 0) {
      s.setUninstallResult({
        success: true,
        programName: successCount !== 1 ? t('batchResultProgramsPlural', { count: successCount }) : t('batchResultProgramsSingular', { count: successCount }),
        exitCode: null,
        leftoversFound: totalLeftoversCleaned,
        leftoversCleaned: totalLeftoversCleaned,
        leftoversSize: totalLeftoversSize,
      })
    } else {
      s.setUninstallResult({
        success: successCount > 0,
        programName: (successCount + failCount) !== 1 ? t('batchResultProgramsPlural', { count: successCount + failCount }) : t('batchResultProgramsSingular', { count: successCount + failCount }),
        exitCode: null,
        error: t('batchResultFailedSucceeded', { failed: failCount, succeeded: successCount }),
        leftoversFound: totalLeftoversCleaned,
        leftoversCleaned: totalLeftoversCleaned,
        leftoversSize: totalLeftoversSize,
      })
    }

    if (successCount > 0) recomputeStats()
  }, [historyStore, recomputeStats])

  // ─── Force remove a program ─────────────────────────────
  const handleForceRemove = useCallback(async () => {
    if (!confirmForceRemove) return
    const program = confirmForceRemove
    setConfirmForceRemove(null)

    const store = useUninstallerStore.getState()
    store.setUninstalling(true)
    store.setUninstallResult(null)
    store.setError(null)
    store.setProgress(null)
    uninstallStartRef.current = Date.now()

    try {
      const result = await window.clarity.uninstallerForceRemove(program.id)
      const s = useUninstallerStore.getState()
      s.setUninstallResult(result)
      s.setProgress(null)

      if (result.success) {
        lastFailedProgramRef.current = null
        s.removeProgram(program.id)

        if (result.leftoversCleaned > 0) {
          await historyStore.addEntry({
            id: Date.now().toString(),
            type: 'cleaner',
            timestamp: new Date().toISOString(),
            duration: Date.now() - uninstallStartRef.current,
            totalItemsFound: result.leftoversFound,
            totalItemsCleaned: result.leftoversCleaned,
            totalItemsSkipped: result.leftoversFound - result.leftoversCleaned,
            totalSpaceSaved: result.leftoversSize,
            categories: [
              {
                name: `Force Remove: ${result.programName}`,
                itemsFound: result.leftoversFound,
                itemsCleaned: result.leftoversCleaned,
                spaceSaved: result.leftoversSize,
              },
            ],
            errorCount: 0,
          })
          recomputeStats()
        }
      }
    } catch (err) {
      console.error('Force remove failed:', err)
      toast.error(t('uninstallFailedToast'))
      useUninstallerStore.getState().setError(t('uninstallFailedError'))
    } finally {
      useUninstallerStore.getState().setUninstalling(false)
    }
  }, [confirmForceRemove, historyStore, recomputeStats])

  // ─── Filtered & sorted list ───────────────────────────────
  const filteredPrograms = useMemo(() => {
    let list = programs

    // Filter by unused
    if (filterMode === 'unused') {
      list = list.filter(isUnused)
    }

    // Filter by search
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      list = list.filter(
        (p) =>
          p.displayName.toLowerCase().includes(q) ||
          p.publisher.toLowerCase().includes(q),
      )
    }

    const dir = sortDirection === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      switch (sortField) {
        case 'estimatedSize':
          return (a.estimatedSize - b.estimatedSize) * dir
        case 'installDate':
          return a.installDate.localeCompare(b.installDate) * dir
        case 'publisher':
          return a.publisher.localeCompare(b.publisher) * dir
        default:
          return a.displayName.localeCompare(b.displayName) * dir
      }
    })
  }, [programs, searchQuery, sortField, sortDirection, filterMode])

  // Unused stats — only meaningful when Prefetch data is available
  const hasPrefetchData = useMemo(() => programs.some((p) => p.lastUsed !== -1), [programs])
  const unusedPrograms = useMemo(() => programs.filter(isUnused), [programs])
  const unusedTotalSize = useMemo(
    () => unusedPrograms.reduce((sum, p) => sum + p.estimatedSize, 0),
    [unusedPrograms],
  )
  const totalSize = useMemo(
    () => programs.reduce((sum, p) => sum + p.estimatedSize, 0),
    [programs],
  )

  const isBusy = loading || uninstalling
  const isExpanded = (id: string) => expandedId === id
  const listItemDelay = (i: number) => Math.min(i * 0.03, 0.5)

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
      />

      {/* ═══ Toolbar ═══════════════════════════════════════ */}
      <div className="mb-5 flex flex-wrap items-center gap-2.5">
        <motion.button
          onClick={handleLoad}
          disabled={isBusy}
          whileTap={{ scale: 0.97 }}
          className="glass-card flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-medium text-zinc-300 transition-colors hover:text-zinc-100 disabled:opacity-40"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-amber-400" strokeWidth={1.8} />
          ) : (
            <RefreshCw className="h-4 w-4" strokeWidth={1.8} />
          )}
          {loading ? t('loading') : hasLoaded ? t('refresh') : t('loadPrograms')}
        </motion.button>

        {/* Filter segmented control */}
        {hasLoaded && hasPrefetchData && (
          <motion.div
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="flex items-center gap-1 rounded-xl p-1"
            style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)' }}
          >
            <button
              onClick={() => useUninstallerStore.getState().setFilterMode('all')}
              className={`relative px-4 py-1.5 text-[12px] font-medium transition-colors rounded-lg ${filterMode === 'all' ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              {filterMode === 'all' && (
                <motion.span
                  layoutId="uninstaller-filter-pill"
                  className="absolute inset-0 rounded-lg"
                  style={{ background: 'var(--bg-active)', border: '1px solid var(--border-strong)' }}
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                />
              )}
              <span className="relative">{t('filterAll', { count: programs.length })}</span>
            </button>
            <button
              onClick={() => useUninstallerStore.getState().setFilterMode('unused')}
              className={`relative flex items-center gap-1.5 px-4 py-1.5 text-[12px] font-medium transition-colors rounded-lg ${filterMode === 'unused' ? 'text-amber-300' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              {filterMode === 'unused' && (
                <motion.span
                  layoutId="uninstaller-filter-pill"
                  className="absolute inset-0 rounded-lg"
                  style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid var(--accent-muted-border)' }}
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                />
              )}
              <AlertTriangle className="relative h-3 w-3" strokeWidth={2} />
              <span className="relative">{t('filterUnused', { count: unusedPrograms.length })}</span>
            </button>
          </motion.div>
        )}

        {/* Search */}
        {hasLoaded && (
          <motion.div
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, ease: EASE, delay: 0.04 }}
            className="flex flex-1 min-w-[180px] items-center gap-2 rounded-xl px-4 py-2.5"
            style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)' }}
          >
            <Search className="h-4 w-4 text-zinc-500" strokeWidth={1.8} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => useUninstallerStore.getState().setSearchQuery(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="bg-transparent text-[13px] text-zinc-300 placeholder-zinc-600 outline-none w-full"
            />
            {searchQuery && (
              <button
                onClick={() => useUninstallerStore.getState().setSearchQuery('')}
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <SearchX className="h-3.5 w-3.5" strokeWidth={1.8} />
              </button>
            )}
          </motion.div>
        )}

        {/* Sort */}
        {hasLoaded && (
          <motion.div
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, ease: EASE, delay: 0.08 }}
            className="relative"
            ref={sortMenuRef}
          >
            <motion.button
              onClick={() => setShowSortMenu(!showSortMenu)}
              whileTap={{ scale: 0.97 }}
              className="glass-card flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium text-zinc-400 transition-colors hover:text-zinc-200"
            >
              <ArrowUpDown className="h-3.5 w-3.5" strokeWidth={1.8} />
              {t(SORT_LABEL_KEYS[sortField])}
              <motion.span animate={{ rotate: showSortMenu ? 180 : 0 }} transition={{ duration: 0.2 }}>
                <ChevronDown className="h-3 w-3" strokeWidth={2} />
              </motion.span>
            </motion.button>
            <AnimatePresence>
              {showSortMenu && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.94, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: -4 }}
                  transition={{ duration: 0.16, ease: EASE }}
                  className="absolute top-full left-0 z-50 mt-1.5 rounded-xl py-1.5 shadow-2xl"
                  style={{ background: '#1e1e22', border: '1px solid var(--border-strong)', minWidth: 150 }}
                >
                  {Object.entries(SORT_LABEL_KEYS).map(([field, labelKey]) => (
                    <button
                      key={field}
                      onClick={() => {
                        const store = useUninstallerStore.getState()
                        if (sortField === field) {
                          store.setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
                        } else {
                          store.setSortField(field as any)
                          store.setSortDirection(field === 'estimatedSize' ? 'desc' : 'asc')
                        }
                        setShowSortMenu(false)
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2 text-[12px] text-zinc-300 hover:bg-white/5 transition-colors"
                    >
                      {t(labelKey)}
                      {sortField === field && (
                        <span className="ml-auto text-amber-400 text-[10px] font-medium">
                          {sortDirection === 'asc' ? t('sortAscending') : t('sortDescending')}
                        </span>
                      )}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}

        {/* Uninstall Selected */}
        <AnimatePresence>
          {hasLoaded && selectedIds.size > 0 && (
            <motion.button
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              transition={{ duration: 0.18, ease: EASE }}
              onClick={() => setConfirmBatch(true)}
              disabled={uninstalling}
              whileTap={{ scale: 0.97 }}
              className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-30"
              style={{
                background: 'rgba(239,68,68,0.06)',
                border: '1px solid rgba(239,68,68,0.18)',
              }}
            >
              <Trash2 className="h-4 w-4" strokeWidth={1.8} />
              {t('uninstallSelected', { count: selectedIds.size })}
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* ═══ Stat strip ═════════════════════════════════════ */}
      <AnimatePresence>
        {hasLoaded && !loading && (
          <motion.div
            key="stats"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="mb-5 grid grid-cols-1 sm:grid-cols-3 gap-3"
          >
            <StatCard
              icon={<Package className="h-4.5 w-4.5 text-violet-300" strokeWidth={1.8} />}
              label={t('statInstalled')}
              value={String(programs.length)}
              hue="rgba(139,92,246,0.12)"
            />
            <StatCard
              icon={<AlertTriangle className="h-4.5 w-4.5 text-amber-300" strokeWidth={1.8} />}
              label={t('statUnused')}
              value={hasPrefetchData ? String(unusedPrograms.length) : '—'}
              hue="rgba(245,158,11,0.12)"
            />
            <StatCard
              icon={<HardDrive className="h-4.5 w-4.5 text-emerald-300" strokeWidth={1.8} />}
              label={t('statTotalSize')}
              value={formatBytes(totalSize)}
              hue="rgba(34,197,94,0.12)"
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Unused recommendation banner */}
      <AnimatePresence>
        {hasLoaded && !loading && hasPrefetchData && unusedPrograms.length > 0 && filterMode === 'all' && (
          <motion.div
            key="unused-banner"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="mb-5 flex items-center justify-between rounded-2xl px-5 py-4 cursor-pointer transition-colors hover:border-amber-500/30"
            style={{
              background: 'linear-gradient(135deg, rgba(245,158,11,0.06), rgba(245,158,11,0.02))',
              border: '1px solid var(--accent-muted-bg)',
            }}
            onClick={() => useUninstallerStore.getState().setFilterMode('unused')}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: 'rgba(245,158,11,0.12)' }}>
                <AlertTriangle className="h-4.5 w-4.5 text-amber-400" strokeWidth={1.8} />
              </div>
              <div>
                <p className="text-[13px] font-medium text-zinc-200">
                  {unusedPrograms.length !== 1
                    ? t('unusedBannerTitlePlural', { count: unusedPrograms.length, days: UNUSED_THRESHOLD_DAYS })
                    : t('unusedBannerTitle', { count: unusedPrograms.length, days: UNUSED_THRESHOLD_DAYS })}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {unusedTotalSize > 0
                    ? t('unusedBannerDescriptionWithSize', { size: formatBytes(unusedTotalSize) })
                    : t('unusedBannerDescriptionNoSize')}
                </p>
              </div>
            </div>
            <span
              className="rounded-full px-3 py-1 text-[11px] font-medium"
              style={{ background: 'rgba(245,158,11,0.12)', color: 'var(--accent-hover)' }}
            >
              {t('unusedBannerViewButton')}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Info banner */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.05 }}
        className="mb-5 flex items-center gap-3 rounded-2xl px-5 py-3.5"
        style={{
          background: 'rgba(245,158,11,0.04)',
          border: '1px solid rgba(245,158,11,0.08)',
        }}
      >
        <Shield className="h-4.5 w-4.5 shrink-0 text-amber-500" strokeWidth={1.8} />
        <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          <span className="font-semibold text-amber-500">{t('safeUninstallLabel')}</span> — {t('safeUninstallDescription')}
        </p>
      </motion.div>

      {/* Errors */}
      <AnimatePresence>
        {error && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="mb-5"
          >
            <ErrorAlert
              message={error}
              onDismiss={() => useUninstallerStore.getState().setError(null)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Uninstall progress */}
      <AnimatePresence>
        {uninstalling && progress && (
          <motion.div
            key="progress"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="glass-card mb-5 rounded-2xl p-4"
            style={{ borderColor: 'var(--accent-muted-border)' }}
          >
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2.5">
                <Loader2 className="h-4 w-4 animate-spin text-amber-400" strokeWidth={2} />
                <span className="text-[13px] font-medium text-zinc-200">
                  {progress.phase === 'uninstalling'
                    ? t('progressUninstalling', { programName: progress.currentProgram })
                    : progress.phase === 'force-removing'
                      ? t('progressForceRemoving', { programName: progress.currentProgram })
                      : progress.phase === 'scanning-leftovers'
                        ? t('progressScanningLeftovers')
                        : progress.phase === 'cleaning-leftovers'
                          ? t('progressCleaningLeftovers')
                          : t('progressLoading')}
                </span>
              </div>
              <span className="text-[12px] font-mono" style={{ color: 'var(--text-muted)' }}>
                {progress.progress}%
              </span>
            </div>
            <div
              className="h-1.5 w-full rounded-full overflow-hidden"
              style={{ background: 'var(--bg-hover-2)' }}
            >
              <motion.div
                className="h-full rounded-full"
                style={{ background: 'linear-gradient(90deg, #f59e0b 0%, #fbbf24 100%)' }}
                initial={false}
                animate={{ width: `${progress.progress}%` }}
                transition={{ type: 'spring', stiffness: 120, damping: 22 }}
              />
            </div>
            <p className="mt-2 text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
              {progress.detail}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Uninstall result */}
      <AnimatePresence>
        {uninstallResult && (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="mb-5 flex items-center gap-3 rounded-2xl p-4"
            style={{
              background: uninstallResult.success
                ? 'rgba(34,197,94,0.06)'
                : 'rgba(239,68,68,0.06)',
              border: `1px solid ${uninstallResult.success ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)'}`,
            }}
          >
            {uninstallResult.success ? (
              <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" strokeWidth={1.8} />
            ) : (
              <Shield className="h-5 w-5 text-red-500 shrink-0" strokeWidth={1.8} />
            )}
            <div className="text-[13px] text-zinc-200">
              {uninstallResult.success ? (
                <p>
                  {t('successfullyUninstalled')}{' '}
                  <span className="font-medium">{uninstallResult.programName}</span>
                  {uninstallResult.leftoversCleaned > 0 && (
                    <span className="text-green-400">
                      {' '}
                      — {uninstallResult.leftoversCleaned !== 1
                        ? t('leftoversCleanedPlural', { count: uninstallResult.leftoversCleaned, size: formatBytes(uninstallResult.leftoversSize) })
                        : t('leftoversCleaned', { count: uninstallResult.leftoversCleaned, size: formatBytes(uninstallResult.leftoversSize) })}
                    </span>
                  )}
                  {uninstallResult.leftoversFound === 0 && (
                    <span style={{ color: 'var(--text-muted)' }}> — {t('noLeftoverFilesFound')}</span>
                  )}
                </p>
              ) : (
                <p>
                  {t('failedToUninstall')}{' '}
                  <span className="font-medium">{uninstallResult.programName}</span>
                  {uninstallResult.error && (
                    <span style={{ color: 'var(--text-muted)' }}> — {uninstallResult.error}</span>
                  )}
                </p>
              )}
            </div>
            {!uninstallResult.success && lastFailedProgramRef.current && lastFailedProgramRef.current.registryKey && (
              <button
                onClick={() => setConfirmForceRemove(lastFailedProgramRef.current)}
                disabled={uninstalling}
                className="ml-auto shrink-0 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium text-amber-400 transition-all hover:bg-amber-500/10 disabled:opacity-30"
                style={{ border: '1px solid rgba(245,158,11,0.15)' }}
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                {t('forceRemoveButton')}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Empty state */}
      <AnimatePresence>
        {!hasLoaded && !loading && (
          <motion.div
            key="empty"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
          >
            <EmptyState
              icon={Package}
              title={t('emptyStateTitle')}
              description={t('emptyStateDescription')}
              action={
                <motion.button
                  onClick={handleLoad}
                  disabled={isBusy}
                  whileTap={{ scale: 0.97 }}
                  className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-40"
                  style={{
                    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                    color: 'var(--text-on-accent)',
                    boxShadow: '0 8px 24px rgba(245,158,11,0.25)',
                  }}
                >
                  <Search className="h-4 w-4" strokeWidth={1.8} />
                  {t('loadPrograms')}
                </motion.button>
              }
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading state — shimmer skeletons */}
      <AnimatePresence>
        {loading && (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="space-y-2"
          >
            <div className="mb-4 flex items-center gap-2 text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin text-amber-400" strokeWidth={1.8} />
              <span className="text-[13px]">{t('loadingInstalledPrograms')}</span>
            </div>
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3.5 rounded-2xl px-4 py-3.5 animate-shimmer"
                style={{
                  background: 'linear-gradient(90deg, var(--bg-subtle) 25%, var(--bg-hover) 50%, var(--bg-subtle) 75%)',
                  backgroundSize: '200% 100%',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div className="h-10 w-10 rounded-xl" style={{ background: 'var(--bg-hover)' }} />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-1/3 rounded-full" style={{ background: 'var(--bg-hover)' }} />
                  <div className="h-2.5 w-1/4 rounded-full" style={{ background: 'var(--bg-hover)' }} />
                </div>
                <div className="h-6 w-20 rounded-full" style={{ background: 'var(--bg-hover)' }} />
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* No results / empty list messages */}
      <AnimatePresence>
        {hasLoaded && !loading && filteredPrograms.length === 0 && programs.length > 0 && (
          <motion.div
            key="no-results"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="flex flex-col items-center justify-center py-16"
          >
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}>
              <SearchX className="h-7 w-7 text-zinc-500" strokeWidth={1.5} />
            </div>
            <p className="text-[13px] text-zinc-400">
              {filterMode === 'unused' ? t('noUnusedProgramsFound') : t('noProgramsMatchSearch')}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {hasLoaded && !loading && programs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16">
          <CheckCircle2 className="h-10 w-10 text-green-500 mb-4" strokeWidth={1.5} />
          <p className="text-[13px] text-zinc-400">{t('noInstalledProgramsFound')}</p>
        </div>
      )}

      {/* ═══ Program list ═══════════════════════════════════ */}
      {hasLoaded && !loading && filteredPrograms.length > 0 && (
        <div className="mb-6">
          {/* List header */}
          <div className="mb-3 flex items-center gap-2.5">
            <motion.button
              onClick={() => {
                const store = useUninstallerStore.getState()
                const allFilteredIds = filteredPrograms.map((p) => p.id)
                const allSelected = allFilteredIds.every((id) => selectedIds.has(id))
                if (allSelected) {
                  store.clearSelected()
                } else {
                  store.selectAll(allFilteredIds)
                }
              }}
              disabled={uninstalling}
              whileTap={{ scale: 0.9 }}
              className="text-zinc-500 hover:text-zinc-200 transition-colors disabled:opacity-30"
              title={filteredPrograms.every((p) => selectedIds.has(p.id)) ? t('deselectAll') : t('selectAll')}
            >
              {filteredPrograms.length > 0 && filteredPrograms.every((p) => selectedIds.has(p.id)) ? (
                <CheckSquare className="h-4.5 w-4.5 text-amber-400" strokeWidth={1.8} />
              ) : filteredPrograms.some((p) => selectedIds.has(p.id)) ? (
                <MinusSquare className="h-4.5 w-4.5 text-amber-400" strokeWidth={1.8} />
              ) : (
                <Square className="h-4.5 w-4.5" strokeWidth={1.8} />
              )}
            </motion.button>
            {filterMode === 'unused' ? (
              <AlertTriangle className="h-4.5 w-4.5 text-amber-400" strokeWidth={1.8} />
            ) : (
              <Package className="h-4.5 w-4.5 text-amber-400" strokeWidth={1.8} />
            )}
            <span className="text-[13px] font-semibold text-zinc-200">
              {filterMode === 'unused' ? t('unusedProgramsHeading') : t('installedProgramsHeading')}{' '}
              {searchQuery
                ? t('programCount', { filtered: filteredPrograms.length, total: filterMode === 'unused' ? unusedPrograms.length : programs.length })
                : `(${filteredPrograms.length})`}
            </span>
          </div>

          <div className="flex flex-col gap-2.5">
            <AnimatePresence initial={true}>
              {filteredPrograms.map((prog, idx) => {
                const unused = isUnused(prog)
                const isSelected = selectedIds.has(prog.id)
                const expanded = isExpanded(prog.id)
                return (
                  <motion.div
                    key={prog.id}
                    layout
                    initial={{ opacity: 0, y: 16, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.18, ease: EASE } }}
                    transition={{ type: 'spring', stiffness: 320, damping: 28, delay: listItemDelay(idx) }}
                    className="group rounded-2xl overflow-hidden"
                    style={{
                      background: isSelected
                        ? 'var(--accent-muted-bg)'
                        : unused ? 'rgba(245,158,11,0.03)' : 'var(--bg-subtle)',
                      border: `1px solid ${isSelected ? 'var(--accent-muted-border)' : unused ? 'rgba(245,158,11,0.12)' : 'var(--border-subtle)'}`,
                      boxShadow: 'inset 0 1px 0 0 rgba(255,255,255,0.02)',
                    }}
                  >
                    {/* Row */}
                    <div
                      className="flex cursor-pointer items-center gap-3.5 px-4 py-3.5 transition-colors hover:bg-white/[0.02]"
                      onClick={() => setExpandedId(expanded ? null : prog.id)}
                    >
                      <motion.button
                        onClick={(e) => {
                          e.stopPropagation()
                          useUninstallerStore.getState().toggleSelected(prog.id)
                        }}
                        disabled={uninstalling}
                        whileTap={{ scale: 0.85 }}
                        className="shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-30"
                        aria-label={isSelected ? t('deselectAll') : t('selectAll')}
                      >
                        {isSelected ? (
                          <CheckSquare className="h-5 w-5 text-amber-400" strokeWidth={1.8} />
                        ) : (
                          <Square className="h-5 w-5" strokeWidth={1.8} />
                        )}
                      </motion.button>

                      {/* Avatar */}
                      <div
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[15px] font-bold text-white"
                        style={appAvatarStyle(prog.displayName || '?')}
                      >
                        {(prog.displayName || '?').charAt(0).toUpperCase()}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2.5">
                          <span className="text-[13px] font-medium text-zinc-200 truncate">
                            {prog.displayName}
                          </span>
                          {prog.displayVersion && (
                            <span
                              className="rounded-md px-2 py-0.5 text-[10px] font-medium shrink-0"
                              style={{ background: 'var(--bg-hover)', color: 'var(--text-muted)' }}
                            >
                              v{prog.displayVersion}
                            </span>
                          )}
                          {unused && (
                            <span
                              className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium shrink-0"
                              style={{ background: 'rgba(245,158,11,0.1)', color: 'var(--accent-hover)' }}
                            >
                              <Clock className="h-2.5 w-2.5" strokeWidth={2} />
                              {t('unusedBadge')}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2.5 min-w-0">
                          <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
                            {prog.publisher || t('unknownPublisher')}
                            {prog.installDate ? ` — ${formatDate(prog.installDate)}` : ''}
                          </p>
                          {prog.lastUsed > 0 && (
                            <span className="flex items-center gap-1 text-[10px] shrink-0" style={{ color: unused ? 'var(--accent)' : 'var(--text-muted)' }}>
                              <Clock className="h-3 w-3" strokeWidth={1.8} />
                              {formatLastUsed(prog.lastUsed, t)}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Right side */}
                      <div className="shrink-0 flex items-center gap-3">
                        <div className="text-right hidden sm:block">
                          <p className="text-[12px] font-medium text-zinc-400">{formatBytes(prog.estimatedSize)}</p>
                        </div>
                        <motion.button
                          onClick={(e) => {
                            e.stopPropagation()
                            setConfirmProgram(prog)
                          }}
                          disabled={uninstalling}
                          whileTap={{ scale: 0.94 }}
                          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium text-red-400 transition-colors hover:bg-red-500/15 disabled:opacity-30"
                          style={{ border: '1px solid rgba(239,68,68,0.18)' }}
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                          <span className="hidden sm:inline">{t('uninstallButton')}</span>
                        </motion.button>
                        <motion.span
                          animate={{ rotate: expanded ? 90 : 0 }}
                          transition={{ duration: 0.22, ease: EASE }}
                          className="flex h-6 w-6 items-center justify-center rounded-md"
                          style={{ color: expanded ? 'var(--accent)' : 'var(--text-muted)', background: expanded ? 'var(--accent-muted-bg)' : 'transparent' }}
                        >
                          <ChevronRight className="h-4 w-4" strokeWidth={1.8} />
                        </motion.span>
                      </div>
                    </div>

                    {/* Expandable details */}
                    <AnimatePresence initial={false}>
                      {expanded && (
                        <motion.div
                          key="details"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.32, ease: EASE }}
                          className="overflow-hidden"
                        >
                          <div className="px-4 pb-4">
                            <div className="rounded-xl p-4 border-t pt-3.5" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-subtle)' }}>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3.5">
                                <DetailRow
                                  label={t('detailPublisher')}
                                  value={prog.publisher || t('detailUnknown')}
                                  icon={<Building2 strokeWidth={1.8} />}
                                />
                                <DetailRow
                                  label={t('detailVersion')}
                                  value={prog.displayVersion || t('detailUnknown')}
                                  icon={<Tag strokeWidth={1.8} />}
                                />
                                <DetailRow
                                  label={t('detailInstallDate')}
                                  value={prog.installDate ? formatDate(prog.installDate) : t('detailUnknown')}
                                  icon={<CalendarDays strokeWidth={1.8} />}
                                />
                                <DetailRow
                                  label={t('detailSize')}
                                  value={formatBytes(prog.estimatedSize)}
                                  icon={<HardDrive strokeWidth={1.8} />}
                                />
                                <DetailRow
                                  label={t('detailInstallLocation')}
                                  value={prog.installLocation || t('detailUnknown')}
                                  mono
                                  icon={<Folder strokeWidth={1.8} />}
                                />
                                <DetailRow
                                  label={t('detailLastUsed')}
                                  value={formatLastUsed(prog.lastUsed, t)}
                                  icon={<Clock strokeWidth={1.8} />}
                                />
                                {prog.registryKey && (
                                  <div className="md:col-span-2">
                                    <DetailRow
                                      label={t('detailRegistryKey')}
                                      value={prog.registryKey}
                                      mono
                                      icon={<KeyRound strokeWidth={1.8} />}
                                    />
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* Confirm dialog — single */}
      <ConfirmDialog
        open={!!confirmProgram}
        onConfirm={handleUninstall}
        onCancel={() => setConfirmProgram(null)}
        title={t('confirmUninstallTitle', { programName: confirmProgram?.displayName ?? '' })}
        description={t('confirmUninstallDescription')}
        confirmLabel={t('confirmUninstallLabel')}
        variant="danger"
      />

      {/* Confirm dialog — batch */}
      <ConfirmDialog
        open={confirmBatch}
        onConfirm={handleBatchUninstall}
        onCancel={() => setConfirmBatch(false)}
        title={selectedIds.size !== 1 ? t('confirmBatchTitlePlural', { count: selectedIds.size }) : t('confirmBatchTitle', { count: selectedIds.size })}
        description={t('confirmBatchDescription')}
        details={programs
          .filter((p) => selectedIds.has(p.id))
          .map((p) => p.displayName)
          .join(', ')}
        confirmLabel={t('confirmBatchLabel', { count: selectedIds.size })}
        variant="danger"
      />

      {/* Confirm dialog — force remove */}
      <ConfirmDialog
        open={!!confirmForceRemove}
        onConfirm={handleForceRemove}
        onCancel={() => setConfirmForceRemove(null)}
        title={t('confirmForceRemoveTitle', { programName: confirmForceRemove?.displayName ?? '' })}
        description={t('confirmForceRemoveDescription')}
        confirmLabel={t('confirmForceRemoveLabel')}
        variant="warning"
      />

      {/* Decorative accent */}
      <div className="pointer-events-none fixed bottom-6 right-6 flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[10.5px] font-medium" style={{ background: 'var(--flyout-bg)', border: '1px solid var(--border-strong)', color: 'var(--text-muted)', backdropFilter: 'blur(12px)' }}>
        <Sparkles className="h-3 w-3 text-amber-400" strokeWidth={2} />
        {t('safeUninstallLabel')}
      </div>
    </div>
  )
}
