import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Bell, BellOff, ChevronRight, X } from 'lucide-react'
import { useAlertStore } from '@/stores/alert-store'

const severityColors: Record<string, { color: string; bg: string }> = {
  info: { color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
  warning: { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
  critical: { color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
}

export function ProactiveAlertsCard() {
  const { t } = useTranslation('dashboard')
  const navigate = useNavigate()
  const events = useAlertStore((s) => s.events)
  const unreadCount = useAlertStore((s) => s.unreadCount)
  const clear = useAlertStore((s) => s.clear)

  const recent = events.slice(-5).reverse()

  return (
    <div className="glass-card rounded-2xl p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="relative flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: 'var(--bg-subtle-2)' }}>
            {events.length > 0 ? (
              <Bell className="h-4 w-4 text-amber-400" strokeWidth={1.8} />
            ) : (
              <BellOff className="h-4 w-4" style={{ color: 'var(--text-faint)' }} strokeWidth={1.8} />
            )}
            {unreadCount > 0 && (
              <span
                className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white"
                style={{ background: '#ef4444' }}
              >
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </div>
          <h3 className="text-[12px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            {t('alertsHeading')}
          </h3>
        </div>
        <div className="flex items-center gap-1.5">
          {events.length > 0 && (
            <button
              onClick={() => clear()}
              className="rounded-lg p-1.5 transition-colors"
              style={{ color: 'var(--text-faint)' }}
              title={t('alertsClear', 'Clear alerts')}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-muted)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-faint)' }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={() => navigate('/settings')}
            className="flex items-center gap-0.5 rounded-lg px-1.5 py-1 text-[11px] font-medium transition-colors"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#f59e0b' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}
          >
            {t('alertsSettings', 'Settings')}
            <ChevronRight className="h-3 w-3" strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {recent.length === 0 ? (
        <p className="py-3 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
          {t('alertsEmpty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {recent.map((event) => {
            const sev = severityColors[event.severity] ?? severityColors.info
            return (
              <li
                key={event.id}
                className="flex items-center gap-3 rounded-xl px-3.5 py-2.5"
                style={{ background: 'var(--bg-subtle)', border: `1px solid ${sev.bg}` }}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: sev.color }} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-zinc-200">{event.title}</p>
                  <p className="truncate text-[11px]" style={{ color: 'var(--text-muted)' }}>{event.message}</p>
                </div>
                <span className="shrink-0 font-mono text-[10px]" style={{ color: 'var(--text-faint)' }}>
                  {formatAlertTime(event.timestamp)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function formatAlertTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}
