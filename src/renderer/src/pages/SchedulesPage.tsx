import { useState, useMemo, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CalendarClock, Plus, Clock, CheckCircle2, XCircle, Minus,
  Pencil, Trash2, Copy, Sparkles, Database, Globe, AppWindow,
  Gamepad2, Trash, Monitor, Download, Zap, AlertTriangle, X,
  Play, SlidersHorizontal, Check, ArrowRight, ListChecks
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { useSettingsStore } from '@/stores/settings-store'
import { usePlatform } from '@/hooks/usePlatform'
import type { ScheduleEntry, ScheduleTaskType } from '@shared/types'
import { getNextRunTime } from './schedules-utils'

// ─── Constants ────────────────────────────────────────────

const DAY_NAME_KEYS = ['dayNames.sunday', 'dayNames.monday', 'dayNames.tuesday', 'dayNames.wednesday', 'dayNames.thursday', 'dayNames.friday', 'dayNames.saturday']

const MAX_SCHEDULES = 10

interface TaskDef {
  type: ScheduleTaskType
  label: string
  icon: typeof Sparkles
  group: 'cleaner' | 'maintenance'
  /** Platform feature flag — task is hidden when this feature is false */
  requiresFeature?: 'registry' | 'drivers'
}

const ALL_TASKS_BASE: Array<Omit<TaskDef, 'label'> & { labelKey: string }> = [
  { type: 'cleaner:system', labelKey: 'tasks.system', icon: Monitor, group: 'cleaner' },
  { type: 'cleaner:browsers', labelKey: 'tasks.browsers', icon: Globe, group: 'cleaner' },
  { type: 'cleaner:apps', labelKey: 'tasks.applications', icon: AppWindow, group: 'cleaner' },
  { type: 'cleaner:gaming', labelKey: 'tasks.gaming', icon: Gamepad2, group: 'cleaner' },
  { type: 'cleaner:recycleBin', labelKey: 'tasks.recycleBin', icon: Trash, group: 'cleaner' },
  { type: 'cleaner:databases', labelKey: 'tasks.databases', icon: Database, group: 'cleaner' },
  { type: 'registry', labelKey: 'tasks.registryFixes', icon: Zap, group: 'maintenance', requiresFeature: 'registry' },
  { type: 'drivers', labelKey: 'tasks.driverUpdates', icon: Download, group: 'maintenance', requiresFeature: 'drivers' },
  { type: 'software-update', labelKey: 'tasks.softwareUpdates', icon: Sparkles, group: 'maintenance' },
]

function useAllTasks(): TaskDef[] {
  const { t } = useTranslation('schedules')
  return useMemo(
    () => ALL_TASKS_BASE.map((task) => ({ ...task, label: t(task.labelKey) })),
    [t]
  )
}

/** Filter tasks to only those available on the current platform */
function usePlatformTasks(): TaskDef[] {
  const { features } = usePlatform()
  const allTasks = useAllTasks()
  return useMemo(
    () => allTasks.filter((task) => !task.requiresFeature || features[task.requiresFeature]),
    [allTasks, features]
  )
}

const CLEANER_TASKS = ALL_TASKS_BASE.filter((t) => t.group === 'cleaner').map((t) => t.type)

interface Preset {
  label: string
  description: string
  icon: typeof Sparkles
  recommended?: boolean
  entry: Partial<ScheduleEntry>
}

function buildPresets(availableTasks: TaskDef[], t: (key: string) => string): Preset[] {
  const allTypes = availableTasks.map((task) => task.type)
  return [
    {
      label: t('presets.weeklyFullCleanLabel'),
      description: t('presets.weeklyFullCleanDescription'),
      icon: CalendarClock,
      recommended: true,
      entry: {
        name: t('presets.weeklyFullCleanLabel'),
        frequency: 'weekly',
        day: 1,
        hour: 9,
        minute: 0,
        tasks: [...CLEANER_TASKS],
        autoApply: true
      }
    },
    {
      label: t('presets.dailyLightSweepLabel'),
      description: t('presets.dailyLightSweepDescription'),
      icon: Sparkles,
      entry: {
        name: t('presets.dailyLightSweepLabel'),
        frequency: 'daily',
        day: 0,
        hour: 8,
        minute: 0,
        tasks: ['cleaner:system', 'cleaner:browsers', 'cleaner:recycleBin'],
        autoApply: true
      }
    },
    {
      label: t('presets.monthlyDeepMaintenanceLabel'),
      description: t('presets.monthlyDeepMaintenanceDescription'),
      icon: Zap,
      entry: {
        name: t('presets.monthlyDeepMaintenanceLabel'),
        frequency: 'monthly',
        day: 1,
        hour: 10,
        minute: 0,
        tasks: [...allTypes],
        autoApply: true
      }
    },
  ]
}

function makeBlankEntry(): Partial<ScheduleEntry> {
  return {
    name: '',
    frequency: 'weekly',
    day: 1,
    hour: 9,
    minute: 0,
    tasks: [...CLEANER_TASKS],
    autoApply: false
  }
}

// ─── Main Page ────────────────────────────────────────────

export function SchedulesPage() {
  const { t } = useTranslation('schedules')
  const { settings, updateSettings } = useSettingsStore()
  const platformTasks = usePlatformTasks()
  const presets = useMemo(() => buildPresets(platformTasks, t), [platformTasks, t])
  const schedules = settings.schedules ?? []

  const save = (updated: ScheduleEntry[]) => {
    updateSettings({ schedules: updated })
    window.clarity?.settingsSet?.({ schedules: updated }).catch(() => {})
  }

  // Ensure startup + tray when any schedule is enabled
  const ensureBackgroundMode = () => {
    if (!settings.runAtStartup) {
      updateSettings({ runAtStartup: true })
      window.clarity?.settingsSet?.({ runAtStartup: true }).catch(() => {})
      window.clarity?.applyStartup?.(true).catch(() => {
        updateSettings({ runAtStartup: false })
        window.clarity?.settingsSet?.({ runAtStartup: false }).catch(() => {})
        toast.error(t('failedEnableStartup'), {
          action: {
            label: t('failedEnableStartupAction'),
            onClick: () => window.open('https://clarity.app/help/startup-failed', '_blank'),
          },
        })
      })
    }
    if (!settings.minimizeToTray) {
      updateSettings({ minimizeToTray: true })
      window.clarity?.settingsSet?.({ minimizeToTray: true }).catch(() => {})
      window.clarity?.applyTray?.(true)
    }
  }

  const [showDialog, setShowDialog] = useState(false)
  const [showPresets, setShowPresets] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [dialogInitial, setDialogInitial] = useState<Partial<ScheduleEntry>>(makeBlankEntry())

  const handleNew = () => {
    if (schedules.length >= MAX_SCHEDULES) {
      toast.error(t('maxSchedulesReached', { max: MAX_SCHEDULES }))
      return
    }
    setEditingId(null)
    setShowPresets(true)
  }

  const handlePresetSelect = (preset: Partial<ScheduleEntry> | null) => {
    setShowPresets(false)
    setEditingId(null)
    setDialogInitial(preset ?? makeBlankEntry())
    setShowDialog(true)
  }

  const handleEdit = (id: string) => {
    const entry = schedules.find((s) => s.id === id)
    if (!entry) return
    setDialogInitial(entry)
    setEditingId(id)
    setShowDialog(true)
  }

  const handleDuplicate = (id: string) => {
    if (schedules.length >= MAX_SCHEDULES) {
      toast.error(t('maxSchedulesReached', { max: MAX_SCHEDULES }))
      return
    }
    const entry = schedules.find((s) => s.id === id)
    if (!entry) return
    const dup: ScheduleEntry = {
      ...entry,
      id: crypto.randomUUID(),
      name: `${entry.name} ${t('copyNameSuffix')}`,
      lastRunAt: null,
      lastRunStatus: 'never',
      createdAt: new Date().toISOString()
    }
    save([...schedules, dup])
    toast.success(t('duplicatedToast', { name: entry.name }))
  }

  const handleDelete = () => {
    if (!deleteId) return
    const entry = schedules.find((s) => s.id === deleteId)
    save(schedules.filter((s) => s.id !== deleteId))
    setDeleteId(null)
    if (entry) toast.success(t('deletedToast', { name: entry.name }))
  }

  const handleToggle = (id: string, enabled: boolean) => {
    save(schedules.map((s) => (s.id === id ? { ...s, enabled } : s)))
    if (enabled) ensureBackgroundMode()
  }

  const handleRunNow = (id: string) => {
    const entry = schedules.find((s) => s.id === id)
    window.clarity?.scheduleRunNow?.(id)
    if (entry) toast.info(t('runNowStarted', { name: entry.name }))
  }

  const handleSave = (entry: ScheduleEntry) => {
    if (editingId) {
      save(schedules.map((s) => (s.id === editingId ? entry : s)))
    } else {
      save([...schedules, entry])
    }
    if (entry.enabled) ensureBackgroundMode()
    setShowDialog(false)
    setEditingId(null)
    toast.success(editingId ? t('updatedToast', { name: entry.name }) : t('createdToast', { name: entry.name }))
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        action={
          <button
            onClick={handleNew}
            className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all duration-200 hover:brightness-110"
            style={{
              background: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)',
              color: 'var(--text-on-accent)',
              boxShadow: '0 0 16px rgba(245,158,11,0.2)',
            }}
          >
            <Plus className="h-4 w-4" strokeWidth={2.2} />
            {t('newScheduleButton')}
          </button>
        }
      />

      {schedules.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title={t('emptyStateTitle')}
          description={t('emptyStateDescription')}
          action={
            <button
              onClick={handleNew}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all duration-200 hover:brightness-110"
              style={{
                background: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)',
                color: 'var(--text-on-accent)',
                boxShadow: '0 0 16px rgba(245,158,11,0.2)',
              }}
            >
              <Plus className="h-4 w-4" strokeWidth={2.2} />
              {t('createScheduleButton')}
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {schedules.map((entry) => (
            <ScheduleCard
              key={entry.id}
              entry={entry}
              onToggle={(enabled) => handleToggle(entry.id, enabled)}
              onEdit={() => handleEdit(entry.id)}
              onDuplicate={() => handleDuplicate(entry.id)}
              onRunNow={() => handleRunNow(entry.id)}
              onDelete={() => setDeleteId(entry.id)}
            />
          ))}
        </div>
      )}

      {/* Preset picker */}
      {showPresets && (
        <PresetPicker
          presets={presets}
          onSelect={handlePresetSelect}
          onClose={() => setShowPresets(false)}
        />
      )}

      {/* Schedule editor dialog */}
      {showDialog && (
        <ScheduleDialog
          initial={dialogInitial}
          isEditing={!!editingId}
          existingNames={schedules.filter((s) => s.id !== editingId).map((s) => s.name)}
          onSave={handleSave}
          onClose={() => { setShowDialog(false); setEditingId(null) }}
        />
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteId}
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
        title={t('deleteConfirmTitle')}
        description={t('deleteConfirmDescription')}
        confirmLabel={t('deleteConfirmLabel')}
        variant="danger"
      />
    </div>
  )
}

