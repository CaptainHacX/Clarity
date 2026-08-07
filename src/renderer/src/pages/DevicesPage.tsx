import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  Bell,
  BellOff,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Clock,
  Cpu,
  Download,
  Eye,
  EyeOff,
  Globe,
  HelpCircle,
  Loader2,
  Lock,
  Monitor,
  MonitorSmartphone,
  Play,
  Printer,
  Radar,
  RadioTower,
  RefreshCw,
  Router,
  Search,
  Server,
  ShieldAlert,
  Speaker,
  Square,
  Tablet,
  Tag,
  Trash2,
  Tv,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { cn } from '@/lib/utils'
import { useDevicesStore, type DeviceDetailTab, type DeviceStatusFilter } from '@/stores/devices-store'
import { useSecurityStore } from '@/stores/security-store'
import { deviceDisplayName, deviceIdentityLine, isPrivateMac, serviceNames } from '@shared/devices'
import type {
  CatalogProbeState,
  DeviceKind,
  DeviceObservation,
  DevicePortState,
  DeviceSecurityResult,
  DeviceSource,
  DevicesSnapshot,
  LocalListener,
  NetworkDevice,
  PortCategory,
  ServiceInspection,
} from '@shared/types'

const KIND_ICON: Record<DeviceKind, typeof Monitor> = {
  computer: Monitor,
  phone: MonitorSmartphone,
  tablet: Tablet,
  speaker: Speaker,
  tv: Tv,
  printer: Printer,
  router: Router,
  media: Clapperboard,
  camera: Camera,
  iot: Cpu,
  unknown: HelpCircle,
}

const KIND_KEYS: DeviceKind[] = [
  'computer', 'phone', 'tablet', 'speaker', 'tv', 'printer',
  'router', 'media', 'camera', 'iot', 'unknown',
]

const SOURCE_LABELS: Record<DeviceSource, string> = {
  arp: 'ARP cache',
  bonjour: 'mDNS (Bonjour)',
  ssdp: 'SSDP',
  netbios: 'NetBIOS',
  icmp: 'Ping',
}

const PORT_STATE_COLOR: Record<DevicePortState, string> = {
  open: '#22c55e',
  closed: '#64748b',
  filtered: '#f59e0b',
}

const CATEGORY_ORDER: PortCategory[] = [
  'remote-access', 'file-sharing', 'web-iot', 'database', 'media', 'dev', 'discovery', 'custom',
]

const WEB_PORTS = new Set([80, 443, 591, 3000, 4200, 5000, 5173, 8000, 8008, 8080, 8081, 8123, 8443, 8888, 9000, 10443, 32400])

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const s = Math.round(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return `${d}d ago`
}

/** Demo Mode: MACs keep their vendor OUI, IPv6 keeps only its first hextet. */
function maskMac(mac: string | null): string | null {
  if (!mac) return null
  const parts = mac.split(':')
  if (parts.length !== 6) return '••:••:••:••:••:••'
  return `${parts.slice(0, 3).join(':')}:••:••:••`
}

function maskIpv6(addr: string): string {
  const head = addr.split(':')[0] ?? ''
  return `${head}:••••:••••`
}

function InfoCell({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="rounded-xl px-4 py-3" style={{ background: 'var(--bg-subtle)' }}>
      <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{label}</p>
      <div className={cn('mt-1 break-words text-[13px] font-medium text-zinc-200', mono && 'font-mono')}>{value}</div>
    </div>
  )
}

function RoleBadge({ label, active }: { label: string; active: boolean }) {
  if (!active) return null
  return (
    <span
      className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ background: 'rgba(34,197,94,0.10)', color: '#34d399' }}
    >
      <Check className="h-2.5 w-2.5" strokeWidth={3} />
      {label}
    </span>
  )
}

