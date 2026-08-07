import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  Wifi,
  WifiOff,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Lock,
  Unlock,
  RefreshCw,
  Loader2,
  Globe,
  Network,
  EyeOff,
  Signal,
  SignalHigh,
  SignalMedium,
  SignalLow,
  Router,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { useNetworkSecurityStore } from '@/stores/network-security-store'
import type { NetworkSecurityStatus, WifiSecurityLevel } from '@shared/types'

const SECURITY_META: Record<WifiSecurityLevel | 'none', { color: string; bg: string; icon: typeof Lock }> = {
  secured: { color: '#22c55e', bg: 'rgba(34,197,94,0.10)', icon: Lock },
  weak: { color: '#f59e0b', bg: 'rgba(245,158,11,0.10)', icon: ShieldAlert },
  open: { color: '#ef4444', bg: 'rgba(239,68,68,0.10)', icon: Unlock },
  unknown: { color: 'var(--text-muted)', bg: 'var(--bg-subtle-2)', icon: ShieldX },
  none: { color: 'var(--text-muted)', bg: 'var(--bg-subtle-2)', icon: WifiOff },
}

function SignalIcon({ percent }: { percent: number | null }) {
  if (percent == null) return <Signal className="h-4 w-4" style={{ color: 'var(--text-faint)' }} strokeWidth={1.8} />
  if (percent >= 75) return <SignalHigh className="h-4 w-4 text-emerald-400" strokeWidth={1.8} />
  if (percent >= 45) return <SignalMedium className="h-4 w-4 text-amber-400" strokeWidth={1.8} />
  return <SignalLow className="h-4 w-4 text-red-400" strokeWidth={1.8} />
}

function SecurityBadge({ level }: { level: WifiSecurityLevel | 'none' }) {
  const { t } = useTranslation('networkSecurity')
  const meta = SECURITY_META[level] ?? SECURITY_META.unknown
  const Icon = meta.icon
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
      style={{ background: meta.bg, color: meta.color }}
    >
      <Icon className="h-3 w-3" strokeWidth={2} />
      {t(`level.${level}`)}
    </span>
  )
}