// ─── Schedule Card ────────────────────────────────────────

function ScheduleCard({
  entry,
  onToggle,
  onEdit,
  onDuplicate,
  onRunNow,
  onDelete
}: {
  entry: ScheduleEntry
  onToggle: (enabled: boolean) => void
  onEdit: () => void
  onDuplicate: () => void
  onRunNow: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation('schedules')
  const allTasks = useAllTasks()
  const nextRun = useMemo(() => getNextRunTime(entry), [entry])
  const frequencyText = useMemo(() => formatFrequency(entry, t), [entry, t])
  const taskCount = entry.tasks.length
  const visibleTasks = entry.tasks.slice(0, 4)
  const hiddenCount = taskCount - visibleTasks.length

  return (
    <div
      className={cn(
        'glass-card glass-card-hover glow-amber group relative flex flex-col rounded-2xl p-5',
        !entry.enabled && 'opacity-60'
      )}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
              style={{ background: 'var(--accent-muted-bg)' }}
              aria-hidden="true"
            >
              <CalendarClock className="h-5 w-5" style={{ color: 'var(--accent)' }} strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-[15px] font-semibold text-white">{entry.name}</h3>
                {entry.autoApply && (
                  <span
                    className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                    style={{ background: 'var(--accent-muted-bg)', color: 'var(--accent)', border: '1px solid var(--accent-muted-border)' }}
                  >
                    {t('card.autoApplyBadge')}
                  </span>
                )}
              </div>
              <p className="mt-1 flex items-center gap-1.5 text-[13px]" style={{ color: 'var(--text-muted)' }}>
                <Clock className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--accent)' }} strokeWidth={1.8} aria-hidden="true" />
                {frequencyText}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Toggle checked={entry.enabled} onChange={onToggle} label={entry.name} />
        </div>
      </div>

      {/* Task pills */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {visibleTasks.map((taskType) => {
          const def = allTasks.find((d) => d.type === taskType)
          if (!def) return null
          return (
            <span
              key={taskType}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium"
              style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-muted)' }}
            >
              <def.icon className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />
              {def.label}
            </span>
          )
        })}
        {hiddenCount > 0 && (
          <span
            className="flex items-center rounded-lg px-2.5 py-1 text-[11px] font-medium"
            style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-muted)' }}
          >
            +{hiddenCount}
          </span>
        )}
        {taskCount === 0 && (
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{t('card.noTasksSelected')}</span>
        )}
      </div>

      {/* Bottom row */}
      <div
        className="mt-4 flex items-center justify-between gap-4 border-t pt-4"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <div className="flex min-w-0 items-center gap-5">
          {/* Next run */}
          {entry.enabled && nextRun && (
            <div className="flex min-w-0 items-center gap-2">
              <Clock className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--accent)' }} strokeWidth={1.8} aria-hidden="true" />
              <span className="truncate text-[12px]" style={{ color: 'var(--text-muted)' }}>
                {t('card.nextRun', { time: formatNextRun(nextRun, t) })}
              </span>
            </div>
          )}

          {/* Last run */}
          <div className="flex shrink-0 items-center gap-2">
            {entry.lastRunStatus === 'success' && (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" style={{ color: '#22c55e' }} strokeWidth={1.8} aria-hidden="true" />
            )}
            {entry.lastRunStatus === 'partial' && (
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" style={{ color: '#eab308' }} strokeWidth={1.8} aria-hidden="true" />
            )}
            {entry.lastRunStatus === 'failed' && (
              <XCircle className="h-3.5 w-3.5 shrink-0" style={{ color: '#ef4444' }} strokeWidth={1.8} aria-hidden="true" />
            )}
            {entry.lastRunStatus === 'never' && (
              <Minus className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--text-faint)' }} strokeWidth={1.8} aria-hidden="true" />
            )}
            <span className="truncate text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {entry.lastRunAt ? t('card.lastRun', { time: formatLastRun(entry.lastRunAt, t) }) : t('card.neverRun')}
            </span>
          </div>
        </div>

        {/* Actions — visible on hover */}
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <IconBtn icon={Play} title={t('card.runNowAction')} onClick={onRunNow} color="var(--accent)" />
          <IconBtn icon={Pencil} title={t('card.editAction')} onClick={onEdit} />
          <IconBtn icon={Copy} title={t('card.duplicateAction')} onClick={onDuplicate} />
          <IconBtn icon={Trash2} title={t('card.deleteAction')} onClick={onDelete} color="#ef4444" />
        </div>
      </div>
    </div>
  )
}

