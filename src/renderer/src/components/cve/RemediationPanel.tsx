import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  CircleSlash,
  Crosshair,
  ShieldAlert,
  Wrench,
} from 'lucide-react'
import type { CveCoverage, CveFixAvailability, CveRemediation } from '@shared/types'

/**
 * The actionable half of the Vulnerabilities page.
 *
 * Three panels that between them answer "what do I do now":
 *  - Remediation plan — the exact version to install per app, and how many
 *    findings that clears.
 *  - Fix availability — how much of the list is actionable at all, so a finding
 *    with no upstream patch is not mistaken for one being ignored.
 *  - Coverage — what the scan could not examine, so a clean result cannot be
 *    read as a clean bill of health.
 *
 * All colours come from theme variables; nothing here is hardcoded to the dark
 * palette, which is what made the old page's text vanish in light mode.
 */

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl p-5"
      style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
    >
      {children}
    </div>
  )
}

function PanelTitle({ icon: Icon, children, tone }: {
  icon: typeof Wrench
  children: React.ReactNode
  tone?: string
}) {
  return (
    <h3
      className="mb-3 flex items-center gap-2 text-[12px] font-medium uppercase tracking-wider"
      style={{ color: 'var(--text-muted)' }}
    >
      <Icon className="h-4 w-4" strokeWidth={1.8} style={{ color: tone ?? 'var(--text-faint)' }} />
      {children}
    </h3>
  )
}

// Graphic swatches, so they follow the chart fill ramp rather than the text hues.
const SEVERITY_TONE: Record<string, string> = {
  critical: 'var(--sev-critical-fill)',
  high: 'var(--sev-high-fill)',
  medium: 'var(--sev-medium-fill)',
  low: 'var(--sev-low-fill)',
  none: 'var(--sev-none-fill)',
}

/**
 * One app's upgrade action.
 *
 * States the target version literally rather than advising the user to "stay up
 * to date", and when findings will survive the update it says so — a card that
 * implied a clean slate it could not deliver would be worse than none.
 */
function RemediationRow({ rem }: { rem: CveRemediation }) {
  const { t } = useTranslation('cveScanner')
  const severities = (['critical', 'high', 'medium', 'low'] as const).filter(
    (s) => rem.fixableBySeverity[s] > 0,
  )

  return (
    <div
      className="flex flex-col gap-2 rounded-xl px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      style={{ background: 'var(--bg-subtle)' }}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            {rem.appName}
          </p>
          {rem.kevCount > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
              style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--sev-critical)' }}
            >
              <Crosshair className="h-2.5 w-2.5" strokeWidth={2.4} />
              {t('remediation.exploited', { count: rem.kevCount })}
            </span>
          )}
        </div>

        {rem.targetVersion ? (
          <p className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[11.5px]">
            <span style={{ color: 'var(--text-muted)' }}>{rem.installedVersion}</span>
            <ArrowUpRight className="h-3 w-3" strokeWidth={2.2} style={{ color: 'var(--accent)' }} />
            <span style={{ color: 'var(--accent)' }}>{rem.targetVersion}</span>
          </p>
        ) : (
          <p className="mt-1 text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
            {t('remediation.noFixYet')}
          </p>
        )}

        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
          {rem.targetVersion && (
            <span style={{ color: 'var(--text-muted)' }}>
              {t('remediation.clears', { count: rem.fixableCount })}
            </span>
          )}
          {severities.map((s) => (
            <span key={s} className="inline-flex items-center gap-1" style={{ color: 'var(--text-faint)' }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: SEVERITY_TONE[s] }} />
              {rem.fixableBySeverity[s]} {t(`severity.${s}`)}
            </span>
          ))}
          {rem.openCount > 0 && (
            <span style={{ color: 'var(--sev-amber)' }}>
              {t('remediation.remainsOpen', { count: rem.openCount })}
            </span>
          )}
        </p>
      </div>

      {rem.maxCvss != null && (
        <span
          className="shrink-0 self-start rounded-lg px-2 py-1 font-mono text-[11px] font-bold sm:self-center"
          style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-muted)' }}
        >
          {rem.maxCvss.toFixed(1)}
        </span>
      )}
    </div>
  )
}

