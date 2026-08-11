import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import {
  Server,
  Search,
  ShieldCheck,
  ShieldAlert,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Sparkles,
  ChevronDown,
  Circle,
  Link2,
  Play,
  Zap,
  BarChart3,
  ListChecks,
  RotateCcw,
  ArrowRight,
  CheckCircle2,
  Settings2,
  ScanSearch,
  Eye,
  EyeOff
} from 'lucide-react'
import { toast } from 'sonner'
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { cn, formatDate } from '@/lib/utils'
import { useAnimatedCounter } from '@/hooks/useAnimatedCounter'
import { useServiceStore } from '@/stores/service-store'
import { useHistoryStore } from '@/stores/history-store'
import type {
  ServiceScanProgress,
  WindowsService,
  ServiceCategory,
  ServiceSafety,
  ServiceStartType
} from '@shared/types'
import type { LucideIcon } from 'lucide-react'

const EASE = [0.16, 1, 0.3, 1] as const

const SAFETY_COLORS: Record<ServiceSafety, { dot: string; bg: string; border: string; text: string }> = {
  safe:    { dot: '#22c55e', bg: 'rgba(34,197,94,0.10)',  border: 'rgba(34,197,94,0.20)',  text: '#22c55e' },
  caution: { dot: '#f59e0b', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.20)', text: '#f59e0b' },
  unsafe:  { dot: '#ef4444', bg: 'rgba(239,68,68,0.10)',  border: 'rgba(239,68,68,0.20)',  text: '#ef4444' }
}

const STATUS_COLORS: Record<string, string> = {
  Running: '#22c55e',
  Stopped: 'var(--text-muted)',
  StartPending: '#f59e0b',
  StopPending: '#f59e0b',
  Paused: '#f59e0b',
  Unknown: 'var(--text-muted)'
}

const START_TYPE_KEY_MAP: Record<string, string> = {
  Automatic: 'serviceManager.startTypeAutomatic',
  Manual: 'serviceManager.startTypeManual',
  Disabled: 'serviceManager.startTypeDisabled',
  Unknown: 'serviceManager.startTypeUnknown'
}

const STATUS_KEY_MAP: Record<string, string> = {
  Running: 'serviceManager.statusRunning',
  Stopped: 'serviceManager.statusStopped',
  Paused: 'serviceManager.statusPaused',
  StartPending: 'serviceManager.statusStartPending',
  StopPending: 'serviceManager.statusStopPending',
  Unknown: 'serviceManager.statusUnknown'
}

const SAFETY_KEY_MAP: Record<ServiceSafety, string> = {
  safe: 'serviceManager.riskSafe',
  caution: 'serviceManager.riskCaution',
  unsafe: 'serviceManager.riskUnsafe'
}

const CATEGORY_LABEL_KEYS: Record<ServiceCategory | 'all', string> = {
  all: 'serviceManager.filterAllCategories',
  telemetry: 'serviceManager.categoryTelemetry',
  xbox: 'serviceManager.categoryXbox',
  print: 'serviceManager.categoryPrint',
  fax: 'serviceManager.categoryFax',
  media: 'serviceManager.categoryMedia',
  network: 'serviceManager.categoryNetwork',
  bluetooth: 'serviceManager.categoryBluetooth',
  remote: 'serviceManager.categoryRemote',
  'hyper-v': 'serviceManager.categoryHyperV',
  developer: 'serviceManager.categoryDeveloper',
  misc: 'serviceManager.categoryMisc',
  core: 'serviceManager.categoryCore',
  security: 'serviceManager.categorySecurity',
  unknown: 'serviceManager.categoryOther'
}

type ApplyMode = 'disable' | 'enable'
type StatusFilter = 'all' | 'running' | 'stopped' | 'disabled' | 'at-risk'

/** Selecting a disabled service means "restore it"; anything else means "disable it". */
function isTarget(svc: WindowsService, mode: ApplyMode): boolean {
  return mode === 'enable' ? svc.startType === 'Disabled' : svc.startType !== 'Disabled'
}

function isStartTypeAuto(type: ServiceStartType): boolean {
  return type === 'Automatic' || type === 'AutomaticDelayed'
}

// ── Service hardening score ring ─────────────────────────────

function ScoreRing({ score }: { score: number }) {
  const animatedScore = useAnimatedCounter(score, 1000)
  const colors =
    score >= 80
      ? { start: '#22c55e', end: '#10b981', glow: '#22c55e', label: 'serviceManager.scoreWellHardened' }
      : score >= 55
        ? { start: '#fbbf24', end: '#f59e0b', glow: '#f59e0b', label: 'serviceManager.scoreNeedsAttention' }
        : { start: '#ef4444', end: '#f43f5e', glow: '#ef4444', label: 'serviceManager.scoreAtRisk' }

  const width = 190
  const strokeWidth = 10
  const radius = (width - strokeWidth * 2) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (animatedScore / 100) * circumference

  return (
    <div className="relative inline-flex items-center justify-center" role="img" aria-label={`${score} / 100`}>
      <div
        className="absolute rounded-full opacity-20 blur-3xl"
        style={{ width: width * 0.7, height: width * 0.7, backgroundColor: colors.glow }}
      />
      <svg width={width} height={width} className="-rotate-90" aria-hidden="true">
        <defs>
          <linearGradient id="service-arc-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={colors.start} />
            <stop offset="100%" stopColor={colors.end} />
          </linearGradient>
        </defs>
        <circle cx={width / 2} cy={width / 2} r={radius} fill="none" stroke="var(--gauge-track)" strokeWidth={strokeWidth} />
        <circle
          cx={width / 2}
          cy={width / 2}
          r={radius}
          fill="none"
          stroke="url(#service-arc-gradient)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            transition: 'stroke-dashoffset 1s cubic-bezier(0.16,1,0.3,1)',
            filter: `drop-shadow(0 0 8px ${colors.glow}40)`
          }}
        />
      </svg>
      <div className="absolute flex flex-col items-center" aria-hidden="true">
        <span
          className="text-[46px] font-bold tracking-tight text-white"
          style={{ textShadow: `0 0 24px ${colors.glow}30` }}
        >
          {Math.round(animatedScore)}
        </span>
        <span className="text-[11px] font-medium uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
          / 100
        </span>
      </div>
    </div>
  )
}

