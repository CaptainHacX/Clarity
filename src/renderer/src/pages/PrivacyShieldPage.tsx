import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import {
  ShieldCheck,
  ShieldAlert,
  Eye,
  Search,
  Megaphone,
  Radio,
  RefreshCw,
  CalendarClock,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  Cpu,
  Globe,
  Lock,
  Compass,
  BrainCircuit,
  Layers,
  ListChecks,
  BarChart3,
  Zap,
  RotateCcw,
  ChevronDown,
  ArrowRight
} from 'lucide-react'
import { toast } from 'sonner'
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { cn, formatDate } from '@/lib/utils'
import { useAnimatedCounter } from '@/hooks/useAnimatedCounter'
import { usePrivacyStore } from '@/stores/privacy-store'
import { useHistoryStore } from '@/stores/history-store'
import type { PrivacySetting } from '@shared/types'
import type { LucideIcon } from 'lucide-react'

const EASE = [0.16, 1, 0.3, 1] as const

interface CategoryDef {
  id: PrivacySetting['category']
  labelKey: string
  descriptionKey: string
  icon: LucideIcon
  color: string
  bg: string
  border: string
}

const categories: CategoryDef[] = [
  {
    id: 'telemetry',
    labelKey: 'privacyCategories.telemetryLabel',
    descriptionKey: 'privacyCategories.telemetryDescription',
    icon: Radio,
    color: '#ef4444',
    bg: 'rgba(239,68,68,0.08)',
    border: 'rgba(239,68,68,0.15)'
  },
  {
    id: 'ads',
    labelKey: 'privacyCategories.adsLabel',
    descriptionKey: 'privacyCategories.adsDescription',
    icon: Megaphone,
    color: '#f59e0b',
    bg: 'rgba(245,158,11,0.08)',
    border: 'rgba(245,158,11,0.15)'
  },
  {
    id: 'search',
    labelKey: 'privacyCategories.searchLabel',
    descriptionKey: 'privacyCategories.searchDescription',
    icon: Search,
    color: '#3b82f6',
    bg: 'rgba(59,130,246,0.08)',
    border: 'rgba(59,130,246,0.15)'
  },
  {
    id: 'sync',
    labelKey: 'privacyCategories.syncLabel',
    descriptionKey: 'privacyCategories.syncDescription',
    icon: RefreshCw,
    color: '#8b5cf6',
    bg: 'rgba(139,92,246,0.08)',
    border: 'rgba(139,92,246,0.15)'
  },
  {
    id: 'services',
    labelKey: 'privacyCategories.servicesLabel',
    descriptionKey: 'privacyCategories.servicesDescription',
    icon: Eye,
    color: '#14b8a6',
    bg: 'rgba(20,184,166,0.08)',
    border: 'rgba(20,184,166,0.15)'
  },
  {
    id: 'tasks',
    labelKey: 'privacyCategories.tasksLabel',
    descriptionKey: 'privacyCategories.tasksDescription',
    icon: CalendarClock,
    color: '#a3e635',
    bg: 'rgba(163,230,53,0.08)',
    border: 'rgba(163,230,53,0.15)'
  },
  {
    id: 'kernel',
    labelKey: 'privacyCategories.kernelLabel',
    descriptionKey: 'privacyCategories.kernelDescription',
    icon: Cpu,
    color: '#a855f7',
    bg: 'rgba(168,85,247,0.08)',
    border: 'rgba(168,85,247,0.15)'
  },
  {
    id: 'network',
    labelKey: 'privacyCategories.networkLabel',
    descriptionKey: 'privacyCategories.networkDescription',
    icon: Globe,
    color: '#06b6d4',
    bg: 'rgba(6,182,212,0.08)',
    border: 'rgba(6,182,212,0.15)'
  },
  {
    id: 'access',
    labelKey: 'privacyCategories.accessLabel',
    descriptionKey: 'privacyCategories.accessDescription',
    icon: Lock,
    color: '#f97316',
    bg: 'rgba(249,115,22,0.08)',
    border: 'rgba(249,115,22,0.15)'
  },
  {
    id: 'ai',
    labelKey: 'privacyCategories.aiLabel',
    descriptionKey: 'privacyCategories.aiDescription',
    icon: BrainCircuit,
    color: '#ec4899',
    bg: 'rgba(236,72,153,0.08)',
    border: 'rgba(236,72,153,0.15)'
  },
  {
    id: 'browser',
    labelKey: 'privacyCategories.browserLabel',
    descriptionKey: 'privacyCategories.browserDescription',
    icon: Compass,
    color: '#0ea5e9',
    bg: 'rgba(14,165,233,0.08)',
    border: 'rgba(14,165,233,0.15)'
  }
]

// ── Privacy score ring (animated, gradient arc) ──────────────