/** How many rows to show before the user asks for the rest. */
const VISIBLE_ROWS = 5

export function RemediationPlan({ remediations }: { remediations: CveRemediation[] }) {
  const { t } = useTranslation('cveScanner')
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? remediations : remediations.slice(0, VISIBLE_ROWS)
  const actionable = useMemo(
    () => remediations.filter((r) => r.targetVersion !== null).length,
    [remediations],
  )

  if (remediations.length === 0) return null

  return (
    <Panel>
      <PanelTitle icon={Wrench} tone="var(--accent)">
        {t('remediation.title')}
        <span
          className="ml-1 rounded-full px-2 py-0.5 text-[10px]"
          style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-muted)' }}
        >
          {actionable}
        </span>
      </PanelTitle>
      <div className="flex flex-col gap-2">
        {shown.map((rem) => (
          <RemediationRow key={`${rem.appName}|${rem.installedVersion}`} rem={rem} />
        ))}
      </div>
      {remediations.length > VISIBLE_ROWS && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-medium transition-colors"
          style={{ color: 'var(--accent)' }}
        >
          <ChevronDown
            className="h-3.5 w-3.5 transition-transform"
            style={{ transform: expanded ? 'rotate(180deg)' : undefined }}
            strokeWidth={2}
          />
          {expanded
            ? t('remediation.showFewer')
            : t('remediation.showAll', { count: remediations.length - VISIBLE_ROWS })}
        </button>
      )}
    </Panel>
  )
}

export function FixAvailability({ fix }: { fix: CveFixAvailability }) {
  const { t } = useTranslation('cveScanner')
  const total = fix.fixAvailable + fix.noFixUpstream
  if (total === 0) return null
  const pct = Math.round((fix.fixAvailable / total) * 100)

  return (
    <Panel>
      <PanelTitle icon={CheckCircle2} tone="var(--sev-low-fill)">{t('fixStatus.title')}</PanelTitle>

      {/* One bar rather than a pie: the only comparison that matters is
          actionable versus not. */}
      <div className="mb-3 flex h-2 overflow-hidden rounded-full" style={{ background: 'var(--bg-subtle-2)' }}>
        <div style={{ width: `${pct}%`, background: 'var(--sev-low-fill)' }} />
        <div style={{ width: `${100 - pct}%`, background: 'var(--sev-medium-fill)' }} />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-[12.5px]">
          <span className="flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
            <span className="h-2 w-2 rounded-full" style={{ background: 'var(--sev-low-fill)' }} />
            {t('fixStatus.available')}
          </span>
          <span className="font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
            {fix.fixAvailable}
          </span>
        </div>
        <div className="flex items-center justify-between text-[12.5px]">
          <span className="flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
            <span className="h-2 w-2 rounded-full" style={{ background: 'var(--sev-medium-fill)' }} />
            {t('fixStatus.noFix')}
          </span>
          <span className="font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
            {fix.noFixUpstream}
          </span>
        </div>
      </div>

      {fix.noFixUpstream > 0 && (
        <p className="mt-3 text-[11px] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
          {t('fixStatus.noFixHint')}
        </p>
      )}
    </Panel>
  )
}

