import { useMemo } from 'react'
import { Network } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { NetworkInterfaceInfo, NetworkSecurityStatus } from '@shared/types'

/**
 * Network interfaces table — one of the three things the old
 * "WiFi & Network Security" page had that the Wi-Fi scanner did not, so it moves
 * onto the merged Wi-Fi tab intact. Keeps the `networkSecurity` i18n namespace
 * so no locale file has to change.
 *
 * Only interfaces holding an IPv4 address are listed. macOS reports around
 * twenty of them — `anpi*`, `en2`-`en7`, `bridge0`, `awdl0`, `llw0`, four
 * `utun*` — and all but one or two have no IPv4 at all, so the table was mostly
 * rows of em dashes with the useful line buried in them.
 */

/**
 * Does this interface hold a usable IPv4 address?
 *
 * `0.0.0.0` is excluded: systeminformation reports it for an interface that is
 * up but unconfigured, which is the same "no address" case as null, just spelled
 * differently. Exported for tests.
 */
export function hasIpv4(iface: NetworkInterfaceInfo): boolean {
  const ip = iface.ip4?.trim()
  if (!ip) return false
  return ip !== '0.0.0.0'
}

export function InterfacesPanel({ interfaces }: { interfaces: NetworkSecurityStatus['interfaces'] }) {
  const { t } = useTranslation('networkSecurity')
  const shown = useMemo(() => interfaces.filter(hasIpv4), [interfaces])

  return (
    <div className="glass-card rounded-2xl p-5">
      <h3
        className="mb-4 flex items-center gap-2 text-[12px] font-medium uppercase tracking-wider"
        style={{ color: 'var(--text-muted)' }}
      >
        <Network className="h-4 w-4" strokeWidth={1.8} />
        {t('interfacesSection')}
      </h3>
      {!shown.length ? (
        <p className="py-3 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
          {t('interfacesEmpty')}
        </p>
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
              {shown.map((iface) => (
                <tr key={iface.iface} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <td className="py-2 pr-4 font-medium text-zinc-200">
                    {iface.iface}
                    {iface.virtual && (
                      <span
                        className="ml-2 rounded px-1.5 py-0.5 text-[10px]"
                        style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-muted)' }}
                      >
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
  )
}