function PrivacyScore({ score }: { score: number }) {
  const animatedScore = useAnimatedCounter(score, 1000)
  const colors =
    score >= 80
      ? { start: '#22c55e', end: '#10b981', glow: '#22c55e', label: 'privacy.scoreWellProtected' }
      : score >= 50
        ? { start: '#fbbf24', end: '#f59e0b', glow: '#f59e0b', label: 'privacy.scoreNeedsImprovement' }
        : { start: '#ef4444', end: '#f43f5e', glow: '#ef4444', label: 'privacy.scoreAtRisk' }

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
          <linearGradient id="privacy-arc-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
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
          stroke="url(#privacy-arc-gradient)"
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

export function PrivacyShieldPage({ embedded }: { embedded?: boolean }) {
  const { t } = useTranslation('hardening')
  const state = usePrivacyStore(s => s.state)
  const status = usePrivacyStore(s => s.status)
  const applyResult = usePrivacyStore(s => s.applyResult)
  const expandedCategories = usePrivacyStore(s => s.expandedCategories)
  const progress = usePrivacyStore(s => s.progress)
  const historyEntries = useHistoryStore(s => s.entries)
  const progressCleanupRef = useRef<(() => void) | null>(null)
  const categoryRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false)
  const [, setTick] = useState(0)

  useEffect(() => {
    return () => { progressCleanupRef.current?.() }
  }, [])

  // Auto-scan on first visit (empty state)
  useEffect(() => {
    const store = usePrivacyStore.getState()
    if (store.status === 'idle' && !store.state) {
      handleScan()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleScan = useCallback(async () => {
    const store = usePrivacyStore.getState()
    store.setStatus('scanning')
    store.setApplyResult(null)
    store.setProgress(null)

    // Listen for progress
    progressCleanupRef.current?.()
    progressCleanupRef.current = window.clarity.onPrivacyProgress?.((data) => {
      usePrivacyStore.getState().setProgress(data)
    }) ?? null

    try {
      const result = await window.clarity.privacyScan()
      usePrivacyStore.getState().setState(result)
      // Auto-expand categories with unprotected settings
      const unprotected = new Set<string>()
      for (const s of result.settings) {
        if (!s.enabled) unprotected.add(s.category)
      }
      usePrivacyStore.getState().setExpandedCategories(unprotected)
      usePrivacyStore.getState().setStatus('done')
    } catch (err) {
      console.error('Privacy scan failed:', err)
      toast.error(t('privacy.scanFailed'))
      usePrivacyStore.getState().setStatus('idle')
    } finally {
      progressCleanupRef.current?.()
      progressCleanupRef.current = null
      usePrivacyStore.getState().setProgress(null)
    }
  }, [t])

  const handleApplyAll = useCallback(async () => {
    const store = usePrivacyStore.getState()
    if (!store.state) return
    const unprotectedIds = store.state.settings.filter(s => !s.enabled).map(s => s.id)
    if (unprotectedIds.length === 0) return

    const startTime = Date.now()
    store.setStatus('applying')
    store.setApplyResult(null)
    try {
      const result = await window.clarity.privacyApply(unprotectedIds)
      usePrivacyStore.getState().setApplyResult(result)
      // Re-scan to get updated state
      const updated = await window.clarity.privacyScan()
      usePrivacyStore.getState().setState(updated)
      usePrivacyStore.getState().setStatus('done')

      // Log to history
      const catMap: Record<string, { found: number; applied: number }> = {}
      for (const id of unprotectedIds) {
        const setting = store.state!.settings.find(s => s.id === id)
        if (setting) {
          if (!catMap[setting.category]) catMap[setting.category] = { found: 0, applied: 0 }
          catMap[setting.category].found++
        }
      }
      // Mark succeeded ones
      const failedIds = new Set(result.errors.map(e => e.id))
      for (const id of unprotectedIds) {
        const setting = store.state!.settings.find(s => s.id === id)
        if (setting && !failedIds.has(id)) {
          catMap[setting.category].applied++
        }
      }
      await useHistoryStore.getState().addEntry({
        id: Date.now().toString(),
        type: 'privacy',
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
        totalItemsFound: unprotectedIds.length,
        totalItemsCleaned: result.succeeded,
        totalItemsSkipped: 0,
        totalSpaceSaved: 0,
        categories: Object.entries(catMap).map(([name, d]) => ({
          name, itemsFound: d.found, itemsCleaned: d.applied, spaceSaved: 0
        })),
        errorCount: result.failed
      })
    } catch (err) {
      console.error('Privacy apply failed:', err)
      usePrivacyStore.getState().setApplyResult({ succeeded: 0, failed: unprotectedIds.length, errors: [{ id: '', label: t('privacy.allSettingsLabel'), reason: t('privacy.ipcCallFailed') }] })
      usePrivacyStore.getState().setStatus('done')
    }
  }, [t])

  const handleApplyCategory = useCallback(async (categoryId: string) => {
    const store = usePrivacyStore.getState()
    if (!store.state) return
    const ids = store.state.settings.filter(s => s.category === categoryId && !s.enabled).map(s => s.id)
    if (ids.length === 0) return

    const startTime = Date.now()
    store.setStatus('applying')
    store.setApplyResult(null)
    try {
      const result = await window.clarity.privacyApply(ids)
      usePrivacyStore.getState().setApplyResult(result)
      const updated = await window.clarity.privacyScan()
      usePrivacyStore.getState().setState(updated)
      usePrivacyStore.getState().setStatus('done')
      if (result.succeeded > 0) toast.success(t(result.succeeded > 1 ? 'privacy.settingsAppliedToastPlural' : 'privacy.settingsAppliedToast', { count: result.succeeded }))
      if (result.failed > 0) toast.error(t(result.failed > 1 ? 'privacy.settingsFailedToastPlural' : 'privacy.settingsFailedToast', { count: result.failed }))

      await useHistoryStore.getState().addEntry({
        id: Date.now().toString(),
        type: 'privacy',
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
        totalItemsFound: ids.length,
        totalItemsCleaned: result.succeeded,
        totalItemsSkipped: 0,
        totalSpaceSaved: 0,
        categories: [{ name: categoryId, itemsFound: ids.length, itemsCleaned: result.succeeded, spaceSaved: 0 }],
        errorCount: result.failed
      })
    } catch (err) {
      console.error('Privacy apply failed:', err)
      toast.error(t('privacy.applyFailed'), { description: t('privacy.applyFailedDescription') })
      usePrivacyStore.getState().setApplyResult({ succeeded: 0, failed: ids.length, errors: [{ id: '', label: categoryId, reason: t('privacy.ipcCallFailed') }] })
      usePrivacyStore.getState().setStatus('done')
    }
  }, [t])

  const handleToggleSingle = useCallback(async (settingId: string) => {
    const store = usePrivacyStore.getState()
    if (!store.state) return
    const setting = store.state.settings.find(s => s.id === settingId)
    if (!setting) return

    const wasEnabled = setting.enabled
    const isEnabling = !wasEnabled
    store.setStatus('applying')
    try {
      const result = isEnabling
        ? await window.clarity.privacyApply([settingId])
        : await window.clarity.privacyRevert([settingId])
      const updated = await window.clarity.privacyScan()
      usePrivacyStore.getState().setState(updated)
      usePrivacyStore.getState().setStatus('done')

      const newSetting = updated.settings.find(s => s.id === settingId)
      const actuallyChanged = newSetting != null && newSetting.enabled !== wasEnabled

      if (result.failed > 0) {
        const reason = result.errors[0]?.reason || t('privacy.unknownError')
        toast.error(t(isEnabling ? 'privacy.settingApplyFailed' : 'privacy.settingRevertFailed', { label: setting.label }), { description: reason })
      } else if (!actuallyChanged) {
        // Operation reported success but system state didn't change (e.g. needs admin)
        toast.error(t(isEnabling ? 'privacy.settingApplyFailed' : 'privacy.settingRevertFailed', { label: setting.label }), { description: t('privacy.adminRequired') })
      } else {
        toast.success(t(newSetting.enabled ? 'privacy.settingEnabled' : 'privacy.settingDisabled', { label: setting.label }))
      }
    } catch {
      toast.error(t(isEnabling ? 'privacy.settingApplyFailedGeneric' : 'privacy.settingRevertFailedGeneric'))
      usePrivacyStore.getState().setStatus('done')
    }
  }, [t])

  // Restore all reversible protections to their defaults
  const handleRestoreDefaults = useCallback(async () => {
    const store = usePrivacyStore.getState()
    if (!store.state) return
    const revertibleIds = store.state.settings
      .filter(s => s.enabled && s.reversible)
      .map(s => s.id)
    if (revertibleIds.length === 0) {
      toast.info(t('privacy.restoreNoneToast'))
      return
    }

    const startTime = Date.now()
    store.setStatus('applying')
    store.setApplyResult(null)
    try {
      const result = await window.clarity.privacyRevert(revertibleIds)
      const updated = await window.clarity.privacyScan()
      usePrivacyStore.getState().setState(updated)
      usePrivacyStore.getState().setStatus('done')

      if (result.succeeded > 0) toast.success(t(result.succeeded > 1 ? 'privacy.restoreToastPlural' : 'privacy.restoreToast', { count: result.succeeded }))
      if (result.failed > 0) toast.error(t('privacy.restoreFailedToast'))

      if (result.succeeded > 0) {
        await useHistoryStore.getState().addEntry({
          id: Date.now().toString(),
          type: 'privacy',
          timestamp: new Date().toISOString(),
          duration: Date.now() - startTime,
          totalItemsFound: revertibleIds.length,
          totalItemsCleaned: result.succeeded,
          totalItemsSkipped: 0,
          totalSpaceSaved: 0,
          categories: [{ name: 'restore', itemsFound: revertibleIds.length, itemsCleaned: result.succeeded, spaceSaved: 0 }],
          errorCount: result.failed
        })
      }
    } catch (err) {
      console.error('Privacy restore failed:', err)
      toast.error(t('privacy.restoreFailedToast'))
      usePrivacyStore.getState().setStatus('done')
    }
  }, [t])

  // Expand every category and scroll to the first one
  const handleReviewPermissions = useCallback(() => {
    const store = usePrivacyStore.getState()
    if (!store.state) return
    const allCats = new Set(store.state.settings.map(s => s.category))
    store.setExpandedCategories(allCats)
    setTick(x => x + 1)
    const first = categories.find(c => allCats.has(c.id))
    if (first) {
      requestAnimationFrame(() => {
        categoryRefs.current[first.id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
  }, [])

  const isScanning = status === 'scanning'
  const isApplying = status === 'applying'
  const busy = isScanning || isApplying
  const unprotectedCount = state ? state.total - state.protected : 0

  // Present categories (those with settings for this platform)
  const presentCategories = state
    ? categories.filter(cat => state.settings.some(s => s.category === cat.id))
    : []

  // Activity data derived from privacy history entries
  const privacyHistory = historyEntries
    .filter(e => e.type === 'privacy')
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
  const checksPerformed = privacyHistory.length
  const issuesFixed = privacyHistory.reduce((sum, e) => sum + (e.totalItemsCleaned || 0), 0)
  const lastScanEntry = privacyHistory.length > 0 ? privacyHistory[privacyHistory.length - 1] : null
  const lastScanText = lastScanEntry ? formatDate(lastScanEntry.timestamp) : t('privacy.neverScanned')
  const trendData = privacyHistory.slice(-8).map((e) => ({
    label: new Date(e.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    fixed: e.totalItemsCleaned || 0
  }))

  const headerAction = (
    <div className="flex items-center gap-2.5">
      <button
        onClick={handleScan}
        disabled={busy}
        className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-medium text-zinc-300 transition-all disabled:opacity-40"
        style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-medium)' }}
      >
        <Eye className="h-4 w-4" strokeWidth={1.8} />
        {t('privacy.scanButton')}
      </button>
      {state && unprotectedCount > 0 && (
        <button
          onClick={handleApplyAll}
          disabled={busy}
          className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-30"
          style={{
            background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
            color: '#fff',
            boxShadow: '0 4px 20px rgba(34,197,94,0.2)'
          }}
        >
          <ShieldCheck className="h-4 w-4" strokeWidth={2} />
          {t('privacy.protectAllButton', { count: unprotectedCount })}
        </button>
      )}
    </div>
  )

  return (
    <div className={embedded ? '' : 'flex h-full flex-col overflow-y-auto'}>
      {!embedded && (
        <PageHeader
          title={t('privacy.pageTitle')}
          description={t('privacy.pageDescription')}
          action={headerAction}
        />
      )}
      {embedded && (
        <div className="mb-5 flex justify-end">
          {headerAction}
        </div>
      )}

      <div className={embedded ? 'space-y-8' : 'flex-1 space-y-8 px-0 pb-8'}>
        {/* ── 1 · Privacy Overview ─────────────────────── */}
        {state && !isScanning && (
          <Section index={0}>
            <SectionHeading icon={ShieldCheck} title={t('privacy.overviewHeading')} hint={t('privacy.overviewHint')} />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {/* Score hero */}
              <div className="glass-card glass-card-hover flex flex-col items-center justify-center rounded-2xl px-6 py-7">
                <PrivacyScore score={state.score} />
                <span
                  className="mt-4 text-[14px] font-bold tracking-wide"
                  style={{
                    color: state.score >= 80 ? '#22c55e' : state.score >= 50 ? '#f59e0b' : '#ef4444',
                    textShadow: `0 0 18px ${state.score >= 80 ? '#22c55e' : state.score >= 50 ? '#f59e0b' : '#ef4444'}30`
                  }}
                >
                  {t(state.score >= 80 ? 'privacy.scoreWellProtected' : state.score >= 50 ? 'privacy.scoreNeedsImprovement' : 'privacy.scoreAtRisk')}
                </span>
                <p className="mt-2 max-w-[240px] text-center text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  {t('privacy.privacyScore')}
                </p>
              </div>

              {/* Stats + coverage */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:col-span-2 lg:grid-cols-3">
                <StatBlock
                  icon={ShieldCheck}
                  label={t('privacy.protectionsEnabled')}
                  value={`${state.protected}/${state.total}`}
                  color="#22c55e"
                  bg="rgba(34,197,94,0.10)"
                />
                <StatBlock
                  icon={unprotectedCount === 0 ? CheckCircle2 : AlertTriangle}
                  label={t('privacy.issuesDetected')}
                  value={String(unprotectedCount)}
                  color={unprotectedCount === 0 ? '#22c55e' : '#f59e0b'}
                  bg={unprotectedCount === 0 ? 'rgba(34,197,94,0.10)' : 'rgba(245,158,11,0.10)'}
                />
                <StatBlock
                  icon={CalendarClock}
                  label={t('privacy.lastScan')}
                  value={lastScanText}
                  color="var(--text-muted)"
                  bg="var(--bg-subtle-2)"
                />
              </div>

              {/* Coverage bar */}
              <div className="glass-card rounded-2xl px-5 py-5 lg:col-span-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[12px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{t('privacy.overviewHeading')}</span>
                  <span className="font-mono text-[12px]" style={{ color: 'var(--text-muted)' }}>
                    {state.protected} / {state.total}
                  </span>
                </div>
                <div className="flex h-2 gap-1 overflow-hidden rounded-full">
                  {presentCategories.map((cat) => {
                    const catSettings = state.settings.filter(s => s.category === cat.id)
                    const protectedInCat = catSettings.filter(s => s.enabled).length
                    const pct = (protectedInCat / catSettings.length) * 100
                    const allGood = protectedInCat === catSettings.length
                    return (
                      <div
                        key={cat.id}
                        className="h-full min-w-[4px] rounded-full transition-all duration-700"
                        style={{
                          width: `${100 / presentCategories.length}%`,
                          background: allGood
                            ? 'linear-gradient(90deg, #22c55e, #10b981)'
                            : protectedInCat > 0
                              ? `linear-gradient(90deg, ${cat.color}, ${cat.color}88)`
                              : 'var(--bg-active)'
                        }}
                        title={`${t(cat.labelKey)} — ${protectedInCat}/${catSettings.length}`}
                      />
                    )
                  })}
                </div>
                <p className="mt-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {state.protected === state.total
                    ? t('privacy.fullyProtected')
                    : t('privacy.unprotectedCount', { count: unprotectedCount })}
                </p>
              </div>
            </div>
          </Section>
        )}

        {/* ── 2 · Protection Categories ──────────────── */}
        {state && !isScanning && (
          <Section index={1}>
            <SectionHeading icon={Layers} title={t('privacy.categoriesHeading')} hint={t('privacy.categoriesHint')} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {presentCategories.map(cat => {
                const catSettings = state.settings.filter(s => s.category === cat.id)
                const protectedInCat = catSettings.filter(s => s.enabled).length
                const allProtected = protectedInCat === catSettings.length
                const unprotectedInCat = catSettings.length - protectedInCat
                const isExpanded = expandedCategories.has(cat.id)
                const CatIcon = cat.icon
                const statusColor = allProtected ? '#22c55e' : unprotectedInCat === catSettings.length ? '#ef4444' : '#f59e0b'
                const statusLabel = allProtected
                  ? t('privacy.categoryStatusProtected')
                  : unprotectedInCat === catSettings.length
                    ? t('privacy.categoryStatusAtRisk')
                    : t('privacy.categoryStatusNeedsAttention')

                return (
                  <div
                    key={cat.id}
                    ref={(el) => { categoryRefs.current[cat.id] = el }}
                    className={cn(
                      'glass-card glass-card-hover overflow-hidden rounded-2xl transition-all',
                      isExpanded && 'ring-1',
                      isApplying && 'opacity-50 pointer-events-none'
                    )}
                    style={isExpanded ? { boxShadow: `0 0 0 1px ${cat.border}` } : undefined}
                  >
                    {/* Card header (clickable to expand) */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => usePrivacyStore.getState().toggleCategory(cat.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter') usePrivacyStore.getState().toggleCategory(cat.id) }}
                      className="flex cursor-pointer items-start gap-3.5 p-5"
                    >
                      <div
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                        style={{ background: allProtected ? 'rgba(34,197,94,0.1)' : cat.bg }}
                      >
                        <CatIcon className="h-5 w-5" style={{ color: allProtected ? '#22c55e' : cat.color }} strokeWidth={1.8} />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[13.5px] font-semibold text-zinc-200">{t(cat.labelKey)}</span>
                        </div>
                        <span
                          className="mt-1.5 inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-bold tracking-wide"
                          style={{ background: `${statusColor}1a`, color: statusColor }}
                        >
                          {statusLabel}
                        </span>
                      </div>

                      <ChevronDown
                        className={cn('h-4 w-4 shrink-0 transition-transform duration-200', isExpanded && 'rotate-180')}
                        style={{ color: 'var(--text-muted)' }}
                        strokeWidth={1.8}
                      />
                    </div>

                    {/* Progress + actions */}
                    <div className="px-5 pb-4">
                      <div className="mb-2 h-[4px] overflow-hidden rounded-full" style={{ background: 'var(--bg-subtle-2)' }}>
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{
                            width: `${(protectedInCat / catSettings.length) * 100}%`,
                            background: `linear-gradient(90deg, ${statusColor}, ${statusColor}bb)`,
                            boxShadow: `0 0 8px ${statusColor}30`
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          {protectedInCat}/{catSettings.length}
                        </span>
                        <div className="flex items-center gap-2">
                          {!allProtected && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleApplyCategory(cat.id)
                              }}
                              disabled={busy}
                              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-40"
                              style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}
                            >
                              <ShieldCheck className="h-3 w-3" strokeWidth={2.2} />
                              {t('privacy.protectAllCategoryButton')}
                            </button>
                          )}
                          <span
                            className="text-[11px] font-medium"
                            style={{ color: 'var(--text-faint)' }}
                          >
                            {isExpanded ? t('privacy.hideDetails') : t('privacy.viewDetails')}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Expanded settings */}
                    {isExpanded && (
                      <div className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                        {catSettings.map((setting, i) => {
                          const depSetting = setting.dependsOn
                            ? state?.settings.find(s => s.id === setting.dependsOn)
                            : undefined
                          const depMissing = depSetting !== undefined && !depSetting.enabled
                          const toggleDisabled = busy || depMissing || (setting.enabled && !setting.reversible)

                          return (
                            <div key={setting.id}
                              className="flex items-center gap-4 px-5 py-3.5"
                              style={{
                                borderBottom: i < catSettings.length - 1 ? '1px solid var(--bg-subtle)' : 'none'
                              }}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-[13px] font-medium text-zinc-300">{setting.label}</span>
                                  {setting.requiresAdmin && (
                                    <span className="rounded px-1 py-0.5 text-[9px] font-semibold uppercase"
                                      style={{ background: 'var(--accent-muted-bg)', color: 'var(--accent)' }}>
                                      {t('privacy.adminBadge')}
                                    </span>
                                  )}
                                </div>
                                <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-dim)' }}>{setting.description}</p>
                                {depMissing && depSetting && (
                                  <p className="mt-0.5 text-[10px]" style={{ color: 'var(--accent)' }}>
                                    {t('privacy.requiresSettingEnabled', { label: depSetting.label })}
                                  </p>
                                )}
                              </div>

                              {/* Toggle switch */}
                              <button
                                onClick={() => handleToggleSingle(setting.id)}
                                disabled={toggleDisabled}
                                className="relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60"
                                style={{ background: setting.enabled ? '#22c55e' : 'var(--bg-active)' }}
                              >
                                <div className="absolute top-0.5 h-5 w-5 rounded-full transition-all"
                                  style={{
                                    left: setting.enabled ? '22px' : '2px',
                                    background: setting.enabled ? '#fff' : 'var(--text-muted)'
                                  }} />
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </Section>
        )}

        {/* ── 3 · Recommended Actions ────────────────── */}
        {state && !isScanning && (
          <Section index={2}>
            <SectionHeading icon={ListChecks} title={t('privacy.recommendationsHeading')} hint={t('privacy.recommendationsHint')} />
            {unprotectedCount === 0 ? (
              <div
                className="glass-card flex items-center gap-3.5 rounded-2xl px-5 py-4"
                style={{ background: 'rgba(34,197,94,0.04)', borderColor: 'rgba(34,197,94,0.12)' }}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: 'rgba(34,197,94,0.1)' }}>
                  <CheckCircle2 className="h-4.5 w-4.5 text-green-500" strokeWidth={1.8} />
                </div>
                <div>
                  <p className="text-[13px] font-medium text-zinc-200">{t('privacy.allProtectedTitle')}</p>
                  <p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>{t('privacy.allProtectedDescription')}</p>
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                {presentCategories
                  .map(cat => ({
                    cat,
                    unprotected: state.settings.filter(s => s.category === cat.id && !s.enabled).length
                  }))
                  .filter(c => c.unprotected > 0)
                  .sort((a, b) => b.unprotected - a.unprotected)
                  .slice(0, 4)
                  .map(({ cat, unprotected }) => (
                    <div
                      key={cat.id}
                      className="glass-card glass-card-hover group flex items-center gap-3.5 rounded-2xl px-5 py-3.5"
                      style={{ borderColor: 'rgba(245,158,11,0.15)' }}
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: 'rgba(245,158,11,0.1)' }}>
                        <AlertTriangle className="h-4 w-4 text-amber-500" strokeWidth={1.8} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-zinc-200">
                          {t('privacy.recSettingsNeedAttention', { count: unprotected, category: t(cat.labelKey) })}
                        </p>
                        <p className="mt-0.5 text-[11.5px]" style={{ color: 'var(--text-muted)' }}>{t(cat.descriptionKey)}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          onClick={() => handleApplyCategory(cat.id)}
                          disabled={busy}
                          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-all disabled:opacity-40"
                          style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: '#fff' }}
                        >
                          <ShieldCheck className="h-3 w-3" strokeWidth={2.2} />
                          {t('privacy.fixButton')}
                        </button>
                        <button
                          onClick={() => {
                            usePrivacyStore.getState().setExpandedCategories(new Set([cat.id]))
                            requestAnimationFrame(() => {
                              categoryRefs.current[cat.id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                            })
                          }}
                          disabled={busy}
                          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-40"
                          style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-secondary)', border: '1px solid var(--border-medium)' }}
                        >
                          {t('privacy.reviewButton')}
                          <ArrowRight className="h-3 w-3 -translate-x-0.5 transition-transform group-hover:translate-x-0" strokeWidth={2} />
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </Section>
        )}

        {/* ── 4 · Privacy Activity ───────────────────── */}
        {state && !isScanning && (
          <Section index={3}>
            <SectionHeading icon={BarChart3} title={t('privacy.activityHeading')} hint={t('privacy.activityHint')} />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Trend chart */}
              <div className="glass-card glass-card-hover rounded-2xl px-5 py-5">
                <h3 className="mb-4 text-[12px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{t('privacy.trendLabel')}</h3>
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
                        formatter={(val) => [String(val), t('privacy.issuesFixed')]}
                        labelStyle={{ color: 'var(--text-muted)', fontSize: '11px' }}
                      />
                      <Bar dataKey="fixed" fill="#22c55e" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-[140px] items-center justify-center text-[12px]" style={{ color: 'var(--text-muted)' }}>
                    {t('privacy.trendNoData')}
                  </div>
                )}
              </div>

              {/* Activity summary */}
              <div className="glass-card glass-card-hover rounded-2xl px-5 py-5">
                <div className="mb-4 grid grid-cols-2 gap-3">
                  <MiniStat icon={BarChart3} label={t('privacy.checksPerformed')} value={String(checksPerformed)} color="#3b82f6" />
                  <MiniStat icon={ShieldCheck} label={t('privacy.issuesFixed')} value={String(issuesFixed)} color="#22c55e" />
                </div>
                <div className="flex items-center justify-between rounded-xl px-3.5 py-2.5" style={{ background: 'var(--bg-subtle)' }}>
                  <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    {t('privacy.lastScan')}
                  </span>
                  <span className="text-[12px] font-semibold text-zinc-300">{lastScanText}</span>
                </div>
                {privacyHistory.length === 0 && (
                  <p className="mt-3 text-[12px]" style={{ color: 'var(--text-muted)' }}>{t('privacy.activityEmpty')}</p>
                )}
              </div>
            </div>
          </Section>
        )}

        {/* ── 5 · Quick Actions ──────────────────────── */}
        {state && !isScanning && (
          <Section index={4}>
            <SectionHeading icon={Zap} title={t('privacy.actionsHeading')} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <QuickActionButton
                icon={Eye}
                title={t('privacy.actionScan')}
                description={t('privacy.actionScanDesc')}
                gradient="linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)"
                glow="rgba(59,130,246,0.2)"
                disabled={busy}
                onClick={handleScan}
              />
              <QuickActionButton
                icon={ShieldCheck}
                title={t('privacy.actionFix')}
                description={t('privacy.actionFixDesc')}
                gradient="linear-gradient(135deg, #22c55e 0%, #16a34a 100%)"
                glow="rgba(34,197,94,0.2)"
                disabled={busy || unprotectedCount === 0}
                onClick={handleApplyAll}
              />
              <QuickActionButton
                icon={ListChecks}
                title={t('privacy.actionReview')}
                description={t('privacy.actionReviewDesc')}
                gradient="linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)"
                glow="rgba(139,92,246,0.2)"
                disabled={busy}
                onClick={handleReviewPermissions}
              />
              <QuickActionButton
                icon={RotateCcw}
                title={t('privacy.actionRestore')}
                description={t('privacy.actionRestoreDesc')}
                gradient="linear-gradient(135deg, #f97316 0%, #ea580c 100%)"
                glow="rgba(249,115,22,0.2)"
                disabled={busy}
                onClick={() => setShowRestoreConfirm(true)}
              />
            </div>
          </Section>
        )}
      </div>

      {/* Scanning progress */}
      {isScanning && (
        <div className="mb-5 rounded-2xl p-5 glass-card" style={{ borderColor: 'rgba(245,158,11,0.15)' }}>
          <div className="flex items-center gap-3 mb-3">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-green-400" strokeWidth={2} />
            <span className="text-[13px] font-medium text-zinc-200">
              {progress ? t('privacy.scanProgressChecking', { label: progress.currentLabel }) : t('privacy.scanProgressPreparing')}
            </span>
            {progress && (
              <span className="ml-auto text-[12px] font-mono text-zinc-500">
                {progress.current} / {progress.total}
              </span>
            )}
          </div>

          {/* Progress bar */}
          <div className="h-1.5 rounded-full overflow-hidden mb-3" style={{ background: 'var(--bg-subtle-2)' }}>
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${progress ? (progress.current / progress.total) * 100 : 0}%`,
                background: 'linear-gradient(90deg, #22c55e, #16a34a)'
              }}
            />
          </div>

          {/* Category pills showing which categories have been checked */}
          {progress && (
            <div className="flex flex-wrap gap-1.5">
              {categories.map(cat => {
                const catLabel = t(cat.labelKey).split(' ')[0]
                const isCurrent = progress.category === cat.id
                const catIdx = categories.findIndex(c => c.id === cat.id)
                const currentCatIdx = categories.findIndex(c => c.id === progress.category)
                const isDone = catIdx < currentCatIdx

                return (
                  <div
                    key={cat.id}
                    className="flex items-center gap-1 rounded-md px-2 py-1"
                    style={{
                      background: isCurrent ? 'rgba(34,197,94,0.1)' : isDone ? 'rgba(34,197,94,0.06)' : 'var(--bg-subtle)',
                      border: `1px solid ${isCurrent ? 'rgba(34,197,94,0.2)' : isDone ? 'rgba(34,197,94,0.1)' : 'var(--border-subtle)'}`
                    }}
                  >
                    {isDone ? (
                      <CheckCircle2 className="h-3 w-3 text-green-500" strokeWidth={2} />
                    ) : isCurrent ? (
                      <div className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-green-400 border-t-transparent" />
                    ) : (
                      <div className="h-3 w-3 rounded-full" style={{ background: 'var(--bg-active)' }} />
                    )}
                    <span
                      className="text-[10px] font-medium"
                      style={{ color: isCurrent ? '#4ade80' : isDone ? '#4ade80' : 'var(--text-muted)' }}
                    >
                      {catLabel}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Applying state */}
      {isApplying && (
        <div className="mb-5 flex items-center gap-3 rounded-2xl px-5 py-4 glass-card" style={{ borderColor: 'rgba(245,158,11,0.15)' }}>
          <Loader2 className="h-4 w-4 animate-spin text-green-400" />
          <span className="text-[13px] text-zinc-400">{t('privacy.applyingProtections')}</span>
        </div>
      )}

      {/* Apply result */}
      {applyResult && status === 'done' && (
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
                {t(applyResult.succeeded !== 1 ? 'privacy.settingsAppliedPlural' : 'privacy.settingsApplied', { count: applyResult.succeeded })}
              </p>
              {applyResult.failed > 0 && (
                <p className="text-[12px] mt-0.5" style={{ color: 'var(--accent)' }}>
                  {t('privacy.settingsFailedRequireAdmin', { count: applyResult.failed })}
                </p>
              )}
            </div>
          </div>
          {applyResult.errors.length > 0 && (
            <div className="mt-3 ml-8 space-y-1">
              {applyResult.errors.map((err) => (
                <p key={err.id} className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
                  {err.label}: {err.reason}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!state && !isScanning && (
        <EmptyState
          icon={Eye}
          title={t('privacy.emptyStateTitle')}
          description={t('privacy.emptyStateDescription')}
          action={
            <button
              onClick={handleScan}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all"
              style={{
                background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                color: '#fff',
                boxShadow: '0 4px 20px rgba(34,197,94,0.2)'
              }}
            >
              <Eye className="h-4 w-4" strokeWidth={2} />
              {t('privacy.scanButton')}
            </button>
          }
        />
      )}

      {/* Admin warning */}
      {state && unprotectedCount > 0 && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl px-5 py-3"
          style={{ background: 'rgba(245,158,11,0.04)', border: '1px solid var(--accent-muted-bg)' }}>
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" strokeWidth={1.8} />
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {t('privacy.adminWarning')}
          </p>
        </div>
      )}

      {/* Restore defaults confirm */}
      <ConfirmDialog
        open={showRestoreConfirm}
        onConfirm={() => { setShowRestoreConfirm(false); handleRestoreDefaults() }}
        onCancel={() => setShowRestoreConfirm(false)}
        title={t('privacy.restoreConfirmTitle')}
        description={t('privacy.restoreConfirmDescription')}
        confirmLabel={t('privacy.restoreConfirmLabel')}
        variant="warning"
      />
    </div>
  )
}

// ── Stat block (overview) ─────────────────────────────────────

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

// ── Mini stat (activity) ──────────────────────────────────────

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

// ── Quick action button ───────────────────────────────────────

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
