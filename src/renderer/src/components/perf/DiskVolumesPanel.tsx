import { useTranslation } from 'react-i18next'
import { HardDrive } from 'lucide-react'
import type { DiskVolumeUsage } from '@shared/types'
import { formatBytes } from '@/lib/utils'

interface DiskVolumesPanelProps {
  volumes: DiskVolumeUsage[]
}

function usageColor(percent: number): string {
  if (percent >= 90) return '#ef4444'
  if (percent >= 75) return '#f59e0b'
  return '#22c55e'
}

export function DiskVolumesPanel({ volumes }: DiskVolumesPanelProps) {
  const { t } = useTranslation('performance')
  if (volumes.length === 0) return null

  return (
    <div className="mb-6">
      <div className="mb-3">
        <h3 className="text-[13px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
          {t('volumeTitle')}
        </h3>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {volumes.map((vol) => {
          const pct = vol.percent ?? 0
          return (
            <div key={vol.mount} className="glass-card flex flex-col gap-3 rounded-2xl p-5">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-xl"
                  style={{ background: 'var(--bg-subtle-2)' }}
                >
                  <HardDrive className="h-4 w-4" style={{ color: 'var(--text-muted)' }} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {vol.mount}
                  </div>
                  <div className="truncate text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
                    {vol.name !== vol.mount ? `${vol.name} · ` : ''}{vol.fsType}
                  </div>
                </div>
                <span
                  className="shrink-0 text-[15px] font-bold font-mono"
                  style={{ color: vol.percent !== null ? usageColor(pct) : 'var(--text-muted)' }}
                >
                  {vol.percent !== null ? `${pct.toFixed(0)}%` : '--'}
                </span>
              </div>

              <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: 'var(--bg-subtle-2)' }}>
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${Math.min(100, pct)}%`,
                    background: vol.percent !== null ? usageColor(pct) : 'transparent'
                  }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px]">
                <span style={{ color: 'var(--text-secondary)' }}>
                  {t('volumeUsed')}: <span className="font-mono">{formatBytes(vol.usedBytes, 1)}</span>
                </span>
                <span style={{ color: 'var(--text-muted)' }}>
                  {t('volumeFree')}: <span className="font-mono">{formatBytes(vol.freeBytes, 1)}</span>
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