// ── Section wrapper + heading (mirrors dashboard) ────────────

function Section({ children, index }: { children: React.ReactNode; index: number }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE, delay: 0.06 * index }}
    >
      {children}
    </motion.section>
  )
}

function SectionHeading({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: string }) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2">
        {Icon && <Icon className="h-3.5 w-3.5" style={{ color: 'var(--text-faint)' }} strokeWidth={1.8} />}
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--text-faint)' }}>
          {title}
        </h2>
        <div className="h-px flex-1" style={{ background: 'var(--border-subtle)' }} />
      </div>
      {hint && (
        <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {hint}
        </p>
      )}
    </div>
  )
}

// ── Stat / mini-stat / quick action (matches privacy page) ───

function StatBlock({ icon: Icon, label, value, color, bg }: { icon: LucideIcon; label: string; value: string; color: string; bg: string }) {
  return (
    <div className="glass-card glass-card-hover flex flex-col justify-between rounded-2xl px-5 py-5">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: bg }}>
          <Icon className="h-4 w-4" style={{ color }} strokeWidth={1.8} />
        </div>
        <span className="text-[12px] font-medium" style={{ color: 'var(--text-muted)' }}>{label}</span>
      </div>
      <span className="mt-3 text-[24px] font-bold tracking-tight text-white">{value}</span>
    </div>
  )
}

function MiniStat({ icon: Icon, label, value, color }: { icon: LucideIcon; label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl px-3.5 py-3" style={{ background: 'var(--bg-subtle)' }}>
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5" style={{ color }} strokeWidth={1.8} />
        <span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>{label}</span>
      </div>
      <p className="mt-1.5 text-[22px] font-bold tracking-tight text-white">{value}</p>
    </div>
  )
}

function QuickActionButton({ icon: Icon, title, description, gradient, glow, disabled, onClick }: {
  icon: LucideIcon
  title: string
  description: string
  gradient: string
  glow: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="glass-card glass-card-hover group relative flex flex-col items-start gap-3 rounded-2xl p-5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50"
    >
      <div
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110"
        style={{ background: gradient, boxShadow: `0 0 20px ${glow}` }}
      >
        <Icon className="h-5 w-5 text-white" strokeWidth={2.2} />
      </div>
      <div>
        <p className="text-[14px] font-semibold text-zinc-200">{title}</p>
        <p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>{description}</p>
      </div>
      <ArrowRight
        className="h-4 w-4 shrink-0 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100"
        style={{ color: 'var(--text-faint)', position: 'absolute', right: '1.25rem', top: '1.4rem' }}
        strokeWidth={1.8}
      />
    </button>
  )
}

// ── Segmented status filter ──────────────────────────────────

function StatusPills({ value, onChange }: { value: StatusFilter; onChange: (v: StatusFilter) => void }) {
  const { t } = useTranslation('hardening')
  const pills: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: t('serviceManager.filterAllStatus') },
    { value: 'running', label: t('serviceManager.filterRunning') },
    { value: 'stopped', label: t('serviceManager.filterStopped') },
    { value: 'disabled', label: t('serviceManager.filterDisabled') },
    { value: 'at-risk', label: t('serviceManager.filterAtRisk') }
  ]
  return (
    <div className="flex items-center gap-1 rounded-xl p-1" style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}>
      {pills.map((pill) => {
        const active = value === pill.value
        return (
          <button
            key={pill.value}
            onClick={() => onChange(pill.value)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-medium transition-all',
              active ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
            )}
            style={active ? { background: 'var(--bg-active)', boxShadow: '0 1px 6px rgba(0,0,0,0.25)' } : undefined}
          >
            {pill.value === 'at-risk' && <Circle className="h-1.5 w-1.5 fill-current" style={{ color: '#ef4444' }} />}
            {pill.label}
          </button>
        )
      })}
    </div>
  )
}

// ── Filter dropdown ──────────────────────────────────────────

