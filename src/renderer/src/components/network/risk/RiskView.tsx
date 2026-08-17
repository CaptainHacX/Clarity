import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Activity,
  Cable,
  Clock,
  Info,
  Loader2,
  RefreshCw,
  Search,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Trash2,
} from 'lucide-react'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { cn } from '@/lib/utils'
import { useSecurityStore } from '@/stores/security-store'
import { deviceDisplayName, isPrivateMac } from '@shared/devices'
import type { CatalogProbeState, DeviceSecurityResult, SecuritySeverity } from '@shared/types'

/**
 * Per-device security risk — the former standalone Security page, now the "Risk"
 * view of the Devices tab.
 *
 * It always was a second lens on the same device set: it shares `devices-store`
 * data, and its "open ports" button already jumped to the Devices page and
 * switched that page's detail tab. Being in the same page turns that jump into
 * `onOpenInventory`, so the two views no longer navigate at each other.
 *
 * Keeps the `security` i18n namespace, so no locale file changes.
 */

const SEVERITY_META: Record<SecuritySeverity, { color: string; bg: string; icon: typeof ShieldAlert }> = {
  high: { color: '#ef4444', bg: 'rgba(239,68,68,0.12)', icon: ShieldAlert },
  medium: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', icon: Shield },
  low: { color: '#22c55e', bg: 'rgba(34,197,94,0.12)', icon: ShieldCheck },
  untested: { color: 'var(--text-faint)', bg: 'var(--bg-subtle-2)', icon: ShieldX },
}

const PORT_STATE_COLOR: Record<CatalogProbeState['state'], string> = {
  open: '#22c55e',
  closed: '#64748b',
  filtered: '#f59e0b',
}