export function ScanCoverage({ coverage }: { coverage: CveCoverage | null }) {
  const { t } = useTranslation('cveScanner')
  const [showSkipped, setShowSkipped] = useState(false)
  // Null before the first scan completes; rendering nothing is better than
  // rendering zeroes that read as "nothing installed".
  if (!coverage || coverage.installedTotal === 0) return null

  return (
    <Panel>
      <PanelTitle icon={CircleSlash}>{t('coverage.title')}</PanelTitle>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="font-mono text-[20px] font-bold" style={{ color: 'var(--text-primary)' }}>
            {coverage.scannedCount}
            <span className="text-[13px] font-normal" style={{ color: 'var(--text-faint)' }}>
              {' / '}{coverage.installedTotal}
            </span>
          </p>
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{t('coverage.scanned')}</p>
        </div>
        <div>
          <p className="font-mono text-[20px] font-bold" style={{ color: coverage.skippedCount > 0 ? 'var(--sev-amber)' : 'var(--text-primary)' }}>
            {coverage.skippedCount}
          </p>
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{t('coverage.notMatched')}</p>
        </div>
      </div>

      {/* The honest caveat: an unscanned app is unknown, not clean. */}
      {coverage.skippedCount > 0 && (
        <>
          <p className="mt-3 text-[11px] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
            {t('coverage.hint')}
          </p>
          <button
            onClick={() => setShowSkipped((v) => !v)}
            className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-medium"
            style={{ color: 'var(--accent)' }}
          >
            <ChevronDown
              className="h-3.5 w-3.5 transition-transform"
              style={{ transform: showSkipped ? 'rotate(180deg)' : undefined }}
              strokeWidth={2}
            />
            {showSkipped ? t('coverage.hideList') : t('coverage.showList')}
          </button>
          {showSkipped && (
            <div className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
              {coverage.skippedSample.map((name) => (
                <span
                  key={name}
                  className="truncate rounded-md px-2 py-0.5 text-[11px]"
                  style={{ background: 'var(--bg-subtle)', color: 'var(--text-muted)', maxWidth: 180 }}
                  title={name}
                >
                  {name}
                </span>
              ))}
              {coverage.skippedCount > coverage.skippedSample.length && (
                <span className="px-2 py-0.5 text-[11px]" style={{ color: 'var(--text-faint)' }}>
                  {t('coverage.andMore', { count: coverage.skippedCount - coverage.skippedSample.length })}
                </span>
              )}
            </div>
          )}
        </>
      )}

      <p className="mt-3 text-[11px]" style={{ color: 'var(--text-faint)' }}>
        {t('coverage.window', { days: coverage.windowDays })}
      </p>
    </Panel>
  )
}

/**
 * Replaces the old "No critical or high severity findings" block.
 *
 * The previous version stated a clean result without qualifying it. This one
 * pairs the good news with what was actually checked, because a reassurance the
 * data cannot support is the one kind of inaccuracy that matters most here.
 */
export function AllClear({ coverage, noFixUpstream }: {
  coverage: CveCoverage | null
  noFixUpstream: number
}) {
  const { t } = useTranslation('cveScanner')

  return (
    <div
      className="flex flex-col gap-4 rounded-2xl p-6 sm:flex-row sm:items-center"
      style={{ background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.16)' }}
    >
      <div
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
        style={{ background: 'rgba(34,197,94,0.12)' }}
      >
        <ShieldAlert className="h-6 w-6" strokeWidth={1.8} style={{ color: 'var(--sev-low-fill)' }} />
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          {t('allClear.title')}
        </p>
        <p className="mt-1 text-[12.5px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {coverage
            ? t('allClear.body', { scanned: coverage.scannedCount, total: coverage.installedTotal })
            : t('allClear.bodyNoCoverage')}
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {coverage && coverage.skippedCount > 0 && (
            <span
              className="rounded-full px-2.5 py-1 text-[11px] font-medium"
              style={{ background: 'rgba(245,158,11,0.10)', color: 'var(--sev-amber)' }}
            >
              {t('allClear.unscanned', { count: coverage.skippedCount })}
            </span>
          )}
          {noFixUpstream > 0 && (
            <span
              className="rounded-full px-2.5 py-1 text-[11px] font-medium"
              style={{ background: 'var(--bg-subtle)', color: 'var(--text-muted)' }}
            >
              {t('allClear.openUpstream', { count: noFixUpstream })}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