// ─── Preset Picker Dialog ─────────────────────────────────

const PRESET_ACCENTS = [
  { iconBg: 'linear-gradient(135deg, #fbbf24 0%, #d97706 100%)', iconColor: '#09090b' },
  { iconBg: 'linear-gradient(135deg, #38bdf8 0%, #2563eb 100%)', iconColor: '#ffffff' },
  { iconBg: 'linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)', iconColor: '#ffffff' },
]

function PresetPicker({
  presets,
  onSelect,
  onClose
}: {
  presets: Preset[]
  onSelect: (preset: Partial<ScheduleEntry> | null) => void
  onClose: () => void
}) {
  const { t } = useTranslation('schedules')
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const dialog = panelRef.current
    if (!dialog) return
    const first = dialog.querySelector<HTMLElement>('button')
    first?.focus()
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="preset-picker-title"
    >
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        className="glass-card relative max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-2xl"
        style={{
          background: 'var(--card-bg)',
          border: '1px solid var(--glass-border)',
          boxShadow: '0 24px 80px var(--modal-shadow), inset 0 1px 0 var(--glass-inset)',
        }}
      >
        {/* Header */}
        <div className="relative overflow-hidden px-7 pb-5 pt-7">
          <div
            className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full opacity-70"
            style={{ background: 'radial-gradient(closest-side, rgba(245,158,11,0.16), transparent)' }}
            aria-hidden="true"
          />
          <div className="relative flex items-start justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                style={{
                  background: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)',
                  boxShadow: '0 6px 20px rgba(245,158,11,0.3)',
                }}
                aria-hidden="true"
              >
                <Sparkles className="h-5 w-5" style={{ color: 'var(--text-on-accent)' }} strokeWidth={2} />
              </div>
              <div>
                <h3 id="preset-picker-title" className="text-[17px] font-semibold text-white">
                  {t('presets.dialogTitle')}
                </h3>
                <p className="mt-0.5 text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
                  {t('presets.dialogDescription')}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label={t('dialog.cancelButton')}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors"
              style={{ color: 'var(--text-muted)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover-2)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              <X className="h-4.5 w-4.5" strokeWidth={1.8} />
            </button>
          </div>
        </div>

        {/* Preset cards */}
        <div className="grid grid-cols-1 gap-3 px-7 sm:grid-cols-2">
          {presets.map((preset, i) => (
            <PresetCard
              key={preset.label}
              preset={preset}
              accent={PRESET_ACCENTS[i % PRESET_ACCENTS.length]}
              recommended={!!preset.recommended}
              onSelect={() => onSelect(preset.entry)}
            />
          ))}
        </div>

        {/* Custom schedule */}
        <div className="px-7 pb-7 pt-3">
          <button
            onClick={() => onSelect(null)}
            className="group flex w-full items-center gap-3.5 rounded-2xl border border-dashed p-4 text-left transition-colors duration-150"
            style={{ borderColor: 'var(--border-stronger)', background: 'var(--bg-subtle)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'rgba(245,158,11,0.5)'
              e.currentTarget.style.background = 'var(--accent-muted-bg)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-stronger)'
              e.currentTarget.style.background = 'var(--bg-subtle)'
            }}
          >
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
              style={{ background: 'var(--bg-subtle-2)', border: '1px solid var(--border-medium)' }}
            >
              <SlidersHorizontal className="h-4.5 w-4.5" style={{ color: 'var(--text-secondary)' }} strokeWidth={1.8} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium text-zinc-200">{t('presets.customLabel')}</p>
              <p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>{t('presets.customDescription')}</p>
            </div>
            <ArrowRight
              className="h-4.5 w-4.5 shrink-0"
              style={{ color: 'var(--text-muted)' }}
              strokeWidth={1.8}
              aria-hidden="true"
            />
          </button>
        </div>
      </div>
    </div>
  )
}

