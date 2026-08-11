import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Zap, Shield, RefreshCw, Clock, Activity, ChevronDown, ChevronUp,
  Trash2, PackageX, Search, Eye, X, Loader2, Gauge, Flame, CircleDashed,
  Circle, ShieldCheck, Layers, Download
} from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { cn } from '@/lib/utils'
import { useStartupStore } from '@/stores/startup-store'
import { useHistoryStore } from '@/stores/history-store'
import { useAnimatedCounter } from '@/hooks/useAnimatedCounter'
import type { StartupItem, StartupBootTrace } from '@shared/types'
import type { LucideIcon } from 'lucide-react'

const EASE = [0.16, 1, 0.3, 1] as const

const impactConfig: Record<StartupItem['impact'], { icon: LucideIcon; bg: string; text: string; border: string; labelKey: string }> = {
  high: { icon: Flame, bg: 'rgba(239,68,68,0.10)', text: '#ef4444', border: 'rgba(239,68,68,0.18)', labelKey: 'impactHigh' },
  medium: { icon: Gauge, bg: 'rgba(245,158,11,0.10)', text: '#f59e0b', border: 'rgba(245,158,11,0.20)', labelKey: 'impactMedium' },
  low: { icon: CircleDashed, bg: 'rgba(34,197,94,0.10)', text: '#22c55e', border: 'rgba(34,197,94,0.18)', labelKey: 'impactLow' },
  none: { icon: ShieldCheck, bg: 'var(--bg-subtle-2)', text: 'var(--text-muted)', border: 'var(--border-medium)', labelKey: 'impactNone' }
}

const sourceKeys: Record<StartupItem['source'], string> = {
  'registry-hkcu': 'sourceUserRegistry',
  'registry-hklm': 'sourceSystemRegistry',
  'startup-folder': 'sourceStartupFolder',
  'task-scheduler': 'sourceTaskScheduler',
  'launch-agent-user': 'sourceLaunchAgentUser',
  'launch-agent-global': 'sourceLaunchAgentGlobal',
  'login-item': 'sourceLoginItem',
  'systemd-user': 'sourceSystemdUser',
  'autostart-desktop': 'sourceAutostartDesktop',
  'cron': 'sourceCron'
}

const impactBarColors: Record<string, string> = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#22c55e'
}

const skeletonBg = 'linear-gradient(90deg, var(--bg-subtle) 25%, var(--bg-hover) 50%, var(--bg-subtle) 75%)'

function formatMs(ms: number): string {
  if (ms >= 60000) return `${(ms / 60000).toFixed(1)}m`
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${ms}ms`
}

function SummaryCard({ icon: Icon, label, value, color, bg }: { icon: LucideIcon; label: string; value: number; color: string; bg: string }) {
  const animated = useAnimatedCounter(value)
  return (
    <div className="glass-card glass-card-hover group flex items-center gap-3 rounded-2xl px-4 py-3.5">
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110"
        style={{ background: bg }}
      >
        <Icon className="h-4 w-4" style={{ color }} strokeWidth={1.8} aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="text-[20px] font-bold leading-tight text-white">{Math.round(animated).toLocaleString()}</p>
        <p className="truncate text-[11.5px] font-medium" style={{ color: 'var(--text-muted)' }}>{label}</p>
      </div>
    </div>
  )
}

function ImpactBadge({ impact, className }: { impact: StartupItem['impact']; className?: string }) {
  const { t } = useTranslation('startup')
  const cfg = impactConfig[impact]
  return (
    <span
      className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold', className)}
      style={{ background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}` }}
    >
      <cfg.icon className="h-3 w-3" strokeWidth={2.2} aria-hidden="true" />
      {t(cfg.labelKey)}
    </span>
  )
}

function StatusBadge({ enabled, className }: { enabled: boolean; className?: string }) {
  const { t } = useTranslation('startup')
  return (
    <span
      className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold', className)}
      style={
        enabled
          ? { background: 'rgba(34,197,94,0.10)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.18)' }
          : { background: 'var(--bg-subtle-2)', color: 'var(--text-muted)', border: '1px solid var(--border-medium)' }
      }
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: enabled ? '#22c55e' : 'var(--text-faint)' }} aria-hidden="true" />
      {t(enabled ? 'statusEnabled' : 'statusDisabled')}
    </span>
  )
}