function FilterDropdown({ value, options, onChange }: {
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-lg py-2 pl-3 pr-8 text-[12.5px] font-medium text-white outline-none"
        style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)' }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
        style={{ color: 'var(--text-muted)' }}
        strokeWidth={2}
      />
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────

const ROW_COLS = '32px minmax(0, 1fr) 110px 120px 110px 112px'

export function ServiceManagerPage({ embedded }: { embedded?: boolean }) {
  const { t } = useTranslation('hardening')
  const services = useServiceStore((s) => s.services)
  const scanning = useServiceStore((s) => s.scanning)
  const applying = useServiceStore((s) => s.applying)
  const scanProgress = useServiceStore((s) => s.scanProgress)
  const applyResult = useServiceStore((s) => s.applyResult)
  const error = useServiceStore((s) => s.error)
  const hasScanned = useServiceStore((s) => s.hasScanned)
  const searchQuery = useServiceStore((s) => s.searchQuery)
  const safetyFilter = useServiceStore((s) => s.safetyFilter)
  const categoryFilter = useServiceStore((s) => s.categoryFilter)
  const statusFilter = useServiceStore((s) => s.statusFilter)
  const enableStartType = useServiceStore((s) => s.enableStartType)
  const historyEntries = useHistoryStore((s) => s.entries)

  const [confirmMode, setConfirmMode] = useState<ApplyMode | null>(null)
  const [pendingTargets, setPendingTargets] = useState<string[] | null>(null)
  const [appliedMode, setAppliedMode] = useState<ApplyMode>('disable')
  const listRef = useRef<HTMLDivElement | null>(null)
  const isBusy = scanning || applying

  // Listen for progress events
  useEffect(() => {
    const cleanup = window.clarity?.onServiceProgress?.((data: ServiceScanProgress) => {
      useServiceStore.getState().setScanProgress(data)
    })
    return () => { cleanup?.() }
  }, [])

  // ─── Scan ──────────────────────────────────────────────────
  const handleScan = useCallback(async () => {
    const store = useServiceStore.getState()
    store.setScanning(true)
    store.setServices([])
    store.setApplyResult(null)
    store.setError(null)
    store.setScanProgress(null)

    try {
      const result = await window.clarity.serviceScan()
      const s = useServiceStore.getState()
      s.setServices(result.services)
      s.setHasScanned(true)
    } catch (err) {
      toast.error(t('serviceManager.scanFailedToast'))
      useServiceStore
        .getState()
        .setError(err instanceof Error ? err.message : t('serviceManager.scanFailedError'))
    } finally {
      useServiceStore.getState().setScanning(false)
      useServiceStore.getState().setScanProgress(null)
    }
  }, [t])

  // Auto-scan on first visit
  useEffect(() => {
    if (!hasScanned && !scanning) handleScan()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Apply (bulk via selection, or a single targeted service) ──
  const handleApply = useCallback(async (mode: ApplyMode) => {
    setConfirmMode(null)
    const store = useServiceStore.getState()
    const selected = store.services.filter((s) => s.selected && isTarget(s, mode))
    const targets = pendingTargets
      ? store.services.filter((s) => pendingTargets.includes(s.name))
      : selected
    setPendingTargets(null)
    if (targets.length === 0) return

    setAppliedMode(mode)
    store.setApplying(true)
    store.setApplyResult(null)
    store.setError(null)

    const startTime = Date.now()
    const targetStartType = mode === 'disable' ? 'Disabled' : store.enableStartType
    const changes = targets.map((s) => ({
      name: s.name,
      targetStartType
    }))

    try {
      const result = await window.clarity.serviceApply(changes)
      useServiceStore.getState().setApplyResult(result)
      if (result.succeeded > 0) {
        const key = mode === 'disable'
          ? (result.succeeded > 1 ? 'serviceManager.serviceDisabledToastPlural' : 'serviceManager.serviceDisabledToast')
          : (result.succeeded > 1 ? 'serviceManager.serviceEnabledToastPlural' : 'serviceManager.serviceEnabledToast')
        toast.success(t(key, { count: result.succeeded }))
      }
      if (result.failed > 0) toast.error(t(result.failed > 1 ? 'serviceManager.serviceFailedToastPlural' : 'serviceManager.serviceFailedToast', { count: result.failed }))

      // Re-scan to refresh state
      const scanResult = await window.clarity.serviceScan()
      useServiceStore.getState().setServices(scanResult.services)

      // Log to history
      const byCat: Record<string, { found: number; changed: number }> = {}
      for (const svc of targets) {
        const cat = svc.category
        if (!byCat[cat]) byCat[cat] = { found: 0, changed: 0 }
        byCat[cat].found++
        if (!result.errors.some(e => e.name === svc.name)) byCat[cat].changed++
      }
      await useHistoryStore.getState().addEntry({
        id: Date.now().toString(),
        type: 'services',
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
        totalItemsFound: targets.length,
        totalItemsCleaned: result.succeeded,
        totalItemsSkipped: 0,
        totalSpaceSaved: 0,
        categories: Object.entries(byCat).map(([name, d]) => ({
          name, itemsFound: d.found, itemsCleaned: d.changed, spaceSaved: 0
        })),
        errorCount: result.failed
      })
    } catch (err) {
      toast.error(t('serviceManager.applyFailedToast'))
      useServiceStore
        .getState()
        .setError(err instanceof Error ? err.message : t('serviceManager.applyFailedError'))
    } finally {
      useServiceStore.getState().setApplying(false)
    }
  }, [t, pendingTargets])

  const requestApply = useCallback((mode: ApplyMode, targets: string[] | null) => {
    setPendingTargets(targets)
    setConfirmMode(mode)
  }, [])

  const handleSelectRecommended = useCallback(() => {
    useServiceStore.getState().selectRecommended()
    requestAnimationFrame(() => listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [])

  const handleApplyRecommended = useCallback(() => {
    useServiceStore.getState().selectRecommended()
    requestApply('disable', null)
  }, [requestApply])

  const scrollToList = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [])

  const handleReviewAtRisk = useCallback(() => {
    useServiceStore.getState().setStatusFilter('at-risk')
    useServiceStore.getState().setSearchQuery('')
    scrollToList()
  }, [scrollToList])

  const handleReviewSafe = useCallback(() => {
    useServiceStore.getState().setStatusFilter('all')
    useServiceStore.getState().setSafetyFilter('safe')
    useServiceStore.getState().setSearchQuery('')
    scrollToList()
  }, [scrollToList])

  const handleViewDisabled = useCallback(() => {
    useServiceStore.getState().setStatusFilter('disabled')
    useServiceStore.getState().setSafetyFilter('all')
    scrollToList()
  }, [scrollToList])

  // ─── Filtering ─────────────────────────────────────────────
  const filteredServices = useMemo(() => {
    let result = services

    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.displayName.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q)
      )
    }

    if (safetyFilter !== 'all') {
      result = result.filter((s) => s.safety === safetyFilter)
    }

    if (categoryFilter !== 'all') {
      result = result.filter((s) => s.category === categoryFilter)
    }

    if (statusFilter !== 'all') {
      if (statusFilter === 'running') result = result.filter((s) => s.status === 'Running')
      else if (statusFilter === 'stopped') result = result.filter((s) => s.status === 'Stopped')
      else if (statusFilter === 'disabled') result = result.filter((s) => s.startType === 'Disabled')
      else if (statusFilter === 'at-risk') result = result.filter((s) => s.safety === 'unsafe')
    }

    return result
  }, [services, searchQuery, safetyFilter, categoryFilter, statusFilter])

  // ─── Overview stats ────────────────────────────────────────
  const runningCount = services.filter((s) => s.status === 'Running').length
  const stoppedCount = services.filter((s) => s.status === 'Stopped').length
  const disabledCount = services.filter((s) => s.startType === 'Disabled').length
  const atRiskCount = services.filter((s) => s.safety === 'unsafe' && s.startType !== 'Disabled').length
  const totalSafeToDisable = services.filter(
    (s) => s.safety === 'safe' && s.startType !== 'Disabled'
  ).length
  const runningCaution = services.filter((s) => s.status === 'Running' && s.safety === 'caution').length
  const runningUnsafe = services.filter((s) => s.status === 'Running' && s.safety === 'unsafe').length

  // Ratio-weighted hardening score: heavy on running high-risk services,
  // moderate on unnecessary services still enabled.
  const score = useMemo(() => {
    if (services.length === 0) return 0
    const pctSafeEnabled = totalSafeToDisable / services.length
    const pctCautionRunning = runningCaution / services.length
    const pctUnsafeRunning = runningUnsafe / services.length
    return Math.max(0, Math.min(100, Math.round(
      100 * (1 - 0.35 * pctSafeEnabled - 0.45 * pctCautionRunning - 0.6 * pctUnsafeRunning)
    )))
  }, [services.length, totalSafeToDisable, runningCaution, runningUnsafe])

  const scoreLabelKey =
    score >= 80
      ? 'serviceManager.scoreWellHardened'
      : score >= 55
        ? 'serviceManager.scoreNeedsAttention'
        : 'serviceManager.scoreAtRisk'

  // ─── Selection counts ──────────────────────────────────────
  const disableCount = services.filter((s) => s.selected && isTarget(s, 'disable')).length
  const enableCount = services.filter((s) => s.selected && isTarget(s, 'enable')).length
  const selectedCount = services.filter((s) => s.selected).length

  // ─── Categories present in scan results ────────────────────
  const presentCategories = useMemo(() => {
    const cats = new Set<ServiceCategory>()
    for (const s of services) cats.add(s.category)
    return cats
  }, [services])

  // ─── Activity from history ─────────────────────────────────
  const serviceHistory = useMemo(
    () =>
      historyEntries
        .filter((e) => e.type === 'services')
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
    [historyEntries]
  )
  const auditsPerformed = serviceHistory.length
  const changesApplied = serviceHistory.reduce((sum, e) => sum + (e.totalItemsCleaned || 0), 0)
  const lastAuditEntry = serviceHistory.length > 0 ? serviceHistory[serviceHistory.length - 1] : null
  const lastAuditText = lastAuditEntry ? formatDate(lastAuditEntry.timestamp) : t('serviceManager.activityNeverAudited')
  const trendData = serviceHistory.slice(-8).map((e) => ({
    label: new Date(e.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    changed: e.totalItemsCleaned || 0
  }))

  // ─── Recommendations ───────────────────────────────────────
  const recommendations: { key: string; kind: 'warn' | 'danger' | 'ok'; icon: LucideIcon; title: string; description: string; action?: () => void; actionLabel?: string }[] = []
  if (runningUnsafe > 0) {
    recommendations.push({
      key: 'high-risk',
      kind: 'danger',
      icon: ShieldAlert,
      title: t('serviceManager.recHighRiskTitle', { count: runningUnsafe, plural: runningUnsafe === 1 ? '' : 's' }),
      description: t('serviceManager.recHighRiskDescription'),
      action: handleReviewAtRisk,
      actionLabel: t('serviceManager.recReviewButton')
    })
  }
  if (totalSafeToDisable > 0) {
    recommendations.push({
      key: 'unnecessary',
      kind: 'warn',
      icon: Sparkles,
      title: t('serviceManager.recUnnecessaryTitle', { count: totalSafeToDisable, plural: totalSafeToDisable === 1 ? '' : 's' }),
      description: t('serviceManager.recUnnecessaryDescription'),
      action: handleApplyRecommended,
      actionLabel: t('serviceManager.recDisableButton')
    })
  }
  if (recommendations.length === 0) {
    recommendations.push({
      key: 'all-good',
      kind: 'ok',
      icon: CheckCircle2,
      title: t('serviceManager.recAllGoodTitle'),
      description: t('serviceManager.recAllGoodDescription')
    })
  }

  const headerAction = (
    <div className="flex items-center gap-2.5">
      <button
        onClick={handleScan}
        disabled={isBusy}
        className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-medium text-zinc-300 transition-all disabled:opacity-40"
        style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-medium)' }}
      >
        <RefreshCw className="h-4 w-4" strokeWidth={1.8} />
        {t('serviceManager.scanServicesButton')}
      </button>
      {hasScanned && totalSafeToDisable > 0 && (
        <button
          onClick={handleApplyRecommended}
          disabled={isBusy}
          className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-30"
          style={{
            background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
            color: '#fff',
            boxShadow: '0 4px 20px rgba(34,197,94,0.2)'
          }}
        >
          <ShieldCheck className="h-4 w-4" strokeWidth={2} />
          {t('serviceManager.applyRecommendedButton', { count: totalSafeToDisable })}
        </button>
      )}
    </div>
  )

  return (
    <div className={embedded ? '' : 'flex h-full flex-col overflow-y-auto'}>
      {!embedded && (
        <PageHeader
          title={t('serviceManager.pageTitle')}
          description={t('serviceManager.pageDescription')}
          action={headerAction}
        />
      )}
      {embedded && (
        <div className="mb-5 flex justify-end">
          {headerAction}
        </div>
      )}

      <div className={embedded ? 'space-y-8' : 'flex-1 space-y-8 px-0 pb-8'}>
        {/* ── 1 · Services Overview ─────────────────────── */}
        {hasScanned && !scanning && (
          <Section index={0}>
            <SectionHeading icon={Server} title={t('serviceManager.overviewHeading')} hint={t('serviceManager.overviewHint')} />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {/* Score hero */}
              <div className="glass-card glass-card-hover flex flex-col items-center justify-center rounded-2xl px-6 py-7">
                <ScoreRing score={score} />
                <span
                  className="mt-4 text-[14px] font-bold tracking-wide"
                  style={{
                    color: score >= 80 ? '#22c55e' : score >= 55 ? '#f59e0b' : '#ef4444',
                    textShadow: `0 0 18px ${score >= 80 ? '#22c55e' : score >= 55 ? '#f59e0b' : '#ef4444'}30`
                  }}
                >
                  {t(scoreLabelKey)}
                </span>
                <p className="mt-2 max-w-[240px] text-center text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  {t('serviceManager.scoreLabel')}
                </p>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:col-span-2">
                <StatBlock icon={Server} label={t('serviceManager.statTotal')} value={String(services.length)} color="#a1a1aa" bg="var(--bg-subtle-2)" />
                <StatBlock icon={Play} label={t('serviceManager.statRunning')} value={String(runningCount)} color="#22c55e" bg="rgba(34,197,94,0.10)" />
                <StatBlock icon={Circle} label={t('serviceManager.statStopped')} value={String(stoppedCount)} color="var(--text-muted)" bg="var(--bg-subtle-2)" />
                <StatBlock icon={RotateCcw} label={t('serviceManager.statDisabled')} value={String(disabledCount)} color="var(--text-muted)" bg="var(--bg-subtle-2)" />
                <StatBlock
                  icon={atRiskCount === 0 ? CheckCircle2 : ShieldAlert}
                  label={t('serviceManager.statAtRisk')}
                  value={String(atRiskCount)}
                  color={atRiskCount === 0 ? '#22c55e' : '#ef4444'}
                  bg={atRiskCount === 0 ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)'}
                />
                <StatBlock
                  icon={Sparkles}
                  label={t('serviceManager.statSafeToDisable')}
                  value={String(totalSafeToDisable)}
                  color={totalSafeToDisable === 0 ? '#22c55e' : '#f59e0b'}
                  bg={totalSafeToDisable === 0 ? 'rgba(34,197,94,0.10)' : 'rgba(245,158,11,0.10)'}
                />
              </div>

              {/* Selection action bar */}
              {(selectedCount > 0 || isBusy) && (
                <div className="glass-card flex items-center justify-between gap-3 rounded-2xl px-5 py-4 lg:col-span-3"
                  style={{ borderColor: 'rgba(245,158,11,0.2)' }}>
                  <div className="flex items-center gap-2.5">
                    <ShieldCheck className="h-4 w-4 shrink-0 text-amber-400" strokeWidth={2} />
                    <span className="text-[12.5px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                      {t('serviceManager.selectedCount', { count: selectedCount })}
                    </span>
                    {enableCount > 0 && (
                      <span className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                        {t('serviceManager.servicesEnabled', { count: enableCount })}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => useServiceStore.getState().deselectAll()}
                      disabled={isBusy}
                      className="rounded-lg px-3 py-1.5 text-[11.5px] font-semibold transition-colors disabled:opacity-40"
                      style={{ color: 'var(--text-muted)', border: '1px solid var(--border-medium)' }}
                    >
                      {t('serviceManager.deselectAllButton')}
                    </button>
                    {disableCount > 0 && (
                      <button
                        onClick={() => requestApply('disable', null)}
                        disabled={isBusy}
                        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-semibold text-white transition-all disabled:opacity-40"
                        style={{ background: '#dc2626', boxShadow: '0 2px 12px rgba(220,38,38,0.25)' }}
                      >
                        {applying && appliedMode === 'disable' ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" strokeWidth={2.2} />}
                        {t('serviceManager.disableSelectedButton', { count: disableCount })}
                      </button>
                    )}
                    {enableCount > 0 && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => requestApply('enable', null)}
                          disabled={isBusy}
                          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-semibold text-white transition-all disabled:opacity-40"
                          style={{ background: '#2563eb', boxShadow: '0 2px 12px rgba(37,99,235,0.25)' }}
                        >
                          {applying && appliedMode === 'enable' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" strokeWidth={2.2} />}
                          {t('serviceManager.enableSelectedButton', { count: enableCount })}
                        </button>
                        <FilterDropdown
                          value={enableStartType}
                          options={[
                            { value: 'Manual', label: t('serviceManager.startTypeManual') },
                            { value: 'Automatic', label: t('serviceManager.startTypeAutomatic') }
                          ]}
                          onChange={(v) =>
                            useServiceStore.getState().setEnableStartType(v as 'Manual' | 'Automatic')
                          }
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* ── 2 · Services list ─────────────────────────── */}
        {hasScanned && !scanning && (
          <Section index={1}>
            <SectionHeading icon={ScanSearch} title={t('serviceManager.listHeading')} hint={t('serviceManager.listHint')} />
            <div ref={listRef} className="glass-card rounded-2xl overflow-hidden">
              {/* Filter bar */}
              <div className="flex flex-wrap items-center gap-2.5 px-4 pt-4 pb-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                <div
                  className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg px-3 py-2"
                  style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)' }}
                >
                  <Search className="h-4 w-4 shrink-0" style={{ color: 'var(--text-muted)' }} strokeWidth={1.8} />
                  <input
                    type="text"
                    placeholder={t('serviceManager.searchPlaceholder')}
                    value={searchQuery}
                    onChange={(e) => useServiceStore.getState().setSearchQuery(e.target.value)}
                    className="w-full bg-transparent text-[13px] text-white placeholder-zinc-600 outline-none"
                  />
                </div>

                <StatusPills value={statusFilter} onChange={(v) => useServiceStore.getState().setStatusFilter(v)} />

                <FilterDropdown
                  value={safetyFilter}
                  options={[
                    { value: 'all', label: t('serviceManager.filterAllSafety') },
                    { value: 'safe', label: t('serviceManager.filterSafe') },
                    { value: 'caution', label: t('serviceManager.filterCaution') },
                    { value: 'unsafe', label: t('serviceManager.filterUnsafe') }
                  ]}
                  onChange={(v) => useServiceStore.getState().setSafetyFilter(v as any)}
                />

                <FilterDropdown
                  value={categoryFilter}
                  options={[
                    { value: 'all', label: t('serviceManager.filterAllCategories') },
                    ...Array.from(presentCategories)
                      .sort()
                      .map((c) => ({ value: c, label: t(CATEGORY_LABEL_KEYS[c]) || c }))
                  ]}
                  onChange={(v) => useServiceStore.getState().setCategoryFilter(v as any)}
                />
              </div>

              {/* Column header */}
              <div
                className="hidden items-center gap-3 px-4 py-2 text-[10.5px] font-semibold uppercase tracking-wider md:grid"
                style={{ gridTemplateColumns: ROW_COLS, color: 'var(--text-faint)', borderBottom: '1px solid var(--border-subtle)' }}
              >
                <span />
                <span>{t('serviceManager.columnService')}</span>
                <span>{t('serviceManager.columnStatus')}</span>
                <span>{t('serviceManager.columnStartupType')}</span>
                <span>{t('serviceManager.riskUnsafe')}</span>
                <span className="text-center">{t('serviceManager.columnDeps')}</span>
              </div>

              {filteredServices.length === 0 ? (
                <div className="py-12 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
                  {t('serviceManager.noServicesMatch')}
                </div>
              ) : (
                <div className="max-h-[520px] overflow-y-auto">
                  {filteredServices.map((svc) => (
                    <ServiceRow
                      key={svc.name}
                      service={svc}
                      isBusy={isBusy}
                      enableStartType={enableStartType}
                      onSingleAction={(mode) => requestApply(mode, [svc.name])}
                      onReview={() => handleReviewAtRisk()}
                    />
                  ))}
                </div>
              )}

              <div className="border-t px-4 py-2.5 text-right text-[11.5px]" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}>
                {t('serviceManager.showingCount', { filtered: filteredServices.length, total: services.length })}
              </div>
            </div>
          </Section>
        )}

        {/* ── 3 · Recommended Actions ──────────────────── */}
        {hasScanned && !scanning && (
          <Section index={2}>
            <SectionHeading icon={ListChecks} title={t('serviceManager.recHeading')} hint={t('serviceManager.recHint')} />
            <div className="space-y-2.5">
              {recommendations.map((rec) => (
                <div
                  key={rec.key}
                  className="glass-card glass-card-hover group flex items-center gap-3.5 rounded-2xl px-5 py-3.5"
                  style={{
                    borderColor:
                      rec.kind === 'ok'
                        ? 'rgba(34,197,94,0.12)'
                        : rec.kind === 'danger'
                          ? 'rgba(239,68,68,0.18)'
                          : 'rgba(245,158,11,0.18)',
                    background: rec.kind === 'ok' ? 'rgba(34,197,94,0.04)' : undefined
                  }}
                >
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                    style={{
                      background:
                        rec.kind === 'ok' ? 'rgba(34,197,94,0.1)' : rec.kind === 'danger' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)'
                    }}
                  >
                    <rec.icon
                      className="h-4 w-4"
                      style={{ color: rec.kind === 'ok' ? '#22c55e' : rec.kind === 'danger' ? '#ef4444' : '#f59e0b' }}
                      strokeWidth={1.8}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-zinc-200">{rec.title}</p>
                    <p className="mt-0.5 text-[11.5px]" style={{ color: 'var(--text-muted)' }}>{rec.description}</p>
                  </div>
                  {rec.action && (
                    <button
                      onClick={rec.action}
                      disabled={isBusy}
                      className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-all disabled:opacity-40"
                      style={{
                        background: rec.kind === 'danger' ? 'rgba(239,68,68,0.12)' : 'linear-gradient(135deg, #22c55e, #16a34a)',
                        color: rec.kind === 'danger' ? '#ef4444' : '#fff'
                      }}
                    >
                      {rec.kind === 'danger' ? <Eye className="h-3 w-3" strokeWidth={2.2} /> : <ShieldCheck className="h-3 w-3" strokeWidth={2.2} />}
                      {rec.actionLabel}
                      {rec.kind !== 'danger' && (
                        <ArrowRight className="h-3 w-3 -translate-x-0.5 transition-transform group-hover:translate-x-0" strokeWidth={2} />
                      )}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── 4 · Service Activity ─────────────────────── */}
        {hasScanned && !scanning && (
          <Section index={3}>
            <SectionHeading icon={BarChart3} title={t('serviceManager.activityHeading')} hint={t('serviceManager.activityHint')} />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Trend chart */}
              <div className="glass-card glass-card-hover rounded-2xl px-5 py-5">
                <h3 className="mb-4 text-[12px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  {t('serviceManager.activityTrendLabel')}
                </h3>
                {trendData.length >= 2 ? (
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart data={trendData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barSize={22}>
                      <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                      <Tooltip
                        cursor={{ fill: 'var(--bg-subtle)' }}
                        contentStyle={{
                          background: '#1e1e24',
                          border: '1px solid var(--border-strong)',
                          borderRadius: '10px',
                          fontSize: '12px',
                          color: 'var(--text-primary)'
                        }}
                        formatter={(val) => [String(val), t('serviceManager.activityChanges')]}
                        labelStyle={{ color: 'var(--text-muted)', fontSize: '11px' }}
                      />
                      <Bar dataKey="changed" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-[140px] items-center justify-center text-[12px]" style={{ color: 'var(--text-muted)' }}>
                    {t('serviceManager.activityTrendNoData')}
                  </div>
                )}
              </div>

              {/* Activity summary */}
              <div className="glass-card glass-card-hover rounded-2xl px-5 py-5">
                <div className="mb-4 grid grid-cols-2 gap-3">
                  <MiniStat icon={BarChart3} label={t('serviceManager.activityChanges')} value={String(changesApplied)} color="#3b82f6" />
                  <MiniStat icon={Settings2} label={t('serviceManager.recHeading')} value={String(auditsPerformed)} color="#22c55e" />
                </div>
                <div className="flex items-center justify-between rounded-xl px-3.5 py-2.5" style={{ background: 'var(--bg-subtle)' }}>
                  <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    {t('serviceManager.activityLastAudit')}
                  </span>
                  <span className="text-[12px] font-semibold text-zinc-300">{lastAuditText}</span>
                </div>
                {serviceHistory.length === 0 && (
                  <p className="mt-3 text-[12px]" style={{ color: 'var(--text-muted)' }}>{t('serviceManager.activityEmpty')}</p>
                )}
              </div>
            </div>
          </Section>
        )}

        {/* ── 5 · Quick Actions ───────────────────────── */}
        {hasScanned && !scanning && (
          <Section index={4}>
            <SectionHeading icon={Zap} title={t('serviceManager.recHeading')} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <QuickActionButton
                icon={ScanSearch}
                title={t('serviceManager.actionScan')}
                description={t('serviceManager.actionScanDesc')}
                gradient="linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)"
                glow="rgba(59,130,246,0.2)"
                disabled={isBusy}
                onClick={handleScan}
              />
              <QuickActionButton
                icon={ShieldCheck}
                title={t('serviceManager.actionApplyRec')}
                description={t('serviceManager.actionApplyRecDesc')}
                gradient="linear-gradient(135deg, #22c55e 0%, #16a34a 100%)"
                glow="rgba(34,197,94,0.2)"
                disabled={isBusy || totalSafeToDisable === 0}
                onClick={handleApplyRecommended}
              />
              <QuickActionButton
                icon={RotateCcw}
                title={t('serviceManager.actionRefresh')}
                description={t('serviceManager.actionRefreshDesc')}
                gradient="linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)"
                glow="rgba(139,92,246,0.2)"
                disabled={isBusy}
                onClick={handleScan}
              />
              <QuickActionButton
                icon={EyeOff}
                title={t('serviceManager.actionDisabled')}
                description={t('serviceManager.actionDisabledDesc')}
                gradient="linear-gradient(135deg, #f59e0b 0%, #d97706 100%)"
                glow="rgba(245,158,11,0.2)"
                disabled={disabledCount === 0}
                onClick={handleViewDisabled}
              />
            </div>
          </Section>
        )}
      </div>

      {/* Scan progress */}
      {scanning && (
        <div className="mb-5 rounded-2xl p-5 glass-card" style={{ borderColor: 'rgba(245,158,11,0.15)' }}>
          <div className="mb-3 flex items-center gap-3">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-400" strokeWidth={2} />
            <span className="text-[13px] font-medium text-zinc-200">
              {scanProgress
                ? t(scanProgress.phase === 'enumerating' ? 'serviceManager.scanProgressEnumerating' : 'serviceManager.scanProgressClassifying')
                : t('serviceManager.scanningButton')}
            </span>
            {scanProgress && scanProgress.total > 0 && (
              <span className="ml-auto text-[12px] font-mono text-zinc-500">
                {scanProgress.current} / {scanProgress.total}
              </span>
            )}
          </div>
          {scanProgress && scanProgress.total > 0 && (
            <div className="mb-3 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--bg-subtle-2)' }}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${Math.round((scanProgress.current / scanProgress.total) * 100)}%`,
                  background: 'linear-gradient(90deg, #3b82f6, #2563eb)'
                }}
              />
            </div>
          )}
          {scanProgress && (
            <div className="truncate text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
              {scanProgress.currentService}
            </div>
          )}
        </div>
      )}

      {/* Applying state */}
      {applying && (
        <div className="mb-5 flex items-center gap-3 rounded-2xl px-5 py-4 glass-card" style={{ borderColor: 'rgba(245,158,11,0.15)' }}>
          <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
          <span className="text-[13px] text-zinc-400">{t('serviceManager.applyingButton')}</span>
        </div>
      )}

      {/* Apply result */}
      {applyResult && !isBusy && (
        <div
          className="mb-5 rounded-2xl p-4 glass-card"
          style={{
            background: applyResult.failed > 0 ? 'rgba(245,158,11,0.04)' : 'rgba(34,197,94,0.06)',
            borderColor: applyResult.failed > 0 ? 'rgba(245,158,11,0.1)' : 'rgba(34,197,94,0.1)'
          }}
        >
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" strokeWidth={1.8} />
            <div>
              <p className="text-[13px] font-medium text-zinc-200">
                {t(
                  appliedMode === 'enable'
                    ? (applyResult.succeeded !== 1 ? 'serviceManager.servicesEnabledPlural' : 'serviceManager.servicesEnabled')
                    : (applyResult.succeeded !== 1 ? 'serviceManager.servicesDisabledPlural' : 'serviceManager.servicesDisabled'),
                  { count: applyResult.succeeded }
                )}
              </p>
              {applyResult.failed > 0 && (
                <p className="mt-0.5 text-[12px]" style={{ color: 'var(--accent)' }}>
                  {t('serviceManager.servicesFailed', { count: applyResult.failed })}
                </p>
              )}
            </div>
          </div>
          {applyResult.errors.length > 0 && (
            <div className="mt-3 ml-8 space-y-1">
              {applyResult.errors.map((err, i) => (
                <p key={i} className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
                  {err.displayName || err.name}: {err.reason}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <ErrorAlert
          message={error}
          onDismiss={() => useServiceStore.getState().setError(null)}
          className="mb-5"
        />
      )}

      {/* Empty state */}
      {!hasScanned && !scanning && (
        <EmptyState
          icon={Server}
          title={t('serviceManager.emptyStateTitle')}
          description={t('serviceManager.emptyStateDescription')}
          action={
            <button
              onClick={handleScan}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all"
              style={{
                background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                color: '#fff',
                boxShadow: '0 4px 20px rgba(59,130,246,0.2)'
              }}
            >
              <RefreshCw className="h-4 w-4" strokeWidth={2} />
              {t('serviceManager.scanServicesButton')}
            </button>
          }
        />
      )}

      {/* Confirm dialog */}
      <ConfirmDialog
        open={confirmMode !== null}
        title={t(confirmMode === 'enable' ? 'serviceManager.confirmEnableTitle' : 'serviceManager.confirmTitle')}
        description={
          confirmMode === 'enable'
            ? t('serviceManager.confirmEnableDescription', {
                count: pendingTargets ? pendingTargets.length : enableCount,
                startType: t(START_TYPE_KEY_MAP[enableStartType])
              })
            : t('serviceManager.confirmDescription', { count: pendingTargets ? pendingTargets.length : disableCount })
        }
        confirmLabel={t(confirmMode === 'enable' ? 'serviceManager.confirmEnableLabel' : 'serviceManager.confirmLabel')}
        variant={confirmMode === 'enable' ? 'default' : 'danger'}
        onConfirm={() => handleApply(confirmMode ?? 'disable')}
        onCancel={() => { setConfirmMode(null); setPendingTargets(null) }}
      />
    </div>
  )
}

// ─── Service row ─────────────────────────────────────────────

function ServiceRow({ service: svc, isBusy, enableStartType, onSingleAction, onReview }: {
  service: WindowsService
  isBusy: boolean
  enableStartType: 'Manual' | 'Automatic'
  onSingleAction: (mode: ApplyMode) => void
  onReview: () => void
}) {
  const { t } = useTranslation('hardening')
  const isUnsafe = svc.safety === 'unsafe'
  const isDisabled = svc.startType === 'Disabled'
  // Critical services can't be picked for disabling — but a disabled one is
  // selectable so it can be restored.
  const locked = isUnsafe && !isDisabled
  const colors = SAFETY_COLORS[svc.safety]
  const statusColor = STATUS_COLORS[svc.status] || 'var(--text-muted)'

  return (
    <div
      className={cn(
        'group grid items-center gap-3 px-4 py-3 transition-colors duration-100 md:grid',
        svc.selected && 'md:grid'
      )}
      style={{
        gridTemplateColumns: ROW_COLS,
        background: svc.selected ? colors.bg : 'transparent',
        borderBottom: '1px solid var(--border-subtle)',
        cursor: 'default'
      }}
    >
      {/* Checkbox */}
      <div className="flex items-center justify-center">
        <button
          onClick={() => !locked && useServiceStore.getState().toggleService(svc.name)}
          disabled={locked || isBusy}
          title={locked ? t('serviceManager.rowReviewTitle') : isDisabled ? t('serviceManager.selectToReEnableTitle') : t('serviceManager.selectToDisableTitle')}
          className="flex h-[18px] w-[18px] items-center justify-center rounded transition-colors disabled:cursor-not-allowed"
          style={{
            border: `1.5px solid ${svc.selected ? colors.dot : locked ? 'var(--text-faint)' : 'var(--text-muted)'}`,
            background: svc.selected ? colors.dot : 'transparent',
            opacity: locked ? 0.4 : 1
          }}
          aria-label={`${svc.displayName} — ${svc.selected ? t('serviceManager.rowSelected') : ''}`}
        >
          {svc.selected && <CheckCircle2 className="h-3 w-3 text-white" strokeWidth={3} />}
        </button>
      </div>

      {/* Name + description */}
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-white">{svc.displayName}</span>
          {isUnsafe && (
            <span
              className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
              style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}
            >
              {t('serviceManager.criticalBadge')}
            </span>
          )}
          {svc.dependents.length > 0 && (
            <span
              className="flex shrink-0 items-center gap-0.5 text-[10.5px]"
              style={{ color: 'var(--text-faint)' }}
              title={t('serviceManager.dependentsTitle', { count: svc.dependents.length })}
            >
              <Link2 className="h-3 w-3" strokeWidth={1.8} />
              {svc.dependents.length}
            </span>
          )}
        </div>
        <div className="truncate text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
          {svc.description || svc.name}
        </div>
      </div>

      {/* Status */}
      <div className="flex items-center gap-1.5">
        <div className="h-1.5 w-1.5 rounded-full" style={{ background: statusColor }} />
        <span className="text-[12px]" style={{ color: statusColor }}>
          {t(STATUS_KEY_MAP[svc.status] || 'serviceManager.statusUnknown')}
        </span>
      </div>

      {/* Startup type */}
      <div>
        <span
          className="inline-block rounded-full px-2 py-0.5 text-[11px] font-medium"
          style={{
            background: isDisabled
              ? 'rgba(239,68,68,0.10)'
              : isStartTypeAuto(svc.startType)
                ? 'rgba(59,130,246,0.10)'
                : 'rgba(113,113,122,0.15)',
            color: isDisabled
              ? '#ef4444'
              : isStartTypeAuto(svc.startType)
                ? '#60a5fa'
                : '#a1a1aa'
          }}
        >
          {svc.startType === 'AutomaticDelayed' ? t('serviceManager.startTypeAutoDelayed') : t(START_TYPE_KEY_MAP[svc.startType] || 'serviceManager.startTypeUnknown')}
        </span>
      </div>

      {/* Risk */}
      <div>
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
          style={{ background: colors.bg, color: colors.text, border: `1px solid ${colors.border}` }}
        >
          <Circle className="h-1.5 w-1.5 fill-current" stroke="none" />
          {t(SAFETY_KEY_MAP[svc.safety])}
        </span>
      </div>

      {/* Action */}
      <div className="flex justify-end">
        {isUnsafe && !isDisabled ? (
          <button
            onClick={onReview}
            disabled={isBusy}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-40"
            style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}
          >
            <Eye className="h-3 w-3" strokeWidth={2.2} />
            {t('serviceManager.rowReview')}
          </button>
        ) : (
          <button
            onClick={() => onSingleAction(isDisabled ? 'enable' : 'disable')}
            disabled={isBusy}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-all disabled:opacity-40',
              isDisabled ? 'text-blue-400' : 'text-white'
            )}
            style={{
              background: isDisabled
                ? 'rgba(59,130,246,0.12)'
                : 'linear-gradient(135deg, #22c55e, #16a34a)'
            }}
          >
            {isDisabled ? (
              <Play className="h-3 w-3" strokeWidth={2.2} />
            ) : (
              <RotateCcw className="h-3 w-3" strokeWidth={2.2} />
            )}
            {isDisabled
              ? t('serviceManager.rowEnable')
              : t('serviceManager.rowDisable')}
          </button>
        )}
      </div>
    </div>
  )
}
