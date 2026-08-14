import { useEffect, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ShieldCheck,
  ShieldAlert,
  Search,
  RefreshCw,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
  Inbox,
  ScanSearch,
  Loader2,
  Download,
  Sparkles,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Wrench,
  Eye,
  X,
  CalendarClock,
  Layers,
  ArrowRight,
  ListChecks,
  Activity,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { cn, formatDate, formatDuration, formatNumber } from '@/lib/utils'
import { useAnimatedCounter } from '@/hooks/useAnimatedCounter'
import { useCveStore } from '@/stores/cve-store'
import type { CveVulnerability, CveSeverity, CveStatus, CveSummary, CveTrendPoint } from '@shared/types'
import type { LucideIcon } from 'lucide-react'

const EASE = [0.16, 1, 0.3, 1] as const

const SEVERITY_COLORS: Record<CveSeverity, { color: string; bg: string; border: string }> = {
  critical: { color: '#ef4444', bg: 'rgba(239,68,68,0.10)', border: 'rgba(239,68,68,0.24)' },
  high:     { color: '#f97316', bg: 'rgba(249,115,22,0.10)', border: 'rgba(249,115,22,0.24)' },
  medium:   { color: '#eab308', bg: 'rgba(234,179,8,0.10)',  border: 'rgba(234,179,8,0.24)' },
  low:      { color: '#3b82f6', bg: 'rgba(59,130,246,0.10)', border: 'rgba(59,130,246,0.24)' },
  none:     { color: '#a1a1aa', bg: 'rgba(161,161,170,0.10)', border: 'rgba(161,161,170,0.24)' },
}

const STATUS_COLORS: Record<CveStatus, { color: string; bg: string; border: string }> = {
  open:           { color: '#ef4444', bg: 'rgba(239,68,68,0.10)',   border: 'rgba(239,68,68,0.24)' },
  'in-progress':  { color: '#f59e0b', bg: 'rgba(245,158,11,0.10)',  border: 'rgba(245,158,11,0.24)' },
  'risk-accepted':{ color: '#eab308', bg: 'rgba(234,179,8,0.10)',   border: 'rgba(234,179,8,0.24)' },
  resolved:       { color: '#22c55e', bg: 'rgba(34,197,94,0.10)',   border: 'rgba(34,197,94,0.24)' },
  ignored:        { color: '#a1a1aa', bg: 'rgba(161,161,170,0.10)', border: 'rgba(161,161,170,0.24)' },
}

const RISK_COLORS: Record<string, string> = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#22c55e',
  none: '#a1a1aa',
}

const ALL_STATUSES: CveStatus[] = ['open', 'in-progress', 'risk-accepted', 'resolved', 'ignored']

function riskOf(v: CveVulnerability): 'high' | 'medium' | 'low' | 'none' {
  if (v.severity === 'critical' || v.severity === 'high') return 'high'
  if (v.severity === 'medium') return 'medium'
  if (v.severity === 'low') return 'low'
  return 'none'
}

function computeScore(summary: CveSummary): number {
  const total = summary.critical + summary.high + summary.medium + summary.low
  if (total === 0) return 100
  const raw = 100 - summary.critical * 6 - summary.high * 3.5 - summary.medium * 1.5 - summary.low * 0.5
  return Math.max(0, Math.min(100, Math.round(raw)))
}

// ── Score ring ────────────────────────────────────────────────

function ScoreRing({ score }: { score: number }) {
  const animatedScore = useAnimatedCounter(score, 1000)
  const colors =
    score >= 70
      ? { start: '#22c55e', end: '#10b981', glow: '#22c55e' }
      : score >= 50
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
          <linearGradient id="cve-score-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
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
          stroke="url(#cve-score-gradient)"
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

// ── Stat card ─────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, color, bg, hint }: {
  icon: LucideIcon
  label: string
  value: number
  color: string
  bg: string
  hint?: string | null
}) {
  const animated = useAnimatedCounter(value, 800)
  return (
    <div className="glass-card glass-card-hover rounded-2xl px-5 py-5">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: bg }}>
          <Icon className="h-4 w-4" style={{ color }} strokeWidth={1.8} />
        </div>
        <span className="text-[12px] font-medium" style={{ color: 'var(--text-muted)' }}>{label}</span>
      </div>
      <p className="mt-3 text-[26px] font-bold tracking-tight text-white">
        {formatNumber(Math.round(animated))}
      </p>
      {hint && (
        <p className="mt-0.5 text-[11px] font-medium" style={{ color, opacity: 0.85 }}>{hint}</p>
      )}
    </div>
  )
}

// ── Filter select ─────────────────────────────────────────────