function PresetCard({
  preset,
  accent,
  recommended,
  onSelect
}: {
  preset: Preset
  accent: { iconBg: string; iconColor: string }
  recommended: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation('schedules')
  const Icon = preset.icon
  const e = preset.entry
  const taskCount = e.tasks?.length ?? 0
  const time = `${String(e.hour ?? 9).padStart(2, '0')}:${String(e.minute ?? 0).padStart(2, '0')}`
  const freq = frequencyLabel(e.frequency, t)
  const scheduleLine =
    e.frequency === 'daily'
      ? `${freq} · ${time}`
      : e.frequency === 'monthly'
        ? `${freq} · ${ordinal(e.day ?? 1)} · ${time}`
        : `${freq} · ${t(DAY_NAME_KEYS[e.day ?? 1] ?? 'dayNames.monday')} · ${time}`

  return (
    <button
      onClick={onSelect}
      className="group relative flex flex-col rounded-2xl p-5 text-left transition-colors duration-150"
      style={{
        background: recommended
          ? 'linear-gradient(180deg, rgba(245,158,11,0.08) 0%, var(--bg-subtle) 100%)'
          : 'linear-gradient(180deg, var(--bg-subtle-2) 0%, var(--bg-subtle) 100%)',
        border: recommended ? '1px solid var(--accent-muted-border)' : '1px solid var(--border-medium)',
        boxShadow: recommended
          ? '0 0 32px rgba(245,158,11,0.08), inset 0 1px 0 rgba(255,255,255,0.04)'
          : 'var(--glass-shadow)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(245,158,11,0.35)' }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = recommended ? 'var(--accent-muted-border)' : 'var(--border-medium)' }}
    >
      {recommended && (
        <div
          className="absolute inset-x-5 top-0 h-0.5 rounded-t-2xl"
          style={{ background: 'linear-gradient(90deg, transparent, #f59e0b, transparent)' }}
          aria-hidden="true"
        />
      )}

      <div className="flex items-start justify-between gap-3">
        <div
          className="flex h-11 w-11 items-center justify-center rounded-xl"
          style={{ background: accent.iconBg, boxShadow: '0 4px 14px rgba(0,0,0,0.2)' }}
          aria-hidden="true"
        >
          <Icon className="h-5 w-5" style={{ color: accent.iconColor }} strokeWidth={2} />
        </div>
        <div className="flex items-center gap-2">
          {recommended && (
            <span
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
              style={{ background: 'var(--accent-muted-bg)', color: 'var(--accent)', border: '1px solid var(--accent-muted-border)' }}
            >
              <Check className="h-3 w-3" strokeWidth={2.4} aria-hidden="true" />
              {t('presets.recommendedBadge')}
            </span>
          )}
          <ArrowRight className="h-4 w-4 shrink-0" style={{ color: 'var(--text-ghost-2)' }} strokeWidth={1.8} aria-hidden="true" />
        </div>
      </div>

      <p className="mt-3.5 text-[15px] font-semibold text-zinc-100">{preset.label}</p>
      <p className="mt-1 text-[12.5px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        {preset.description}
      </p>

      <div className="mt-auto flex items-center justify-between gap-2 border-t pt-3.5" style={{ borderColor: 'var(--border-subtle)' }}>
        <span className="flex min-w-0 items-center gap-1.5 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
          <Clock className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--accent)' }} strokeWidth={1.8} aria-hidden="true" />
          <span className="truncate">{scheduleLine}</span>
        </span>
        <span
          className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium"
          style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-muted)' }}
        >
          <ListChecks className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />
          {taskCount}
        </span>
      </div>
    </button>
  )
}