function Toggle({ enabled, pending, onToggle, label }: { enabled: boolean; pending: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      disabled={pending}
      onClick={onToggle}
      className={cn(
        'relative h-[26px] w-[48px] shrink-0 rounded-full transition-colors duration-200 disabled:cursor-wait',
        enabled ? 'bg-gradient-to-r from-amber-500 to-amber-400' : ''
      )}
      style={enabled ? { boxShadow: '0 0 14px rgba(245,158,11,0.25)' } : { background: 'var(--bg-active)' }}
    >
      <span
        className={cn(
          'absolute top-[3px] flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-sm transition-transform duration-200',
          enabled ? 'translate-x-[25px]' : 'translate-x-[3px]'
        )}
      >
        {pending && <Loader2 className="h-3 w-3 animate-spin text-amber-500" strokeWidth={2.5} aria-hidden="true" />}
      </span>
    </button>
  )
}

function FilterPills({ value, onChange }: { value: 'all' | 'active' | 'disabled'; onChange: (v: 'all' | 'active' | 'disabled') => void }) {
  const { t } = useTranslation('startup')
  const pills: { value: 'all' | 'active' | 'disabled'; label: string }[] = [
    { value: 'all', label: t('filterAll') },
    { value: 'active', label: t('filterActive') },
    { value: 'disabled', label: t('filterDisabled') }
  ]
  return (
    <div
      className="flex items-center gap-1 rounded-xl p-1"
      style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}
      role="group"
      aria-label={t('filterByLabel')}
    >
      {pills.map((pill) => {
        const active = value === pill.value
        return (
          <button
            key={pill.value}
            onClick={() => onChange(pill.value)}
            className={cn('rounded-lg px-3 py-1.5 text-[11.5px] font-medium transition-all', active ? 'text-white' : 'text-zinc-500 hover:text-zinc-300')}
            style={active ? { background: 'var(--bg-active)', boxShadow: '0 1px 6px rgba(0,0,0,0.25)' } : undefined}
            aria-pressed={active}
          >
            {pill.label}
          </button>
        )
      })}
    </div>
  )
}

function SortDropdown({ value, onChange }: { value: 'name' | 'impact'; onChange: (v: 'name' | 'impact') => void }) {
  const { t } = useTranslation('startup')
  return (
    <div className="relative shrink-0">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as 'name' | 'impact')}
        aria-label={t('sortByImpact')}
        className="appearance-none rounded-xl py-2 pl-3 pr-8 text-[12.5px] font-medium text-white outline-none"
        style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)' }}
      >
        <option value="impact">{t('sortByImpact')}</option>
        <option value="name">{t('sortByName')}</option>
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} strokeWidth={2} aria-hidden="true" />
    </div>
  )
}

function SkeletonRows() {
  return (
    <div className="space-y-2.5" aria-hidden="true">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="glass-card flex items-center gap-4 rounded-2xl px-4 py-3.5">
          <div className="h-10 w-10 shrink-0 rounded-xl animate-shimmer" style={{ backgroundImage: skeletonBg, backgroundSize: '200% 100%' }} />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3 w-40 max-w-full rounded-full animate-shimmer" style={{ backgroundImage: skeletonBg, backgroundSize: '200% 100%' }} />
            <div className="h-2.5 w-64 max-w-full rounded-full animate-shimmer" style={{ backgroundImage: skeletonBg, backgroundSize: '200% 100%' }} />
          </div>
          <div className="h-6 w-20 shrink-0 rounded-full animate-shimmer" style={{ backgroundImage: skeletonBg, backgroundSize: '200% 100%' }} />
        </div>
      ))}
    </div>
  )
}

