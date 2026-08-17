import { useState } from 'react'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'

/**
 * The "grant Location access" prompt for Wi-Fi details.
 *
 * macOS withholds every BSSID and country code until Location Services is on,
 * and both the Wi-Fi scanner and the network-security snapshot detect that
 * independently. Before the merge each rendered its own banner, so the combined
 * page would have shown the same prompt twice; this is the single one, and the
 * Wi-Fi page decides when to show it by OR-ing both signals.
 *
 * `onGrant` is passed in rather than bound to a store because either store's
 * `requestLocation` is an equally valid way to raise the system dialog.
 */
/** The two stores spell their failure case differently ('denied' vs 'failed'). */
export type LocationGrantOutcome = 'granted' | 'settings' | 'denied' | 'failed'

export function LocationBanner({ onGrant }: { onGrant: () => Promise<LocationGrantOutcome> }) {
  const { t } = useTranslation('wifi')
  const [granting, setGranting] = useState(false)

  const grant = async (): Promise<void> => {
    setGranting(true)
    try {
      const outcome = await onGrant()
      if (outcome === 'granted') toast.success(t('locationGranted'))
      else if (outcome === 'settings') toast.info(t('locationOpenSettingsHint'))
      else toast.error(t('locationDenied'))
    } finally {
      setGranting(false)
    }
  }

  return (
    <div className="glass-card flex flex-col gap-3 rounded-2xl p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <div
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'rgba(245,158,11,0.12)' }}
        >
          <EyeOff className="h-4 w-4 text-amber-400" strokeWidth={1.8} />
        </div>
        <div>
          <p className="text-[13px] font-medium text-zinc-100">{t('locationBannerTitle')}</p>
          <p className="mt-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>{t('locationBannerBody')}</p>
          <p className="mt-1 text-[11px]" style={{ color: 'var(--text-faint)' }}>{t('locationOpenSettings')}</p>
        </div>
      </div>
      <button
        onClick={() => void grant()}
        disabled={granting}
        className="flex shrink-0 items-center justify-center gap-2 rounded-xl px-4 py-2 text-[13px] font-medium text-white transition-all disabled:opacity-60"
        style={{ background: 'var(--accent)' }}
      >
        {granting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" strokeWidth={1.8} />}
        {t('locationGrantButton')}
      </button>
    </div>
  )
}