export function NetworkSecurityPage() {
  const { t } = useTranslation('networkSecurity')
  const status = useNetworkSecurityStore((s) => s.status)
  const scanning = useNetworkSecurityStore((s) => s.scanning)
  const error = useNetworkSecurityStore((s) => s.error)
  const hasScanned = useNetworkSecurityStore((s) => s.hasScanned)
  const scan = useNetworkSecurityStore((s) => s.scan)
  const requestLocation = useNetworkSecurityStore((s) => s.requestLocation)

  const [granting, setGranting] = useState(false)

  useEffect(() => {
    if (!hasScanned) void scan()
  }, [hasScanned, scan])

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

  const wifi = status?.wifi

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-6 py-8">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        action={
          <button
            onClick={() => void scan()}
            disabled={scanning}
            className="flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-medium text-white transition-all disabled:opacity-60"
            style={{ background: 'var(--accent)' }}
          >
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" strokeWidth={1.8} />}
            {t('scanButton')}
          </button>
        }
      />

      {error && <ErrorAlert message={error} onDismiss={() => useNetworkSecurityStore.setState({ error: null })} />}

      {status && isWifiRedacted(status) && (
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
            {granting ? <Loader2 className="h-4 w-4 animate-spin" /> : <EyeOff className="h-4 w-4" strokeWidth={1.8} />}
            {t('locationGrantButton')}
          </button>
        </div>
      )}

      {!status && !error && (
        <EmptyState icon={Wifi} title={t('emptyTitle')} description={t('emptyDesc')} />
      )}

      {status && (
        <div className="flex flex-col gap-5">
          {/* ── WiFi connection ─────────────────────────── */}
          <div className="glass-card rounded-2xl p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                <Wifi className="h-4 w-4" strokeWidth={1.8} />
                {t('wifiSection')}
              </h3>
              {wifi?.connected && (
                <SecurityBadge level={wifi.securitySummary} />
              )}
            </div>

            {!wifi?.connected ? (
              <div className="flex items-center gap-3 rounded-xl px-4 py-4" style={{ background: 'var(--bg-subtle)' }}>
                <WifiOff className="h-5 w-5" style={{ color: 'var(--text-faint)' }} strokeWidth={1.8} />
                <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>{t('noWifi')}</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <InfoCell
                  label={t('ssid')}
                  value={
                    wifi.connected.ssidRedacted ? (
                      <span className="inline-flex items-center gap-1.5 text-amber-400">
                        <EyeOff className="h-3.5 w-3.5" strokeWidth={1.8} />
                        {t('redactedSsid')}
                      </span>
                    ) : (
                      wifi.connected.ssid ?? '—'
                    )
                  }
                />
                <InfoCell
                  label={t('signal')}
                  value={
                    <span className="flex items-center gap-2">
                      <SignalIcon percent={wifi.connected.signalPercent} />
                      {wifi.connected.signalPercent != null ? `${wifi.connected.signalPercent}%` : '—'}
                    </span>
                  }
                />
                <InfoCell label={t('bssid')} value={wifi.connected.bssid ?? '—'} />
                <InfoCell label={t('band')} value={wifi.connected.band ?? '—'} />
                <InfoCell label={t('channel')} value={wifi.connected.channel != null ? String(wifi.connected.channel) : '—'} />
                <InfoCell label={t('frequency')} value={wifi.connected.frequency != null ? `${wifi.connected.frequency} MHz` : '—'} />
                <InfoCell label={t('encryption')} value={wifi.connected.security ?? '—'} />
                <InfoCell label={t('txRate')} value={wifi.connected.txRate != null ? `${wifi.connected.txRate} Mbps` : '—'} />
              </div>
            )}
          </div>

          {/* ── Risk summary ───────────────────────────── */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard
              icon={wifi?.securitySummary === 'open' ? ShieldX : ShieldCheck}
              label={t('statWifiSecurity')}
              value={t(`level.${wifi?.securitySummary ?? 'none'}`)}
              color={wifi?.securitySummary === 'secured' ? '#22c55e' : wifi?.securitySummary === 'none' ? 'var(--text-faint)' : '#ef4444'}
            />
            <StatCard
              icon={wifi?.connected ? ShieldCheck : ShieldAlert}
              label={t('statConnection')}
              value={wifi?.connected ? t('connected') : t('disconnected')}
              color={wifi?.connected ? '#22c55e' : '#f59e0b'}
            />
            <StatCard
              icon={EyeOff}
              label={t('statVpn')}
              value={status.vpn.detected ? t('vpnActive') : t('vpnNone')}
              color={status.vpn.detected ? '#22c55e' : 'var(--text-muted)'}
            />
            <StatCard
              icon={Globe}
              label={t('statIp')}
              value={status.ipv4 ?? '—'}
              color="var(--text-muted)"
            />
          </div>

          {/* ── Nearby networks ────────────────────────── */}
          <div className="glass-card rounded-2xl p-5">
            <h3 className="mb-4 flex items-center gap-2 text-[12px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              <Network className="h-4 w-4" strokeWidth={1.8} />
              {t('nearbySection')}
              <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-muted)' }}>
                {wifi?.nearby.length ?? 0}
              </span>
            </h3>
            {!wifi?.nearby.length ? (
              <p className="py-3 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>{t('nearbyEmpty')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {wifi.nearby.map((net) => {
                  const meta = SECURITY_META[net.securityLevel] ?? SECURITY_META.unknown
                  return (
                    <li
                      key={net.bssid || `${net.ssid}-${net.channel}`}
                      className="flex items-center gap-3 rounded-xl px-4 py-3"
                      style={{ background: 'var(--bg-subtle)' }}
                    >
                      <SignalIcon percent={net.signalDbm != null ? pctFromDbm(net.signalDbm) : net.quality} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-zinc-200">
                          {net.ssid ?? (
                            <span className="inline-flex items-center gap-1.5 text-amber-400">
                              <EyeOff className="h-3.5 w-3.5" strokeWidth={1.8} />
                              {t('redactedSsid')}
                            </span>
                          )}
                        </p>
                        <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                          {net.band ?? ''}
                          {net.channel != null ? ` · Ch ${net.channel}` : ''}
                          {net.frequency != null ? ` · ${net.frequency} MHz` : ''}
                          {net.bssid ? ` · ${net.bssid}` : ''}
                          {net.security.length ? ` · ${net.security.join(', ')}` : ''}
                        </p>
                      </div>
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                        style={{ background: meta.bg, color: meta.color }}
                      >
                        <meta.icon className="h-3 w-3" strokeWidth={2} />
                        {t(`level.${net.securityLevel}`)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* ── Interfaces ─────────────────────────────── */}
          <div className="glass-card rounded-2xl p-5">
            <h3 className="mb-4 flex items-center gap-2 text-[12px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              <Network className="h-4 w-4" strokeWidth={1.8} />
              {t('interfacesSection')}
            </h3>
            {!status.interfaces.length ? (
              <p className="py-3 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>{t('interfacesEmpty')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr style={{ color: 'var(--text-faint)' }}>
                      <th className="pb-2 pr-4 font-medium">{t('colInterface')}</th>
                      <th className="pb-2 pr-4 font-medium">{t('colType')}</th>
                      <th className="pb-2 pr-4 font-medium">{t('colIpv4')}</th>
                      <th className="pb-2 pr-4 font-medium">{t('colIpv6')}</th>
                      <th className="pb-2 font-medium">{t('colMac')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.interfaces.map((iface) => (
                      <tr key={iface.iface} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                        <td className="py-2 pr-4 font-medium text-zinc-200">
                          {iface.iface}
                          {iface.virtual && (
                            <span className="ml-2 rounded px-1.5 py-0.5 text-[10px]" style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-muted)' }}>
                              {t('tagVirtual')}
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-4" style={{ color: 'var(--text-muted)' }}>{t(`ifaceType.${iface.type}`)}</td>
                        <td className="py-2 pr-4 font-mono text-[12px]" style={{ color: 'var(--text-muted)' }}>{iface.ip4 ?? '—'}</td>
                        <td className="py-2 pr-4 font-mono text-[12px]" style={{ color: 'var(--text-muted)' }}>{iface.ip6 ?? '—'}</td>
                        <td className="py-2 font-mono text-[12px]" style={{ color: 'var(--text-muted)' }}>{iface.mac ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── VPN + gateway footer ───────────────────── */}
          <div className="grid grid-cols-2 gap-4">
            <div className="glass-card rounded-2xl p-5">
              <h3 className="mb-3 flex items-center gap-2 text-[12px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                <EyeOff className="h-4 w-4" strokeWidth={1.8} />
                {t('vpnSection')}
              </h3>
              {status.vpn.detected ? (
                <div>
                  <p className="flex items-center gap-2 text-[13px] font-medium text-emerald-400">
                    <ShieldCheck className="h-4 w-4" /> {t('vpnActive')}
                  </p>
                  <p className="mt-1 font-mono text-[11px]" style={{ color: 'var(--text-faint)' }}>
                    {status.vpn.interfaces.join(', ')}
                  </p>
                </div>
              ) : (
                <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>{t('vpnNone')}</p>
              )}
            </div>
            <div className="glass-card rounded-2xl p-5">
              <h3 className="mb-3 flex items-center gap-2 text-[12px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                <Router className="h-4 w-4" strokeWidth={1.8} />
                {t('gatewaySection')}
              </h3>
              <p className="font-mono text-[13px] text-zinc-200">{status.gateway ?? '—'}</p>
              {status.ipv6 && (
                <p className="mt-1 font-mono text-[11px]" style={{ color: 'var(--text-faint)' }}>
                  {t('ipv6Label')}: {status.ipv6}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function pctFromDbm(dbm: number): number {
  const clamped = Math.max(-90, Math.min(-30, dbm))
  return Math.round(((clamped + 90) / 60) * 100)
}

function isWifiRedacted(status: NetworkSecurityStatus): boolean {
  return !!status.wifi.connected?.ssidRedacted || status.wifi.nearby.some((n) => n.ssidRedacted)
}

function InfoCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl px-4 py-3" style={{ background: 'var(--bg-subtle)' }}>
      <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{label}</p>
      <p className="mt-1 text-[13px] font-medium text-zinc-200">{value}</p>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, color }: { icon: typeof ShieldCheck; label: string; value: string; color: string }) {
  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4" strokeWidth={1.8} style={{ color }} />
        <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>{label}</p>
      </div>
      <p className="mt-2 truncate text-[15px] font-semibold text-zinc-100">{value}</p>
    </div>
  )
}
