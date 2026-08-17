import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  Network,
  Radio,
  Activity,
  Clock,
  Search,
  RefreshCw,
  X,
  Square,
  ShieldAlert,
  ArrowUpDown,
  Globe,
  Zap
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { LocalServicesPanel } from '@/components/network/ports/LocalServicesPanel'
import { usePortManagerStore } from '@/stores/port-manager-store'
import { useDevicesStore } from '@/stores/devices-store'
import type { PortEntry } from '@shared/types'

/**
 * Ports — local listening ports and connections, with the ability to end the
 * process holding one.
 *
 * Also carries the "local services" split (reachable from the network vs only
 * from this machine) that used to be a tab inside the Devices page. It belongs
 * here: it describes this machine's own sockets, which is exactly what the port
 * table already enumerates.
 *
 * Available on all three platforms — Windows enumerates through netstat, see
 * `port-monitor.ts`.
 */

const REFRESH_OPTIONS = [0, 2000, 5000, 10000] as const

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const rem = Math.round(s % 60)
  return `${m}m ${rem}s`
}

function ProtocolBadge({ protocol }: { protocol: 'tcp' | 'udp' }) {
  return (
    <span
      className="inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold"
      style={{
        background: protocol === 'tcp' ? 'rgba(59,130,246,0.12)' : 'rgba(168,85,247,0.12)',
        color: protocol === 'tcp' ? '#60a5fa' : '#c084fc'
      }}
    >
      {protocol.toUpperCase()}
    </span>
  )
}

function StatChip({ icon: Icon, label, value, color }: {
  icon: typeof Network
  label: string
  value: string
  color: string
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-xl px-4 py-3"
      style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}
    >
      <Icon className="h-4 w-4 shrink-0" style={{ color }} strokeWidth={1.8} />
      <div className="min-w-0">
        <div className="text-[16px] font-bold leading-tight text-white">{value}</div>
        <div className="truncate text-[11px]" style={{ color: 'var(--text-muted)' }}>{label}</div>
      </div>
    </div>
  )
}

