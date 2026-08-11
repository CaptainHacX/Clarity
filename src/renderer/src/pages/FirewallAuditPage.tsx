import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import {
  ShieldCheck,
  ShieldAlert,
  Search,
  ShieldOff,
  Trash2,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Sparkles,
  Globe,
  FileX,
  FileWarning,
  Network,
  Inbox,
  Layers,
  ListChecks,
  BarChart3,
  Zap,
  ScanSearch,
  RotateCcw,
  ChevronDown,
  Circle,
  ArrowRight,
  Settings2,
  CalendarClock
} from 'lucide-react'
import { toast } from 'sonner'
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { cn, formatDate } from '@/lib/utils'
import { useAnimatedCounter } from '@/hooks/useAnimatedCounter'
import { useFirewallStore } from '@/stores/firewall-store'
import type {
  FirewallScanProgress,
  FirewallRule,
  FirewallRiskLevel,
  FirewallIssue,
  FirewallAction,
  FirewallProfile
} from '@shared/types'
import type { LucideIcon } from 'lucide-react'

const EASE = [0.16, 1, 0.3, 1] as const

const RISK_COLORS: Record<FirewallRiskLevel, { dot: string; bg: string; border: string; text: string }> = {
  high:   { dot: '#ef4444', bg: 'rgba(239,68,68,0.10)', border: 'rgba(239,68,68,0.20)', text: '#ef4444' },
  medium: { dot: '#f59e0b', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.20)', text: '#f59e0b' },
  low:    { dot: '#22c55e', bg: 'rgba(34,197,94,0.10)',  border: 'rgba(34,197,94,0.20)',  text: '#22c55e' }
}

const RISK_KEY: Record<FirewallRiskLevel, string> = {
  high: 'firewall.riskHigh',
  medium: 'firewall.riskMedium',
  low: 'firewall.riskLow'
}

const ISSUE_LABEL: Record<FirewallIssue, string> = {
  'stale': 'firewall.issueStale',
  'unsigned': 'firewall.issueUnsigned',
  'broad-scope': 'firewall.issueBroadScope',
  'any-remote': 'firewall.issueAnyRemote'
}

const ISSUE_ICON: Record<FirewallIssue, LucideIcon> = {
  'stale': FileX,
  'unsigned': FileWarning,
  'broad-scope': Globe,
  'any-remote': Network
}

const ISSUE_COLOR: Record<FirewallIssue, string> = {
  'stale': '#ef4444',
  'unsigned': '#f59e0b',
  'broad-scope': '#ef4444',
  'any-remote': '#f59e0b'
}

// Apply-result copy is action-specific ("rule allowed" vs "rule deleted").
function resultKey(action: FirewallAction | null, plural: boolean): string {
  if (action === 'delete') return plural ? 'firewall.deleteResultPlural' : 'firewall.deleteResult'
  if (action === 'enable') return plural ? 'firewall.enableResultPlural' : 'firewall.enableResult'
  return plural ? 'firewall.applyResultPlural' : 'firewall.applyResult'
}

type RiskFilter = 'all' | FirewallRiskLevel
type ProgramFilter = 'all' | 'with-program' | 'no-program' | 'stale'

// ── Firewall score ring ───────────────────────────────────────