function FilterSelect({ value, options, onChange }: {
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

// ── Severity donut ────────────────────────────────────────────

function SeverityDonut({ data }: { data: { key: CveSeverity; count: number }[] }) {
  const { t } = useTranslation('cveScanner')
  const visible = data.filter((d) => d.count > 0)
  const total = data.reduce((sum, d) => sum + d.count, 0)

  return (
    <div className="flex items-center gap-6">
      <div className="relative h-[170px] w-[170px] shrink-0">
        {visible.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={visible}
                dataKey="count"
                nameKey="key"
                innerRadius={54}
                outerRadius={72}
                paddingAngle={2}
                stroke="none"
              >
                {visible.map((d) => (
                  <Cell key={d.key} fill={SEVERITY_COLORS[d.key].color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div
            className="flex h-full w-full items-center justify-center rounded-full"
            style={{ border: '8px solid var(--gauge-track)' }}
          >
            <CheckCircle2 className="h-8 w-8 text-green-500" strokeWidth={1.6} />
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center" aria-hidden="true">
          <span className="text-[28px] font-bold tracking-tight text-white">{formatNumber(total)}</span>
          <span className="text-[10.5px] font-medium uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            {t('summary.total')}
          </span>
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        {visible.length > 0 ? (
          visible.map((d) => (
            <div key={d.key} className="flex items-center gap-2 text-[12px]">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: SEVERITY_COLORS[d.key].color }}
                aria-hidden="true"
              />
              <span style={{ color: 'var(--text-secondary)' }}>{t(`severity.${d.key}`)}</span>
              <span className="ml-auto font-mono text-zinc-300">{formatNumber(d.count)}</span>
            </div>
          ))
        ) : (
          <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            {t('chart.noData')}
          </p>
        )}
      </div>
    </div>
  )
}

// ── Trend chart ───────────────────────────────────────────────

function TrendChart({ data, range, onRangeChange }: {
  data: CveTrendPoint[]
  range: number
  onRangeChange: (range: number) => void
}) {
  const { t } = useTranslation('cveScanner')
  const sliced = data.slice(-range)
  const maxRemaining = Math.max(1, ...sliced.map((p) => p.remaining))

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-lg p-0.5" style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)' }}>
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => onRangeChange(d)}
              className={cn(
                'rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition-colors',
                range === d ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
              )}
              style={range === d ? { background: 'var(--bg-active)' } : undefined}
            >
              {t(`chart.days${d}`)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden="true" />
            {t('chart.new')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden="true" />
            {t('chart.resolved')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden="true" />
            {t('chart.remaining')}
          </span>
        </div>
      </div>
      {sliced.length === 0 ? (
        <div className="flex h-[220px] items-center justify-center rounded-xl" style={{ background: 'var(--bg-subtle)' }}>
          <p className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>{t('chart.noData')}</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={sliced} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
            <defs>
              <linearGradient id="cve-trend-new" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ef4444" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="cve-trend-resolved" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22c55e" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: 'var(--text-dim)' }}
              tickLine={false}
              axisLine={{ stroke: 'var(--border-subtle)' }}
              minTickGap={28}
            />
            <YAxis hide domain={[0, maxRemaining]} />
            <Tooltip
              cursor={{ stroke: 'var(--border-strong)' }}
              contentStyle={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-strong)',
                borderRadius: '10px',
                fontSize: '12px',
                color: 'var(--text-primary)'
              }}
              labelStyle={{ color: 'var(--text-muted)', marginBottom: 4 }}
              formatter={(value, name) => [formatNumber(Number(value)), name]}
            />
            <Area
              type="monotone"
              dataKey="new"
              stroke="#ef4444"
              fill="url(#cve-trend-new)"
              strokeWidth={1.5}
              dot={false}
              name={t('chart.new')}
            />
            <Area
              type="monotone"
              dataKey="resolved"
              stroke="#22c55e"
              fill="url(#cve-trend-resolved)"
              strokeWidth={1.5}
              dot={false}
              name={t('chart.resolved')}
            />
            <Line
              type="monotone"
              dataKey="remaining"
              stroke="#f59e0b"
              strokeWidth={2}
              dot={false}
              name={t('chart.remaining')}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

// ── Skeleton loader ───────────────────────────────────────────

function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div
      className={cn('animate-shimmer rounded-xl', className)}
      style={{
        background: 'linear-gradient(90deg, var(--bg-subtle) 25%, var(--bg-subtle-2) 50%, var(--bg-subtle) 75%)',
        backgroundSize: '200% 100%'
      }}
    />
  )
}

function PageSkeleton() {
  const { t } = useTranslation('cveScanner')
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader title={t('pageTitle')} description={t('pageDescription')} />
      <div className="flex-1 space-y-8 px-0 pb-8">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <SkeletonBlock className="h-[290px]" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:col-span-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonBlock key={i} className="h-[120px]" />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SkeletonBlock className="h-[280px]" />
          <SkeletonBlock className="h-[280px]" />
        </div>
        <SkeletonBlock className="h-[360px]" />
      </div>
    </div>
  )
}

// ── Slide-over details panel ──────────────────────────────────

function VulnSlideOver({ vuln, onClose }: { vuln: CveVulnerability; onClose: () => void }) {
  const { t } = useTranslation('cveScanner')
  const navigate = useNavigate()
  const status = useCveStore((s) => s.statuses[vuln.id] ?? ('open' as CveStatus))
  const setVulnStatus = useCveStore((s) => s.setVulnStatus)
  const rescan = useCveStore((s) => s.fetch)

  const sev = SEVERITY_COLORS[vuln.severity]
  const risk = riskOf(vuln)
  const dateOptions: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' }

  const handleStatus = (next: CveStatus) => {
    setVulnStatus(vuln.id, next)
    toast.success(t('toast.statusUpdated'))
  }

  const handleRescan = useCallback(async () => {
    toast.promise(rescan({ page: 1, force: true }), {
      loading: t('scanningButton'),
      success: t('refetchButton'),
      error: t('toast.fetchFailed'),
    })
  }, [rescan, t])

  return (
    <motion.div
      className="fixed inset-0 z-50"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)' }}
        onClick={onClose}
        aria-hidden="true"
      />
      <motion.aside
        role="dialog"
        aria-modal="true"
        aria-label={t('slideover.title')}
        className="absolute right-0 top-0 flex h-full w-full max-w-[480px] flex-col"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ duration: 0.35, ease: EASE }}
        style={{
          background: 'var(--card-bg)',
          borderLeft: '1px solid var(--border-medium)',
          boxShadow: '-24px 0 64px var(--panel-shadow)'
        }}
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b p-6" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
                style={{ background: sev.bg, color: sev.color, border: `1px solid ${sev.border}` }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: sev.color }} />
                {t(`severity.${vuln.severity}`)}
              </span>
              <span className="font-mono text-[12.5px] font-semibold text-zinc-200">{vuln.cveId}</span>
            </div>
            <h2 className="mt-2 text-[18px] font-bold tracking-tight text-white">{vuln.appName}</h2>
            <p className="mt-0.5 font-mono text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {t('slideover.component')}: {vuln.appName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-2 transition-colors"
            style={{ color: 'var(--text-muted)' }}
            aria-label={t('slideover.close')}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-subtle-2)'; e.currentTarget.style.color = 'var(--text-primary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' }}
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {/* Overview meta */}
          <SectionHeading icon={Inbox} title={t('slideover.overview')} />
          <div className="mb-6 grid grid-cols-2 gap-3">
            <MetaTile label={t('severity.' + vuln.severity)} value={t('slideover.cvss')} sub={vuln.cvssScore != null ? vuln.cvssScore.toFixed(1) : t('slideover.cvssNone')} color={sev.color} />
            <MetaTile label={t('table.colComponent')} value={vuln.appName} sub={vuln.installedVersion} color={RISK_COLORS[risk]} />
            <MetaTile label={t('slideover.installed')} value={vuln.installedVersion} sub={t('slideover.firstDetected') + ': ' + formatDate(vuln.firstDetectedAt)} color="var(--text-secondary)" />
            <MetaTile
              label={vuln.fixedIn ? t('slideover.fixedIn') : t('slideover.fixedInNone')}
              value={vuln.fixedIn ?? '—'}
              sub={t('slideover.lastScanned') + ': ' + formatDate(vuln.lastScannedAt)}
              color={vuln.fixedIn ? '#22c55e' : 'var(--text-muted)'}
            />
          </div>

          {/* Risk assessment */}
          <SectionHeading icon={ShieldAlert} title={t('slideover.riskAssessment')} />
          <div
            className="mb-6 rounded-xl px-4 py-3.5"
            style={{ background: SEVERITY_COLORS[vuln.severity].bg, border: `1px solid ${SEVERITY_COLORS[vuln.severity].border}` }}
          >
            <p className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: sev.color }}>
              <span className="h-2 w-2 rounded-full" style={{ background: sev.color }} />
              {t(`risk.${risk}`)} {t('slideover.riskAssessment').toLowerCase()}
            </p>
            <p className="mt-1.5 text-[12px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {vuln.fixedIn
                ? t('slideover.risky', { component: vuln.appName, version: vuln.fixedIn })
                : t('slideover.riskUnpatched')}
            </p>
          </div>

          {/* Description */}
          <SectionHeading icon={ListChecks} title={t('slideover.description')} />
          <p className="mb-6 text-[12.5px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {vuln.description ?? t('slideover.noDescription')}
          </p>

          {/* Status management */}
          <SectionHeading icon={Activity} title={t('slideover.statusHeading')} hint={t('slideover.statusHint')} />
          <div className="mb-6 flex flex-wrap gap-2">
            {ALL_STATUSES.map((st) => {
              const active = status === st
              const c = STATUS_COLORS[st]
              return (
                <button
                  key={st}
                  onClick={() => handleStatus(st)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-semibold transition-all',
                    active ? 'text-white' : 'text-zinc-400'
                  )}
                  style={{
                    background: active ? c.bg : 'var(--bg-subtle)',
                    border: `1px solid ${active ? c.border : 'var(--border-medium)'}`,
                    color: active ? c.color : 'var(--text-muted)'
                  }}
                >
                  {active && <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.color }} />}
                  {t(`status.${st}`)}
                </button>
              )
            })}
          </div>

          {/* References */}
          <SectionHeading icon={ExternalLink} title={t('slideover.referencesHeading')} />
          <div className="mb-6 flex flex-wrap gap-2">
            <a
              href={`https://nvd.nist.gov/vuln/detail/${vuln.cveId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium text-zinc-300 transition-colors"
              style={{ border: '1px solid var(--border-strong)' }}
            >
              <ExternalLink className="h-3 w-3" />
              {t('slideover.nvdLink')}
            </a>
            <button
              onClick={() => navigate('/updates')}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium text-zinc-300 transition-colors"
              style={{ border: '1px solid var(--border-strong)' }}
            >
              <RefreshCw className="h-3 w-3" />
              {t('slideover.checkUpdates')}
            </button>
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex items-center gap-2.5 border-t p-5" style={{ borderColor: 'var(--border-subtle)' }}>
          <button
            onClick={() => vuln.fixedIn && navigate('/updates')}
            disabled={!vuln.fixedIn}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: vuln.fixedIn ? 'linear-gradient(135deg, #22c55e, #16a34a)' : 'var(--bg-subtle)', color: vuln.fixedIn ? '#fff' : 'var(--text-muted)' }}
          >
            <Wrench className="h-4 w-4" strokeWidth={2} />
            {vuln.fixedIn ? t('slideover.fixButton') : t('slideover.fixUnavailable')}
          </button>
          <button
            onClick={handleRescan}
            className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium transition-all"
            style={{ border: '1px solid var(--border-medium)' }}
          >
            <ScanSearch className="h-4 w-4" style={{ color: 'var(--text-muted)' }} strokeWidth={1.8} />
            {t('slideover.rescan')}
          </button>
        </div>
      </motion.aside>
    </motion.div>
  )
}

function MetaTile({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="rounded-xl px-4 py-3" style={{ background: 'var(--bg-subtle)' }}>
      <p className="text-[10.5px] font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
        {label}
      </p>
      <p className="mt-1 truncate text-[13px] font-semibold" style={{ color }}>{value}</p>
      <p className="mt-0.5 truncate text-[11px]" style={{ color: 'var(--text-faint)' }}>{sub}</p>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────

export function CveScannerPage() {
  const { t } = useTranslation('cveScanner')
  const navigate = useNavigate()

  const vulnerabilities = useCveStore((s) => s.vulnerabilities)
  const status = useCveStore((s) => s.status)
  const error = useCveStore((s) => s.error)
  const page = useCveStore((s) => s.page)
  const total = useCveStore((s) => s.total)
  const hasNextPage = useCveStore((s) => s.hasNextPage)
  const severityFilter = useCveStore((s) => s.severityFilter)
  const searchQuery = useCveStore((s) => s.searchQuery)
  const componentFilter = useCveStore((s) => s.componentFilter)
  const components = useCveStore((s) => s.components)
  const summary = useCveStore((s) => s.summary)
  const trend = useCveStore((s) => s.trend)
  const librarySize = useCveStore((s) => s.librarySize)
  const selectedId = useCveStore((s) => s.selectedId)
  const statuses = useCveStore((s) => s.statuses)
  const lastScanAt = useCveStore((s) => s.lastScanAt)
  const fetchVulns = useCveStore((s) => s.fetch)
  const setSeverityFilter = useCveStore((s) => s.setSeverityFilter)
  const setSearchQuery = useCveStore((s) => s.setSearchQuery)
  const setComponentFilter = useCveStore((s) => s.setComponentFilter)
  const setSelectedId = useCveStore((s) => s.setSelectedId)
  const setVulnStatus = useCveStore((s) => s.setVulnStatus)

  const [searchInput, setSearchInput] = useState(searchQuery)
  const [statusFilter, setStatusFilter] = useState<'all' | CveStatus>('all')
  const [dateFilter, setDateFilter] = useState('all')
  const [range, setRange] = useState(30)
  const [scanDuration, setScanDuration] = useState<number | null>(null)
  const scanStartRef = useRef<number | null>(null)
  const tableRef = useRef<HTMLDivElement | null>(null)

  // Auto-fetch on mount (local NVD scan).
  useEffect(() => {
    if (status === 'idle') {
      fetchVulns()
    }
  }, [status, fetchVulns])

  // Track scan duration across loading → done transitions.
  useEffect(() => {
    if (status === 'loading') {
      if (scanStartRef.current === null) scanStartRef.current = Date.now()
    } else if (status === 'done' && scanStartRef.current !== null) {
      setScanDuration(Date.now() - scanStartRef.current)
      scanStartRef.current = null
    }
  }, [status])

  // Toast on error.
  useEffect(() => {
    if (error) toast.error(t('toast.fetchFailed'))
  }, [error, t])

  const totalFindings = useMemo(() => {
    if (!summary) return 0
    return summary.critical + summary.high + summary.medium + summary.low
  }, [summary])

  const score = useMemo(() => (summary ? computeScore(summary) : 0), [summary])
  const isLoading = status === 'loading'
  const isScanning = isLoading && (vulnerabilities.length > 0 || !!summary)
  const hasData = status === 'done' && !!summary

  // ── Actions ─────────────────────────────────────────────────
  const handleScan = useCallback(async () => {
    setScanDuration(null)
    await fetchVulns({ page: 1, force: true })
  }, [fetchVulns])

  const handleRefresh = useCallback(() => {
    fetchVulns({ page: 1 })
  }, [fetchVulns])

  const handleSeverityChange = useCallback((filter: typeof severityFilter) => {
    setSeverityFilter(filter)
    fetchVulns({ page: 1, severity: filter })
  }, [setSeverityFilter, fetchVulns])

  const handleComponentChange = useCallback((filter: string) => {
    setComponentFilter(filter)
    fetchVulns({ page: 1, component: filter === 'all' ? undefined : filter })
  }, [setComponentFilter, fetchVulns])

  const handleSearch = useCallback(() => {
    setSearchQuery(searchInput)
    fetchVulns({ page: 1, search: searchInput })
  }, [searchInput, setSearchQuery, fetchVulns])

  const handlePageChange = useCallback((newPage: number) => {
    fetchVulns({ page: newPage })
  }, [fetchVulns])

  const scrollToTable = useCallback(() => {
    requestAnimationFrame(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [])

  const reviewSeverity = useCallback((level: 'critical' | 'high') => {
    setSeverityFilter(level)
    setStatusFilter('all')
    setComponentFilter('all')
    setDateFilter('all')
    setSearchQuery('')
    setSearchInput('')
    fetchVulns({ page: 1, severity: level })
    scrollToTable()
  }, [setSeverityFilter, setSearchQuery, setComponentFilter, fetchVulns, scrollToTable])

  const resetFilters = useCallback(() => {
    setSeverityFilter('all')
    setStatusFilter('all')
    setComponentFilter('all')
    setDateFilter('all')
    setSearchQuery('')
    setSearchInput('')
    fetchVulns({ page: 1, severity: 'all' })
    scrollToTable()
  }, [setSeverityFilter, setSearchQuery, setComponentFilter, fetchVulns, scrollToTable])

  // ── Derived display data ────────────────────────────────────
  const severityData = useMemo(() => {
    if (!summary) return []
    return (['critical', 'high', 'medium', 'low'] as const).map((key) => ({
      key,
      count: summary[key] ?? 0,
    }))
  }, [summary])

  const getStatus = useCallback((id: number): CveStatus => statuses[id] ?? 'open', [statuses])

  const rows = useMemo(() => {
    let result = vulnerabilities
    if (statusFilter !== 'all') result = result.filter((v) => getStatus(v.id) === statusFilter)
    if (componentFilter !== 'all') result = result.filter((v) => v.appName === componentFilter)
    if (dateFilter !== 'all') {
      const days = dateFilter === '7' ? 7 : dateFilter === '30' ? 30 : 90
      const cutoff = Date.now() - days * 86_400_000
      result = result.filter((v) => new Date(v.firstDetectedAt).getTime() >= cutoff)
    }
    return result
  }, [vulnerabilities, statusFilter, componentFilter, dateFilter, getStatus])

  const exportCsv = useCallback(() => {
    if (rows.length === 0) {
      toast.error(t('toast.exportFailed'))
      return
    }
    try {
      const header = ['CVE ID', 'Severity', 'CVSS', 'Component', 'Installed Version', 'Fixed In', 'Status', 'First Detected', 'Last Scanned', 'Description']
      const lines = rows.map((v) => {
        const st = statuses[v.id] ?? 'open'
        const cell = (val: string | number | null) => {
          const s = val == null ? '' : String(val)
          return `"${s.replace(/"/g, '""')}"`
        }
        return [
          cell(v.cveId),
          cell(t(`severity.${v.severity}`)),
          cell(v.cvssScore != null ? v.cvssScore.toFixed(1) : ''),
          cell(v.appName),
          cell(v.installedVersion),
          cell(v.fixedIn),
          cell(t(`status.${st}`)),
          cell(v.firstDetectedAt),
          cell(v.lastScannedAt),
          cell(v.description),
        ].join(',')
      })
      const csv = [header.join(','), ...lines].join('\n')
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `clarity-cve-report-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success(t('toast.exportDone'))
    } catch {
      toast.error(t('toast.exportFailed'))
    }
  }, [rows, statuses, t])

  const scoreConfig = useMemo(() => {
    if (totalFindings === 0) return { label: t('score.protected'), color: '#22c55e' }
    if (score >= 70) return { label: score >= 90 ? t('score.protected') : t('score.good'), color: score >= 90 ? '#22c55e' : '#3b82f6' }
    if (score >= 50) return { label: t('score.needsAttention'), color: '#f59e0b' }
    return { label: t('score.atRisk'), color: '#ef4444' }
  }, [score, totalFindings, t])

  const coverage = useMemo(() => {
    const library = librarySize > 0 ? librarySize : totalFindings
    const pct = library > 0 ? Math.min(100, Math.round((totalFindings / library) * 100)) : 100
    return { library, pct }
  }, [librarySize, totalFindings])

  // ── Recommendations ─────────────────────────────────────────
  const recommendations = useMemo(() => {
    const recs: { key: string; kind: 'warn' | 'danger' | 'ok'; icon: LucideIcon; title: string; description: string; action?: () => void; actionLabel?: string }[] = []
    if (summary && summary.critical > 0) {
      recs.push({
        key: 'critical',
        kind: 'danger',
        icon: ShieldAlert,
        title: t('recs.fixCritical', { count: summary.critical, plural: summary.critical === 1 ? '' : 'ies' }),
        description: t('recs.fixCriticalDesc'),
        action: () => reviewSeverity('critical'),
        actionLabel: t('recs.fixNowButton'),
      })
    }
    if (summary && summary.high > 0) {
      recs.push({
        key: 'high',
        kind: 'warn',
        icon: AlertTriangle,
        title: t('recs.reviewHigh', { count: summary.high, plural: summary.high === 1 ? 'y' : 'ies' }),
        description: t('recs.reviewHighDesc'),
        action: () => reviewSeverity('high'),
        actionLabel: t('recs.reviewButton'),
      })
    }
    if (summary && summary.patched > 0 && summary.critical === 0) {
      recs.push({
        key: 'patched',
        kind: 'ok',
        icon: Wrench,
        title: t('recs.reviewFixes', { count: summary.patched, plural: summary.patched === 1 ? '' : 'es' }),
        description: t('recs.reviewFixesDesc'),
        action: () => navigate('/updates'),
        actionLabel: t('recs.goToUpdatesButton'),
      })
    }
    if (recs.length === 0) {
      recs.push({
        key: 'all-clear',
        kind: 'ok',
        icon: CheckCircle2,
        title: t('recs.allClear'),
        description: t('recs.allClearDesc'),
      })
    }
    return recs
  }, [summary, t, reviewSeverity, navigate])

  // ── Selected vulnerability for slide-over ───────────────────
  const selectedVuln = selectedId != null
    ? vulnerabilities.find((v) => v.id === selectedId) ?? null
    : null

  // ── Header actions ──────────────────────────────────────────
  const headerAction = (
    <div className="flex flex-wrap items-center gap-2.5">
      <button
        onClick={exportCsv}
        disabled={rows.length === 0}
        className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium transition-all disabled:opacity-40"
        style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-medium)' }}
      >
        <Download className="h-4 w-4" strokeWidth={1.8} />
        {t('exportButton')}
      </button>
      <button
        onClick={handleRefresh}
        disabled={isLoading}
        className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium transition-all disabled:opacity-40"
        style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-medium)' }}
      >
        <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} strokeWidth={1.8} />
        {t('refetchButton')}
      </button>
    </div>
  )

  // ── Skeleton (first load) ───────────────────────────────────
  if (status === 'loading' && !summary && !error) {
    return <PageSkeleton />
  }

  // ── Empty state ─────────────────────────────────────────────
  if (hasData && totalFindings === 0 && !error) {
    return (
      <div className="flex h-full flex-col overflow-y-auto">
        <PageHeader title={t('pageTitle')} description={t('pageDescription')} action={headerAction} />
        <div className="flex flex-1 flex-col items-center justify-center pb-16">
          <ScoreRing score={100} />
          <h3 className="mt-6 text-[16px] font-semibold text-zinc-200">{t('empty.title')}</h3>
          <p className="mt-1.5 max-w-sm text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
            {t('empty.description')}
          </p>
          <button
            onClick={handleScan}
            disabled={isLoading}
            className="mt-6 flex items-center gap-2 rounded-xl px-6 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: '#fff', boxShadow: '0 4px 20px rgba(245,158,11,0.25)' }}
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" strokeWidth={2} />}
            {isLoading ? t('scanningButton') : t('scanButton')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        action={headerAction}
      />

      <div className="flex-1 space-y-8 px-0 pb-8">
        {/* ── 1 · Security overview ─────────────────────── */}
        <Section index={0}>
          <SectionHeading icon={ShieldCheck} title={t('score.label')} hint={t('score.hint')} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Score hero */}
            <div className="glass-card glass-card-hover flex flex-col items-center justify-center rounded-2xl px-6 py-7">
              <ScoreRing score={score} />
              <span
                className="mt-4 text-[14px] font-bold tracking-wide"
                style={{ color: scoreConfig.color, textShadow: `0 0 18px ${scoreConfig.color}30` }}
              >
                {scoreConfig.label}
              </span>
              <button
                onClick={handleScan}
                disabled={isLoading}
                className="mt-5 flex w-full max-w-[220px] items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: '#fff', boxShadow: '0 4px 20px rgba(245,158,11,0.25)' }}
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" strokeWidth={2} />}
                {isLoading ? t('scanningButton') : t('scanButton')}
              </button>
            </div>

            {/* Summary stat cards */}
            {summary && (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:col-span-2">
                <StatCard icon={Inbox} label={t('summary.total')} value={totalFindings} color="#a1a1aa" bg="var(--bg-subtle-2)" />
                <StatCard
                  icon={ShieldAlert}
                  label={t('summary.critical')}
                  value={summary.critical}
                  color={summary.critical === 0 ? '#22c55e' : '#ef4444'}
                  bg={summary.critical === 0 ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)'}
                  hint={summary.critical > 0 && totalFindings > 0 ? t('summary.ofFindings', { pct: Math.round((summary.critical / totalFindings) * 100) }) : null}
                />
                <StatCard
                  icon={AlertTriangle}
                  label={t('summary.high')}
                  value={summary.high}
                  color={summary.high === 0 ? '#22c55e' : '#f97316'}
                  bg={summary.high === 0 ? 'rgba(34,197,94,0.10)' : 'rgba(249,115,22,0.10)'}
                  hint={summary.high > 0 && totalFindings > 0 ? t('summary.ofFindings', { pct: Math.round((summary.high / totalFindings) * 100) }) : null}
                />
                <StatCard
                  icon={AlertCircle}
                  label={t('summary.medium')}
                  value={summary.medium}
                  color={summary.medium === 0 ? '#22c55e' : '#eab308'}
                  bg={summary.medium === 0 ? 'rgba(34,197,94,0.10)' : 'rgba(234,179,8,0.10)'}
                  hint={summary.medium > 0 && totalFindings > 0 ? t('summary.ofFindings', { pct: Math.round((summary.medium / totalFindings) * 100) }) : null}
                />
                <StatCard
                  icon={Info}
                  label={t('summary.low')}
                  value={summary.low}
                  color={summary.low === 0 ? '#22c55e' : '#3b82f6'}
                  bg={summary.low === 0 ? 'rgba(34,197,94,0.10)' : 'rgba(59,130,246,0.10)'}
                  hint={summary.low > 0 && totalFindings > 0 ? t('summary.ofFindings', { pct: Math.round((summary.low / totalFindings) * 100) }) : null}
                />
                <StatCard
                  icon={CheckCircle2}
                  label={t('summary.patched')}
                  value={summary.patched}
                  color={summary.patched === 0 ? 'var(--text-muted)' : '#22c55e'}
                  bg={summary.patched === 0 ? 'var(--bg-subtle-2)' : 'rgba(34,197,94,0.10)'}
                  hint={t('summary.patchedHint')}
                />
              </div>
            )}
          </div>
        </Section>

        {/* ── 2 · Severity + trend charts ───────────────── */}
        <Section index={1}>
          <SectionHeading icon={Layers} title={t('chart.severityHeading')} hint={t('chart.severityHint')} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
            <div className="glass-card rounded-2xl p-5 lg:col-span-2">
              {summary && <SeverityDonut data={severityData} />}
            </div>
            <div className="glass-card rounded-2xl p-5 lg:col-span-3">
              <TrendChart data={trend} range={range} onRangeChange={setRange} />
            </div>
          </div>
        </Section>

        {/* ── 3 · Top vulnerabilities ───────────────────── */}
        <Section index={2}>
          <SectionHeading icon={ScanSearch} title={t('table.heading')} hint={t('table.hint')} />
          <div ref={tableRef} className="glass-card overflow-hidden rounded-2xl">
            {/* Filter bar */}
            <div className="flex flex-wrap items-center gap-2.5 border-b px-4 py-3" style={{ borderColor: 'var(--border-subtle)' }}>
              <div
                className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg px-3 py-2"
                style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)' }}
              >
                <Search className="h-4 w-4 shrink-0" style={{ color: 'var(--text-muted)' }} strokeWidth={1.8} />
                <input
                  type="text"
                  placeholder={t('table.searchPlaceholder')}
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  onBlur={handleSearch}
                  className="w-full bg-transparent text-[13px] text-white placeholder-zinc-600 outline-none"
                />
              </div>
              <FilterSelect
                value={severityFilter}
                onChange={(v) => handleSeverityChange(v as typeof severityFilter)}
                options={[
                  { value: 'all', label: t('table.filterAllSeverities') },
                  ...(['critical', 'high', 'medium', 'low', 'none'] as CveSeverity[]).map((sev) => ({
                    value: sev,
                    label: t(`severity.${sev}`),
                  })),
                ]}
              />
              <FilterSelect
                value={statusFilter}
                onChange={(v) => setStatusFilter(v as typeof statusFilter)}
                options={[
                  { value: 'all', label: t('table.filterAllStatuses') },
                  ...ALL_STATUSES.map((st) => ({ value: st, label: t(`status.${st}`) })),
                ]}
              />
              <FilterSelect
                value={componentFilter}
                onChange={handleComponentChange}
                options={[
                  { value: 'all', label: t('table.filterAllComponents') },
                  ...components.map((c) => ({ value: c, label: c })),
                ]}
              />
              <FilterSelect
                value={dateFilter}
                onChange={setDateFilter}
                options={[
                  { value: 'all', label: t('table.filterAllDates') },
                  { value: '7', label: t('table.date7') },
                  { value: '30', label: t('table.date30') },
                  { value: '90', label: t('table.date90') },
                ]}
              />
            </div>

            {/* Scan progress strip */}
            {isScanning && (
              <div className="border-b px-4 py-3" style={{ borderColor: 'var(--border-subtle)' }}>
                <div className="mb-2 flex items-center gap-2.5">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-400" strokeWidth={2} />
                  <span className="text-[12.5px] font-medium text-zinc-200">{t('scan.inProgress')}</span>
                </div>
                <div
                  className="h-1.5 overflow-hidden rounded-full"
                  style={{ background: 'var(--bg-subtle-2)' }}
                  role="progressbar"
                  aria-label={t('scan.inProgress')}
                >
                  <div
                    className="h-full rounded-full animate-scan-stripe"
                    style={{
                      backgroundImage: 'linear-gradient(90deg, rgba(245,158,11,0.4) 25%, rgba(245,158,11,0.85) 50%, rgba(245,158,11,0.4) 75%)',
                      backgroundSize: '40px 100%',
                      width: '100%'
                    }}
                  />
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="border-b px-4 py-3" style={{ borderColor: 'var(--border-subtle)' }}>
                <ErrorAlert message={error} />
              </div>
            )}

            {/* Table */}
            {rows.length > 0 ? (
              <>
                <div className="overflow-x-auto">
                  <div className="min-w-[860px]">
                    {/* Header */}
                    <div
                      className="grid grid-cols-[100px_minmax(200px,1.5fr)_120px_minmax(130px,1fr)_90px_70px_110px_120px] gap-3 border-b px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.14em]"
                      style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-faint)' }}
                    >
                      <span>{t('table.colSeverity')}</span>
                      <span>{t('table.colVulnerability')}</span>
                      <span>{t('table.colCveId')}</span>
                      <span>{t('table.colComponent')}</span>
                      <span>{t('table.colVersion')}</span>
                      <span>{t('table.colRisk')}</span>
                      <span>{t('table.colStatus')}</span>
                      <span className="text-right">{t('table.colAction')}</span>
                    </div>
                    {/* Rows */}
                    {rows.map((v) => {
                      const sev = SEVERITY_COLORS[v.severity]
                      const risk = riskOf(v)
                      const st = getStatus(v.id)
                      const stC = STATUS_COLORS[st]
                      const isResolved = st === 'resolved' || st === 'ignored'
                      return (
                        <button
                          key={`${v.id}-${v.cveId}`}
                          onClick={() => setSelectedId(v.id)}
                          className="grid w-full grid-cols-[100px_minmax(200px,1.5fr)_120px_minmax(130px,1fr)_90px_70px_110px_120px] items-center gap-3 border-b px-4 py-3 text-left transition-colors last:border-b-0"
                          style={{ borderColor: 'var(--border-subtle)' }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-subtle-2)' }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                        >
                          {/* Severity */}
                          <span
                            className="inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
                            style={{ background: sev.bg, color: sev.color, border: `1px solid ${sev.border}` }}
                          >
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: sev.color }} />
                            {t(`severity.${v.severity}`)}
                          </span>
                          {/* Vulnerability */}
                          <span className="truncate text-[12.5px] font-medium text-zinc-200" title={v.description ?? v.cveId}>
                            {v.description ?? v.cveId}
                          </span>
                          {/* CVE ID */}
                          <span className="font-mono text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                            {v.cveId}
                          </span>
                          {/* Component */}
                          <span className="truncate text-[12.5px]" style={{ color: 'var(--text-secondary)' }}>
                            {v.appName}
                          </span>
                          {/* Version */}
                          <span className="font-mono text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                            {v.installedVersion}
                          </span>
                          {/* Risk */}
                          <span className="flex items-center gap-1.5 text-[12px]" style={{ color: RISK_COLORS[risk] }}>
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: RISK_COLORS[risk] }} />
                            {t(`risk.${risk}`)}
                          </span>
                          {/* Status */}
                          <span
                            className="inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
                            style={{ background: stC.bg, color: stC.color, border: `1px solid ${stC.border}` }}
                          >
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: stC.color }} />
                            {t(`status.${st}`)}
                          </span>
                          {/* Action */}
                          <span className="flex items-center justify-end gap-1.5">
                            <span
                              role="button"
                              tabIndex={-1}
                              onClick={(e) => { e.stopPropagation(); setSelectedId(v.id) }}
                              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors"
                              style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-secondary)' }}
                            >
                              <Eye className="h-3 w-3" strokeWidth={2} />
                              {t('table.details')}
                            </span>
                            {!isResolved && (
                              <span
                                role="button"
                                tabIndex={-1}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setVulnStatus(v.id, 'resolved')
                                  toast.success(t('toast.statusUpdated'))
                                }}
                                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors"
                                style={{ background: 'rgba(34,197,94,0.10)', color: '#22c55e' }}
                              >
                                <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
                                {t('table.resolve')}
                              </span>
                            )}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Footer: count + pagination */}
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <span className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                    {t('table.showing')} <span className="font-semibold text-zinc-300">{formatNumber(rows.length)}</span> {t('table.of')}{' '}
                    <span className="font-semibold text-zinc-300">{formatNumber(total)}</span>
                  </span>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handlePageChange(page - 1)}
                      disabled={page <= 1 || isLoading}
                      aria-label={t('pagination.previous')}
                      title={t('pagination.previous')}
                      className="flex items-center justify-center rounded-lg p-2 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                      style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-secondary)' }}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                    <span className="text-[11.5px] font-mono" style={{ color: 'var(--text-muted)' }}>
                      {t('pagination.page', { current: page })}
                    </span>
                    <button
                      onClick={() => handlePageChange(page + 1)}
                      disabled={!hasNextPage || isLoading}
                      aria-label={t('pagination.next')}
                      title={t('pagination.next')}
                      className="flex items-center justify-center rounded-lg p-2 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                      style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-secondary)' }}
                    >
                      <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <EmptyState
                icon={totalFindings === 0 ? ShieldCheck : Search}
                title={totalFindings === 0 ? t('empty.title') : t('table.noResults')}
                description={totalFindings === 0 ? t('empty.description') : t('table.noResultsDesc')}
              />
            )}
          </div>
        </Section>

        {/* ── 4 · Recommendations + quick actions ───────── */}
        <Section index={3}>
          <SectionHeading icon={Sparkles} title={t('recs.allClear')} hint={t('recs.allClearDesc')} />
          <div className="mb-4 space-y-2.5">
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
                    className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-all"
                    style={{
                      background: rec.kind === 'danger' ? 'rgba(239,68,68,0.12)' : 'linear-gradient(135deg, #22c55e, #16a34a)',
                      color: rec.kind === 'danger' ? '#ef4444' : '#fff'
                    }}
                  >
                    {rec.kind === 'danger' ? <ShieldAlert className="h-3 w-3" strokeWidth={2.2} /> : <Wrench className="h-3 w-3" strokeWidth={2.2} />}
                    {rec.actionLabel}
                    {rec.kind !== 'danger' && (
                      <ArrowRight className="h-3 w-3 -translate-x-0.5 transition-transform group-hover:translate-x-0" strokeWidth={2} />
                    )}
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Quick actions */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            <QuickActionCard
              icon={ScanSearch}
              title={t('quick.runScan')}
              description={t('quick.runScanDesc')}
              gradient="linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)"
              glow="rgba(59,130,246,0.2)"
              disabled={isLoading}
              onClick={handleScan}
            />
            <QuickActionCard
              icon={ShieldAlert}
              title={t('quick.fixCritical')}
              description={t('quick.fixCriticalDesc')}
              gradient="linear-gradient(135deg, #ef4444 0%, #dc2626 100%)"
              glow="rgba(239,68,68,0.2)"
              disabled={!(summary && summary.critical > 0) || isLoading}
              onClick={() => reviewSeverity('critical')}
            />
            <QuickActionCard
              icon={ListChecks}
              title={t('quick.viewAll')}
              description={t('quick.viewAllDesc')}
              gradient="linear-gradient(135deg, #22c55e 0%, #16a34a 100%)"
              glow="rgba(34,197,94,0.2)"
              disabled={isLoading}
              onClick={resetFilters}
            />
            <QuickActionCard
              icon={RefreshCw}
              title={t('quick.refresh')}
              description={t('quick.refreshDesc')}
              gradient="linear-gradient(135deg, #f59e0b 0%, #d97706 100%)"
              glow="rgba(245,158,11,0.2)"
              disabled={isLoading}
              onClick={handleRefresh}
            />
            <QuickActionCard
              icon={Download}
              title={t('quick.export')}
              description={t('quick.exportDesc')}
              gradient="linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)"
              glow="rgba(139,92,246,0.2)"
              disabled={rows.length === 0}
              onClick={exportCsv}
            />
          </div>
        </Section>

        {/* ── 5 · Scan status + coverage ────────────────── */}
        <Section index={4}>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Scan status */}
            <div className="glass-card rounded-2xl p-5 lg:col-span-2">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  <Activity className="h-3.5 w-3.5" style={{ color: 'var(--text-faint)' }} strokeWidth={1.8} />
                  {t('scan.heading')}
                </span>
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10.5px] font-bold tracking-wide"
                  style={
                    isScanning
                      ? { background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }
                      : totalFindings === 0
                        ? { background: 'rgba(34,197,94,0.1)', color: '#22c55e' }
                        : score >= 50
                          ? { background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }
                          : { background: 'rgba(239,68,68,0.1)', color: '#ef4444' }
                  }
                >
                  {isScanning ? <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.4} /> : <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} />}
                  {isScanning
                    ? t('scan.statusScanning')
                    : totalFindings === 0
                      ? t('scan.statusProtected')
                      : score >= 50
                        ? t('scan.statusNeedsAttention')
                        : t('scan.statusAtRisk')}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <ScanInfo icon={CalendarClock} label={t('scan.lastScan')} value={lastScanAt ? formatDate(new Date(lastScanAt)) : t('scan.never')} />
                <ScanInfo icon={Activity} label={t('scan.duration')} value={scanDuration != null ? formatDuration(scanDuration) : '—'} />
                <ScanInfo icon={Layers} label={t('scan.entriesScanned')} value={formatNumber(librarySize)} />
                <ScanInfo icon={Inbox} label={t('scan.findings')} value={formatNumber(totalFindings)} />
              </div>
            </div>

            {/* Coverage */}
            <div className="glass-card rounded-2xl p-5">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  <ShieldCheck className="h-3.5 w-3.5" style={{ color: 'var(--text-faint)' }} strokeWidth={1.8} />
                  {t('coverage.heading')}
                </span>
                <span className="font-mono text-[11px] font-semibold" style={{ color: coverage.pct >= 100 ? '#22c55e' : '#f59e0b' }}>
                  {t('coverage.pct', { pct: coverage.pct })}
                </span>
              </div>
              <p className="mb-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {t('coverage.entries', { total: formatNumber(totalFindings), library: formatNumber(coverage.library) })}
              </p>
              <div className="h-2 overflow-hidden rounded-full" style={{ background: 'var(--bg-subtle-2)' }}>
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${coverage.pct}%`,
                    background: coverage.pct >= 100 ? 'linear-gradient(90deg, #22c55e, #10b981)' : 'linear-gradient(90deg, #f59e0b, #fbbf24)',
                    boxShadow: coverage.pct >= 100 ? '0 0 10px rgba(34,197,94,0.35)' : '0 0 10px rgba(245,158,11,0.3)'
                  }}
                />
              </div>
              <p className="mt-3 text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                {t('coverage.hint')}
              </p>
            </div>
          </div>
        </Section>
      </div>

      {/* Slide-over details */}
      <AnimatePresence>
        {selectedVuln && (
          <VulnSlideOver vuln={selectedVuln} onClose={() => setSelectedId(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}

function QuickActionCard({ icon: Icon, title, description, gradient, glow, disabled, onClick }: {
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
      className="glass-card glass-card-hover group relative flex flex-col items-start gap-3 rounded-2xl p-5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-45"
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

function ScanInfo({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="rounded-xl px-3.5 py-3" style={{ background: 'var(--bg-subtle)' }}>
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5" style={{ color: 'var(--text-faint)' }} strokeWidth={1.8} />
        <span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>{label}</span>
      </div>
      <p className="mt-1.5 truncate text-[15px] font-bold tracking-tight text-white">{value}</p>
    </div>
  )
}