export function PortsPage() {
  const { t } = useTranslation('portManager')

  // Subscribed per field rather than through a bare usePortManagerStore(): the
  // selectorless form re-rendered this whole table (and every row) on any store
  // change, including each keystroke in the search box.
  const status = usePortManagerStore((s) => s.status)
  const error = usePortManagerStore((s) => s.error)
  const result = usePortManagerStore((s) => s.result)
  const filter = usePortManagerStore((s) => s.filter)
  const search = usePortManagerStore((s) => s.search)
  const selectedPids = usePortManagerStore((s) => s.selectedPids)
  const killInFlight = usePortManagerStore((s) => s.killInFlight)
  const scan = usePortManagerStore((s) => s.scan)
  const setFilter = usePortManagerStore((s) => s.setFilter)
  const setSearch = usePortManagerStore((s) => s.setSearch)
  const togglePid = usePortManagerStore((s) => s.togglePid)
  const selectAll = usePortManagerStore((s) => s.selectAll)
  const deselectAll = usePortManagerStore((s) => s.deselectAll)
  const killSelected = usePortManagerStore((s) => s.killSelected)

  // Read-only: hosts-file names to enrich local services, used only if a
  // devices scan already happened. Never triggers one.
  const localListeners = useDevicesStore((s) => s.snapshot?.listeners)
  const devicesDemoMode = useDevicesStore((s) => s.demoMode)

  const [showConfirm, setShowConfirm] = useState(false)
  const [refreshMs, setRefreshMs] = useState<number>(5000)
  const [sortBy, setSortBy] = useState<'port' | 'process'>('port')
  const [sortAsc, setSortAsc] = useState(true)

  useEffect(() => {
    if (usePortManagerStore.getState().status === 'idle') void scan()
  }, [scan])

  // Auto-refresh. Status is read at fire time instead of being a dependency:
  // every scan flips it, so having it in the deps tore the interval down and
  // rebuilt it on each pass, which meant the timer never actually elapsed at
  // the configured rate.
  useEffect(() => {
    if (refreshMs <= 0) return
    const id = setInterval(() => {
      const store = usePortManagerStore.getState()
      if (store.status !== 'scanning') void store.scan()
    }, refreshMs)
    return () => clearInterval(id)
  }, [refreshMs])

  const filtered = useMemo(() => {
    if (!result) return []
    let list = result.ports.filter((entry) => {
      if (filter === 'listening' && !entry.isListener) return false
      if (filter === 'tcp' && entry.protocol !== 'tcp') return false
      if (filter === 'udp' && entry.protocol !== 'udp') return false
      return true
    })
    const query = search.trim().toLowerCase()
    if (query) {
      list = list.filter((entry) =>
        String(entry.port).includes(query) ||
        (entry.processName ?? '').toLowerCase().includes(query) ||
        (entry.serviceName ?? '').toLowerCase().includes(query) ||
        (entry.command ?? '').toLowerCase().includes(query)
      )
    }
    const dir = sortAsc ? 1 : -1
    list = [...list].sort((a, b) => {
      if (sortBy === 'process') {
        return (a.processName ?? '').localeCompare(b.processName ?? '') * dir
      }
      if (a.port !== b.port) return (a.port - b.port) * dir
      return a.protocol.localeCompare(b.protocol) * dir
    })
    return list
  }, [result, filter, search, sortBy, sortAsc])

  const selectedEntries = useMemo(() => {
    if (!result) return []
    return result.ports.filter((e) => e.pid != null && selectedPids.has(e.pid))
  }, [result, selectedPids])

  const toggleSort = (by: 'port' | 'process') => {
    if (sortBy === by) setSortAsc((v) => !v)
    else { setSortBy(by); setSortAsc(true) }
  }

  const handleKill = async () => {
    setShowConfirm(false)
    const res = await killSelected()
    if (res.success) {
      if (res.freedPorts.length > 0) {
        toast.success(t('killFreed', { count: res.freedPorts.length }))
      } else {
        toast.success(t('killSuccess', { count: selectedEntries.length }))
      }
    } else {
      toast.error(res.requiresAdmin ? t('killAdminNeeded') : res.error || t('killFailed'))
    }
  }

  const rowKey = (e: PortEntry) => `${e.protocol}:${e.port}:${e.pid ?? 'kernel'}`
  const scanning = status === 'scanning'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        className="mb-5"
        title={t('pageTitle')}
        description={t('pageDescription')}
        action={
          <button
            onClick={() => void scan()}
            disabled={scanning}
            className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-40"
            style={{
              background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
              color: 'var(--text-on-accent)'
            }}
          >
            <RefreshCw className={cn('h-4 w-4', scanning && 'animate-spin')} />
            {scanning ? t('scanning') : t('scan')}
          </button>
        }
      />

      {/* Stats */}
      {result && status !== 'error' && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatChip icon={Network} label={t('ports')} value={String(result.totalPorts)} color="#60a5fa" />
          <StatChip icon={Radio} label={t('listeningTab')} value={String(result.listeners)} color="#4ade80" />
          <StatChip icon={Activity} label={t('connections')} value={String(result.connections)} color="#c084fc" />
          <StatChip icon={Clock} label={t('lastScan')} value={formatDuration(result.duration)} color="#f59e0b" />
        </div>
      )}

      {/* Local services — exposure summary, relocated from the Devices page */}
      {result && status !== 'error' && result.ports.length > 0 && (
        <div className="mb-4">
          <LocalServicesPanel
            ports={result.ports}
            listeners={localListeners}
            demoMode={devicesDemoMode}
          />
        </div>
      )}

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <div className="flex items-center gap-1 rounded-xl p-1" style={{ background: 'var(--bg-subtle)' }}>
          {([['all', t('allTab')], ['listening', t('listeningTab')], ['tcp', t('tcpTab')], ['udp', t('udpTab')]] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors',
                filter === key ? 'text-white' : 'text-[var(--text-muted)]'
              )}
              style={filter === key ? { background: 'var(--bg-subtle-2)' } : undefined}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative min-w-[160px] flex-1 max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="w-full rounded-xl border py-2 pl-9 pr-8 text-[13px] outline-none transition-colors"
            style={{ background: 'var(--bg-subtle)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--text-muted)' }}
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <label className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>
          <span>{t('refreshInterval')}</span>
          <select
            value={refreshMs}
            onChange={(e) => setRefreshMs(Number(e.target.value))}
            className="rounded-lg border-none px-2 py-1.5 text-[12px] outline-none"
            style={{ background: 'var(--bg-subtle)', color: 'var(--text-primary)' }}
          >
            <option value={0}>{t('off')}</option>
            {REFRESH_OPTIONS.filter((v) => v > 0).map((v) => (
              <option key={v} value={v}>{`${v / 1000}s`}</option>
            ))}
          </select>
        </label>

        <span className="flex-1" />

        {result && (
          <>
            <button
              onClick={() => selectAll()}
              className="text-[12px] font-medium transition-colors hover:text-white"
              style={{ color: 'var(--text-muted)' }}
            >
              {t('selectAll')}
            </button>
            <button
              onClick={() => deselectAll()}
              className="text-[12px] font-medium transition-colors hover:text-white"
              style={{ color: 'var(--text-muted)' }}
            >
              {t('deselectAll')}
            </button>
            <button
              onClick={() => setShowConfirm(true)}
              disabled={selectedPids.size === 0 || killInFlight.size > 0}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-[12px] font-semibold transition-all disabled:opacity-40"
              style={{
                background: 'rgba(239,68,68,0.12)',
                color: '#ef4444'
              }}
            >
              <Square className="h-3.5 w-3.5" />
              {killInFlight.size > 0 ? t('ending') : t('endSelected')}
              {selectedPids.size > 0 && (
                <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold" style={{ background: 'rgba(239,68,68,0.2)' }}>
                  {selectedPids.size}
                </span>
              )}
            </button>
          </>
        )}
      </div>

      {/* Body */}
      {status === 'idle' && (
        <EmptyState icon={Network} title={t('idleTitle')} description={t('idleDescription')} />
      )}

      {scanning && !result && (
        <div className="flex flex-1 items-center justify-center">
          <RefreshCw className="h-6 w-6 animate-spin" style={{ color: 'var(--text-muted)' }} />
        </div>
      )}

      {status === 'error' && (
        <EmptyState icon={ShieldAlert} title={t('errorTitle')} description={error ?? ''} />
      )}

      {status === 'complete' && filtered.length === 0 && (
        <EmptyState icon={Network} title={t('emptyTitle')} description={t('emptyDescription')} />
      )}

      {status === 'complete' && filtered.length > 0 && (
        <div
          className="min-h-0 flex-1 overflow-y-auto rounded-2xl border"
          style={{
            borderColor: 'var(--border-medium)',
            background: 'var(--card-bg)',
            scrollbarWidth: 'thin',
            scrollbarColor: 'var(--scrollbar-thumb) transparent'
          }}
        >
          <table className="w-full border-collapse text-left">
            <thead
              className="sticky top-0 z-10 text-[11px] uppercase tracking-wider"
              style={{ background: 'var(--card-bg)', color: 'var(--text-muted)' }}
            >
              <tr style={{ boxShadow: 'inset 0 -1px 0 var(--border-medium)' }}>
                <th className="w-10 px-4 py-3 font-semibold">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && filtered.every((e) => e.pid == null || selectedPids.has(e.pid))}
                    onChange={(e) => e.target.checked ? selectAll() : deselectAll()}
                    aria-label={t('selectAll')}
                  />
                </th>
                <th className="px-3 py-3 font-semibold">{t('protocol')}</th>
                <th
                  className="cursor-pointer select-none px-3 py-3 font-semibold"
                  onClick={() => toggleSort('port')}
                >
                  <span className="inline-flex items-center gap-1">
                    {t('port')}
                    <ArrowUpDown className="h-3 w-3" />
                  </span>
                </th>
                <th className="px-3 py-3 font-semibold">{t('state')}</th>
                <th
                  className="cursor-pointer select-none px-3 py-3 font-semibold"
                  onClick={() => toggleSort('process')}
                >
                  <span className="inline-flex items-center gap-1">
                    {t('process')}
                    <ArrowUpDown className="h-3 w-3" />
                  </span>
                </th>
                <th className="px-3 py-3 font-semibold">{t('pid')}</th>
                <th className="px-3 py-3 font-semibold">{t('service')}</th>
                <th className="px-3 py-3 font-semibold">{t('connections')}</th>
                <th className="px-4 py-3 font-semibold">{t('remote')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <tr
                  key={rowKey(entry)}
                  className="border-t align-top text-[12.5px] transition-colors hover:bg-[var(--bg-subtle)]"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <td className="px-4 py-3">
                    {entry.pid != null ? (
                      <input
                        type="checkbox"
                        checked={selectedPids.has(entry.pid)}
                        onChange={() => togglePid(entry.pid!)}
                        disabled={killInFlight.has(entry.pid)}
                        aria-label={`${entry.processName ?? entry.pid} (${entry.port})`}
                      />
                    ) : null}
                  </td>
                  <td className="px-3 py-3"><ProtocolBadge protocol={entry.protocol} /></td>
                  <td className="px-3 py-3 font-mono font-semibold text-white">{entry.port}</td>
                  <td className="px-3 py-3">
                    {entry.isListener ? (
                      <span
                        className="rounded-md px-1.5 py-0.5 text-[10px] font-bold"
                        style={{ background: 'rgba(34,197,94,0.12)', color: '#4ade80' }}
                      >
                        {t('listenerBadge')}
                      </span>
                    ) : (
                      <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        {entry.state}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div className="font-medium text-white">{entry.processName || t('unknown')}</div>
                    {entry.command && (
                      <div className="mt-0.5 max-w-[340px] truncate font-mono text-[10.5px]" style={{ color: 'var(--text-muted)' }} title={entry.command}>
                        {entry.command}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    {entry.pid != null ? (
                      <span className="inline-flex items-center gap-1.5">
                        {entry.pid}
                        {entry.killRequiresAdmin && (
                          <span title={t('adminTooltip')} className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-bold" style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>
                            <Zap className="h-2.5 w-2.5" />
                            {t('adminBadge')}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span title={t('kernelRow')}>{t('noPid')}</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {entry.serviceName ? (
                      <span className="rounded-md px-1.5 py-0.5 font-mono text-[10.5px]" style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-muted)' }}>
                        {entry.serviceName}
                      </span>
                    ) : (
                      <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    {entry.connectionCount}
                  </td>
                  <td className="px-4 py-3">
                    {entry.remoteSummary.length > 0 ? (
                      <div className="flex max-w-[280px] flex-wrap gap-1">
                        {entry.remoteSummary.map((peer) => (
                          <span
                            key={peer}
                            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-mono text-[10px]"
                            style={{ background: 'var(--bg-subtle)', color: 'var(--text-muted)' }}
                          >
                            <Globe className="h-2.5 w-2.5" />
                            {peer}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={showConfirm}
        onConfirm={handleKill}
        onCancel={() => setShowConfirm(false)}
        title={t('confirmKillTitle', { count: selectedEntries.length })}
        description={selectedEntries.some((e) => e.killRequiresAdmin)
          ? `${t('confirmKillDescription')} ${t('confirmAdminWarning')}`
          : t('confirmKillDescription')}
        confirmLabel={t('confirmKillLabel')}
        variant="danger"
        details={selectedEntries
          .slice(0, 5)
          .map((e) => `${e.protocol.toUpperCase()} ${e.port} · ${e.processName ?? e.pid}`)
          .join(' · ')}
      />
    </div>
  )
}
