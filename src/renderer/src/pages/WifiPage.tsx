import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  ArrowDown,
  ArrowUp,
  BadgeCheck,
  Download,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  MonitorSmartphone,
  RefreshCw,
  ShieldAlert,
  ShieldX,
  Signal,
  SignalHigh,
  SignalLow,
  SignalMedium,
  Unlock,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { toast } from 'sonner'
import { Area, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { cn } from '@/lib/utils'
import { useWifiStore, type WifiSortBy } from '@/stores/wifi-store'
import { signalBucket, wifiNetworkKey, type WifiSignalBucket } from '@shared/wifi'
import type { WifiExportPayload, WifiNetworkDetail, WifiSecurityLevel } from '@shared/types'

const SECURITY_META: Record<WifiSecurityLevel, { color: string; bg: string; icon: typeof Lock }> = {
  secured: { color: '#22c55e', bg: 'rgba(34,197,94,0.10)', icon: Lock },
  weak: { color: '#f59e0b', bg: 'rgba(245,158,11,0.10)', icon: ShieldAlert },
  open: { color: '#ef4444', bg: 'rgba(239,68,68,0.10)', icon: Unlock },
  unknown: { color: 'var(--text-muted)', bg: 'var(--bg-subtle-2)', icon: ShieldX },
}

/** Netfox's four signal buckets: weak → excellent, red → green. */
const BUCKET_COLOR: Record<WifiSignalBucket, string> = {
  excellent: '#22c55e',
  good: '#a3e635',
  fair: '#f59e0b',
  weak: '#ef4444',
  unknown: 'var(--text-faint)',
}

const BUCKET_ICON: Record<WifiSignalBucket, typeof Signal> = {
  excellent: SignalHigh,
  good: SignalHigh,
  fair: SignalMedium,
  weak: SignalLow,
  unknown: Signal,
}

function SignalIcon({ signalDbm }: { signalDbm: number | null }) {
  const bucket = signalBucket(signalDbm)
  const Icon = BUCKET_ICON[bucket]
  return <Icon className="h-4 w-4" strokeWidth={1.8} style={{ color: BUCKET_COLOR[bucket] }} />
}

function SecurityIcon({ level }: { level: WifiSecurityLevel }) {
  const meta = SECURITY_META[level] ?? SECURITY_META.unknown
  const Icon = meta.icon
  return <Icon className="h-3.5 w-3.5" strokeWidth={2} style={{ color: meta.color }} />
}

function InfoRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b py-2 last:border-b-0" style={{ borderColor: 'var(--border-default)' }}>
      <span className="shrink-0 text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>
        {label}
      </span>
      <span className={cn('min-w-0 break-words text-right text-[12.5px] font-medium text-zinc-200', mono && 'font-mono')}>
        {value}
      </span>
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl px-3 py-2.5" style={{ background: 'var(--bg-subtle)' }}>
      <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{label}</p>
      <p className="mt-0.5 font-mono text-[15px] font-semibold" style={{ color: tone ?? 'var(--text-primary)' }}>{value}</p>
    </div>
  )
}

const SORT_OPTIONS: Array<{ id: WifiSortBy; labelKey: string }> = [
  { id: 'signal', labelKey: 'sortSignal' },
  { id: 'name', labelKey: 'sortName' },
  { id: 'channel', labelKey: 'sortChannel' },
  { id: 'security', labelKey: 'sortSecurity' },
]

const SECURITY_RANK: Record<WifiSecurityLevel, number> = { open: 0, weak: 1, unknown: 2, secured: 3 }

function relativeSeconds(ts: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (secs < 60) return t('lastSeenSeconds', { count: secs })
  const mins = Math.round(secs / 60)
  return t('lastSeenMinutes', { count: mins })
}

/** Stable per-network mask index so `Network #3` stays #3 between polls. */
function maskName(key: string, order: string[]): string {
  const idx = order.indexOf(key)
  return `Network #${idx >= 0 ? idx + 1 : order.length + 1}`
}

function maskBssid(bssid: string): string {
  const parts = bssid.split(':')
  if (parts.length !== 6) return '••:••:••:••:••:••'
  return `${parts.slice(0, 3).join(':')}:••:••:••`
}