// ─── Schedule Editor Dialog ───────────────────────────────

function ScheduleDialog({
  initial,
  isEditing,
  existingNames,
  onSave,
  onClose
}: {
  initial: Partial<ScheduleEntry>
  isEditing: boolean
  existingNames: string[]
  onSave: (entry: ScheduleEntry) => void
  onClose: () => void
}) {
  const { t } = useTranslation('schedules')
  const { features } = usePlatform()
  const allTasks = useAllTasks()
  const [name, setName] = useState(initial.name ?? '')
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'monthly'>(initial.frequency ?? 'weekly')
  const [day, setDay] = useState(initial.day ?? 1)
  const [hour, setHour] = useState(initial.hour ?? 9)
  const [minute, setMinute] = useState(initial.minute ?? 0)
  const [tasks, setTasks] = useState<ScheduleTaskType[]>(initial.tasks ?? [...CLEANER_TASKS])
  const [autoApply, setAutoApply] = useState(initial.autoApply ?? false)
  const [touched, setTouched] = useState(false)

  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Focus + ESC handling
  useEffect(() => {
    const dialog = panelRef.current
    if (!dialog) return
    dialog.querySelector<HTMLElement>('input, select, button')?.focus()
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const toggleTask = (type: ScheduleTaskType) => {
    setTasks((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    )
  }

  const selectAll = () => setTasks([...availableTypes])
  const deselectAll = () => setTasks([])

  const trimmedName = name.trim()
  const nameError = trimmedName.length === 0
    ? t('dialog.nameRequired')
    : existingNames.some((n) => n.toLowerCase() === trimmedName.toLowerCase())
      ? t('dialog.nameDuplicate')
      : null
  const tasksError = tasks.length === 0 ? t('dialog.tasksRequired') : null
  const showErrors = touched
  const canSave = !nameError && !tasksError

  const handleSubmit = () => {
    setTouched(true)
    if (!canSave) return
    const entry: ScheduleEntry = {
      id: (initial as ScheduleEntry).id ?? crypto.randomUUID(),
      name: trimmedName,
      enabled: (initial as ScheduleEntry).enabled ?? true,
      frequency,
      day,
      hour,
      minute,
      tasks,
      autoApply,
      lastRunAt: (initial as ScheduleEntry).lastRunAt ?? null,
      lastRunStatus: (initial as ScheduleEntry).lastRunStatus ?? 'never',
      createdAt: (initial as ScheduleEntry).createdAt ?? new Date().toISOString()
    }
    onSave(entry)
  }

  const cleanerTasks = allTasks.filter((task) => task.group === 'cleaner')
  const maintTasks = allTasks.filter((task) => task.group === 'maintenance')
  const isAvailable = (task: TaskDef) => !task.requiresFeature || features[task.requiresFeature]
  const availableTypes = allTasks.filter(isAvailable).map((task) => task.type)
  const availableCount = availableTypes.length
  const selectedAvailable = tasks.filter((type) => availableTypes.includes(type)).length

  const inputErrorStyle = showErrors && nameError
    ? { background: 'var(--bg-subtle)', border: '1px solid rgba(239,68,68,0.5)' }
    : { background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)' }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="schedule-dialog-title"
    >
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        className="glass-card relative max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-2xl"
        style={{
          background: 'var(--card-bg)',
          border: '1px solid var(--glass-border)',
          boxShadow: '0 24px 80px var(--modal-shadow), inset 0 1px 0 var(--glass-inset)',
        }}
      >
        <div className="flex items-center justify-between p-6 pb-4">
          <div>
            <h3 id="schedule-dialog-title" className="text-[16px] font-semibold text-white">
              {isEditing ? t('dialog.editTitle') : t('dialog.newTitle')}
            </h3>
            <p className="mt-1 text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
              {formatFrequencyFrom(initial, frequency, day, hour, minute, t)}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label={t('dialog.cancelButton')}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover-2)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            <X className="h-4.5 w-4.5" strokeWidth={1.8} />
          </button>
        </div>

        <div className="space-y-5 px-6 pb-6">
          {/* Name */}
          <div>
            <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--text-muted)' }}>
              {t('dialog.nameLabel')}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('dialog.namePlaceholder')}
              maxLength={60}
              aria-invalid={showErrors && !!nameError}
              className="w-full rounded-xl px-4 py-2.5 text-[13px] outline-none transition-colors"
              style={{ ...inputErrorStyle, color: 'var(--text-primary)' }}
              onFocus={() => setTouched(true)}
            />
            {showErrors && nameError && (
              <p
                className="mt-1.5 flex items-center gap-1.5 text-[12px]"
                style={{ color: '#ef4444' }}
                role="alert"
              >
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
                {nameError}
              </p>
            )}
          </div>

          {/* Frequency + day + time */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--text-muted)' }}>
                {t('dialog.frequencyLabel')}
              </label>
              <div
                className="flex items-center gap-1 rounded-xl p-1"
                style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)' }}
                role="group"
                aria-label={t('dialog.frequencyLabel')}
              >
                {(['daily', 'weekly', 'monthly'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => {
                      setFrequency(f)
                      if (f === 'weekly') setDay(1)
                      if (f === 'monthly') setDay(1)
                    }}
                    className="flex-1 rounded-lg px-2 py-1.5 text-[12px] font-medium transition-all"
                    style={
                      frequency === f
                        ? { background: 'var(--accent-muted-bg)', color: 'var(--accent)', border: '1px solid var(--accent-muted-border)' }
                        : { background: 'transparent', color: 'var(--text-muted)', border: '1px solid transparent' }
                    }
                  >
                    {t(`dialog.frequency${f[0].toUpperCase()}${f.slice(1)}`)}
                  </button>
                ))}
              </div>
            </div>

            {(frequency === 'weekly' || frequency === 'monthly') && (
              <div>
                <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--text-muted)' }}>
                  {t('dialog.dayLabel')}
                </label>
                <select
                  value={day}
                  onChange={(e) => setDay(Number(e.target.value))}
                  className="w-full cursor-pointer rounded-xl px-3 py-2.5 text-[13px] outline-none"
                  style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
                >
                  {frequency === 'weekly' && DAY_NAME_KEYS.map((key, i) => (
                    <option key={key} value={i} style={{ background: 'var(--card-bg)' }}>{t(key)}</option>
                  ))}
                  {frequency === 'monthly' && Array.from({ length: 31 }, (_, i) => (
                    <option key={i + 1} value={i + 1} style={{ background: 'var(--card-bg)' }}>{ordinal(i + 1)}</option>
                  ))}
                </select>
              </div>
            )}

            <div className={frequency === 'daily' ? 'sm:col-span-3' : ''}>
              <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--text-muted)' }}>
                {t('dialog.timeLabel')}
              </label>
              <div className="flex items-center gap-1.5">
                <select
                  value={hour}
                  onChange={(e) => setHour(Number(e.target.value))}
                  aria-label={t('dialog.timeLabel')}
                  className="w-full cursor-pointer rounded-xl px-3 py-2.5 text-[13px] outline-none"
                  style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i} style={{ background: 'var(--card-bg)' }}>{String(i).padStart(2, '0')}</option>
                  ))}
                </select>
                <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>:</span>
                <select
                  value={minute}
                  onChange={(e) => setMinute(Number(e.target.value))}
                  aria-label={`${t('dialog.timeLabel')} (minutes)`}
                  className="w-full cursor-pointer rounded-xl px-3 py-2.5 text-[13px] outline-none"
                  style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
                >
                  {Array.from({ length: 60 }, (_, i) => (
                    <option key={i} value={i} style={{ background: 'var(--card-bg)' }}>{String(i).padStart(2, '0')}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Tasks */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div>
                <label className="text-[12px] font-medium" style={{ color: 'var(--text-muted)' }}>
                  {t('dialog.tasksLabel')}
                </label>
                <span className="ml-2 text-[11px]" style={{ color: 'var(--text-faint)' }}>
                  {selectedAvailable}/{availableCount}
                </span>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={selectAll}
                  className="text-[11px] font-medium transition-colors hover:brightness-125"
                  style={{ color: 'var(--accent)' }}
                >
                  {t('dialog.selectAll')}
                </button>
                <button
                  onClick={deselectAll}
                  className="text-[11px] font-medium transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {t('dialog.deselectAll')}
                </button>
              </div>
            </div>

            <div
              className="rounded-xl p-4"
              style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-default)' }}
            >
              <TaskGroup
                title={t('dialog.cleanerGroup')}
                tasks={cleanerTasks}
                selected={tasks}
                isAvailable={isAvailable}
                unavailableLabel={t('dialog.notAvailableOnPlatform')}
                onToggle={toggleTask}
              />
              <TaskGroup
                title={t('dialog.maintenanceGroup')}
                tasks={maintTasks}
                selected={tasks}
                isAvailable={isAvailable}
                unavailableLabel={t('dialog.notAvailableOnPlatform')}
                onToggle={toggleTask}
                last
              />
            </div>

            {showErrors && tasksError && (
              <p
                className="mt-1.5 flex items-center gap-1.5 text-[12px]"
                style={{ color: '#ef4444' }}
                role="alert"
              >
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
                {tasksError}
              </p>
            )}
          </div>

          {/* Auto-apply */}
          <div
            className="flex items-start gap-4 rounded-xl p-4"
            style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-default)' }}
          >
            <div className="flex-1">
              <p className="text-[13px] font-medium text-zinc-300">{t('dialog.autoApplyLabel')}</p>
              <p className="mt-1 text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                {t('dialog.autoApplyDescription')}
              </p>
            </div>
            <Toggle checked={autoApply} onChange={setAutoApply} label={t('dialog.autoApplyLabel')} />
          </div>

          {autoApply && (
            <div
              className="flex items-start gap-3 rounded-xl p-3"
              style={{ background: 'var(--accent-muted-bg)', border: '1px solid var(--accent-muted-border)' }}
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--accent)' }} strokeWidth={1.8} aria-hidden="true" />
              <p className="text-[12px] leading-relaxed" style={{ color: 'var(--accent)' }}>
                {t('dialog.autoApplyWarning')}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 border-t p-6 pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
          <button
            onClick={onClose}
            className="rounded-xl px-5 py-2.5 text-[13px] font-medium transition-colors"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-subtle-2)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            {t('dialog.cancelButton')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSave}
            className={cn(
              'flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all duration-200 hover:brightness-110',
              !canSave && 'cursor-not-allowed opacity-40 hover:brightness-100'
            )}
            style={{
              background: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)',
              color: 'var(--text-on-accent)',
              boxShadow: '0 0 16px rgba(245,158,11,0.2)',
            }}
          >
            <Check className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
            {isEditing ? t('dialog.saveChangesButton') : t('dialog.createScheduleButton')}
          </button>
        </div>
      </div>
    </div>
  )
}