function relativeTime(ts: number | null): string {
  if (ts == null) return ''
  const diff = Date.now() - ts
  const s = Math.round(diff / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.round(h / 24)
  return `${d}d`
}

function severityTier(severity: SecuritySeverity): number {
  return severity === 'high' ? 3 : severity === 'medium' ? 2 : severity === 'low' ? 1 : 0
}

/**
 * The label a device leads with: a name the user gave it, then the one it
 * reports, then *vendor · kind · services* — so a row reads
 * "Netgear · Router · Web service" instead of the bare word "Unknown".
 */
function deviceLabel(device: DeviceSecurityResult, kindLabels: Record<string, string>, fallback: string): string {
  return deviceDisplayName(
    {
      tagName: device.tagName,
      hostname: device.hostname,
      vendor: device.vendor,
      kind: device.kind,
      serviceTypes: device.serviceTypes ?? [],
      mac: device.mac,
      ipv4: device.ip ? [device.ip] : [],
    },
    kindLabels,
    fallback,
  )
}

export function RiskView({ onOpenInventory }: { onOpenInventory: (deviceId: string) => void }) {
  const { t } = useTranslation('security')
  const snapshot = useSecurityStore((s) => s.snapshot)
  const scanning = useSecurityStore((s) => s.scanning)
  const probing = useSecurityStore((s) => s.probing)
  const error = useSecurityStore((s) => s.error)
  const selectedId = useSecurityStore((s) => s.selectedId)
  const view = useSecurityStore((s) => s.view)
  const scanAll = useSecurityStore((s) => s.scanAll)
  const scanDevice = useSecurityStore((s) => s.scanDevice)
  const setSelected = useSecurityStore((s) => s.setSelected)
  const setView = useSecurityStore((s) => s.setView)
  const reset = useSecurityStore((s) => s.reset)
  const start = useSecurityStore((s) => s.start)
  const stop = useSecurityStore((s) => s.stop)
  const [query, setQuery] = useState('')

  useEffect(() => {
    void (async () => {
      if (!snapshot) await scanAll()
    })()
    start()
    return () => stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, stop])

  const kindLabels = t('kind', { returnObjects: true }) as Record<string, string>
  const unknownLabel = t('deviceUnknown')
  const devices = useMemo(() => snapshot?.devices ?? [], [snapshot])
  const job = snapshot?.job

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase()
    return [...devices]
      .sort((a, b) => {
        if (a.online !== b.online) return a.online ? -1 : 1
        const tDiff = severityTier(b.severity) - severityTier(a.severity)
        if (tDiff !== 0) return tDiff
        return deviceLabel(a, kindLabels, unknownLabel).localeCompare(deviceLabel(b, kindLabels, unknownLabel))
      })
      .filter((d) => {
        if (!q) return true
        return (
          (d.hostname ?? '').toLowerCase().includes(q) ||
          d.ip.includes(q) ||
          (d.mac ?? '').toLowerCase().includes(q) ||
          deviceLabel(d, kindLabels, unknownLabel).toLowerCase().includes(q)
        )
      })
  }, [devices, query, kindLabels, unknownLabel])

  const selected = useMemo(() => devices.find((d) => d.deviceId === selectedId) ?? null, [devices, selectedId])

  const byService = useMemo(() => {
    const map = new Map<
      number,
      { service: string; port: number; risk: CatalogProbeState['risk']; category: string; devices: string[]; atRisk: number; custom: boolean }
    >()
    for (const d of devices) {
      for (const p of d.catalog) {
        if (p.state !== 'open') continue
        const entry = map.get(p.port)
        const label = deviceLabel(d, kindLabels, unknownLabel)
        const risky = d.severity === 'high' || d.severity === 'medium'
        if (entry) {
          if (!entry.devices.includes(label)) {
            entry.devices.push(label)
            if (risky) entry.atRisk += 1
          }
        } else {
          map.set(p.port, {
            service: p.service,
            port: p.port,
            risk: p.risk,
            category: p.category ?? 'custom',
            devices: [label],
            atRisk: risky ? 1 : 0,
            custom: p.custom ?? false,
          })
        }
      }
    }
    const riskTier = { high: 2, medium: 1, none: 0 } as const
    return [...map.values()].sort((a, b) => riskTier[b.risk] - riskTier[a.risk] || a.port - b.port)
  }, [devices, kindLabels, unknownLabel])

  const counts = useMemo(() => {
    const high = devices.filter((d) => d.severity === 'high').length
    const medium = devices.filter((d) => d.severity === 'medium').length
    const low = devices.filter((d) => d.severity === 'low').length
    const untested = devices.filter((d) => d.severity === 'untested').length
    return { high, medium, low, untested }
  }, [devices])

  const hasResults = devices.length > 0
  const scannedSomething = devices.some((d) => d.lastScannedAt != null)

  // The hero leads with the most important thing.
  const hero = counts.high > 0
    ? { title: t('heroHigh', { count: counts.high }), tone: '#ef4444', bg: 'rgba(239,68,68,0.10)', Icon: ShieldAlert }
    : counts.medium > 0
      ? { title: t('heroMedium', { count: counts.medium }), tone: '#f59e0b', bg: 'rgba(245,158,11,0.10)', Icon: Shield }
      : scannedSomething
        ? { title: t('heroClear'), tone: '#22c55e', bg: 'rgba(34,197,94,0.10)', Icon: ShieldCheck }
        : { title: t('heroFirstScan'), tone: 'var(--text-muted)', bg: 'var(--bg-subtle-2)', Icon: ShieldX }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* Actions — the page header owns the title and the view switcher, so the
          risk-specific scan controls live with the risk content. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          onClick={() => void reset()}
          className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-semibold transition-colors hover:bg-red-500/10"
          style={{ color: 'var(--text-muted)' }}
        >
          <Trash2 className="h-4 w-4" /> {t('reset')}
        </button>
        <button
          onClick={() => void scanAll()}
          disabled={scanning}
          className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ background: 'var(--accent)' }}
        >
          {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {scanning ? t('scanning') : scannedSomething ? t('rescanAllButton') : t('scanAllButton')}
        </button>
      </div>

      {error && <ErrorAlert message={error} />}

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl px-5 py-4" style={{ background: hero.bg }}>
        <div className="flex items-center gap-3">
          <hero.Icon className="h-6 w-6" style={{ color: hero.tone }} strokeWidth={1.8} />
          <div>
            <p className="text-[15px] font-semibold text-zinc-100">{hero.title}</p>
            <p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>{t('scanAllHint')}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <SeverityPill color="#ef4444" label={t('highRisk')} count={counts.high} />
          <SeverityPill color="#f59e0b" label={t('mediumRisk')} count={counts.medium} />
          <SeverityPill color="#22c55e" label={t('lowRisk')} count={counts.low} />
          <SeverityPill color="var(--text-faint)" label={t('untested')} count={counts.untested} />
          {scanning && (
            <span className="flex items-center gap-1.5 text-zinc-300">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {job?.state === 'running' ? t('jobScanning', { checked: job.checked, total: job.total }) : t('scanning')}
            </span>
          )}
          {!scanning && job?.state === 'done' && (
            <span className="flex items-center gap-1.5 text-emerald-400">
              <Activity className="h-3.5 w-3.5" /> {t('jobDone')}
            </span>
          )}
        </div>
      </div>

      {!hasResults && !scanning && (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState title={t('emptyTitle')} description={t('emptyDesc')} icon={ShieldX} />
        </div>
      )}

      {hasResults && (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setView('device')}
                className={cn('rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors', view === 'device' && 'text-white')}
                style={view === 'device' ? { background: 'var(--accent)' } : { background: 'var(--bg-subtle)', color: 'var(--text-muted)' }}
              >
                {t('byDevice')}
              </button>
              <button
                onClick={() => setView('service')}
                className={cn('rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors', view === 'service' && 'text-white')}
                style={view === 'service' ? { background: 'var(--accent)' } : { background: 'var(--bg-subtle)', color: 'var(--text-muted)' }}
              >
                {t('byService')}
              </button>
            </div>

            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('searchPlaceholder')}
                aria-label={t('searchPlaceholder')}
                className="w-52 rounded-lg py-1.5 pl-8 pr-3 text-[12px] outline-none"
                style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-primary)' }}
              />
            </div>
          </div>

          {view === 'device' ? (
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(300px,360px)_1fr]">
              <div className="min-h-0 overflow-y-auto rounded-xl p-1" style={{ background: 'var(--bg-subtle-2)' }}>
                {sorted.map((d) => {
                  const meta = SEVERITY_META[d.severity]
                  const Icon = meta.icon
                  const active = d.deviceId === selectedId
                  const isProbing = probing.includes(d.ip)
                  return (
                    <div
                      key={d.deviceId}
                      className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2.5', active ? 'bg-white/10' : 'hover:bg-white/5')}
                    >
                      <button onClick={() => setSelected(d.deviceId)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                        <span
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                          style={{ background: meta.bg, color: meta.color }}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-[13px] font-semibold text-zinc-100">
                              {deviceLabel(d, kindLabels, unknownLabel)}
                            </span>
                            {d.online && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />}
                          </span>
                          <span className="mt-0.5 block truncate font-mono text-[11px]" style={{ color: 'var(--text-faint)' }}>
                            {d.ip || t('noAddress')}
                            {d.lastScannedAt ? ` · ${t('lastScanned', { time: relativeTime(d.lastScannedAt) })}` : ''}
                          </span>
                        </span>
                      </button>
                      {d.severity === 'untested' && d.online && d.ip ? (
                        <button
                          onClick={() => void scanDevice(d.ip)}
                          disabled={isProbing}
                          className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold transition-colors disabled:opacity-50"
                          style={{ background: 'var(--accent)', color: '#fff' }}
                        >
                          {isProbing ? <Loader2 className="h-3 w-3 animate-spin" /> : t('probeRow')}
                        </button>
                      ) : (
                        <span
                          className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold"
                          style={{ background: meta.bg, color: meta.color }}
                        >
                          {t(`severity.${d.severity}`)}
                        </span>
                      )}
                    </div>
                  )
                })}
                {sorted.length === 0 && (
                  <p className="px-3 py-6 text-center text-[12px]" style={{ color: 'var(--text-faint)' }}>{t('emptyTitle')}</p>
                )}
              </div>

              <div className="min-h-0 overflow-y-auto rounded-xl p-4" style={{ background: 'var(--bg-subtle-2)' }}>
                {selected ? (
                  <DeviceRiskDetail
                    device={selected}
                    kindLabels={kindLabels}
                    unknownLabel={unknownLabel}
                    onOpenInventory={() => onOpenInventory(selected.deviceId)}
                  />
                ) : (
                  <EmptyState title={t('detailEmpty')} description={t('detailEmptyDesc')} icon={Shield} />
                )}
              </div>
            </div>
          ) : (
            <div className="min-h-0 overflow-y-auto rounded-xl p-1" style={{ background: 'var(--bg-subtle-2)' }}>
              {byService.length === 0 ? (
                <p className="px-3 py-6 text-center text-[12px]" style={{ color: 'var(--text-faint)' }}>{t('openPortsEmpty')}</p>
              ) : (
                <table className="w-full text-left text-[12px]">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>
                      <th className="px-3 py-2 font-semibold">{t('portColumn')}</th>
                      <th className="px-3 py-2 font-semibold">{t('serviceColumn')}</th>
                      <th className="px-3 py-2 font-semibold">{t('categoryColumn')}</th>
                      <th className="px-3 py-2 font-semibold">{t('riskColumn')}</th>
                      <th className="px-3 py-2 font-semibold">{t('exposedOnColumn')}</th>
                      <th className="px-3 py-2 font-semibold">{t('byDeviceCol')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byService.map((row) => (
                      <tr key={row.port} className="border-t border-white/5">
                        <td className="px-3 py-2 font-mono text-zinc-200">{row.port}</td>
                        <td className="px-3 py-2 text-zinc-200">{row.service}</td>
                        <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }}>{t(`category.${row.category}`)}</td>
                        <td className="px-3 py-2">
                          <span
                            className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                            style={{
                              background: row.risk === 'high' ? 'rgba(239,68,68,0.12)' : row.risk === 'medium' ? 'rgba(245,158,11,0.12)' : 'var(--bg-subtle)',
                              color: row.risk === 'high' ? '#f87171' : row.risk === 'medium' ? '#fbbf24' : 'var(--text-muted)',
                            }}
                          >
                            {row.risk === 'high' ? t('highRisk') : row.risk === 'medium' ? t('mediumRisk') : t('noRisk')}
                          </span>
                        </td>
                        <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--text-muted)' }}>
                          {t('exposedOnValue', { devices: row.devices.length, atRisk: row.atRisk })}
                        </td>
                        <td className="px-3 py-2 text-zinc-300">{row.devices.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SeverityPill({ color, label, count }: { color: string; label: string; count: number }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1" style={{ background: 'var(--bg-subtle)' }}>
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      <span className="tabular-nums font-semibold" style={{ color: 'var(--text-primary)' }}>{count}</span>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
    </span>
  )
}

function DeviceRiskDetail({ device, kindLabels, unknownLabel, onOpenInventory }: {
  device: DeviceSecurityResult
  kindLabels: Record<string, string>
  unknownLabel: string
  onOpenInventory: () => void
}) {
  const { t } = useTranslation('security')
  const probing = useSecurityStore((s) => s.probing)
  const scanDevice = useSecurityStore((s) => s.scanDevice)
  const meta = SEVERITY_META[device.severity]
  const Icon = meta.icon
  const openPorts = device.catalog.filter((p) => p.state === 'open')
  const isProbing = probing.includes(device.ip)

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold text-zinc-100">
            {deviceLabel(device, kindLabels, unknownLabel)}
          </h2>
          <p className="mt-0.5 font-mono text-[12px]" style={{ color: 'var(--text-faint)' }}>
            {device.ip || t('noAddress')}
          </p>
        </div>
        <span
          className="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold"
          style={{ background: meta.bg, color: meta.color }}
        >
          <Icon className="h-3.5 w-3.5" />
          {t(`severity.${device.severity}`)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1" style={{ background: 'var(--bg-subtle)', color: 'var(--text-muted)' }}>
          <Server className="h-3 w-3" />
          {t(`kind.${device.kind}`)}
        </span>
        <span className="rounded-full px-2.5 py-1" style={{ background: 'var(--bg-subtle)', color: 'var(--text-muted)' }}>
          {device.vendor ?? (isPrivateMac(device.mac) ? t('privateAddress') : t('vendorUnknown'))}
        </span>
        {device.online ? (
          <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1" style={{ background: 'rgba(34,197,94,0.12)', color: '#34d399' }}>
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> {t('onlineBadge')}
          </span>
        ) : (
          <span className="rounded-full px-2.5 py-1" style={{ background: 'var(--bg-subtle)', color: 'var(--text-faint)' }}>
            {t('offlineBadge')}
          </span>
        )}
        <span className="flex items-center gap-1 rounded-full px-2.5 py-1" style={{ background: 'var(--bg-subtle)', color: 'var(--text-muted)' }}>
          <Clock className="h-3 w-3" />
          {device.lastScannedAt ? t('lastScanned', { time: relativeTime(device.lastScannedAt) }) : t('neverScanned')}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => void scanDevice(device.ip)}
          disabled={!device.ip || !device.online || isProbing}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          style={{ background: 'var(--accent)' }}
        >
          {isProbing ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldAlert className="h-3 w-3" />}
          {isProbing ? t('scanning') : t('probeRow')}
        </button>
        <button
          onClick={onOpenInventory}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-medium transition-all"
          style={{ border: '1px solid var(--border-strong)', color: 'var(--text-primary)' }}
        >
          <Cable className="h-3 w-3" />
          {t('openPortsTab')}
        </button>
      </div>

      {/* Risk inspector */}
      <div>
        <div className="mb-1.5 flex items-center gap-1.5">
          <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
          <h3 className="text-[12px] font-semibold text-zinc-200">{t('riskInspectorTitle')}</h3>
        </div>
        <p className="mb-2 text-[11px]" style={{ color: 'var(--text-faint)' }}>{t('riskInspectorDesc')}</p>
        {device.severity === 'untested' ? (
          <div className="rounded-lg px-3 py-2.5 text-[12px]" style={{ background: 'var(--bg-subtle)', color: 'var(--text-muted)' }}>
            {t('untestedHint')}
          </div>
        ) : device.findings.length === 0 ? (
          <div className="rounded-lg px-3 py-2.5 text-[12px]" style={{ background: 'rgba(34,197,94,0.08)', color: '#34d399' }}>
            {t('findingsEmpty')}
          </div>
        ) : (
          <div className="space-y-2">
            {device.findings.map((f, i) => (
              <div
                key={`${f.port}-${i}`}
                className="rounded-lg px-3 py-2.5"
                style={{ background: SEVERITY_META[f.risk === 'high' ? 'high' : f.risk === 'medium' ? 'medium' : 'low'].bg }}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[12px] font-semibold text-zinc-100">{f.title}</p>
                  <span
                    className="shrink-0 font-mono text-[10px] font-bold"
                    style={{ color: SEVERITY_META[f.risk === 'high' ? 'high' : f.risk === 'medium' ? 'medium' : 'low'].color }}
                  >
                    {f.port}/{f.service}
                  </span>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>{f.explanation}</p>
                <p className="mt-1 flex items-start gap-1 text-[11px] leading-relaxed" style={{ color: '#a1a1aa' }}>
                  <Info className="mt-0.5 h-3 w-3 shrink-0" /> {f.advice}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Open ports */}
      <div>
        <div className="mb-1.5 flex items-center gap-1.5">
          <Cable className="h-3.5 w-3.5 text-emerald-400" />
          <h3 className="text-[12px] font-semibold text-zinc-200">{t('openPortsTitle')}</h3>
        </div>
        {openPorts.length === 0 ? (
          <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>{t('openPortsEmpty')}</p>
        ) : (
          <div className="overflow-hidden rounded-lg ring-1 ring-white/10">
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="bg-black/30 text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>
                  <th className="px-3 py-1.5 font-semibold">{t('portColumn')}</th>
                  <th className="px-3 py-1.5 font-semibold">{t('serviceColumn')}</th>
                  <th className="px-3 py-1.5 font-semibold">{t('categoryColumn')}</th>
                  <th className="px-3 py-1.5 font-semibold">{t('stateColumn')}</th>
                </tr>
              </thead>
              <tbody>
                {openPorts.map((p) => (
                  <tr key={p.port} className="border-t border-white/5">
                    <td className="px-3 py-1.5 font-mono text-zinc-200">{p.port}</td>
                    <td className="flex items-center gap-1.5 px-3 py-1.5 text-zinc-200">
                      {p.service}
                      {p.risk !== 'none' && (
                        <ShieldAlert
                          className="h-3 w-3"
                          strokeWidth={2.2}
                          style={{ color: p.risk === 'high' ? '#f87171' : '#fbbf24' }}
                        />
                      )}
                    </td>
                    <td className="px-3 py-1.5" style={{ color: 'var(--text-muted)' }}>{t(`category.${p.category}`)}</td>
                    <td className="px-3 py-1.5">
                      <span className="flex items-center gap-1.5 font-semibold" style={{ color: PORT_STATE_COLOR[p.state] }}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: PORT_STATE_COLOR[p.state] }} />
                        {t(`state${p.state.charAt(0).toUpperCase()}${p.state.slice(1)}`)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[11px] leading-relaxed" style={{ color: 'var(--text-faint)' }}>{t('fullScanPointer')}</p>
      </div>
    </div>
  )
}