function ScoreRing({ score }: { score: number }) {
  const animatedScore = useAnimatedCounter(score, 1000)
  const colors =
    score >= 80
      ? { start: '#22c55e', end: '#10b981', glow: '#22c55e' }
      : score >= 55
        ? { start: '#fbbf24', end: '#f59e0b', glow: '#f59e0b' }
        : { start: '#ef4444', end: '#f43f5e', glow: '#ef4444' }

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
          <linearGradient id="firewall-arc-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
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
          stroke="url(#firewall-arc-gradient)"
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

// ── Section wrapper + heading ────────────────────────────────

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

// ── Stat / mini-stat / quick action ──────────────────────────

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

export function FirewallAuditPage() {
  const { t } = useTranslation('hardening')
  const rules = useFirewallStore((s) => s.rules)
  const scanning = useFirewallStore((s) => s.scanning)
  const applying = useFirewallStore((s) => s.applying)
  const scanProgress = useFirewallStore((s) => s.scanProgress)
  const applyResult = useFirewallStore((s) => s.applyResult)
  const error = useFirewallStore((s) => s.error)
  const hasScanned = useFirewallStore((s) => s.hasScanned)
  const truncated = useFirewallStore((s) => s.truncated)
  const lastScanAt = useFirewallStore((s) => s.lastScanAt)
  const searchQuery = useFirewallStore((s) => s.searchQuery)
  const riskFilter = useFirewallStore((s) => s.riskFilter)
  const programFilter = useFirewallStore((s) => s.programFilter)
  const showBuiltin = useFirewallStore((s) => s.showBuiltin)

  const [pendingAction, setPendingAction] = useState<FirewallAction | null>(null)
  const [appliedAction, setAppliedAction] = useState<FirewallAction | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const isBusy = scanning || applying

  useEffect(() => {
    const cleanup = window.clarity?.onFirewallProgress?.((data: FirewallScanProgress) => {
      useFirewallStore.getState().setScanProgress(data)
    })
    return () => { cleanup?.() }
  }, [])

  // ─── Scan ──────────────────────────────────────────────────
  const handleScan = useCallback(async () => {
    const store = useFirewallStore.getState()
    store.setScanning(true)
    store.setRules([])
    store.setApplyResult(null)
    store.setError(null)
    store.setScanProgress(null)
    store.setTruncated(false)

    try {
      const result = await window.clarity.firewallScan()
      const s = useFirewallStore.getState()
      s.setRules(result.rules)
      s.setTruncated(!!result.truncated)
      s.setHasScanned(true)
      s.setLastScanAt(Date.now())
    } catch (err) {
      toast.error(t('firewall.scanFailedToast'))
      useFirewallStore
        .getState()
        .setError(err instanceof Error ? err.message : t('firewall.scanFailedToast'))
    } finally {
      useFirewallStore.getState().setScanning(false)
      useFirewallStore.getState().setScanProgress(null)
    }
  }, [t])

  // Auto-scan on first visit
  useEffect(() => {
    if (!hasScanned && !scanning) handleScan()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Apply ─────────────────────────────────────────────────
  const handleApply = useCallback(async (action: FirewallAction) => {
    setPendingAction(null)
    const store = useFirewallStore.getState()
    const selected = store.rules.filter((r) => r.selected)
    if (selected.length === 0) return

    // Each action only applies to rules in the matching state: enable targets
    // blocked rules, disable targets active rules, delete targets both. Filter
    // here so a mixed selection never sends an action a rule can't perform.
    const eligible = selected.filter((r) =>
      action === 'delete' ? true : action === 'enable' ? !r.enabled : r.enabled
    )
    if (eligible.length === 0) return

    store.setApplying(true)
    store.setApplyResult(null)
    store.setError(null)
    setAppliedAction(action)

    const changes = eligible.map((r) => ({ name: r.name, action }))
    const requestedNames = new Set(eligible.map((r) => r.name))

    try {
      const result = await window.clarity.firewallApply(changes)
      useFirewallStore.getState().setApplyResult(result)
      if (result.succeeded > 0) {
        toast.success(t(resultKey(action, result.succeeded !== 1), { count: result.succeeded }))
      }
      if (result.failed > 0) toast.error(t('firewall.applyFailed', { count: result.failed }))

      // A full re-scan takes 30-90s on a typical system, so reflect the change
      // locally instead: delete removes the rule, disable/enable flips the
      // enabled flag so the row moves out of the actionable state.
      const failedNames = new Set(result.errors.map((e) => e.name).filter(Boolean))
      const s = useFirewallStore.getState()
      s.setRules(
        s.rules
          .map((r) => {
            if (!requestedNames.has(r.name) || failedNames.has(r.name)) return r
            if (action === 'delete') return null
            return { ...r, enabled: action === 'enable' }
          })
          .filter((r): r is FirewallRule => r !== null)
      )
    } catch (err) {
      toast.error(t('firewall.applyFailedToast'))
      useFirewallStore
        .getState()
        .setError(err instanceof Error ? err.message : t('firewall.applyFailedToast'))
    } finally {
      useFirewallStore.getState().setApplying(false)
    }
  }, [t])

  const handleSelectStale = useCallback(() => {
    useFirewallStore.getState().selectRecommended()
    requestAnimationFrame(() => listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [])

  const scrollToList = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [])

  const handleReviewRisk = useCallback((level: FirewallRiskLevel) => {
    useFirewallStore.getState().setRiskFilter(level)
    useFirewallStore.getState().setSearchQuery('')
    scrollToList()
  }, [scrollToList])

  const handleApplyRecommended = useCallback(() => {
    useFirewallStore.getState().selectRecommended()
    requestApply('disable')
  }, [])

  const requestApply = useCallback((action: FirewallAction) => {
    setPendingAction(action)
  }, [])

  // ─── Filtering ─────────────────────────────────────────────
  const filteredRules = useMemo(() => {
    let result = rules

    // Built-in / Microsoft / AppX rules are hidden by default. Stale built-ins
    // are still surfaced because a leftover rule pointing at a removed Windows
    // feature is genuinely worth cleaning up — the toggle handles only the noise.
    if (!showBuiltin) result = result.filter((r) => !r.builtin || r.issues.includes('stale'))

    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.displayName.toLowerCase().includes(q) ||
          r.group.toLowerCase().includes(q) ||
          r.programResolved.toLowerCase().includes(q)
      )
    }
    if (riskFilter !== 'all') result = result.filter((r) => r.risk === riskFilter)
    if (programFilter === 'with-program') result = result.filter((r) => !!r.programResolved)
    else if (programFilter === 'no-program') result = result.filter((r) => !r.programResolved)
    else if (programFilter === 'stale') result = result.filter((r) => r.issues.includes('stale'))

    return result
  }, [rules, searchQuery, riskFilter, programFilter, showBuiltin])

  // ─── Overview stats ────────────────────────────────────────
  const highCount = rules.filter((r) => r.risk === 'high').length
  const mediumCount = rules.filter((r) => r.risk === 'medium').length
  const lowCount = rules.filter((r) => r.risk === 'low').length
  const staleCount = rules.filter((r) => r.issues.includes('stale')).length
  const unsignedCount = rules.filter((r) => r.issues.includes('unsigned')).length
  const broadScopeCount = rules.filter((r) => r.issues.includes('broad-scope')).length
  const anyRemoteCount = rules.filter((r) => r.issues.includes('any-remote')).length
  const totalIssues = staleCount + unsignedCount + broadScopeCount + anyRemoteCount

  const firewallInactive = rules.some((r) => r.name === 'firewall-inactive')

  // Score: inactive firewall is the worst posture, an empty rule set on a
  // managed firewall reads as default-deny, otherwise weight the risk mix.
  const score = useMemo(() => {
    if (firewallInactive) return 4
    if (rules.length === 0) return 96
    const pctHigh = highCount / rules.length
    const pctMed = mediumCount / rules.length
    const pctLow = lowCount / rules.length
    return Math.max(0, Math.min(100, Math.round(
      100 * (1 - 0.55 * pctHigh - 0.3 * pctMed - 0.15 * pctLow)
    )))
  }, [firewallInactive, rules.length, highCount, mediumCount, lowCount])

  const scoreLabelKey =
    firewallInactive
      ? 'firewall.scoreAtRisk'
      : score >= 80
        ? 'firewall.scoreProtected'
        : score >= 55
          ? 'firewall.scoreNeedsAttention'
          : 'firewall.scoreAtRisk'

  // ─── Profile coverage ──────────────────────────────────────
  const PROFILE_ORDER: FirewallProfile[] = ['Domain', 'Private', 'Public', 'Any']
  const profileData = useMemo(
    () =>
      PROFILE_ORDER.map((key) => {
        const matching = rules.filter((r) => r.profiles.includes(key))
        return {
          key,
          count: matching.length,
          high: matching.filter((r) => r.risk === 'high').length,
          medium: matching.filter((r) => r.risk === 'medium').length
        }
      }),
    [rules] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const profileStatus = (p: { high: number; medium: number; count: number }): { label: string; color: string; bg: string } => {
    if (p.high > 0) return { label: t('firewall.profileAtRisk'), color: '#ef4444', bg: 'rgba(239,68,68,0.10)' }
    if (p.medium > 0) return { label: t('firewall.profileWarning'), color: '#f59e0b', bg: 'rgba(245,158,11,0.10)' }
    if (p.count > 0) return { label: t('firewall.profileProtected'), color: '#22c55e', bg: 'rgba(34,197,94,0.10)' }
    return { label: '—', color: 'var(--text-faint)', bg: 'var(--bg-subtle)' }
  }

  const overallProfileStatus = highCount > 0
    ? t('firewall.profileAtRisk')
    : mediumCount > 0
      ? t('firewall.profileWarning')
      : rules.length > 0
        ? t('firewall.profileProtected')
        : '—'

  // ─── Selection ─────────────────────────────────────────────
  const selectedRules = rules.filter((r) => r.selected)
  const selectedCount = selectedRules.length
  const selectedEnabledCount = selectedRules.filter((r) => r.enabled).length
  const selectedDisabledCount = selectedCount - selectedEnabledCount
  const builtinCount = rules.filter((r) => r.builtin && !r.issues.includes('stale')).length

  // The confirm dialog and apply count only the rules the pending action can
  // actually touch — a mixed selection never counts rules that would be skipped.
  const confirmCount =
    pendingAction === 'enable' ? selectedDisabledCount : pendingAction === 'disable' ? selectedEnabledCount : selectedCount

  // ─── Recommendations ───────────────────────────────────────
  const recommendations: { key: string; kind: 'warn' | 'danger' | 'ok'; icon: LucideIcon; title: string; description: string; action?: () => void; actionLabel?: string }[] = []
  if (firewallInactive) {
    recommendations.push({
      key: 'inactive',
      kind: 'danger',
      icon: ShieldAlert,
      title: t('firewall.recFirewallInactiveTitle'),
      description: t('firewall.recFirewallInactiveDescription'),
      action: () => handleReviewRisk('high'),
      actionLabel: t('firewall.recReviewButton')
    })
  }
  if (broadScopeCount > 0) {
    recommendations.push({
      key: 'broad-scope',
      kind: 'danger',
      icon: Globe,
      title: t('firewall.recBroadScopeTitle', { count: broadScopeCount, plural: broadScopeCount === 1 ? '' : 's' }),
      description: t('firewall.recBroadScopeDescription'),
      action: () => handleReviewRisk('high'),
      actionLabel: t('firewall.recReviewButton')
    })
  }
  if (staleCount > 0) {
    recommendations.push({
      key: 'stale',
      kind: 'warn',
      icon: FileX,
      title: t('firewall.recStaleTitle', { count: staleCount, plural: staleCount === 1 ? '' : 's' }),
      description: t('firewall.recStaleDescription'),
      action: handleSelectStale,
      actionLabel: t('firewall.recFixButton')
    })
  }
  if (unsignedCount > 0) {
    recommendations.push({
      key: 'unsigned',
      kind: 'warn',
      icon: FileWarning,
      title: t('firewall.recUnsignedTitle', { count: unsignedCount, plural: unsignedCount === 1 ? '' : 's' }),
      description: t('firewall.recUnsignedDescription'),
      action: () => handleReviewRisk('medium'),
      actionLabel: t('firewall.recReviewButton')
    })
  }
  if (recommendations.length === 0) {
    recommendations.push({
      key: rules.length === 0 ? 'default-deny' : 'all-good',
      kind: 'ok',
      icon: rules.length === 0 ? ShieldCheck : CheckCircle2,
      title: t(rules.length === 0 ? 'firewall.recDefaultDenyTitle' : 'firewall.recAllGoodTitle'),
      description: t(rules.length === 0 ? 'firewall.recDefaultDenyDescription' : 'firewall.recAllGoodDescription')
    })
  }

  // ─── Activity ──────────────────────────────────────────────
  const lastScanText = lastScanAt ? formatDate(new Date(lastScanAt)) : t('firewall.activityNeverAudited')
  const findingsTrend = [
    { key: 'stale', label: t('firewall.issueStale'), count: staleCount, color: '#ef4444' },
    { key: 'unsigned', label: t('firewall.issueUnsigned'), count: unsignedCount, color: '#f59e0b' },
    { key: 'broad-scope', label: t('firewall.issueBroadScope'), count: broadScopeCount, color: '#ef4444' },
    { key: 'any-remote', label: t('firewall.issueAnyRemote'), count: anyRemoteCount, color: '#f59e0b' }
  ]
  const trendData = findingsTrend.filter((f) => f.count > 0)

  // ─── Risk groups ───────────────────────────────────────────
  const riskGroups = useMemo(() => {
    const groups: { key: FirewallRiskLevel; rules: FirewallRule[] }[] = [
      { key: 'high', rules: filteredRules.filter((r) => r.risk === 'high') },
      { key: 'medium', rules: filteredRules.filter((r) => r.risk === 'medium') },
      { key: 'low', rules: filteredRules.filter((r) => r.risk === 'low') }
    ]
    return groups.filter((g) => g.rules.length > 0)
  }, [filteredRules])

  const headerAction = (
    <div className="flex flex-wrap items-center gap-2.5">
      <button
        onClick={handleScan}
        disabled={isBusy}
        className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-medium text-zinc-300 transition-all disabled:opacity-40"
        style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-medium)' }}
      >
        {scanning ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} /> : <RefreshCw className="h-4 w-4" strokeWidth={1.8} />}
        {hasScanned ? t('firewall.rescanButton') : t('firewall.scanButton')}
      </button>
      {hasScanned && staleCount > 0 && (
        <button
          onClick={handleSelectStale}
          disabled={isBusy}
          className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-40"
          style={{ background: 'rgba(34,197,94,0.10)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.20)' }}
        >
          <Sparkles className="h-4 w-4" strokeWidth={2} />
          {t('firewall.selectStaleButton', { count: staleCount })}
        </button>
      )}
      {hasScanned && selectedEnabledCount > 0 && (
        <button
          onClick={() => requestApply('disable')}
          disabled={isBusy}
          className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-40"
          style={{ background: '#f59e0b', color: '#fff', boxShadow: '0 4px 20px rgba(245,158,11,0.25)' }}
        >
          {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldOff className="h-4 w-4" strokeWidth={2} />}
          {t('firewall.disableSelectedButton', { count: selectedEnabledCount })}
        </button>
      )}
      {hasScanned && selectedDisabledCount > 0 && (
        <button
          onClick={() => requestApply('enable')}
          disabled={isBusy}
          className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', color: '#fff', boxShadow: '0 4px 20px rgba(34,197,94,0.25)' }}
        >
          {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" strokeWidth={2} />}
          {t('firewall.allowSelectedButton', { count: selectedDisabledCount })}
        </button>
      )}
      {hasScanned && selectedCount > 0 && (
        <button
          onClick={() => requestApply('delete')}
          disabled={isBusy}
          className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold text-white transition-all disabled:opacity-40"
          style={{ background: '#dc2626', boxShadow: '0 4px 20px rgba(220,38,38,0.25)' }}
        >
          <Trash2 className="h-4 w-4" strokeWidth={2} />
          {t('firewall.deleteSelectedButton')}
        </button>
      )}
    </div>
  )

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader
        title={t('firewall.pageTitle')}
        description={t('firewall.pageDescription')}
        action={headerAction}
      />

      <div className="flex-1 space-y-8 px-0 pb-8">
        {/* ── 1 · Firewall Overview ─────────────────────── */}
        {hasScanned && !scanning && (
          <Section index={0}>
            <SectionHeading icon={ShieldCheck} title={t('firewall.overviewHeading')} hint={t('firewall.overviewHint')} />
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
                  {t('firewall.scoreLabel')}
                </p>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:col-span-2">
                <StatBlock icon={Inbox} label={t('firewall.statRules')} value={String(rules.length)} color="#a1a1aa" bg="var(--bg-subtle-2)" />
                <StatBlock
                  icon={ShieldAlert}
                  label={t('firewall.statHighRisk')}
                  value={String(highCount)}
                  color={highCount === 0 ? '#22c55e' : '#ef4444'}
                  bg={highCount === 0 ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)'}
                />
                <StatBlock
                  icon={AlertTriangle}
                  label={t('firewall.statMediumRisk')}
                  value={String(mediumCount)}
                  color={mediumCount === 0 ? '#22c55e' : '#f59e0b'}
                  bg={mediumCount === 0 ? 'rgba(34,197,94,0.10)' : 'rgba(245,158,11,0.10)'}
                />
                <StatBlock
                  icon={FileWarning}
                  label={t('firewall.statIssues')}
                  value={String(totalIssues)}
                  color={totalIssues === 0 ? '#22c55e' : '#f59e0b'}
                  bg={totalIssues === 0 ? 'rgba(34,197,94,0.10)' : 'rgba(245,158,11,0.10)'}
                />
                <StatBlock
                  icon={FileX}
                  label={t('firewall.statStale')}
                  value={String(staleCount)}
                  color={staleCount === 0 ? '#22c55e' : '#ef4444'}
                  bg={staleCount === 0 ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)'}
                />
                <StatBlock
                  icon={CalendarClock}
                  label={t('firewall.activityLastAudit')}
                  value={lastScanText}
                  color="var(--text-muted)"
                  bg="var(--bg-subtle-2)"
                />
              </div>

              {/* Profile coverage bar */}
              <div className="glass-card rounded-2xl px-5 py-5 lg:col-span-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
                    <Layers className="h-3.5 w-3.5" style={{ color: 'var(--text-faint)' }} strokeWidth={1.8} />
                    {t('firewall.profilesHeading')}
                  </span>
                  <span
                    className="inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-bold tracking-wide"
                    style={{
                      background: highCount > 0 ? 'rgba(239,68,68,0.1)' : mediumCount > 0 ? 'rgba(245,158,11,0.1)' : 'rgba(34,197,94,0.1)',
                      color: highCount > 0 ? '#ef4444' : mediumCount > 0 ? '#f59e0b' : '#22c55e'
                    }}
                  >
                    {overallProfileStatus}
                  </span>
                </div>
                <div className="flex h-2 gap-1 overflow-hidden rounded-full">
                  {profileData.map((p) => {
                    const st = profileStatus(p)
                    return (
                      <div
                        key={p.key}
                        className="h-full min-w-[4px] rounded-full transition-all duration-700"
                        style={{
                          width: `${100 / PROFILE_ORDER.length}%`,
                          background:
                            p.count === 0
                              ? 'var(--bg-active)'
                              : p.high > 0
                                ? 'linear-gradient(90deg, #ef4444, #f43f5e)'
                                : p.medium > 0
                                  ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
                                  : 'linear-gradient(90deg, #22c55e, #10b981)'
                        }}
                        title={`${p.key === 'Any' ? t('firewall.profilesAny') : p.key} — ${p.count} rules`}
                      />
                    )
                  })}
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
                  {profileData.map((p) => {
                    const st = profileStatus(p)
                    return (
                      <div key={p.key} className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        <span
                          className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium"
                          style={{ background: st.bg, color: st.color }}
                        >
                          {p.key === 'Any' ? t('firewall.profilesAny') : p.key}
                        </span>
                        <span className="font-mono">{p.count}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </Section>
        )}

        {/* ── 2 · Security Findings ─────────────────────── */}
        {hasScanned && !scanning && (
          <Section index={1}>
            <SectionHeading icon={ListChecks} title={t('firewall.findingsHeading')} hint={t('firewall.findingsHint')} />
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
                      {rec.kind === 'danger' ? <Search className="h-3 w-3" strokeWidth={2.2} /> : <ShieldCheck className="h-3 w-3" strokeWidth={2.2} />}
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

        {/* ── 3 · Rule Audit ───────────────────────────── */}
        {hasScanned && !scanning && rules.length > 0 && (
          <Section index={2}>
            <SectionHeading icon={ScanSearch} title={t('firewall.rulesHeading')} hint={t('firewall.rulesHint')} />
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
                    placeholder={t('firewall.searchPlaceholder')}
                    value={searchQuery}
                    onChange={(e) => useFirewallStore.getState().setSearchQuery(e.target.value)}
                    className="w-full bg-transparent text-[13px] text-white placeholder-zinc-600 outline-none"
                  />
                </div>

                <FilterDropdown
                  value={riskFilter}
                  onChange={(v) => useFirewallStore.getState().setRiskFilter(v as RiskFilter)}
                  options={[
                    { value: 'all', label: t('firewall.filterAll') },
                    { value: 'high', label: t('firewall.filterHighRisk') },
                    { value: 'medium', label: t('firewall.filterMediumRisk') },
                    { value: 'low', label: t('firewall.filterLowRisk') }
                  ]}
                />

                <FilterDropdown
                  value={programFilter}
                  onChange={(v) => useFirewallStore.getState().setProgramFilter(v as ProgramFilter)}
                  options={[
                    { value: 'all', label: t('firewall.filterAll') },
                    { value: 'with-program', label: t('firewall.filterWithProgram') },
                    { value: 'no-program', label: t('firewall.filterPortOnly') },
                    { value: 'stale', label: t('firewall.filterStaleOnly') }
                  ]}
                />

                {builtinCount > 0 && (
                  <label
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-medium"
                    style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)', color: 'var(--text-secondary)' }}
                    title={t('firewall.showBuiltinTitle')}
                  >
                    <input
                      type="checkbox"
                      checked={showBuiltin}
                      onChange={(e) => useFirewallStore.getState().setShowBuiltin(e.target.checked)}
                      className="h-3.5 w-3.5 cursor-pointer accent-amber-500"
                    />
                    {t('firewall.showBuiltin', { count: builtinCount })}
                  </label>
                )}
              </div>

              {/* Selection action bar */}
              {(selectedCount > 0 || isBusy) && (
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div className="flex items-center gap-2.5">
                    <ShieldCheck className="h-4 w-4 shrink-0 text-amber-400" strokeWidth={2} />
                    <span className="text-[12.5px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                      {t('firewall.selectedCount', { count: selectedCount })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => useFirewallStore.getState().deselectAll()}
                      disabled={isBusy}
                      className="rounded-lg px-3 py-1.5 text-[11.5px] font-semibold transition-colors disabled:opacity-40"
                      style={{ color: 'var(--text-muted)', border: '1px solid var(--border-medium)' }}
                    >
                      {t('firewall.deselectAllButton')}
                    </button>
                    <button
                      onClick={() => requestApply('disable')}
                      disabled={isBusy || selectedEnabledCount === 0}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-semibold text-white transition-all disabled:opacity-40"
                      style={{ background: '#f59e0b', boxShadow: '0 2px 12px rgba(245,158,11,0.25)' }}
                    >
                      {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldOff className="h-3 w-3" strokeWidth={2.2} />}
                      {t('firewall.disableSelectedButton', { count: selectedEnabledCount })}
                    </button>
                    <button
                      onClick={() => requestApply('enable')}
                      disabled={isBusy || selectedDisabledCount === 0}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-semibold text-white transition-all disabled:opacity-40"
                      style={{ background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', boxShadow: '0 2px 12px rgba(34,197,94,0.25)' }}
                    >
                      {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" strokeWidth={2.2} />}
                      {t('firewall.allowSelectedButton', { count: selectedDisabledCount })}
                    </button>
                    <button
                      onClick={() => requestApply('delete')}
                      disabled={isBusy}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-semibold text-white transition-all disabled:opacity-40"
                      style={{ background: '#dc2626', boxShadow: '0 2px 12px rgba(220,38,38,0.25)' }}
                    >
                      {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" strokeWidth={2.2} />}
                      {t('firewall.deleteSelectedButton')}
                    </button>
                  </div>
                </div>
              )}

              {filteredRules.length === 0 ? (
                <div className="py-12 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
                  {t('firewall.noRulesMatch')}
                </div>
              ) : (
                <div className="max-h-[520px] overflow-y-auto p-4">
                  <div className="space-y-5">
                    {riskGroups.map((group) => (
                      <div key={group.key}>
                        <div className="mb-2 flex items-center gap-2">
                          <div className="h-2 w-2 rounded-full" style={{ background: RISK_COLORS[group.key].dot }} aria-hidden="true" />
                          <h3 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                            {t(RISK_KEY[group.key])}
                          </h3>
                          <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                            {group.rules.length}
                          </span>
                        </div>
                        <div className="space-y-1.5">
                          {group.rules.map((r) => (
                            <RuleRow key={r.name} rule={r} isBusy={isBusy} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="border-t px-4 py-2.5 text-right text-[11.5px]" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}>
                {t('firewall.showingCount', { filtered: filteredRules.length, total: rules.length })}
              </div>
            </div>
          </Section>
        )}

        {/* ── 4 · Firewall Activity ────────────────────── */}
        {hasScanned && !scanning && (
          <Section index={3}>
            <SectionHeading icon={BarChart3} title={t('firewall.activityHeading')} hint={t('firewall.activityHint')} />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Findings by type */}
              <div className="glass-card glass-card-hover rounded-2xl px-5 py-5">
                <h3 className="mb-4 text-[12px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  {t('firewall.activityTrendLabel')}
                </h3>
                {trendData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart data={trendData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barSize={26}>
                      <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} interval={0} />
                      <Tooltip
                        cursor={{ fill: 'var(--bg-subtle)' }}
                        contentStyle={{
                          background: '#1e1e24',
                          border: '1px solid var(--border-strong)',
                          borderRadius: '10px',
                          fontSize: '12px',
                          color: 'var(--text-primary)'
                        }}
                        formatter={(val) => [String(val), t('firewall.activityIssuesFound')]}
                        labelStyle={{ color: 'var(--text-muted)', fontSize: '11px' }}
                      />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {trendData.map((entry) => (
                          <Cell key={entry.key} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-[140px] items-center justify-center text-[12px]" style={{ color: 'var(--text-muted)' }}>
                    {t('firewall.activityTrendNoData')}
                  </div>
                )}
              </div>

              {/* Activity summary */}
              <div className="glass-card glass-card-hover rounded-2xl px-5 py-5">
                <div className="mb-4 grid grid-cols-3 gap-3">
                  <MiniStat icon={Inbox} label={t('firewall.activityRulesAudited')} value={String(rules.length)} color="#3b82f6" />
                  <MiniStat icon={AlertTriangle} label={t('firewall.activityIssuesFound')} value={String(totalIssues)} color="#f59e0b" />
                  <MiniStat icon={ShieldAlert} label={t('firewall.activityHighRisk')} value={String(highCount)} color={highCount === 0 ? '#22c55e' : '#ef4444'} />
                </div>
                <div className="flex items-center justify-between rounded-xl px-3.5 py-2.5" style={{ background: 'var(--bg-subtle)' }}>
                  <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    {t('firewall.activityLastAudit')}
                  </span>
                  <span className="text-[12px] font-semibold text-zinc-300">{lastScanText}</span>
                </div>
                {rules.length === 0 && (
                  <p className="mt-3 text-[12px]" style={{ color: 'var(--text-muted)' }}>{t('firewall.activityTrendNoData')}</p>
                )}
              </div>
            </div>
          </Section>
        )}

        {/* ── 5 · Quick Actions ───────────────────────── */}
        {hasScanned && !scanning && (
          <Section index={4}>
            <SectionHeading icon={Zap} title={t('firewall.actionsHeading')} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <QuickActionButton
                icon={ScanSearch}
                title={t('firewall.actionAudit')}
                description={t('firewall.actionAuditDesc')}
                gradient="linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)"
                glow="rgba(59,130,246,0.2)"
                disabled={isBusy}
                onClick={handleScan}
              />
              <QuickActionButton
                icon={Sparkles}
                title={t('firewall.actionFix')}
                description={t('firewall.actionFixDesc')}
                gradient="linear-gradient(135deg, #22c55e 0%, #16a34a 100%)"
                glow="rgba(34,197,94,0.2)"
                disabled={isBusy || staleCount === 0}
                onClick={handleSelectStale}
              />
              <QuickActionButton
                icon={Search}
                title={t('firewall.actionReview')}
                description={t('firewall.actionReviewDesc')}
                gradient="linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)"
                glow="rgba(139,92,246,0.2)"
                disabled={isBusy || highCount === 0}
                onClick={() => handleReviewRisk('high')}
              />
              <QuickActionButton
                icon={RefreshCw}
                title={t('firewall.actionRefresh')}
                description={t('firewall.actionRefreshDesc')}
                gradient="linear-gradient(135deg, #f59e0b 0%, #d97706 100%)"
                glow="rgba(245,158,11,0.2)"
                disabled={isBusy}
                onClick={handleScan}
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
                ? scanProgress.phase === 'enumerating'
                  ? t('firewall.scanningButton')
                  : scanProgress.phase === 'classifying'
                    ? t('firewall.overviewHint')
                    : t('firewall.overviewHint')
                : t('firewall.scanningButton')}
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
              {scanProgress.currentRule}
            </div>
          )}
        </div>
      )}

      {/* Applying state */}
      {applying && (
        <div className="mb-5 flex items-center gap-3 rounded-2xl px-5 py-4 glass-card" style={{ borderColor: 'rgba(245,158,11,0.15)' }}>
          <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
          <span className="text-[13px] text-zinc-400">{t('firewall.applyingRules')}</span>
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
                {t(resultKey(appliedAction, applyResult.succeeded !== 1), { count: applyResult.succeeded })}
              </p>
              {applyResult.failed > 0 && (
                <p className="mt-0.5 text-[12px]" style={{ color: 'var(--accent)' }}>
                  {t('firewall.applyFailed', { count: applyResult.failed })}
                </p>
              )}
            </div>
          </div>
          {applyResult.errors.length > 0 && (
            <div className="mt-3 ml-8 space-y-1">
              {applyResult.errors.map((e, i) => (
                <p key={i} className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
                  {e.displayName || e.name}: {e.reason}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Truncated notice — a partial rule set is still worth acting on, but it
          must not read as a complete audit: rules Windows never returned aren't "clean". */}
      {truncated && !scanning && (
        <div
          className="mb-5 flex items-start gap-2.5 rounded-2xl p-4 glass-card"
          style={{ background: 'rgba(245,158,11,0.06)', borderColor: 'rgba(245,158,11,0.2)' }}
        >
          <AlertTriangle className="mt-px h-4 w-4 shrink-0" style={{ color: '#f59e0b' }} strokeWidth={2} />
          <span className="text-[12.5px]" style={{ color: 'var(--text-secondary)' }}>
            {t('firewall.truncatedNotice')}
          </span>
        </div>
      )}

      {/* Error */}
      {error && (
        <ErrorAlert
          message={error}
          onDismiss={() => useFirewallStore.getState().setError(null)}
          className="mb-5"
        />
      )}

      {/* Empty state */}
      {!hasScanned && !scanning && (
        <EmptyState
          icon={ShieldAlert}
          title={t('firewall.noScanTitle')}
          description={t('firewall.noScanDescription')}
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
              {t('firewall.scanButton')}
            </button>
          }
        />
      )}

      {/* Confirm dialog */}
      <ConfirmDialog
        open={pendingAction !== null}
        onConfirm={() => pendingAction && handleApply(pendingAction)}
        onCancel={() => setPendingAction(null)}
        title={t(
          pendingAction === 'delete'
            ? 'firewall.confirmDeleteTitle'
            : pendingAction === 'enable'
              ? 'firewall.confirmAllowTitle'
              : 'firewall.confirmDisableTitle'
        )}
        description={t(
          pendingAction === 'delete'
            ? 'firewall.confirmDeleteDescription'
            : pendingAction === 'enable'
              ? 'firewall.confirmAllowDescription'
              : 'firewall.confirmDisableDescription',
          { count: confirmCount, plural: confirmCount === 1 ? '' : 's' }
        )}
        variant={pendingAction === 'delete' ? 'danger' : pendingAction === 'enable' ? 'default' : 'warning'}
        confirmLabel={t(
          pendingAction === 'delete'
            ? 'firewall.confirmDeleteLabel'
            : pendingAction === 'enable'
              ? 'firewall.confirmAllowLabel'
              : 'firewall.confirmDisableLabel'
        )}
      />
    </div>
  )
}

// ─── Rule row ────────────────────────────────────────────────

function RuleRow({ rule, isBusy }: { rule: FirewallRule; isBusy: boolean }) {
  const { t } = useTranslation('hardening')
  const colors = RISK_COLORS[rule.risk]
  const statusColor = rule.programResolved && !rule.programExists ? '#ef4444' : 'var(--text-muted)'

  return (
    <label
      className="flex cursor-pointer items-start gap-3 rounded-xl px-4 py-3 transition-colors"
      style={{
        background: rule.selected ? colors.bg : 'var(--bg-subtle)',
        border: `1px solid ${rule.selected ? colors.border : 'var(--border-subtle)'}`
      }}
    >
      <input
        type="checkbox"
        checked={rule.selected}
        disabled={isBusy}
        onChange={() => useFirewallStore.getState().toggleRule(rule.name)}
        className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-amber-500"
        aria-label={`Select rule ${rule.displayName}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-white">{rule.displayName}</span>
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium"
            style={{ background: colors.bg, color: colors.text, border: `1px solid ${colors.border}` }}
          >
            <Circle className="h-1.5 w-1.5 fill-current" stroke="none" />
            {t(RISK_KEY[rule.risk])}
          </span>
          {!rule.enabled && (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium"
              style={{ background: 'rgba(148,163,184,0.12)', color: '#a1a1aa', border: '1px solid rgba(148,163,184,0.25)' }}
            >
              <Circle className="h-1.5 w-1.5 fill-current" stroke="none" />
              {t('firewall.ruleBlocked')}
            </span>
          )}
          {rule.group && (
            <span className="hidden shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium sm:inline" style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-muted)' }}>
              {rule.group}
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
          <span>
            {t('firewall.profilesHeading')}: <span className="text-zinc-300">{rule.profiles.length ? rule.profiles.map((p) => p === 'Any' ? t('firewall.profilesAny') : p).join(', ') : t('firewall.profilesAny')}</span>
          </span>
          <span>{rule.protocol} {rule.localPort !== 'Any' && `· ${t('firewall.statProfiles')} ${rule.localPort}`}</span>
          <span>{t('firewall.issueAnyRemote')}: <span className="text-zinc-300">{rule.remoteAddress}</span></span>
        </div>
        {rule.programResolved && (
          <div className="mt-1 truncate font-mono text-[11px]" style={{ color: statusColor }} title={rule.programResolved}>
            {rule.programResolved}
          </div>
        )}
        {rule.issues.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {rule.issues.map((issue) => {
              const Icon = ISSUE_ICON[issue]
              return (
                <span
                  key={issue}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-medium"
                  style={{ background: colors.bg, color: colors.text, border: `1px solid ${colors.border}` }}
                >
                  <Icon className="h-3 w-3" style={{ color: ISSUE_COLOR[issue] }} strokeWidth={2} />
                  {t(ISSUE_LABEL[issue])}
                </span>
              )
            })}
          </div>
        )}
      </div>
    </label>
  )
}