export function WifiPage() {
  const { t } = useTranslation('wifi')
  const navigate = useNavigate()
  const snapshot = useWifiStore((s) => s.snapshot)
  const detailedScanning = useWifiStore((s) => s.detailedScanning)
  const error = useWifiStore((s) => s.error)
  const hasScanned = useWifiStore((s) => s.hasScanned)
  const selectedKey = useWifiStore((s) => s.selectedKey)
  const samples = useWifiStore((s) => s.samples)
  const sortBy = useWifiStore((s) => s.sortBy)
  const sortDir = useWifiStore((s) => s.sortDir)
  const demoMode = useWifiStore((s) => s.demoMode)
  const detailedScan = useWifiStore((s) => s.detailedScan)
  const setSelected = useWifiStore((s) => s.setSelected)
  const setSort = useWifiStore((s) => s.setSort)
  const toggleDemoMode = useWifiStore((s) => s.toggleDemoMode)
  const requestLocation = useWifiStore((s) => s.requestLocation)
  const start = useWifiStore((s) => s.start)
  const stop = useWifiStore((s) => s.stop)

  const [granting, setGranting] = useState(false)

  useEffect(() => {
    if (!hasScanned) void detailedScan()
    start()
    return () => stop()
  }, [hasScanned, detailedScan, start, stop])

  const networks = useMemo(() => snapshot?.networks ?? [], [snapshot])

  // Mask order is by first appearance so the label survives re-sorts.
  const maskOrder = useMemo(() => networks.map((n) => wifiNetworkKey(n)).sort(), [networks])

  const displayName = (n: WifiNetworkDetail): string => {
    if (demoMode) return maskName(wifiNetworkKey(n), maskOrder)
    return n.ssid ?? t('hiddenSsid')
  }
  const displayBssid = (n: WifiNetworkDetail): string => {
    if (!n.bssid) return t('bssidUnavailable')
    return demoMode ? maskBssid(n.bssid) : n.bssid
  }

  const sorted = useMemo(() => {
    const list = [...networks]
    const dir = sortDir === 'asc' ? 1 : -1
    list.sort((a, b) => {
      if (sortBy === 'signal') return ((a.signalDbm ?? -Infinity) - (b.signalDbm ?? -Infinity)) * dir
      if (sortBy === 'channel') return ((a.channel ?? 0) - (b.channel ?? 0)) * dir
      if (sortBy === 'security') {
        const diff = SECURITY_RANK[a.securityLevel] - SECURITY_RANK[b.securityLevel]
        return diff !== 0 ? diff * dir : (a.ssid ?? '').localeCompare(b.ssid ?? '')
      }
      return (a.ssid ?? '￿').localeCompare(b.ssid ?? '￿') * dir
    })
    return list
  }, [networks, sortBy, sortDir])

  const selected = useMemo(
    () => networks.find((n) => wifiNetworkKey(n) === selectedKey) ?? null,
    [networks, selectedKey],
  )

  const selectedSamples = useMemo(() => (selectedKey ? samples[selectedKey] ?? [] : []), [samples, selectedKey])
  const chartData = useMemo(() => {
    const base = selectedSamples[0]?.t ?? 0
    return selectedSamples.map((s) => ({
      t: Math.round((s.t - base) / 1000),
      signal: s.signalDbm,
      noise: s.noiseDbm,
    }))
  }, [selectedSamples])
  const hasNoise = useMemo(() => chartData.some((d) => d.noise != null), [chartData])

  const grantAccess = async () => {
    setGranting(true)
    try {
      const outcome = await requestLocation()
      if (outcome === 'granted') toast.success(t('locationGranted'))
      else if (outcome === 'settings') toast.info(t('locationOpenSettingsHint'))
      else toast.error(t('locationDenied'))
    } finally {
      setGranting(false)
    }
  }

  const handleExport = async () => {
    if (!snapshot) return
    const connected = snapshot.networks.find((n) => n.isConnected) ?? null
    const payload: WifiExportPayload = {
      exportedAt: Date.now(),
      generatedBy: 'Clarity',
      connected,
      networks: snapshot.networks,
      samples,
    }
    const path = await window.clarity.wifiExport(payload)
    if (path) toast.success(t('exportedTo'))
    else toast.error(t('exportFailed'))
  }

  const handleExportSelected = async () => {
    if (!selected) return
    const key = wifiNetworkKey(selected)
    const payload: WifiExportPayload = {
      exportedAt: Date.now(),
      generatedBy: 'Clarity',
      connected: selected.isConnected ? selected : null,
      networks: [selected],
      samples: { [key]: samples[key] ?? [] },
    }
    const path = await window.clarity.wifiExport(payload)
    if (path) toast.success(t('exportedTo'))
    else toast.error(t('exportFailed'))
  }

  const showLocationBanner = snapshot?.bssidHidden === true
  const noRadio = snapshot != null && !snapshot.supported
  const radioOff = snapshot != null && snapshot.supported && !snapshot.powerOn

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-8">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={toggleDemoMode}
              title={t('demoModeHint')}
              className="flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium transition-all"
              style={
                demoMode
                  ? { background: 'rgba(245,158,11,0.14)', color: '#fbbf24' }
                  : { border: '1px solid var(--border-strong)', color: 'var(--text-muted)' }
              }
            >
              {demoMode ? <EyeOff className="h-4 w-4" strokeWidth={1.8} /> : <Eye className="h-4 w-4" strokeWidth={1.8} />}
              {t('demoMode')}
            </button>
            <button
              onClick={() => void detailedScan()}
              disabled={detailedScanning}
              className="flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-medium text-white transition-all disabled:opacity-60"
              style={{ background: 'var(--accent)' }}
            >
              {detailedScanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" strokeWidth={1.8} />}
              {detailedScanning ? t('scanningTitle') : t('rescanButton')}
            </button>
            <button
              onClick={() => void handleExport()}
              disabled={!snapshot}
              className="flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-medium transition-all disabled:opacity-40"
              style={{ border: '1px solid var(--border-strong)', color: 'var(--text-primary)' }}
            >
              <Download className="h-4 w-4" strokeWidth={1.8} />
              {t('exportButton')}
            </button>
          </div>
        }
      />

      {error && <ErrorAlert message={error} onDismiss={() => useWifiStore.setState({ error: null })} />}

      {showLocationBanner && (
        <div className="glass-card flex flex-col gap-3 rounded-2xl p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: 'rgba(245,158,11,0.12)' }}>
              <EyeOff className="h-4 w-4 text-amber-400" strokeWidth={1.8} />
            </div>
            <div>
              <p className="text-[13px] font-medium text-zinc-100">{t('locationBannerTitle')}</p>
              <p className="mt-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>{t('locationBannerBody')}</p>
              <p className="mt-1 text-[11px]" style={{ color: 'var(--text-faint)' }}>{t('locationOpenSettings')}</p>
            </div>
          </div>
          <button
            onClick={() => void grantAccess()}
            disabled={granting}
            className="flex shrink-0 items-center justify-center gap-2 rounded-xl px-4 py-2 text-[13px] font-medium text-white transition-all disabled:opacity-60"
            style={{ background: 'var(--accent)' }}
          >
            {granting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" strokeWidth={1.8} />}
            {t('locationGrantButton')}
          </button>
        </div>
      )}

      {noRadio && <EmptyState icon={WifiOff} title={t('noRadioTitle')} description={t('noRadioDesc')} />}
      {radioOff && <EmptyState icon={WifiOff} title={t('radioOffTitle')} description={t('radioOffDesc')} />}

      {!snapshot && !error && <EmptyState icon={Wifi} title={t('emptyTitle')} description={t('emptyDesc')} />}

      {snapshot && snapshot.supported && (
        <div className="flex flex-col gap-5 lg:flex-row">
          {/* ── Network list ───────────────────────────── */}
          <div className="glass-card min-w-0 flex-1 rounded-2xl p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[12px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                {t('listCount', { count: networks.length })}
              </p>
              <div className="flex items-center gap-1.5">
                <div className="flex rounded-lg p-0.5" style={{ background: 'var(--bg-subtle-2)' }}>
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setSort(opt.id, sortBy === opt.id ? (sortDir === 'asc' ? 'desc' : 'asc') : 'desc')}
                      className="flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
                      style={
                        sortBy === opt.id
                          ? { background: 'var(--bg-subtle)', color: 'var(--text-primary)' }
                          : { color: 'var(--text-faint)' }
                      }
                    >
                      {t(opt.labelKey)}
                      {sortBy === opt.id &&
                        (sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {sorted.length === 0 ? (
              <p className="py-6 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>{t('emptyDesc')}</p>
            ) : (
              <div className="flex max-h-[70vh] flex-col gap-1.5 overflow-y-auto pr-1">
                {sorted.map((network) => {
                  const key = wifiNetworkKey(network)
                  const isActive = key === selectedKey
                  const subtitleParts: string[] = []
                  subtitleParts.push(network.securityShort ?? t('unknownValue'))
                  if (network.channel != null) {
                    subtitleParts.push(
                      network.band
                        ? `${t('channelAbbrev')} ${network.channel} (${network.band})`
                        : `${t('channelAbbrev')} ${network.channel}`,
                    )
                  }
                  // For a hidden network the AP maker is the only thing telling
                  // one `Hidden network` row from the next.
                  if (network.isHidden && network.vendor && !demoMode) subtitleParts.push(network.vendor)
                  return (
                    <button
                      key={key}
                      onClick={() => setSelected(key)}
                      className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors')}
                      style={
                        isActive
                          ? { background: 'var(--bg-subtle)', boxShadow: 'inset 0 0 0 1px var(--border-strong)' }
                          : undefined
                      }
                    >
                      <span className="flex shrink-0 items-center gap-1.5">
                        <SecurityIcon level={network.securityLevel} />
                        <SignalIcon signalDbm={network.signalDbm} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 truncate text-[13px] font-medium text-zinc-100">
                          <span className={cn('truncate', network.isHidden && !demoMode && 'italic text-zinc-400')}>
                            {displayName(network)}
                          </span>
                          {network.isConnected && (
                            <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-emerald-400" strokeWidth={2.2} />
                          )}
                        </p>
                        <p className="truncate text-[11px]" style={{ color: 'var(--text-faint)' }}>
                          {subtitleParts.join(' · ')}
                        </p>
                      </div>
                      <span
                        className="w-16 shrink-0 text-right font-mono text-[12px] tabular-nums"
                        style={{ color: BUCKET_COLOR[signalBucket(network.signalDbm)] }}
                      >
                        {network.signalDbm != null ? `${network.signalDbm} dBm` : '—'}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* ── Detail pane ────────────────────────────── */}
          <div className="w-full shrink-0 lg:w-[420px]">
            {selected ? (
              <div className="flex flex-col gap-4">
                {/* Header */}
                <div className="glass-card rounded-2xl p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="flex items-center gap-2 text-[17px] font-semibold text-zinc-100">
                        <span className={cn('truncate', selected.isHidden && !demoMode && 'italic text-zinc-300')}>
                          {displayName(selected)}
                        </span>
                        {selected.isConnected && (
                          <span className="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold text-emerald-400" style={{ background: 'rgba(34,197,94,0.10)' }}>
                            <BadgeCheck className="h-3 w-3" strokeWidth={2.5} />
                            {t('connectedBadge')}
                          </span>
                        )}
                      </h3>
                      <p className="mt-1 truncate text-[12px]" style={{ color: 'var(--text-faint)' }}>
                        {relativeSeconds(selected.lastSeen, t)}
                      </p>
                    </div>
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                      style={{ background: (SECURITY_META[selected.securityLevel] ?? SECURITY_META.unknown).bg }}
                    >
                      <SignalIcon signalDbm={selected.signalDbm} />
                    </div>
                  </div>

                  {selected.signalPercent != null && (
                    <div className="mt-4">
                      <div className="h-1.5 w-full rounded-full" style={{ background: 'var(--bg-subtle-2)' }}>
                        <div
                          className="h-1.5 rounded-full transition-all"
                          style={{
                            width: `${selected.signalPercent}%`,
                            background: BUCKET_COLOR[signalBucket(selected.signalDbm)],
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Signal Overview */}
                <div className="rounded-2xl p-5" style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}>
                  <p className="mb-3 text-[12px] font-semibold text-zinc-400">{t('signalOverviewTitle')}</p>
                  {chartData.length < 2 ? (
                    <div className="flex h-32 items-center justify-center">
                      <p className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-faint)' }}>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t('signalChartNoData')}
                      </p>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={150}>
                      <ComposedChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                        <defs>
                          <linearGradient id="wifiSignalFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#22c55e" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="t" hide />
                        <YAxis hide domain={['dataMin - 5', 'dataMax + 5']} />
                        <Tooltip
                          contentStyle={{
                            background: '#1e1e24',
                            border: '1px solid var(--border-strong)',
                            borderRadius: '10px',
                            fontSize: '12px',
                            color: 'var(--text-primary)',
                          }}
                          labelFormatter={(v) => `${v}s`}
                          formatter={(val, name) => [
                            `${Number(val).toFixed(0)} dBm`,
                            name === 'signal' ? t('signalChartSignal') : t('signalChartNoise'),
                          ]}
                        />
                        <Area
                          type="monotone"
                          dataKey="signal"
                          stroke="#22c55e"
                          strokeWidth={1.6}
                          fill="url(#wifiSignalFill)"
                          isAnimationActive={false}
                          name="signal"
                          connectNulls
                        />
                        {hasNoise && (
                          <Line
                            type="monotone"
                            dataKey="noise"
                            stroke="#64748b"
                            strokeWidth={1.2}
                            strokeDasharray="3 3"
                            dot={false}
                            isAnimationActive={false}
                            name="noise"
                            connectNulls
                          />
                        )}
                      </ComposedChart>
                    </ResponsiveContainer>
                  )}
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <Metric
                      label={t('statCurrentRssi')}
                      value={selected.signalDbm != null ? `${selected.signalDbm}` : '—'}
                      tone={BUCKET_COLOR[signalBucket(selected.signalDbm)]}
                    />
                    <Metric label={t('statNoise')} value={selected.noiseDbm != null ? `${selected.noiseDbm}` : '—'} />
                    <Metric label={t('statSnr')} value={selected.snrDbm != null ? `${selected.snrDbm}` : '—'} />
                  </div>
                </div>

                {/* Network Information */}
                <div className="rounded-2xl p-5" style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}>
                  <p className="mb-1 text-[12px] font-semibold text-zinc-400">{t('networkInfoTitle')}</p>
                  <InfoRow
                    label={t('statSsid')}
                    value={selected.isHidden && !demoMode ? t('hiddenSsid') : displayName(selected)}
                  />
                  <InfoRow label={t('statBssid')} value={displayBssid(selected)} mono />
                  <InfoRow label={t('statVendor')} value={selected.vendor ?? t('vendorUnknown')} />
                  <InfoRow label={t('statChannel')} value={selected.channel != null ? String(selected.channel) : t('unknownValue')} />
                  <InfoRow label={t('statBand')} value={selected.band ?? t('unknownValue')} />
                  <InfoRow label={t('statWidth')} value={selected.channelWidthMhz != null ? `${selected.channelWidthMhz} MHz` : t('unknownValue')} />
                  <InfoRow label={t('statFrequency')} value={selected.frequency != null ? `${selected.frequency} MHz` : t('unknownValue')} mono />
                  <InfoRow
                    label={t('statSecurity')}
                    value={selected.securityLabel ?? (selected.securityLevel === 'open' ? t('noSecurity') : t('unknownValue'))}
                  />
                  <InfoRow label={t('statCountry')} value={selected.countryCode ?? t('unknownCountry')} />
                  <InfoRow
                    label={t('statBeacon')}
                    value={selected.beaconIntervalMs != null ? `${selected.beaconIntervalMs} ms` : t('unknownValue')}
                  />
                  <InfoRow label={t('statType')} value={t(`networkType.${selected.networkType}`)} />
                  <InfoRow label={t('statPhy')} value={selected.phyModes.length ? selected.phyModes.join(', ') : t('unknownValue')} mono />
                  {selected.txRateMbps != null && (
                    <InfoRow label={t('statTxRate')} value={`${selected.txRateMbps} Mbit/s`} mono />
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => void handleExportSelected()}
                    className="flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-[13px] font-medium transition-all"
                    style={{ border: '1px solid var(--border-strong)', color: 'var(--text-primary)' }}
                  >
                    <Download className="h-4 w-4" strokeWidth={1.8} />
                    {t('exportNetworkButton')}
                  </button>
                  {selected.isConnected && (
                    <button
                      onClick={() => navigate('/devices')}
                      className="flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-[13px] font-medium text-white transition-all"
                      style={{ background: 'var(--accent)' }}
                    >
                      <MonitorSmartphone className="h-4 w-4" strokeWidth={1.8} />
                      {t('viewDevicesButton')}
                    </button>
                  )}
                </div>

                {selected.isHidden && (
                  <p className="rounded-xl px-4 py-3 text-[11.5px] leading-relaxed" style={{ background: 'var(--bg-subtle)', color: 'var(--text-muted)' }}>
                    {t('hiddenExplainer')}
                  </p>
                )}
              </div>
            ) : (
              <EmptyState icon={WifiOff} title={t('detailEmpty')} description={t('emptyDesc')} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
