import { useMemo } from 'react'
import { Server } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { LocalListener, PortEntry } from '@shared/types'

/**
 * "What on this machine is reachable from the network, and what is only
 * reachable from this machine" — relocated here from the Devices page, where it
 * sat as a device-detail tab and duplicated what the port table already knew.
 *
 * The grouping is derived from the port scan rather than from a devices scan.
 * `PortEntry` is strictly richer than the `LocalListener` this used to read
 * (protocol, state, service name, connection count on top of port/pid/process),
 * and deriving it here means the panel costs nothing extra — no LAN sweep just to
 * list local sockets.
 *
 * The one thing `PortEntry` lacks is hosts-file names, so those are folded in
 * from a devices snapshot when one already exists. Nothing triggers a scan to
 * get them; absent a snapshot the rows simply render without that line.
 */

/** Addresses that mean "this machine only". */
function isLoopbackAddress(address: string): boolean {
  if (!address) return false
  const addr = address.toLowerCase()
  return addr === '127.0.0.1' || addr === '::1' || addr.startsWith('127.') || addr === 'localhost'
}

export interface LocalServiceRow {
  port: number
  protocol: 'tcp' | 'udp'
  process: string | null
  pid: number | null
  loopbackOnly: boolean
  hostNames: string[]
}

/**
 * Fold listening sockets into one row per port, tagging each as loopback-only or
 * network-reachable.
 *
 * A port bound on both 127.0.0.1 and 0.0.0.0 is reachable — the widest binding
 * wins, because that is the one that decides exposure. Exported for tests.
 */
export function buildLocalServiceRows(
  ports: PortEntry[],
  listeners: LocalListener[] = [],
): LocalServiceRow[] {
  const hostNamesByPort = new Map<number, string[]>()
  for (const l of listeners) {
    if (l.hostNames.length > 0) hostNamesByPort.set(l.port, l.hostNames)
  }

  const byKey = new Map<string, LocalServiceRow>()
  for (const entry of ports) {
    if (!entry.isListener) continue
    const key = `${entry.protocol}:${entry.port}`
    const loopback = isLoopbackAddress(entry.localAddress)
    const existing = byKey.get(key)
    if (existing) {
      // Reachable beats loopback-only: the widest binding is the real exposure.
      if (!loopback) existing.loopbackOnly = false
      if (!existing.process && entry.processName) existing.process = entry.processName
      continue
    }
    byKey.set(key, {
      port: entry.port,
      protocol: entry.protocol,
      process: entry.processName,
      pid: entry.pid,
      loopbackOnly: loopback,
      hostNames: hostNamesByPort.get(entry.port) ?? [],
    })
  }

  return [...byKey.values()].sort((a, b) => a.port - b.port || a.protocol.localeCompare(b.protocol))
}

export function LocalServicesPanel({ ports, listeners, demoMode = false }: {
  ports: PortEntry[]
  listeners?: LocalListener[]
  demoMode?: boolean
}) {
  const { t } = useTranslation('devices')
  const rows = useMemo(() => buildLocalServiceRows(ports, listeners), [ports, listeners])
  const loopback = rows.filter((r) => r.loopbackOnly)
  const reachable = rows.filter((r) => !r.loopbackOnly)

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Group
        title={t('localOnlyTitle')}
        hint={t('localOnlyHint')}
        rows={loopback}
        demoMode={demoMode}
        emptyLabel={t('localServicesEmpty')}
        unknownLabel={t('unknownValue')}
        maskedLabel={t('maskedValue')}
      />
      <Group
        title={t('localReachableTitle')}
        hint={t('localReachableHint')}
        rows={reachable}
        demoMode={demoMode}
        emptyLabel={t('localServicesEmpty')}
        unknownLabel={t('unknownValue')}
        maskedLabel={t('maskedValue')}
      />
    </div>
  )
}

function Group({ title, hint, rows, demoMode, emptyLabel, unknownLabel, maskedLabel }: {
  title: string
  hint: string
  rows: LocalServiceRow[]
  demoMode: boolean
  emptyLabel: string
  unknownLabel: string
  maskedLabel: string
}) {
  return (
    <div className="glass-card rounded-2xl p-5">
      <h3
        className="mb-2 flex items-center gap-2 text-[12px] font-medium uppercase tracking-wider"
        style={{ color: 'var(--text-muted)' }}
      >
        <Server className="h-4 w-4" strokeWidth={1.8} />
        {title}
        <span
          className="rounded-full px-2 py-0.5 text-[10px]"
          style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-muted)' }}
        >
          {rows.length}
        </span>
      </h3>
      <p className="mb-2 text-[11px] leading-relaxed" style={{ color: 'var(--text-faint)' }}>{hint}</p>
      {rows.length === 0 ? (
        <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>{emptyLabel}</p>
      ) : (
        <div className="flex flex-col gap-1">
          {rows.map((row) => (
            <div
              key={`${row.protocol}:${row.port}`}
              className="flex items-center justify-between gap-2 rounded-lg px-3 py-1.5"
              style={{ background: 'var(--bg-subtle)' }}
            >
              <div className="min-w-0">
                <p className="truncate text-[12px] text-zinc-200">
                  {demoMode ? maskedLabel : row.process ?? unknownLabel}
                  {!demoMode && row.pid != null && (
                    <span className="ml-1.5 text-[10px]" style={{ color: 'var(--text-faint)' }}>PID {row.pid}</span>
                  )}
                </p>
                {!demoMode && row.hostNames.length > 0 && (
                  <p className="truncate text-[10px]" style={{ color: 'var(--text-faint)' }}>
                    {row.hostNames.slice(0, 3).map((h) => `${h}:${row.port}`).join(' · ')}
                  </p>
                )}
              </div>
              <span className="flex shrink-0 items-center gap-1.5">
                <span
                  className="rounded px-1 py-0.5 font-mono text-[9px] font-semibold uppercase"
                  style={{
                    background: row.protocol === 'tcp' ? 'rgba(59,130,246,0.12)' : 'rgba(168,85,247,0.12)',
                    color: row.protocol === 'tcp' ? '#60a5fa' : '#c084fc',
                  }}
                >
                  {row.protocol}
                </span>
                <span className="font-mono text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
                  {row.port}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
