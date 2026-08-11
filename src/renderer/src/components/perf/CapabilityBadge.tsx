import { useTranslation } from 'react-i18next'
import { CheckCircle2, Circle, ShieldAlert, MinusCircle } from 'lucide-react'

/**
 * Platform capability model used across the Performance Monitor:
 *  - supported          → the feature works and is reporting live data
 *  - available          → hardware is present but no live data yet
 *  - permission-required → data may exist but needs elevated privileges
 *  - unavailable        → no hardware / unsupported on this platform
 */
export type CapabilityState = 'supported' | 'available' | 'permission-required' | 'unavailable'

const CAPABILITY_ICONS = {
  supported: CheckCircle2,
  available: Circle,
  'permission-required': ShieldAlert,
  unavailable: MinusCircle,
} as const

const CAPABILITY_COLORS = {
  supported: { color: '#22c55e', bg: 'rgba(34,197,94,0.1)', border: 'rgba(34,197,94,0.2)' },
  available: { color: '#3b82f6', bg: 'rgba(59,130,246,0.1)', border: 'rgba(59,130,246,0.2)' },
  'permission-required': { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.2)' },
  unavailable: { color: 'var(--text-muted)', bg: 'var(--bg-subtle)', border: 'var(--border-medium)' },
} as const

const CAPABILITY_LABEL_KEYS = {
  supported: 'capabilitySupported',
  available: 'capabilityAvailable',
  'permission-required': 'capabilityPermissionRequired',
  unavailable: 'capabilityUnavailable',
} as const

export function CapabilityBadge({ state }: { state: CapabilityState }) {
  const { t } = useTranslation('performance')
  const Icon = CAPABILITY_ICONS[state]
  const style = CAPABILITY_COLORS[state]

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10px] font-semibold"
      style={{ background: style.bg, border: `1px solid ${style.border}`, color: style.color }}
    >
      <Icon className="h-3 w-3" />
      {t(CAPABILITY_LABEL_KEYS[state])}
    </span>
  )
}