function SectionCard({ title, icon: Icon, action, children }: {
  title: string
  icon?: typeof Server
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl p-5" style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[12px] font-semibold text-zinc-400">
          {Icon && <Icon className="h-3.5 w-3.5" strokeWidth={2} />}
          {title}
        </p>
        {action}
      </div>
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────

export function DevicesPage() {
  const { t } = useTranslation('devices')
  const snapshot = useDevicesStore((s) => s.snapshot)
  const scanning = useDevicesStore((s) => s.scanning)
  const error = useDevicesStore((s) => s.error)
  const hasScanned = useDevicesStore((s) => s.hasScanned)
  const selectedId = useDevicesStore((s) => s.selectedId)
  const query = useDevicesStore((s) => s.query)
  const statusFilter = useDevicesStore((s) => s.statusFilter)
  const demoMode = useDevicesStore((s) => s.demoMode)
  const history = useDevicesStore((s) => s.history)
  const alertsSeenAt = useDevicesStore((s) => s.alertsSeenAt)
  const manualScan = useDevicesStore((s) => s.manualScan)
  const setSelected = useDevicesStore((s) => s.setSelected)
  const setQuery = useDevicesStore((s) => s.setQuery)
  const setStatusFilter = useDevicesStore((s) => s.setStatusFilter)
  const toggleDemoMode = useDevicesStore((s) => s.toggleDemoMode)
  const markAlertsSeen = useDevicesStore((s) => s.markAlertsSeen)
  const reloadHistory = useDevicesStore((s) => s.reloadHistory)
  const start = useDevicesStore((s) => s.start)
  const stop = useDevicesStore((s) => s.stop)

  const securityStart = useSecurityStore((s) => s.start)
  const securityStop = useSecurityStore((s) => s.stop)

  const [alertsOpen, setAlertsOpen] = useState(false)
  const [menu, setMenu] = useState<{ device: NetworkDevice; x: number; y: number } | null>(null)

  useEffect(() => {
    if (!hasScanned) {
      void manualScan()
      void reloadHistory()
    }
    start()
    // The Ports tab reads the Security tool's probe results, so keep them fresh.
    securityStart()
    return () => {
      stop()
      securityStop()
    }
  }, [hasScanned, manualScan, reloadHistory, start, stop, securityStart, securityStop])

  const kindLabels = t('kind', { returnObjects: true }) as Record<string, string>

  const nameOf = useCallback(
    (d: NetworkDevice): string => {
      if (demoMode) {
        const label = kindLabels[d.kind] ?? kindLabels.unknown ?? 'Device'
        return `${label} #${(d.ipv4[0] ?? d.id).split('.').pop() ?? '?'}`
      }
      return deviceDisplayName(
        {
          tagName: d.tag?.name ?? null,
          hostname: d.hostname,
          vendor: d.vendor,
          kind: d.kind,
          serviceTypes: d.services.map((s) => s.type),
          mac: d.mac,
          ipv4: d.ipv4,
          model: d.model,
        },
        kindLabels,
        t('deviceUnknown'),
      )
    },
    [demoMode, kindLabels, t],
  )

  const filtered = useMemo(() => {
    let list = [...(snapshot?.devices ?? [])]
    if (statusFilter !== 'all') {
      list = list.filter((d) => (statusFilter === 'online' ? d.status === 'online' : d.status === 'offline'))
    }
    const q = query.trim().toLowerCase()
    if (q) {
      list = list.filter((d) =>
        [d.tag?.name, d.hostname, d.vendor, d.model, d.mac, ...d.ipv4, ...d.ipv6]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      )
    }
    return list
  }, [snapshot, query, statusFilter])

  const selected = useMemo(
    () => snapshot?.devices.find((d) => d.id === selectedId) ?? null,
    [snapshot, selectedId],
  )

  const counts = useMemo(() => {
    const all = snapshot?.devices ?? []
    return {
      all: all.length,
      online: all.filter((d) => d.status === 'online').length,
      offline: all.filter((d) => d.status === 'offline').length,
    }
  }, [snapshot])

  const unreadAlerts = useMemo(() => history.filter((e) => e.at > alertsSeenAt).length, [history, alertsSeenAt])

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [menu])

  const STATUS_FILTERS: Array<{ id: DeviceStatusFilter; label: string; count: number }> = [
    { id: 'all', label: t('filterAll'), count: counts.all },
    { id: 'online', label: t('online'), count: counts.online },
    { id: 'offline', label: t('offline'), count: counts.offline },
  ]

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-8">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setAlertsOpen((v) => !v)
                if (!alertsOpen) markAlertsSeen()
              }}
              title={t('alertsTitle')}
              className="relative flex h-9 w-9 items-center justify-center rounded-xl transition-colors"
              style={{ border: '1px solid var(--border-strong)', color: 'var(--text-muted)' }}
            >
              <Bell className="h-4 w-4" strokeWidth={1.8} />
              {unreadAlerts > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white" style={{ background: '#ef4444' }}>
                  {unreadAlerts > 99 ? '99+' : unreadAlerts}
                </span>
              )}
            </button>
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
              onClick={() => void manualScan()}
              disabled={scanning}
              className="flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-medium text-white transition-all disabled:opacity-60"
              style={{ background: 'var(--accent)' }}
            >
              {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" strokeWidth={1.8} />}
              {scanning ? t('scanning') : t('rescanButton')}
            </button>
          </div>
        }
      />

      {error && <ErrorAlert message={error} onDismiss={() => useDevicesStore.setState({ error: null })} />}

      {alertsOpen && (
        <AlertsInbox
          events={history.slice(0, 40)}
          onClose={() => setAlertsOpen(false)}
          onClear={() => void useDevicesStore.getState().clearHistory()}
        />
      )}

      {snapshot && <NetworkPanel snapshot={snapshot} demoMode={demoMode} />}

      {!snapshot && !error && (
        <EmptyState icon={Radar} title={t('emptyTitle')} description={t('emptyDesc')} />
      )}

      {snapshot && (
        <div className="flex flex-col gap-5 lg:flex-row">
          {/* ── Device list ───────────────────────────── */}
          <div className="glass-card min-w-0 flex-1 rounded-2xl p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex rounded-lg p-0.5" style={{ background: 'var(--bg-subtle-2)' }}>
                {STATUS_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setStatusFilter(f.id)}
                    className="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
                    style={
                      statusFilter === f.id
                        ? { background: 'var(--bg-subtle)', color: 'var(--text-primary)' }
                        : { color: 'var(--text-faint)' }
                    }
                  >
                    {f.label} <span className="tabular-nums opacity-70">{f.count}</span>
                  </button>
                ))}
              </div>
              <div className="relative w-56">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} strokeWidth={2} aria-hidden="true" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('searchPlaceholder')}
                  className="w-full rounded-lg py-1.5 pl-8 pr-3 text-[12px] outline-none"
                  style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-primary)' }}
                  aria-label={t('searchPlaceholder')}
                />
              </div>
            </div>

            {filtered.length === 0 ? (
              <p className="py-6 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>{t('emptyDesc')}</p>
            ) : (
              <div className="flex max-h-[70vh] flex-col gap-1.5 overflow-y-auto pr-1">
                {filtered.map((device) => (
                  <DeviceRow
                    key={device.id}
                    device={device}
                    label={nameOf(device)}
                    demoMode={demoMode}
                    active={device.id === selectedId}
                    onSelect={() => setSelected(device.id)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setSelected(device.id)
                      setMenu({ device, x: e.clientX, y: e.clientY })
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* ── Detail pane ───────────────────────────── */}
          <div className="w-full shrink-0 lg:w-[460px]">
            {selected ? (
              <DeviceDetail device={selected} label={nameOf(selected)} snapshot={snapshot} demoMode={demoMode} />
            ) : (
              <EmptyState icon={Radar} title={t('detailEmpty')} description={t('detailEmptyDesc')} />
            )}
          </div>
        </div>
      )}

      {menu && <DeviceContextMenu device={menu.device} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Network panel (the lease every device on the LAN shares)
// ─────────────────────────────────────────────────────────────

function NetworkPanel({ snapshot, demoMode }: { snapshot: DevicesSnapshot; demoMode: boolean }) {
  const { t } = useTranslation('devices')
  const host = snapshot.host
  const ctx = snapshot.networkContext

  const cells: Array<{ label: string; value: string }> = [
    { label: t('hostTitle'), value: demoMode ? t('thisDevice') : host.hostname || t('unknownValue') },
    { label: t('ipAddress'), value: host.ipCidr ?? host.ipv4.join(', ') ?? t('unknownValue') },
    { label: t('connection'), value: host.connectionType || t('unknownValue') },
    { label: t('routerLabel'), value: ctx?.router ?? t('unknownValue') },
    { label: t('dnsLabel'), value: ctx?.dnsServers.length ? ctx.dnsServers.join(', ') : t('unknownValue') },
    { label: t('domainLabel'), value: ctx?.domain ?? t('unknownValue') },
    { label: t('dhcpLabel'), value: ctx?.dhcpServer ?? t('unknownValue') },
  ]

  return (
    <div className="glass-card flex flex-col gap-4 rounded-2xl p-5">
      <div className="flex items-center gap-2">
        <Globe className="h-4 w-4" style={{ color: 'var(--text-muted)' }} strokeWidth={1.8} />
        <p className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          {t('networkPanelTitle')}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {cells.map((c) => (
          <div key={c.label}>
            <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{c.label}</p>
            <p className="truncate font-mono text-[12px] text-zinc-300" title={c.value}>{c.value}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{t('providerStatus')}</p>
        {snapshot.providerStatus.map((p) => (
          <span
            key={p.provider}
            title={p.error}
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium"
            style={
              p.ok
                ? { background: 'rgba(34,197,94,0.10)', color: '#34d399' }
                : { background: 'rgba(245,158,11,0.10)', color: '#fbbf24' }
            }
          >
            {p.ok ? <Check className="h-3 w-3" strokeWidth={3} /> : <ShieldAlert className="h-3 w-3" strokeWidth={2} />}
            {SOURCE_LABELS[p.provider]}
          </span>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// List row + context menu
// ─────────────────────────────────────────────────────────────

function DeviceRow({ device, label, demoMode, active, onSelect, onContextMenu }: {
  device: NetworkDevice
  label: string
  demoMode: boolean
  active: boolean
  onSelect: () => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  const { t } = useTranslation('devices')
  const KindIcon = KIND_ICON[device.tag?.kind ?? device.kind] ?? HelpCircle
  const subtitle = [
    device.ipv4.join(', ') || t('unknownValue'),
    device.vendor ?? (isPrivateMac(device.mac) ? t('privateAddress') : null),
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <button
      onClick={onSelect}
      onContextMenu={onContextMenu}
      className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors')}
      style={
        active ? { background: 'var(--bg-subtle)', boxShadow: 'inset 0 0 0 1px var(--border-strong)' } : undefined
      }
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: 'var(--bg-subtle-2)' }}>
        <KindIcon className="h-4 w-4" style={{ color: 'var(--text-muted)' }} strokeWidth={1.8} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 truncate text-[13px] font-medium text-zinc-100">
          <span className="truncate">{label}</span>
          {device.isLocal && (
            <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-amber-300" style={{ background: 'rgba(245,158,11,0.12)' }}>
              {t('thisDevice')}
            </span>
          )}
          {device.tag?.muted && (
            <BellOff className="h-3 w-3 shrink-0" style={{ color: 'var(--text-faint)' }} strokeWidth={2.2} />
          )}
        </span>
        <span className="block truncate text-[11px]" style={{ color: 'var(--text-faint)' }}>
          {demoMode ? t('maskedSubtitle') : subtitle}
        </span>
      </span>
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        title={device.status === 'online' ? t('online') : t('offline')}
        style={{ background: device.status === 'online' ? '#34d399' : 'var(--text-faint)' }}
      />
    </button>
  )
}

function DeviceContextMenu({ device, x, y, onClose }: { device: NetworkDevice; x: number; y: number; onClose: () => void }) {
  const { t } = useTranslation('devices')
  const navigate = useNavigate()
  const probeDevice = useDevicesStore((s) => s.probeDevice)
  const tagDevice = useDevicesStore((s) => s.tagDevice)
  const setDetailTab = useDevicesStore((s) => s.setDetailTab)
  const scanDevice = useSecurityStore((s) => s.scanDevice)
  const ip = device.ipv4[0] ?? null

  const items: Array<{ label: string; icon: typeof Activity; disabled?: boolean; run: () => void }> = [
    {
      label: t('ctxProbeDevice'),
      icon: Activity,
      disabled: !ip,
      run: () => {
        if (ip) void probeDevice(ip).then(() => toast.success(t('probeDone')))
      },
    },
    {
      label: t('ctxProbePorts'),
      icon: ShieldAlert,
      disabled: !ip,
      run: () => {
        if (!ip) return
        setDetailTab('ports')
        void scanDevice(ip).then((ok) => (ok ? toast.success(t('portsProbed')) : toast.error(t('portsProbeFailed'))))
      },
    },
    {
      label: t('ctxEditTag'),
      icon: Tag,
      run: () => setDetailTab('general'),
    },
    {
      label: device.tag?.muted ? t('ctxUnmute') : t('ctxMute'),
      icon: device.tag?.muted ? Bell : BellOff,
      run: () => void tagDevice({ deviceId: device.id, muted: !device.tag?.muted }),
    },
    {
      label: t('ctxRevealWifi'),
      icon: RadioTower,
      run: () => navigate('/wifi'),
    },
  ]

  return (
    <div
      className="fixed z-50 min-w-[210px] overflow-hidden rounded-xl py-1 shadow-2xl"
      style={{
        left: Math.min(x, window.innerWidth - 230),
        top: Math.min(y, window.innerHeight - 220),
        background: 'var(--card-bg)',
        border: '1px solid var(--border-strong)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          disabled={item.disabled}
          onClick={() => {
            item.run()
            onClose()
          }}
          className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12.5px] transition-colors hover:bg-white/5 disabled:opacity-40"
          style={{ color: 'var(--text-primary)' }}
        >
          <item.icon className="h-3.5 w-3.5" strokeWidth={1.8} style={{ color: 'var(--text-muted)' }} />
          {item.label}
        </button>
      ))}
    </div>
  )
}

function AlertsInbox({ events, onClose, onClear }: {
  events: DeviceObservation[]
  onClose: () => void
  onClear: () => void
}) {
  const { t } = useTranslation('devices')
  return (
    <div className="glass-card rounded-2xl p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="flex items-center gap-2 text-[12px] font-semibold text-zinc-300">
          <Bell className="h-3.5 w-3.5" strokeWidth={2} />
          {t('alertsTitle')}
        </p>
        <div className="flex items-center gap-2">
          <button onClick={onClear} className="text-[11px] font-medium" style={{ color: 'var(--text-faint)' }}>
            {t('timelineClear')}
          </button>
          <button onClick={onClose} className="rounded-md p-1 transition-colors hover:bg-white/5">
            <X className="h-3.5 w-3.5" style={{ color: 'var(--text-faint)' }} />
          </button>
        </div>
      </div>
      {events.length === 0 ? (
        <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>{t('alertsEmpty')}</p>
      ) : (
        <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
          {events.map((e) => (
            <div key={e.id} className="flex items-start justify-between gap-3 rounded-lg px-3 py-2" style={{ background: 'var(--bg-subtle)' }}>
              <p className="text-[12px] text-zinc-300">{e.text}</p>
              <p className="shrink-0 text-[10px]" style={{ color: 'var(--text-faint)' }}>{relativeTime(e.at)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Detail panel
// ─────────────────────────────────────────────────────────────

function DeviceDetail({ device, label, snapshot, demoMode }: {
  device: NetworkDevice
  label: string
  snapshot: DevicesSnapshot
  demoMode: boolean
}) {
  const { t } = useTranslation('devices')
  const detailTab = useDevicesStore((s) => s.detailTab)
  const setDetailTab = useDevicesStore((s) => s.setDetailTab)

  const tabs: Array<{ id: DeviceDetailTab; label: string; show: boolean }> = [
    { id: 'general', label: t('tabGeneral'), show: true },
    { id: 'ports', label: t('tabPorts'), show: true },
    { id: 'history', label: t('tabHistory'), show: true },
    { id: 'local', label: t('tabLocalServices'), show: device.isLocal },
  ]
  const visible = tabs.filter((tab) => tab.show)
  const active = visible.some((tab) => tab.id === detailTab) ? detailTab : 'general'

  return (
    <div className="flex flex-col gap-4">
      <div className="glass-card rounded-2xl p-5">
        <DeviceHeader device={device} label={label} />
        <div className="mt-4 flex rounded-lg p-0.5" style={{ background: 'var(--bg-subtle-2)' }}>
          {visible.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setDetailTab(tab.id)}
              className="flex-1 rounded-md px-2 py-1.5 text-[11.5px] font-medium transition-colors"
              style={
                active === tab.id
                  ? { background: 'var(--bg-subtle)', color: 'var(--text-primary)' }
                  : { color: 'var(--text-faint)' }
              }
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {active === 'general' && <GeneralTab device={device} snapshot={snapshot} demoMode={demoMode} />}
      {active === 'ports' && <PortsTab device={device} />}
      {active === 'history' && <HistoryTab device={device} />}
      {active === 'local' && <LocalServicesTab listeners={snapshot.listeners} demoMode={demoMode} />}
    </div>
  )
}

function DeviceHeader({ device, label }: { device: NetworkDevice; label: string }) {
  const { t } = useTranslation('devices')
  const probeDevice = useDevicesStore((s) => s.probeDevice)
  const tagDevice = useDevicesStore((s) => s.tagDevice)
  const [probing, setProbing] = useState(false)
  const KindIcon = KIND_ICON[device.tag?.kind ?? device.kind] ?? HelpCircle
  const primaryIp = device.ipv4[0] ?? null
  const kindLabels = t('kind', { returnObjects: true }) as Record<string, string>
  const identity = deviceIdentityLine(
    { vendor: device.vendor, kind: device.tag?.kind ?? device.kind, serviceTypes: device.services.map((s) => s.type), mac: device.mac },
    kindLabels,
    t('privateAddress'),
  )

  const handleProbe = async (): Promise<void> => {
    if (!primaryIp || probing) return
    setProbing(true)
    try {
      await probeDevice(primaryIp)
      toast.success(t('probeDone'))
    } catch {
      toast.error(t('probeFailed'))
    } finally {
      setProbing(false)
    }
  }

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold text-zinc-100">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: 'var(--bg-subtle)' }}>
            <KindIcon className="h-4 w-4" style={{ color: 'var(--text-muted)' }} strokeWidth={1.8} />
          </span>
          <span className="truncate">{label}</span>
        </h3>
        <p className="mt-1.5 truncate text-[12px]" style={{ color: 'var(--text-faint)' }}>
          {device.ipv4[0] ?? t('unknownValue')}
          {identity && identity !== label ? ` · ${identity}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={() => void tagDevice({ deviceId: device.id, muted: !device.tag?.muted })}
          title={device.tag?.muted ? t('mutedButton') : t('muteButton')}
          className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
          style={device.tag?.muted ? { background: 'rgba(245,158,11,0.12)', color: '#fbbf24' } : { background: 'var(--bg-subtle-2)', color: 'var(--text-faint)' }}
        >
          {device.tag?.muted ? <BellOff className="h-4 w-4" strokeWidth={1.8} /> : <Bell className="h-4 w-4" strokeWidth={1.8} />}
        </button>
        <button
          onClick={() => void handleProbe()}
          disabled={!primaryIp || probing}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium text-white transition-all disabled:opacity-40"
          style={{ background: 'var(--accent)' }}
        >
          {probing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" strokeWidth={2} />}
          {probing ? t('probeProbing') : t('probeButton')}
        </button>
      </div>
    </div>
  )
}

// ─── General ────────────────────────────────────────────────

function GeneralTab({ device, snapshot, demoMode }: { device: NetworkDevice; snapshot: DevicesSnapshot; demoMode: boolean }) {
  const { t } = useTranslation('devices')
  const tagDevice = useDevicesStore((s) => s.tagDevice)
  const clearTag = useDevicesStore((s) => s.clearTag)
  const measureLink = useDevicesStore((s) => s.measureLink)
  const inspections = useDevicesStore((s) => s.inspections)
  const history = useDevicesStore((s) => s.history)
  const setDetailTab = useDevicesStore((s) => s.setDetailTab)

  const [nameDraft, setNameDraft] = useState(device.tag?.name ?? '')
  const [editingName, setEditingName] = useState(false)
  const [measuring, setMeasuring] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)

  useEffect(() => {
    setNameDraft(device.tag?.name ?? '')
    setEditingName(false)
  }, [device.id, device.tag?.name])

  const primaryIp = device.ipv4[0] ?? null
  const hasRoles = device.roles.gateway || device.roles.dns || device.roles.dhcp
  const services = serviceNames(device.services.map((s) => s.type))
  const ctx = snapshot.networkContext
  const events = history.filter((e) => e.deviceId === device.id).slice(0, 5)
  const q = device.linkQuality

  const deviceInspections = useMemo(
    () =>
      Object.entries(inspections)
        .filter(([key]) => primaryIp != null && key.startsWith(`${primaryIp}:`))
        .map(([, value]) => value)
        .filter((v) => v.product != null),
    [inspections, primaryIp],
  )

  const commitName = async (): Promise<void> => {
    await tagDevice({ deviceId: device.id, name: nameDraft.trim() || null })
    setEditingName(false)
  }

  const handleMeasure = async (): Promise<void> => {
    if (!primaryIp || measuring) return
    setMeasuring(true)
    try {
      await measureLink(primaryIp)
    } finally {
      setMeasuring(false)
    }
  }

  // A first reply far slower than the rest is a battery-powered device waking
  // its radio, not a problem — say so rather than leaving it looking broken.
  const wakeUpGap = q?.latencyMs != null && q.avgMs != null && q.avgMs > q.latencyMs * 3

  return (
    <>
      {/* Identity */}
      <SectionCard title={t('identityTitle')} icon={Server}>
        <div className="mb-3 flex flex-wrap gap-1.5">
          <RoleBadge label={t('roleGateway')} active={device.roles.gateway} />
          <RoleBadge label={t('roleDns')} active={device.roles.dns} />
          <RoleBadge label={t('roleDhcp')} active={device.roles.dhcp} />
          {!hasRoles && <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>{t('roleNone')}</span>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl px-4 py-3" style={{ background: 'var(--bg-subtle)' }}>
            <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{t('deviceName')}</p>
            {editingName ? (
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => void commitName()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commitName()
                  if (e.key === 'Escape') setEditingName(false)
                }}
                maxLength={80}
                placeholder={t('deviceNamePlaceholder')}
                className="mt-1 w-full rounded-md px-2 py-1 text-[13px] outline-none"
                style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-primary)' }}
                aria-label={t('deviceName')}
              />
            ) : (
              <button
                onClick={() => { setNameDraft(device.tag?.name ?? ''); setEditingName(true) }}
                className="mt-1 max-w-full truncate text-left text-[13px] font-medium text-zinc-200 hover:underline"
              >
                {device.tag?.name ?? t('deviceNamePlaceholder')}
              </button>
            )}
          </div>
          <div className="rounded-xl px-4 py-3" style={{ background: 'var(--bg-subtle)' }}>
            <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{t('kindLabel')}</p>
            <select
              value={device.tag?.kind ?? device.kind}
              onChange={(e) => void tagDevice({ deviceId: device.id, kind: (e.target.value || null) as DeviceKind | null })}
              className="mt-1 w-full cursor-pointer rounded-md px-2 py-1 text-[13px] font-medium outline-none"
              style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-primary)' }}
              aria-label={t('kindLabel')}
            >
              {KIND_KEYS.map((k) => (
                <option key={k} value={k}>{t(`kind.${k}`)}</option>
              ))}
            </select>
          </div>
          <InfoCell
            label={t('vendorLabel')}
            value={device.vendor ?? (isPrivateMac(device.mac) ? t('privateAddress') : t('unknownValue'))}
          />
          <InfoCell label={t('modelLabel')} value={device.model ?? t('unknownValue')} />
          <InfoCell label={t('macLabel')} value={(demoMode ? maskMac(device.mac) : device.mac) ?? t('unknownValue')} mono />
          <InfoCell label={t('hostnameLabel')} value={demoMode ? t('maskedValue') : device.hostname ?? t('unknownValue')} />
        </div>
        <div className="mt-3">
          <InfoCell
            label={t('servicesRow')}
            value={
              services.length ? (
                <span className="flex flex-wrap gap-1">
                  {services.map((s) => (
                    <span key={s} className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-muted)' }}>
                      {s}
                    </span>
                  ))}
                </span>
              ) : (
                t('servicesEmpty')
              )
            }
          />
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="flex flex-wrap gap-1">
            {device.sources.map((s) => (
              <span key={s} className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-muted)' }}>
                {SOURCE_LABELS[s]}
              </span>
            ))}
          </span>
          <button
            onClick={() => void clearTag(device.id)}
            disabled={!device.tag}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-40"
            style={{ color: 'var(--text-muted)' }}
          >
            <Trash2 className="h-3 w-3" strokeWidth={1.8} />
            {t('clearTagButton')}
          </button>
        </div>
      </SectionCard>

      {/* Service inspector */}
      {deviceInspections.length > 0 && (
        <SectionCard title={t('inspectorTitle')} icon={Search}>
          <div className="flex flex-col gap-1.5">
            {deviceInspections.map((ins) => (
              <div key={ins.port} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: 'var(--bg-subtle)' }}>
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-medium text-zinc-200">{ins.product}</p>
                  <p className="truncate text-[10px]" style={{ color: 'var(--text-faint)' }}>{ins.title ?? ins.banner ?? ins.server ?? ''}</p>
                </div>
                <span className="shrink-0 font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>{ins.port}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Network */}
      <SectionCard title={t('networkSectionTitle')} icon={Globe}>
        <div className="grid grid-cols-2 gap-3">
          <InfoCell
            label={t('ipv4Label')}
            value={
              device.ipv4.length ? (
                <span>
                  {device.ipv4.join(', ')}
                  {device.isLocal && snapshot.host.ipCidr && (
                    <span className="ml-1 text-[11px]" style={{ color: 'var(--text-faint)' }}>
                      /{snapshot.host.ipCidr.split('/').pop()?.trim()}
                    </span>
                  )}
                </span>
              ) : (
                t('unknownValue')
              )
            }
            mono
          />
          <InfoCell
            label={t('ipv6Label')}
            value={
              device.ipv6.length
                ? (demoMode ? device.ipv6.map(maskIpv6) : device.ipv6).slice(0, 3).join(', ')
                : t('unknownValue')
            }
            mono
          />
          <InfoCell
            label={t('connection')}
            value={device.isLocal ? snapshot.host.connectionType ?? t('unknownValue') : t('connectionUnknowable')}
          />
          <InfoCell label={t('statusLabel')} value={device.status === 'online' ? t('online') : t('offline')} />
        </div>

        <button
          onClick={() => setContextOpen((v) => !v)}
          className="mt-3 flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-left text-[11.5px] font-medium transition-colors hover:bg-white/5"
          style={{ color: 'var(--text-muted)' }}
        >
          {contextOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {t('networkContextTitle')}
        </button>
        {contextOpen && (
          <div className="mt-2 grid grid-cols-2 gap-3">
            <InfoCell label={t('subnet')} value={ctx?.subnetMask ?? t('unknownValue')} mono />
            <InfoCell label={t('routerLabel')} value={ctx?.router ?? t('unknownValue')} mono />
            <InfoCell label={t('dnsLabel')} value={ctx?.dnsServers.join(', ') || t('unknownValue')} mono />
            <InfoCell label={t('domainLabel')} value={ctx?.domain ?? t('unknownValue')} />
            <InfoCell label={t('dhcpLabel')} value={ctx?.dhcpServer ?? t('unknownValue')} mono />
          </div>
        )}
      </SectionCard>

      {/* Link quality — meaningless for our own address, so hidden there. */}
      {!device.isLocal && (
        <SectionCard
          title={t('linkTitle')}
          icon={Activity}
          action={
            <button
              onClick={() => void handleMeasure()}
              disabled={!primaryIp || measuring}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all disabled:opacity-40"
              style={{ border: '1px solid var(--border-strong)', color: 'var(--text-primary)' }}
            >
              {measuring ? <Loader2 className="h-3 w-3 animate-spin" /> : <Activity className="h-3 w-3" strokeWidth={2} />}
              {measuring ? t('linkMeasuring') : t('linkMeasure')}
            </button>
          }
        >
          {q ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <InfoCell label={t('linkLatency')} value={q.latencyMs != null ? `${q.latencyMs.toFixed(1)} ms` : '—'} mono />
                <InfoCell label={t('linkAvg')} value={q.avgMs != null ? `${q.avgMs.toFixed(1)} ms` : '—'} mono />
                <InfoCell label={t('linkVariability')} value={q.variabilityMs != null ? `${q.variabilityMs.toFixed(1)} ms` : '—'} mono />
                <InfoCell label={t('linkLoss')} value={q.packetLossPct != null ? `${(q.packetLossPct * 100).toFixed(0)}%` : '—'} mono />
              </div>
              {wakeUpGap && (
                <p className="mt-3 text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>{t('linkWakeUp')}</p>
              )}
              <p className="mt-2 text-[11px] leading-relaxed" style={{ color: 'var(--text-faint)' }}>{t('linkNotSignal')}</p>
            </>
          ) : (
            <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>{t('linkUnavailable')}</p>
          )}
        </SectionCard>
      )}

      {/* Activity */}
      <SectionCard title={t('activityTitle')} icon={Clock}>
        <div className="grid grid-cols-2 gap-3">
          <InfoCell label={t('firstSeen')} value={relativeTime(device.firstSeenAt)} />
          <InfoCell label={t('lastSeen')} value={relativeTime(device.lastSeenAt)} />
        </div>
        <div className="mt-3">
          {events.length === 0 ? (
            <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>{t('timelineEmpty')}</p>
          ) : (
            <div className="space-y-1.5">
              {events.map((e) => (
                <div key={e.id} className="flex items-start justify-between gap-3">
                  <p className="text-[12px] text-zinc-300">{e.text}</p>
                  <p className="shrink-0 text-[10px]" style={{ color: 'var(--text-faint)' }}>{relativeTime(e.at)}</p>
                </div>
              ))}
              <button
                onClick={() => setDetailTab('history')}
                className="mt-1 text-[11px] font-medium hover:underline"
                style={{ color: 'var(--accent)' }}
              >
                {t('viewFullHistory')}
              </button>
            </div>
          )}
        </div>
      </SectionCard>
    </>
  )
}

// ─── Ports ──────────────────────────────────────────────────

type PortFilter = 'all' | DevicePortState

function PortsTab({ device }: { device: NetworkDevice }) {
  const { t } = useTranslation('devices')
  const snapshot = useSecurityStore((s) => s.snapshot)
  const probing = useSecurityStore((s) => s.probing)
  const scanDevice = useSecurityStore((s) => s.scanDevice)
  const [filter, setFilter] = useState<PortFilter>('all')
  const [openPort, setOpenPort] = useState<CatalogProbeState | null>(null)

  const ip = device.ipv4[0] ?? null
  const result: DeviceSecurityResult | null = useMemo(
    () => snapshot?.devices.find((d) => d.deviceId === device.id || (ip != null && d.ip === ip)) ?? null,
    [snapshot, device.id, ip],
  )
  const catalog = result?.catalog ?? []
  const isProbing = ip != null && probing.includes(ip)

  const counts = useMemo(
    () => ({
      all: catalog.length,
      open: catalog.filter((p) => p.state === 'open').length,
      closed: catalog.filter((p) => p.state === 'closed').length,
      filtered: catalog.filter((p) => p.state === 'filtered').length,
    }),
    [catalog],
  )

  const shown = useMemo(
    () => (filter === 'all' ? catalog : catalog.filter((p) => p.state === filter)),
    [catalog, filter],
  )

  const grouped = useMemo(() => {
    const map = new Map<PortCategory, CatalogProbeState[]>()
    for (const p of shown) {
      const list = map.get(p.category) ?? []
      list.push(p)
      map.set(p.category, list)
    }
    return CATEGORY_ORDER.filter((c) => map.has(c)).map((c) => ({ category: c, ports: map.get(c)! }))
  }, [shown])

  const FILTERS: Array<{ id: PortFilter; label: string; count: number }> = [
    { id: 'all', label: t('portFilterAll'), count: counts.all },
    { id: 'open', label: t('portOpen'), count: counts.open },
    { id: 'closed', label: t('portClosed'), count: counts.closed },
    { id: 'filtered', label: t('portFiltered'), count: counts.filtered },
  ]

  return (
    <>
      <SectionCard
        title={t('portStateTitle')}
        icon={ShieldAlert}
        action={
          <button
            onClick={() => {
              if (!ip) return
              void scanDevice(ip).then((ok) => (ok ? toast.success(t('portsProbed')) : toast.error(t('portsProbeFailed'))))
            }}
            disabled={!ip || isProbing}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all disabled:opacity-40"
            style={{ border: '1px solid var(--border-strong)', color: 'var(--text-primary)' }}
          >
            {isProbing ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldAlert className="h-3 w-3" strokeWidth={2} />}
            {isProbing ? t('portsProbing') : t('probePortsButton')}
          </button>
        }
      >
        {catalog.length === 0 ? (
          <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>{t('portStateEmpty')}</p>
        ) : (
          <>
            <div className="mb-3 flex rounded-lg p-0.5" style={{ background: 'var(--bg-subtle-2)' }}>
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className="flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors"
                  style={
                    filter === f.id
                      ? { background: 'var(--bg-subtle)', color: 'var(--text-primary)' }
                      : { color: 'var(--text-faint)' }
                  }
                >
                  {f.label} <span className="tabular-nums opacity-70">{f.count}</span>
                </button>
              ))}
            </div>

            {counts.filtered > 0 && filter !== 'closed' && (
              <p className="mb-3 flex items-start gap-1.5 rounded-lg px-3 py-2 text-[11px] leading-relaxed" style={{ background: 'rgba(245,158,11,0.08)', color: '#fbbf24' }}>
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={2} />
                {t('portsFilteredExplainer', { count: counts.filtered })}
              </p>
            )}

            <div className="flex flex-col gap-3">
              {grouped.map(({ category, ports }) => (
                <div key={category}>
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>
                    {t(`portCategory.${category}`)}
                  </p>
                  <div className="flex flex-col gap-1">
                    {ports.map((p) => (
                      <button
                        key={p.port}
                        onClick={() => setOpenPort(p)}
                        className="flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-left transition-colors hover:bg-white/5"
                        style={{ background: 'var(--bg-subtle)' }}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: PORT_STATE_COLOR[p.state] }} />
                          <span className="truncate text-[12px] text-zinc-200">{p.service}</span>
                          {p.risk !== 'none' && (
                            <ShieldAlert
                              className="h-3 w-3 shrink-0"
                              strokeWidth={2.2}
                              style={{ color: p.risk === 'high' ? '#f87171' : '#fbbf24' }}
                            />
                          )}
                        </span>
                        <span className="shrink-0 font-mono text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>{p.port}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </SectionCard>

      <FullScanCard ip={ip} progress={result?.fullScan ?? null} />

      {openPort && ip && (
        <PortSheet ip={ip} port={openPort} findings={result?.findings ?? []} onClose={() => setOpenPort(null)} />
      )}
    </>
  )
}

function FullScanCard({ ip, progress }: { ip: string | null; progress: DeviceSecurityResult['fullScan'] | null }) {
  const { t } = useTranslation('devices')
  const fullScanStart = useSecurityStore((s) => s.fullScanStart)
  const fullScanCancel = useSecurityStore((s) => s.fullScanCancel)
  const [preset, setPreset] = useState<'1024' | 'all' | 'custom'>('1024')
  const [customFrom, setCustomFrom] = useState('1')
  const [customTo, setCustomTo] = useState('1024')
  const [starting, setStarting] = useState(false)

  const running = progress?.state === 'running'
  const total = progress ? Math.max(1, progress.to - progress.from + 1) : 1
  const pct = progress ? Math.min(100, (progress.checked / total) * 100) : 0

  const start = async (): Promise<void> => {
    if (!ip) {
      toast.error(t('fullScanNoIp'))
      return
    }
    let from = 1
    let to = 1024
    if (preset === 'all') {
      to = 65535
    } else if (preset === 'custom') {
      const f = Number.parseInt(customFrom, 10)
      const tt = Number.parseInt(customTo, 10)
      if (!Number.isInteger(f) || !Number.isInteger(tt) || f < 1 || tt > 65535 || f > tt) {
        toast.error(t('fullScanRangeInvalid'))
        return
      }
      from = f
      to = tt
    }
    setStarting(true)
    const result = await fullScanStart({ ip, from, to })
    setStarting(false)
    // The reason now travels with the rejection instead of a bare "Scan failed".
    if (!result.ok) toast.error(result.error ?? t('fullScanFailed'))
  }

  return (
    <SectionCard title={t('fullScanTitle')} icon={Search}>
      {running ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-[12.5px] font-medium text-zinc-200">
            <span className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" />
              {t('fullScanRunning', { checked: progress?.checked ?? 0, total })}
            </span>
            <span className="font-mono text-[11px]" style={{ color: '#34d399' }}>
              {t('fullScanOpenCount', { count: progress?.open ?? 0 })}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--bg-subtle-2)' }}>
            <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${pct}%` }} />
          </div>
          {progress?.current != null && (
            <p className="font-mono text-[10px]" style={{ color: 'var(--text-faint)' }}>
              {t('fullScanCurrentPort', { port: progress.current })}
            </p>
          )}
          <button
            onClick={() => ip && void fullScanCancel(ip)}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-red-500/10"
            style={{ color: '#f87171' }}
          >
            <Square className="h-3 w-3" /> {t('fullScanCancel')}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-1.5">
            {(['1024', 'all', 'custom'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPreset(p)}
                className="rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors"
                style={preset === p ? { background: 'var(--accent)', color: '#fff' } : { background: 'var(--bg-subtle-2)', color: 'var(--text-muted)' }}
              >
                {p === '1024' ? t('fullScanRange1024') : p === 'all' ? t('fullScanRangeAll') : t('fullScanCustom')}
              </button>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="flex items-center gap-2">
              <input
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                className="w-20 rounded-lg px-2 py-1 font-mono text-[12px] outline-none"
                style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-primary)' }}
                placeholder={t('fullScanCustomFrom')}
                aria-label={t('fullScanCustomFrom')}
              />
              <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>–</span>
              <input
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                className="w-20 rounded-lg px-2 py-1 font-mono text-[12px] outline-none"
                style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-primary)' }}
                placeholder={t('fullScanCustomTo')}
                aria-label={t('fullScanCustomTo')}
              />
            </div>
          )}
          {progress?.state === 'done' && (
            <p className="text-[11px] font-medium" style={{ color: progress.open > 0 ? '#34d399' : 'var(--text-muted)' }}>
              {t('fullScanDone', { open: progress.open, checked: progress.checked })}
            </p>
          )}
          {progress?.state === 'cancelled' && (
            <p className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>{t('fullScanCancelled')}</p>
          )}
          {progress?.state === 'error' && (
            <p className="text-[11px]" style={{ color: '#f87171' }}>{progress.error ?? t('fullScanFailed')}</p>
          )}
          {(!progress || progress.state === 'idle') && (
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-faint)' }}>{t('fullScanIdle')}</p>
          )}
          <button
            onClick={() => void start()}
            disabled={starting || !ip}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: 'var(--accent)' }}
          >
            {starting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            {t('fullScanStart')}
          </button>
        </div>
      )}
    </SectionCard>
  )
}

function PortSheet({ ip, port, findings, onClose }: {
  ip: string
  port: CatalogProbeState
  findings: DeviceSecurityResult['findings']
  onClose: () => void
}) {
  const { t } = useTranslation('devices')
  const inspections = useDevicesStore((s) => s.inspections)
  const inspecting = useDevicesStore((s) => s.inspecting)
  const inspectService = useDevicesStore((s) => s.inspectService)
  const [tab, setTab] = useState<'overview' | 'raw'>('overview')
  const key = `${ip}:${port.port}`
  const inspection: ServiceInspection | undefined = inspections[key]
  const busy = inspecting.includes(key)
  const finding = findings.find((f) => f.port === port.port) ?? null
  const isWeb = WEB_PORTS.has(port.port)
  const scheme: 'http' | 'https' = port.port === 443 || port.port === 8443 || port.port === 10443 ? 'https' : 'http'

  const postureTone = inspection?.posture === 'open-no-auth' ? '#f87171' : inspection?.posture === 'auth-required' ? '#34d399' : 'var(--text-muted)'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl p-5"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border-strong)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-semibold text-zinc-100">{port.service}</h3>
            <p className="mt-0.5 font-mono text-[12px]" style={{ color: 'var(--text-faint)' }}>
              {ip}:{port.port}
            </p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 transition-colors hover:bg-white/5">
            <X className="h-4 w-4" style={{ color: 'var(--text-faint)' }} />
          </button>
        </div>

        <div className="mt-4 flex rounded-lg p-0.5" style={{ background: 'var(--bg-subtle-2)' }}>
          {(['overview', 'raw'] as const).map((id) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className="flex-1 rounded-md px-2 py-1.5 text-[11.5px] font-medium transition-colors"
              style={tab === id ? { background: 'var(--bg-subtle)', color: 'var(--text-primary)' } : { color: 'var(--text-faint)' }}
            >
              {id === 'overview' ? t('sheetOverview') : t('sheetRaw')}
            </button>
          ))}
        </div>

        {tab === 'overview' ? (
          <div className="mt-4 flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <InfoCell label={t('portColumn')} value={String(port.port)} mono />
              <InfoCell label={t('stateColumn')} value={t(`portState.${port.state}`)} />
              <InfoCell label={t('categoryColumn')} value={t(`portCategory.${port.category}`)} />
              <InfoCell label={t('productLabel')} value={inspection?.product ?? t('unknownValue')} />
            </div>

            {inspection?.postureDetail && (
              <div className="rounded-xl px-4 py-3" style={{ background: 'var(--bg-subtle)' }}>
                <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{t('postureLabel')}</p>
                <p className="mt-1 text-[12.5px] font-medium" style={{ color: postureTone }}>{inspection.postureDetail}</p>
              </div>
            )}

            {finding && (
              <div className="rounded-xl px-4 py-3" style={{ background: finding.risk === 'high' ? 'rgba(239,68,68,0.10)' : 'rgba(245,158,11,0.10)' }}>
                <p className="text-[12px] font-semibold text-zinc-100">{finding.title}</p>
                <p className="mt-1 text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>{finding.explanation}</p>
                <p className="mt-1 text-[11px] leading-relaxed" style={{ color: '#a1a1aa' }}>{finding.advice}</p>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => void inspectService(ip, port.port)}
                disabled={busy || port.state !== 'open'}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-medium transition-all disabled:opacity-40"
                style={{ border: '1px solid var(--border-strong)', color: 'var(--text-primary)' }}
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" strokeWidth={2} />}
                {t('inspectServiceButton')}
              </button>
              {isWeb && port.state === 'open' && (
                <button
                  onClick={() => void window.clarity.devicesOpenWebViewer({ ip, port: port.port, scheme })}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-medium text-white transition-all"
                  style={{ background: 'var(--accent)' }}
                >
                  <Globe className="h-3 w-3" strokeWidth={2} />
                  {t('openWebViewer')}
                </button>
              )}
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(`${ip}:${port.port}`)
                  toast.success(t('copied'))
                }}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-medium transition-all"
                style={{ border: '1px solid var(--border-strong)', color: 'var(--text-primary)' }}
              >
                <Lock className="h-3 w-3" strokeWidth={2} />
                {t('copyAddress')}
              </button>
            </div>
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-faint)' }}>{t('inspectExplainer')}</p>
          </div>
        ) : (
          <div className="mt-4">
            {inspection?.raw ? (
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl p-3 font-mono text-[11px] leading-relaxed" style={{ background: 'var(--bg-subtle)', color: 'var(--text-muted)' }}>
                {inspection.raw}
              </pre>
            ) : (
              <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                {inspection?.error ?? t('rawEmpty')}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── History ────────────────────────────────────────────────

const EVENT_KINDS = ['online', 'offline', 'ipv4', 'hostname', 'vendor', 'kind', 'port_opened', 'port_closed'] as const

function HistoryTab({ device }: { device: NetworkDevice }) {
  const { t } = useTranslation('devices')
  const history = useDevicesStore((s) => s.history)
  const clearHistory = useDevicesStore((s) => s.clearHistory)
  const [kindFilter, setKindFilter] = useState<string>('all')
  const anchorRef = useRef<HTMLAnchorElement>(null)

  const events = useMemo(() => {
    const mine = history.filter((e) => e.deviceId === device.id)
    return kindFilter === 'all' ? mine : mine.filter((e) => e.kind === kindFilter)
  }, [history, device.id, kindFilter])

  const exportJson = (): void => {
    const blob = new Blob([JSON.stringify({ deviceId: device.id, exportedAt: Date.now(), events }, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = anchorRef.current
    if (!a) return
    a.href = url
    a.download = `clarity-device-history-${device.id.replace(/[^a-z0-9]/gi, '-')}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  return (
    <SectionCard
      title={t('timelineTitle')}
      icon={Clock}
      action={
        <div className="flex items-center gap-2">
          <button onClick={exportJson} className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
            <Download className="h-3 w-3" strokeWidth={1.8} />
            {t('exportHistory')}
          </button>
          <button onClick={() => void clearHistory()} className="text-[11px] font-medium" style={{ color: 'var(--text-faint)' }}>
            {t('timelineClear')}
          </button>
          <a ref={anchorRef} className="hidden" aria-hidden="true" />
        </div>
      }
    >
      <select
        value={kindFilter}
        onChange={(e) => setKindFilter(e.target.value)}
        className="mb-3 w-full cursor-pointer rounded-lg px-2 py-1.5 text-[12px] outline-none"
        style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-primary)' }}
        aria-label={t('historyFilter')}
      >
        <option value="all">{t('historyFilterAll')}</option>
        {EVENT_KINDS.map((k) => (
          <option key={k} value={k}>{t(`eventKind.${k}`)}</option>
        ))}
      </select>

      {events.length === 0 ? (
        <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>{t('timelineEmpty')}</p>
      ) : (
        <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
          {events.map((e) => (
            <div key={e.id} className="flex items-start justify-between gap-3 rounded-lg px-3 py-2" style={{ background: 'var(--bg-subtle)' }}>
              <div className="min-w-0">
                <p className="text-[12px] text-zinc-300">{e.text}</p>
                <p className="mt-0.5 text-[10px]" style={{ color: 'var(--text-faint)' }}>{t(`eventKind.${e.kind}`)}</p>
              </div>
              <p className="shrink-0 text-[10px]" style={{ color: 'var(--text-faint)' }}>{relativeTime(e.at)}</p>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}

// ─── Local services (This Mac only) ─────────────────────────

function LocalServicesTab({ listeners, demoMode }: { listeners: LocalListener[]; demoMode: boolean }) {
  const { t } = useTranslation('devices')
  const loopback = listeners.filter((l) => l.loopbackOnly)
  const reachable = listeners.filter((l) => !l.loopbackOnly)

  const Group = ({ title, hint, rows }: { title: string; hint: string; rows: LocalListener[] }) => (
    <SectionCard title={title} icon={Server}>
      <p className="mb-2 text-[11px] leading-relaxed" style={{ color: 'var(--text-faint)' }}>{hint}</p>
      {rows.length === 0 ? (
        <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>{t('localServicesEmpty')}</p>
      ) : (
        <div className="flex flex-col gap-1">
          {rows.map((l) => (
            <div key={`${l.port}-${l.pid}`} className="flex items-center justify-between gap-2 rounded-lg px-3 py-1.5" style={{ background: 'var(--bg-subtle)' }}>
              <div className="min-w-0">
                <p className="truncate text-[12px] text-zinc-200">
                  {demoMode ? t('maskedValue') : l.process ?? t('unknownValue')}
                  {!demoMode && l.pid != null && (
                    <span className="ml-1.5 text-[10px]" style={{ color: 'var(--text-faint)' }}>PID {l.pid}</span>
                  )}
                </p>
                {!demoMode && l.hostNames.length > 0 && (
                  <p className="truncate text-[10px]" style={{ color: 'var(--text-faint)' }}>
                    {l.hostNames.slice(0, 3).map((h) => `${h}:${l.port}`).join(' · ')}
                  </p>
                )}
              </div>
              <span className="shrink-0 font-mono text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>{l.port}</span>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )

  return (
    <>
      <Group title={t('localOnlyTitle')} hint={t('localOnlyHint')} rows={loopback} />
      <Group title={t('localReachableTitle')} hint={t('localReachableHint')} rows={reachable} />
    </>
  )
}