function DetailsModal({ item, onClose }: { item: StartupItem; onClose: () => void }) {
  const { t } = useTranslation('startup')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const cfg = impactConfig[item.impact]
  const rows: { label: string; value: string; mono?: boolean }[] = [
    { label: t('detailsName'), value: item.displayName },
    { label: t('detailsPublisher'), value: item.publisher || '—' },
    { label: t('detailsSource'), value: t(sourceKeys[item.source]) },
    { label: t('detailsStatus'), value: t(item.enabled ? 'statusEnabled' : 'statusDisabled') },
    { label: t('detailsImpact'), value: t(cfg.labelKey) },
    { label: t('detailsLocation'), value: item.location || '—' },
    { label: t('detailsCommand'), value: item.command || '—', mono: true },
    { label: t('detailsIdentifier'), value: item.id, mono: true }
  ]

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 animate-fade-in" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }} onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="startup-details-title"
        className="glass-card relative w-full max-w-lg animate-scale-in overflow-hidden rounded-2xl"
        style={{ background: 'var(--card-bg)', boxShadow: '0 24px 80px rgba(0,0,0,0.5), inset 0 1px 0 var(--glass-inset)' }}
      >
        <div className="flex items-start gap-4 px-6 pt-6 pb-5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-[15px] font-bold" style={{ background: cfg.bg, color: cfg.text }} aria-hidden="true">
            {item.displayName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <h3 id="startup-details-title" className="truncate text-[16px] font-semibold text-white">{item.displayName}</h3>
            <p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {item.publisher || '—'} · {t(sourceKeys[item.source])}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label={t('detailsClose')}
            autoFocus
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200"
            style={{ background: 'var(--bg-subtle)' }}
          >
            <X className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-6 py-5">
          <div className="space-y-2">
            {rows.map((row) => (
              <div key={row.label} className="flex items-start justify-between gap-4 rounded-xl px-3.5 py-2.5" style={{ background: 'var(--bg-subtle)' }}>
                <span className="shrink-0 text-[11.5px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{row.label}</span>
                <span className={cn('min-w-0 break-all text-right text-[12.5px] font-medium', row.mono ? 'font-mono' : 'text-zinc-200')} style={{ color: row.mono ? 'var(--text-secondary)' : undefined }}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>
          {item.stale && (
            <div className="mt-4 flex items-start gap-2.5 rounded-xl px-4 py-3" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.15)' }}>
              <PackageX className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" strokeWidth={1.8} aria-hidden="true" />
              <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{t('staleTooltip')}</p>
            </div>
          )}
        </div>

        <div className="flex justify-end px-6 pb-6 pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <button
            onClick={onClose}
            className="rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all"
            style={{ background: 'linear-gradient(135deg, #fbbf24, #f59e0b)', color: 'var(--text-on-accent)', boxShadow: '0 0 16px rgba(245,158,11,0.2)' }}
          >
            {t('detailsClose')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Boot trace panel ─────────────────────────────────────────

function BootTracePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('startup')
  const trace = useStartupStore((s) => s.bootTrace)
  const traceLoading = useStartupStore((s) => s.traceLoading)

  const fetchTrace = useCallback(async () => {
    useStartupStore.getState().setTraceLoading(true)
    try {
      const data = await window.clarity.startupBootTrace()
      useStartupStore.getState().setBootTrace(data)
    } catch (err) {
      console.error('Failed to load boot trace:', err)
      useStartupStore.getState().setBootTrace(null)
    }
    useStartupStore.getState().setTraceLoading(false)
  }, [])

  useEffect(() => {
    if (open && !trace && !traceLoading) {
      fetchTrace()
    }
  }, [open, trace, traceLoading, fetchTrace])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (open) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const pieData = useMemo(() => {
    if (!trace) return []
    const main = Math.max(0, trace.mainPathMs)
    const apps = Math.max(0, trace.startupAppsMs)
    const other = Math.max(0, trace.totalBootMs - main - apps)
    const items = [
      { name: t('pieCoreBoot'), value: main, color: '#3b82f6' },
      { name: t('pieStartupApps'), value: apps, color: '#f59e0b' },
      { name: t('pieOther'), value: other, color: 'var(--text-faint)' }
    ]
    return items.filter((i) => i.value > 0)
  }, [trace, t])

  const barData = useMemo(() => {
    if (!trace) return []
    return [...trace.entries]
      .sort((a, b) => b.delayMs - a.delayMs)
      .slice(0, 8)
      .map((e) => ({ name: e.displayName, delayMs: e.delayMs, impact: e.impact }))
  }, [trace])

  const savings = useMemo(() => {
    if (!trace) return 0
    return trace.entries
      .filter((e) => e.impact === 'high')
      .reduce((sum, e) => sum + e.delayMs, 0)
  }, [trace])

  const highImpactCount = useMemo(() => {
    if (!trace) return 0
    return trace.entries.filter((e) => e.impact === 'high').length
  }, [trace])

  return (
    <AnimatePresence>
      {open && (
        <>
          <div
            className="fixed inset-0 z-[95] animate-fade-in"
            style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="boot-trace-title"
            initial={{ x: 420, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 420, opacity: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="glass-card fixed right-0 top-0 z-[96] flex h-full w-full max-w-[420px] flex-col overflow-hidden rounded-l-2xl rounded-r-none"
            style={{ background: 'var(--card-bg)', boxShadow: '-24px 0 80px rgba(0,0,0,0.5), inset 0 1px 0 var(--glass-inset)' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: 'rgba(245,158,11,0.12)' }}>
                  <Activity className="h-4 w-4 text-amber-400" strokeWidth={1.8} aria-hidden="true" />
                </div>
                <div>
                  <h2 id="boot-trace-title" className="text-[15px] font-semibold text-white">{t('bootTraceTitle')}</h2>
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{t('bootTraceBasedOnLastBoot')}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {trace && trace.available && (
                  <button
                    onClick={fetchTrace}
                    aria-label={t('refreshBootTrace')}
                    title={t('refreshBootTrace')}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200"
                    style={{ background: 'var(--bg-subtle)' }}
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', traceLoading && 'animate-spin')} strokeWidth={1.8} aria-hidden="true" />
                  </button>
                )}
                <button
                  onClick={onClose}
                  aria-label={t('detailsClose')}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200"
                  style={{ background: 'var(--bg-subtle)' }}
                >
                  <X className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {traceLoading && (
                <div className="space-y-4">
                  <div className="h-24 animate-shimmer rounded-2xl" style={{ backgroundImage: skeletonBg, backgroundSize: '200% 100%' }} />
                  <div className="h-48 animate-shimmer rounded-2xl" style={{ backgroundImage: skeletonBg, backgroundSize: '200% 100%' }} />
                </div>
              )}

              {!traceLoading && trace && trace.needsAdmin && (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: 'rgba(245,158,11,0.1)' }}>
                    <Shield className="h-6 w-6 text-amber-400" strokeWidth={1.6} aria-hidden="true" />
                  </div>
                  <p className="max-w-[280px] text-[13px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                    {t('bootTraceNeedsAdmin')}
                  </p>
                </div>
              )}

              {!traceLoading && trace && !trace.needsAdmin && !trace.available && (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: 'var(--bg-subtle)' }}>
                    <Clock className="h-6 w-6" style={{ color: 'var(--text-faint)' }} strokeWidth={1.6} aria-hidden="true" />
                  </div>
                  <p className="max-w-[280px] text-[13px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                    {t('bootTraceNotAvailable')}
                  </p>
                </div>
              )}

              {!traceLoading && trace && trace.available && (
                <>
                  {/* Stat chips */}
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="rounded-2xl px-4 py-3" style={{ background: 'var(--bg-subtle)' }}>
                      <p className="text-[10.5px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{t('statTotalBootTime')}</p>
                      <p className="mt-1 text-[20px] font-bold text-white">{formatMs(trace.totalBootMs)}</p>
                    </div>
                    <div className="rounded-2xl px-4 py-3" style={{ background: 'var(--bg-subtle)' }}>
                      <p className="text-[10.5px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{t('statStartupAppsDelay')}</p>
                      <p className="mt-1 text-[20px] font-bold" style={{ color: highImpactCount > 0 ? '#f59e0b' : '#22c55e' }}>{formatMs(trace.startupAppsMs)}</p>
                    </div>
                    <div className="rounded-2xl px-4 py-3" style={{ background: 'var(--bg-subtle)' }}>
                      <p className="text-[10.5px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{t('statAppsMeasured')}</p>
                      <p className="mt-1 text-[20px] font-bold text-white">{trace.entries.length}</p>
                    </div>
                    <div className="rounded-2xl px-4 py-3" style={{ background: 'var(--bg-subtle)' }}>
                      <p className="text-[10.5px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{t('statPotentialSavings')}</p>
                      <p className="mt-1 text-[20px] font-bold" style={{ color: '#22c55e' }}>{formatMs(savings)}</p>
                    </div>
                  </div>

                  {trace.lastBootDate && (
                    <p className="mt-3 text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                      {t('bootTraceLastBoot', { date: trace.lastBootDate })}
                    </p>
                  )}

                  {/* Pie chart */}
                  {pieData.length > 0 && (
                    <div className="mt-5 rounded-2xl p-5" style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}>
                      <h3 className="mb-3 text-[12px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                        {t('chartBootTimeBreakdown')}
                      </h3>
                      <div className="flex items-center gap-5">
                        <div className="h-[130px] w-[130px] shrink-0">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={38} outerRadius={58} paddingAngle={3} stroke="none">
                                {pieData.map((entry, idx) => (
                                  <Cell key={idx} fill={entry.color} />
                                ))}
                              </Pie>
                              <Tooltip
                                contentStyle={{ background: 'var(--card-bg)', border: '1px solid var(--border-medium)', borderRadius: 12, fontSize: 12 }}
                                formatter={(value) => [formatMs(Number(value)), '']}
                              />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="flex-1 space-y-2.5">
                          {pieData.map((entry) => (
                            <div key={entry.name} className="flex items-center gap-2">
                              <span className="h-2.5 w-2.5 rounded-full" style={{ background: entry.color }} aria-hidden="true" />
                              <span className="flex-1 truncate text-[12px]" style={{ color: 'var(--text-secondary)' }}>{entry.name}</span>
                              <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>{formatMs(entry.value)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Bar chart */}
                  <div className="mt-4 rounded-2xl p-5" style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}>
                    <h3 className="mb-3 text-[12px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                      {t('chartBootTimeImpact')}
                    </h3>
                    {barData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={barData} layout="vertical" barSize={12}>
                          <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false}
                            tickFormatter={(v) => formatMs(Number(v))} />
                          <YAxis type="category" dataKey="name" tick={{ fill: 'var(--text-secondary)', fontSize: 10 }} axisLine={false}
                            tickLine={false} width={96} />
                          <Tooltip
                            contentStyle={{ background: 'var(--card-bg)', border: '1px solid var(--border-medium)', borderRadius: 12, fontSize: 12 }}
                            formatter={(value) => [formatMs(Number(value)), t('chartTooltipDelay')]}
                          />
                          <Bar dataKey="delayMs" radius={[0, 6, 6, 0]}>
                            {barData.map((entry) => (
                              <Cell key={entry.name} fill={impactBarColors[entry.impact] ?? '#64748b'} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex h-[220px] items-center justify-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
                        {t('chartNoPerAppData')}
                      </div>
                    )}
                  </div>

                  {highImpactCount > 0 && (
                    <p className="mt-4 text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                      {t(highImpactCount === 1 ? 'bootTraceHighImpactApp' : 'bootTraceHighImpactApps', { count: highImpactCount })}
                    </p>
                  )}
                </>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

// ── Startup row ──────────────────────────────────────────────

interface StartupRowProps {
  item: StartupItem
  compact: boolean
  pendingToggle: boolean
  onToggle: () => void
  onDetails: () => void
  onRemove: () => void
}

function StartupRow({ item, compact, pendingToggle, onToggle, onDetails, onRemove }: StartupRowProps) {
  const { t } = useTranslation('startup')
  const [expanded, setExpanded] = useState(false)
  const cfg = impactConfig[item.impact]

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.3, ease: EASE }}
      className={cn('glass-card rounded-2xl', compact ? 'px-4 py-2.5' : 'px-4 py-3.5')}
      style={{ border: '1px solid var(--border-subtle)' }}
    >
      <div className="flex items-center gap-4">
        {/* Icon */}
        <div
          className={cn('flex shrink-0 items-center justify-center rounded-xl text-[13px] font-bold', compact ? 'h-8 w-8' : 'h-10 w-10')}
          style={{ background: cfg.bg, color: cfg.text }}
          aria-hidden="true"
        >
          {item.displayName.charAt(0).toUpperCase()}
        </div>

        {/* Name / publisher */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="min-w-0 flex-1 text-left"
          aria-expanded={expanded}
        >
          <div className="flex items-center gap-2">
            <span className="truncate text-[13.5px] font-semibold text-white">{item.displayName}</span>
            {item.stale && (
              <span className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.2)' }}>
                <PackageX className="mr-1 h-2.5 w-2.5" strokeWidth={2.2} aria-hidden="true" />
                {t('staleBadge')}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
            {item.publisher || t(sourceKeys[item.source])}
            <span className="mx-1.5" aria-hidden="true">·</span>
            {t(sourceKeys[item.source])}
          </p>
        </button>

        {/* Impact + status badges */}
        <div className="hidden shrink-0 items-center gap-2 lg:flex">
          <ImpactBadge impact={item.impact} />
          <StatusBadge enabled={item.enabled} />
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={onDetails}
            aria-label={t('detailsOpen')}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200"
            style={{ background: 'var(--bg-subtle)' }}
          >
            <Eye className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button
            onClick={onRemove}
            aria-label={t('removeButtonTitle', { name: item.displayName })}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-white/5"
            style={{ background: 'var(--bg-subtle)' }}
          >
            <Trash2 className="h-4 w-4 text-red-400/80" strokeWidth={1.8} aria-hidden="true" />
          </button>
          <Toggle
            enabled={item.enabled}
            pending={pendingToggle}
            onToggle={onToggle}
            label={t(item.enabled ? 'statusDisabled' : 'statusEnabled')}
          />
        </div>

        {/* Expand chevron */}
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? t('detailsOpen') : t('detailsName')}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/5"
        >
          {expanded
            ? <ChevronUp className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            : <ChevronDown className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />}
        </button>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="mt-3 space-y-2 rounded-xl px-3.5 py-3" style={{ background: 'var(--bg-subtle)' }}>
              <div>
                <p className="text-[10.5px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{t('detailsCommand')}</p>
                <p className="mt-0.5 break-all font-mono text-[11.5px]" style={{ color: 'var(--text-secondary)' }}>{item.command || '—'}</p>
              </div>
              <div>
                <p className="text-[10.5px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{t('detailsLocation')}</p>
                <p className="mt-0.5 break-all text-[11.5px]" style={{ color: 'var(--text-secondary)' }}>{item.location || '—'}</p>
              </div>
              <div className="flex items-center gap-2 lg:hidden">
                <ImpactBadge impact={item.impact} />
                <StatusBadge enabled={item.enabled} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ── Page ─────────────────────────────────────────────────────

export function StartupPage({ embedded }: { embedded?: boolean }) {
  const { t } = useTranslation('startup')
  const store = useStartupStore
  const items = useStartupStore((s) => s.items)
  const loading = useStartupStore((s) => s.loading)
  const sortBy = useStartupStore((s) => s.sortBy)
  const filterBy = useStartupStore((s) => s.filterBy)
  const error = useStartupStore((s) => s.error)
  const deleteTarget = useStartupStore((s) => s.deleteTarget)
  const historyStore = useHistoryStore()

  const [search, setSearch] = useState('')
  const [compact, setCompact] = useState(false)
  const [traceOpen, setTraceOpen] = useState(false)
  const [detailsItem, setDetailsItem] = useState<StartupItem | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const loadItems = useCallback(async () => {
    store.getState().setLoading(true)
    store.getState().setError(null)
    try {
      const list = await window.clarity.startupList()
      store.getState().setItems(list)
    } catch (err) {
      console.error('Failed to load startup items:', err)
      store.getState().setError(t('errorFailedToLoad'))
    }
    store.getState().setLoading(false)
  }, [t, store])

  // Auto-load on first visit
  useEffect(() => {
    if (!items.length && !loading) loadItems()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggle = useCallback(async (item: StartupItem) => {
    setTogglingId(item.id)
    const next = !item.enabled
    try {
      const ok = await window.clarity.startupToggle(item.name, item.location, item.command, item.source, next)
      if (ok) {
        store.getState().updateItem(item.id, { enabled: next })
      } else {
        toast.error(t(next ? 'toastFailedToEnable' : 'toastFailedToDisable', { name: item.displayName }), {
          description: t('toastAdminRequired')
        })
      }
    } catch (err) {
      console.error('Toggle failed:', err)
      toast.error(t(next ? 'toastFailedToEnable' : 'toastFailedToDisable', { name: item.displayName }), {
        description: t('toastAdminRequired')
      })
    }
    setTogglingId(null)
  }, [t, store])

  const handleRemove = useCallback(async () => {
    const target = deleteTarget
    if (!target) return
    store.getState().setDeleteTarget(null)
    try {
      const ok = await window.clarity.startupDelete(target.name, target.location, target.source)
      if (ok) {
        store.getState().removeItem(target.id)
        await historyStore.addEntry({
          id: Date.now().toString(),
          type: 'startup',
          timestamp: new Date().toISOString(),
          duration: 0,
          totalItemsFound: 1,
          totalItemsCleaned: 1,
          totalItemsSkipped: 0,
          totalSpaceSaved: 0,
          categories: [{ name: t('historyCategoryRemoved'), itemsFound: 1, itemsCleaned: 1, spaceSaved: 0 }],
          errorCount: 0
        })
      } else {
        toast.error(t('toastFailedToRemove', { name: target.displayName }), { description: t('toastAdminRequired') })
      }
    } catch (err) {
      console.error('Remove failed:', err)
      toast.error(t('toastFailedToRemove', { name: target.displayName }), { description: t('toastAdminRequired') })
    }
  }, [deleteTarget, historyStore, store, t])

  const handleExport = useCallback(() => {
    const header = ['Name', 'Publisher', 'Source', 'Status', 'Impact', 'Command', 'Location']
    const rows = items.map((item) => [
      item.displayName,
      item.publisher ?? '',
      item.source,
      item.enabled ? 'Enabled' : 'Disabled',
      item.impact,
      item.command,
      item.location
    ])
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'startup-items.csv'
    a.click()
    URL.revokeObjectURL(url)
  }, [items])

  const filtered = useMemo(() => {
    let list = items
    if (filterBy === 'active') list = list.filter((i) => i.enabled)
    if (filterBy === 'disabled') list = list.filter((i) => !i.enabled)
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter((i) =>
        i.displayName.toLowerCase().includes(q) ||
        (i.publisher ?? '').toLowerCase().includes(q) ||
        i.command.toLowerCase().includes(q)
      )
    }
    const sorted = [...list]
    if (sortBy === 'impact') {
      const order = { high: 0, medium: 1, low: 2, none: 3 }
      sorted.sort((a, b) => order[a.impact] - order[b.impact] || a.displayName.localeCompare(b.displayName))
    } else {
      sorted.sort((a, b) => a.displayName.localeCompare(b.displayName))
    }
    return sorted
  }, [items, filterBy, search, sortBy])

  const stats = useMemo(() => ({
    total: items.length,
    active: items.filter((i) => i.enabled).length,
    disabled: items.filter((i) => !i.enabled).length,
    stale: items.filter((i) => i.stale).length
  }), [items])

  const headerAction = (
    <>
      <button
        onClick={() => setTraceOpen(true)}
        className="flex h-9 items-center gap-2 rounded-xl px-3.5 text-[12.5px] font-semibold transition-all"
        style={{
          background: 'rgba(245,158,11,0.12)',
          color: '#f59e0b',
          border: '1px solid rgba(245,158,11,0.2)'
        }}
      >
        <Activity className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
        {t('bootTraceTitle')}
      </button>
      <button
        onClick={handleExport}
        className="flex h-9 items-center gap-2 rounded-xl px-3.5 text-[12.5px] font-semibold transition-colors hover:bg-white/5"
        style={{ background: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}
      >
        <Download className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
        CSV
      </button>
      <button
        onClick={loadItems}
        disabled={loading}
        className="flex h-9 w-9 items-center justify-center rounded-xl transition-colors hover:bg-white/5 disabled:cursor-wait"
        style={{ background: 'var(--bg-subtle)' }}
        aria-label={t('refreshButton')}
        title={t('refreshButton')}
      >
        <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} strokeWidth={1.8} style={{ color: 'var(--text-secondary)' }} aria-hidden="true" />
      </button>
    </>
  )

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        action={!embedded ? headerAction : undefined}
      />

      {error && (
        <ErrorAlert message={error} onDismiss={() => store.getState().setError(null)} className="mb-5" />
      )}

      {/* Summary cards */}
      {!loading && items.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <SummaryCard icon={Layers} label={t('summaryTotal')} value={stats.total} color="#3b82f6" bg="rgba(59,130,246,0.1)" />
          <SummaryCard icon={Zap} label={t('filterActive')} value={stats.active} color="#22c55e" bg="rgba(34,197,94,0.1)" />
          <SummaryCard icon={Circle} label={t('filterDisabled')} value={stats.disabled} color="#64748b" bg="rgba(100,116,139,0.1)" />
          <SummaryCard icon={PackageX} label={t('staleBadge')} value={stats.stale} color="#f59e0b" bg="rgba(245,158,11,0.1)" />
        </div>
      )}

      {/* Toolbar */}
      {!loading && items.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[220px] flex-1">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2"
              style={{ color: 'var(--text-faint)' }}
              strokeWidth={1.8}
              aria-hidden="true"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="w-full rounded-xl py-2 pl-10 pr-9 text-[12.5px] font-medium text-white placeholder:text-zinc-600 outline-none"
              style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)' }}
              aria-label={t('searchPlaceholder')}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                aria-label={t('detailsClose')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              </button>
            )}
          </div>
          <FilterPills value={filterBy} onChange={(v) => store.getState().setFilterBy(v)} />
          <SortDropdown value={sortBy} onChange={(v) => store.getState().setSortBy(v)} />
          <button
            onClick={() => setCompact((v) => !v)}
            aria-pressed={compact}
            aria-label={t('compactToggle')}
            title={t('compactToggle')}
            className="flex h-[38px] w-[38px] items-center justify-center rounded-xl transition-colors hover:bg-white/5"
            style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)', color: compact ? '#f59e0b' : 'var(--text-secondary)' }}
          >
            <Layers className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <SkeletonRows />
      ) : error ? (
        <EmptyState
          icon={Shield}
          title={t('errorFailedToLoad')}
          description={t('pageDescription')}
              action={
                <button
                  onClick={loadItems}
                  className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-40"
                  style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', color: 'var(--text-on-accent)' }}
                >
                  <RefreshCw className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                  {t('refreshButton')}
                </button>
              }
            />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Zap}
          title={t('emptyStateTitle')}
          description={t('emptyStateDescription')}
          action={
            <button
              onClick={loadItems}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', color: 'var(--text-on-accent)' }}
            >
              <RefreshCw className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              {t('refreshButton')}
            </button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title={t('emptySearchTitle')}
          description={t('emptySearchDescription')}
        />
      ) : (
        <div className="space-y-2.5">
          <AnimatePresence mode="popLayout">
            {filtered.map((item) => (
              <StartupRow
                key={item.id}
                item={item}
                compact={compact}
                pendingToggle={togglingId === item.id}
                onToggle={() => handleToggle(item)}
                onDetails={() => setDetailsItem(item)}
                onRemove={() => store.getState().setDeleteTarget(item)}
              />
            ))}
          </AnimatePresence>

          <p className="pt-2 text-center text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
            {t('showingCount', { shown: filtered.length, total: items.length })}
          </p>
        </div>
      )}

      {/* Dialogs */}
      <ConfirmDialog
        open={!!deleteTarget}
        onCancel={() => store.getState().setDeleteTarget(null)}
        onConfirm={handleRemove}
        title={t('confirmRemoveTitle', { name: deleteTarget?.displayName ?? '' })}
        description={t('confirmRemoveDescription')}
        confirmLabel={t('confirmRemoveLabel')}
        variant="danger"
        details={deleteTarget?.command}
      />

      <AnimatePresence>
        {detailsItem && (
          <DetailsModal item={detailsItem} onClose={() => setDetailsItem(null)} />
        )}
      </AnimatePresence>

      <BootTracePanel open={traceOpen} onClose={() => setTraceOpen(false)} />
    </div>
  )
}
