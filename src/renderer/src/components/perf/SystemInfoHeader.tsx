import { useTranslation } from 'react-i18next'
import { Cpu, MemoryStick, Monitor, Clock, Server } from 'lucide-react'
import { formatBytes } from '@/lib/utils'
import type { PerfSystemInfo } from '@shared/types'

interface SystemInfoHeaderProps {
  info: PerfSystemInfo | null
  uptime: number
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function SystemInfoHeader({ info, uptime }: SystemInfoHeaderProps) {
  const { t } = useTranslation('performance')
  if (!info) return null

  const items = [
    {
      icon: Cpu,
      label: t('systemInfoCpu'),
      value: info.cpuModel,
      sub: t('systemInfoCores', { cores: info.cpuCores, threads: info.cpuThreads })
    },
    { icon: MemoryStick, label: t('systemInfoMemory'), value: formatBytes(info.totalMemBytes, 1), sub: '' },
    {
      icon: Monitor,
      label: t('systemInfoOs'),
      value: info.osVersion,
      sub: [info.kernel, info.arch].filter(Boolean).join(' · ')
    },
    { icon: Server, label: t('systemInfoHostname'), value: info.hostname || '--', sub: '' },
    { icon: Clock, label: t('systemInfoUptime'), value: formatUptime(uptime), sub: '' }
  ]

  return (
    <div className="glass-card mb-6 grid grid-cols-1 gap-3 rounded-2xl p-4 sm:grid-cols-2 lg:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 items-center gap-3 px-2">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            style={{ background: 'var(--bg-subtle-2)' }}
          >
            <item.icon className="h-4 w-4" style={{ color: 'var(--text-muted)' }} strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              {item.label}
            </div>
            <div className="truncate text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>
              {item.value}
            </div>
            {item.sub && (
              <div className="truncate text-[10px]" style={{ color: 'var(--text-muted)' }}>{item.sub}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
