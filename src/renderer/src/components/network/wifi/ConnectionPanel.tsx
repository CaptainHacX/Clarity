import { Cloud, CloudOff, EyeOff, Globe, Router, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { NetworkSecurityStatus } from '@shared/types'

/**
 * Link-level posture: the risk stat cards, VPN state, gateway and IPv6.
 *
 * These are the parts of the old "WiFi & Network Security" page the Wi-Fi
 * scanner never covered. Its connected-Wi-Fi grid and nearby-networks list are
 * deliberately *not* here — the scanner already renders every field they showed
 * and more (vendor, channel width, country code, beacon interval, PHY modes), so
 * reproducing them would be duplicate UI over the same data.
 */
export function ConnectionPanel({ status }: { status: NetworkSecurityStatus }) {
  const { t } = useTranslation('networkSecurity')
  const wifi = status.wifi
  const level = wifi?.securitySummary ?? 'none'

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <StatCard
          icon={level === 'open' ? ShieldX : ShieldCheck}
          label={t('statWifiSecurity')}
          value={t(`level.${level}`)}
          color={level === 'secured' ? '#22c55e' : level === 'none' ? 'var(--text-faint)' : '#ef4444'}
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
        {/* Two addresses, deliberately adjacent and distinctly labelled: the
            local one (`colIpv4` — 192.168.x.x on any normal LAN) and the
            internet-facing one (`statIp`). Conflating them is what made the old
            single card read "Public IPv4" over a private address. */}
        <StatCard icon={Globe} label={t('colIpv4')} value={status.ipv4 ?? '—'} color="var(--text-muted)" />
        <PublicIpCard publicIp={status.publicIp} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="glass-card rounded-2xl p-5">
          <h3
            className="mb-3 flex items-center gap-2 text-[12px] font-medium uppercase tracking-wider"
            style={{ color: 'var(--text-muted)' }}
          >
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
          <h3
            className="mb-3 flex items-center gap-2 text-[12px] font-medium uppercase tracking-wider"
            style={{ color: 'var(--text-muted)' }}
          >
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
  )
}

/**
 * The internet-facing address.
 *
 * Three states, because "no address" has two very different meanings and
 * showing an em dash for both would hide which one applies:
 *  - `ok`       the address, in the same mono treatment as the local IPv4
 *  - `offline`  no internet path — reuses the already-translated
 *               "Disconnected", so nothing new needs translating
 *  - `unknown`  the lookup has not finished yet
 *
 * Unlike every other card here this one depends on an outbound request, so it is
 * the only value on the page that can be unavailable while the machine itself is
 * perfectly healthy. The amber struck-through cloud carries that distinction
 * without needing a new string in 30 locales.
 */
function PublicIpCard({ publicIp }: { publicIp: NetworkSecurityStatus['publicIp'] }) {
  const { t } = useTranslation('networkSecurity')

  const offline = publicIp.state === 'offline'
  const pending = publicIp.state === 'unknown'
  const value = publicIp.state === 'ok' && publicIp.address
    ? publicIp.address
    : offline
      ? t('disconnected')
      : '—'

  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="flex items-center gap-2">
        {offline ? (
          <CloudOff className="h-4 w-4" strokeWidth={1.8} style={{ color: '#f59e0b' }} />
        ) : (
          <Cloud className="h-4 w-4" strokeWidth={1.8} style={{ color: pending ? 'var(--text-faint)' : '#22c55e' }} />
        )}
        <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>{t('statIp')}</p>
      </div>
      <p
        className="mt-2 truncate text-[15px] font-semibold"
        style={{ color: offline || pending ? 'var(--text-muted)' : 'var(--text-primary)' }}
      >
        {value}
      </p>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, color }: {
  icon: typeof ShieldCheck
  label: string
  value: string
  color: string
}) {
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