function TaskGroup({
  title,
  tasks,
  selected,
  isAvailable,
  unavailableLabel,
  onToggle,
  last
}: {
  title: string
  tasks: TaskDef[]
  selected: ScheduleTaskType[]
  isAvailable: (task: TaskDef) => boolean
  unavailableLabel: string
  onToggle: (type: ScheduleTaskType) => void
  last?: boolean
}) {
  if (tasks.length === 0) return null
  return (
    <div className={cn(!last && 'mb-4')}>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{title}</p>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {tasks.map((task) => (
          <TaskCheckbox
            key={task.type}
            task={task}
            checked={selected.includes(task.type)}
            available={isAvailable(task)}
            unavailableLabel={unavailableLabel}
            onChange={() => onToggle(task.type)}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Small Components ─────────────────────────────────────

function TaskCheckbox({ task, checked, available, unavailableLabel, onChange }: { task: TaskDef; checked: boolean; available: boolean; unavailableLabel: string; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      disabled={!available}
      title={!available ? unavailableLabel : undefined}
      aria-pressed={checked}
      className={cn(
        'flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[12px] font-medium transition-all',
        checked ? 'text-zinc-200' : available ? 'text-zinc-600' : 'text-zinc-600',
        !available && 'cursor-not-allowed opacity-40'
      )}
      style={{
        background: checked ? 'var(--accent-muted-bg)' : 'transparent',
        border: checked ? '1px solid var(--accent-muted-border)' : '1px solid transparent',
      }}
    >
      <div
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded"
        style={{
          background: checked ? 'var(--accent)' : 'var(--bg-hover-2)',
          border: checked ? 'none' : '1px solid var(--border-stronger)',
        }}
      >
        {checked && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M2 5L4.2 7.5L8 2.5" stroke="var(--text-on-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      <task.icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
      <span className="truncate">{task.label}</span>
    </button>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onChange(!checked) }}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="relative h-[26px] w-[46px] shrink-0 cursor-pointer rounded-full transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
      style={{ background: checked ? 'var(--accent)' : 'var(--bg-active)' }}
    >
      <div
        aria-hidden="true"
        className={cn(
          'absolute top-[3px] h-5 w-5 rounded-full bg-white shadow-sm transition-[left] duration-200',
          checked ? 'left-[23px]' : 'left-[3px]'
        )}
      />
    </button>
  )
}

function IconBtn({ icon: Icon, title, onClick, color }: { icon: typeof Pencil; title: string; onClick: () => void; color?: string }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick() }}
      title={title}
      aria-label={title}
      className="flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-150 hover:scale-105"
      style={{ color: color ?? 'var(--text-muted)' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover-2)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      <Icon className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
    </button>
  )
}

// ─── Utilities ────────────────────────────────────────────

function frequencyLabel(frequency: ScheduleEntry['frequency'] | undefined, t: (key: string) => string): string {
  const f = frequency ?? 'weekly'
  return t(`dialog.frequency${f[0].toUpperCase()}${f.slice(1)}`)
}

function formatFrequency(entry: ScheduleEntry, t: (key: string, opts?: Record<string, unknown>) => string): string {
  return formatFrequencyFrom(entry, entry.frequency, entry.day, entry.hour, entry.minute ?? 0, t)
}

function formatFrequencyFrom(
  _entry: Partial<ScheduleEntry>,
  frequency: 'daily' | 'weekly' | 'monthly',
  day: number,
  hour: number,
  minute: number,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  switch (frequency) {
    case 'daily':
      return t('frequency.everyDayAt', { time })
    case 'weekly':
      return t('frequency.everyWeekdayAt', { day: t(DAY_NAME_KEYS[day] ?? 'dayNames.monday'), time })
    case 'monthly':
      return t('frequency.monthlyAt', { ordinalDay: ordinal(day), time })
  }
}

function formatNextRun(date: Date, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  const diffD = Math.floor(diffMs / 86_400_000)
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`

  if (diffD === 0 && date.getDate() === now.getDate()) return t('nextRun.todayAt', { time })
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (date.getFullYear() === tomorrow.getFullYear() && date.getMonth() === tomorrow.getMonth() && date.getDate() === tomorrow.getDate()) return t('nextRun.tomorrowAt', { time })
  if (diffD < 7) return t('nextRun.inDaysAt', { count: diffD, time })
  return t('nextRun.dateAt', { date: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), time })
}

function formatLastRun(iso: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffM = Math.floor(diffMs / 60_000)
  const diffH = Math.floor(diffMs / 3_600_000)
  const diffD = Math.floor(diffMs / 86_400_000)

  if (diffM < 1) return t('lastRun.justNow')
  if (diffM < 60) return t('lastRun.minutesAgo', { count: diffM })
  if (diffH < 24) return t('lastRun.hoursAgo', { count: diffH })
  if (diffD < 7) return t('lastRun.daysAgo', { count: diffD })
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
