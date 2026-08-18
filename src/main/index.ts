import { app, BrowserWindow, ipcMain, Menu, nativeImage, nativeTheme, Notification, screen, session, shell, Tray } from 'electron'
import { execFile } from 'child_process'
import { readFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { promisify } from 'util'
import { join } from 'path'

const execFileAsync = promisify(execFile)
import { execNativeUtf8, killAllChildren } from './services/exec-utf8'
import { IPC } from '../shared/channels'
import { t } from './i18n'
import { registerCleanerIpc } from './ipc'
import { runSystemScan } from './ipc/system-cleaner.ipc'
import { alertMonitor } from './services/alert-monitor'
import { installThreatMonitorAlerts } from './services/threat-monitor-alerts'
import { threatMonitor } from './services/threat-monitor'
import { getSettings, setSettings } from './services/settings-store'
import { loadWindowState, trackWindowState, MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT } from './services/window-state'
import { startScheduler, stopScheduler, getNextScanTime, notifyScheduledScanComplete, completeScheduleRun, runScheduleNow, runSoonestScheduleNow, hasEnabledSchedules } from './services/scheduler'
import { createRestorePoint } from './services/restore-point'
import { menuIconPng, overlayDotOnBitmap, recolorBitmap, type StatusColor, type MenuIconName } from './services/tray-icons'
import { startSecurityScheduler, stopSecurityScheduler } from './services/security/security-service'
import { initAutoUpdater } from './services/auto-updater'
import { attachRendererDiagnostics } from './services/renderer-diagnostics'
import { shouldDisableGpu, applyGpuFallbackSwitches, registerGpuCrashRecovery } from './services/gpu-fallback'
import { runCli } from './cli'
import { installCrashGuard } from './services/crash-guard'
import { hardenExecutablePath } from './services/path-hardening'

// ─── Crash guard ────────────────────────────────────────────
// Install before anything else so an early failure in this file is captured.
installCrashGuard()

// ─── Executable search path ─────────────────────────────────
// Before anything spawns a child process. This app runs elevated and launches
// ~90 system tools by bare name; `powershell.exe` in particular is resolved by
// walking PATH, so a user-writable directory ahead of the real one would be an
// administrator-level code execution primitive.
hardenExecutablePath()

// ─── Disable hardware acceleration ──────────────────────────
// Must be called before app.whenReady().  On machines with incompatible
// GPU drivers, broken ANGLE, or certain VM setups, Chromium's GPU
// compositor silently fails — resulting in a black window that the user
// can resize but never see content in.  For a system-cleaner utility the
// visual trade-off (software compositing) is negligible.
app.disableHardwareAcceleration()

// ─── Headless mode flags ─────────────────────────────────────
// When running without a GUI (CLI), disable sandbox
// so Electron works on headless Linux servers without X11/Wayland.
// IMPORTANT: Clear DISPLAY before Chromium initializes — otherwise the
// native layer picks the X11 ozone backend before app.commandLine
// switches are processed, and crashes if no X server is running.
if (process.argv.includes('--cli')) {
  delete process.env.DISPLAY
  delete process.env.WAYLAND_DISPLAY
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('ozone-platform', 'headless')
}

// ─── Data directory override ────────────────────────────────
// When relaunched as root (macOS/Linux), the elevated process receives
// --clarity-data-dir=<path> so it reads/writes the original user's config
// instead of /var/root/... or /root/...
const dataDirFlag = process.argv.find(a => a.startsWith('--clarity-data-dir='))
if (dataDirFlag) {
  const dir = dataDirFlag.slice('--clarity-data-dir='.length)
  if (dir && require('path').isAbsolute(dir)) {
    app.setPath('userData', dir)
  }
}

// ─── GPU process fallback ───────────────────────────────────
// disableHardwareAcceleration() still spawns a GPU process; on stripped
// Windows builds that process fails to launch and Chromium fatally aborts
// (issue #203).  If a prior launch hit that, or the user opted in, fully
// disable the GPU process.  Otherwise watch for the failure and recover by
// relaunching with --disable-gpu.  Placed after the data-dir override so
// the marker is read from the correct userData path.
if (shouldDisableGpu()) {
  applyGpuFallbackSwitches()
} else {
  registerGpuCrashRecovery()
}

// ─── Root detection (macOS + Linux) ─────────────────────────
// Chromium refuses to run as root without --no-sandbox.  Also required
// on macOS for clipboard access (paste) in the elevated process.
const isRoot =
  (process.platform === 'linux' || process.platform === 'darwin') &&
  typeof process.getuid === 'function' &&
  process.getuid() === 0

if (isRoot) {
  app.commandLine.appendSwitch('no-sandbox')
  // On some Linux desktops (e.g. Linux Mint / Cinnamon) the software
  // compositor still fails to paint when running as root — the window
  // loads (cursor reacts) but remains grey.  Disabling GPU compositing
  // forces a fallback path that reliably renders.
  if (process.platform === 'linux') {
    app.commandLine.appendSwitch('disable-gpu-compositing')
    app.commandLine.appendSwitch('in-process-gpu')
  }
}

// ─── CLI mode ────────────────────────────────────────────────
// If --cli is passed, run headless and exit — no GUI, no tray.
if (process.argv.includes('--cli')) {
  app.whenReady().then(() => runCli())
} else {
  initGui()
}

function initGui(): void {

// Prevent multiple instances — if another is already running, focus it and quit this one
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
  return
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let ipcRegistered = false
// Set once the app is actually quitting (Cmd+Q, tray Quit, OS shutdown) so the
// minimize-to-tray close interceptor lets windows close instead of aborting quit
let isQuitting = false

function getIconPath(): string {
  const ext = process.platform === 'darwin' ? 'icns' : process.platform === 'linux' ? 'png' : 'ico'
  return app.isPackaged
    ? join(process.resourcesPath, `icon.${ext}`)
    : join(__dirname, `../../resources/icon.${ext}`)
}

function getIconsDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icons')
    : join(__dirname, '../../resources/icons')
}

function createTrayIcon(): Electron.NativeImage {
  if (process.platform === 'darwin') {
    // Build a multi-resolution image so the icon is sharp on Retina displays.
    // Uses pre-rendered 16×16 (@1x) and 32×32 (@2x) PNGs instead of
    // down-scaling the 1024×1024 app icon at runtime. Template images render
    // black and let macOS invert them for light/dark menu bars automatically.
    const dir = getIconsDir()
    const trayIcon = nativeImage.createEmpty()
    trayIcon.addRepresentation({ scaleFactor: 1.0, width: 16, height: 16, buffer: readFileSync(join(dir, '16x16.png')) })
    trayIcon.addRepresentation({ scaleFactor: 2.0, width: 32, height: 32, buffer: readFileSync(join(dir, '32x32.png')) })
    trayIcon.setTemplateImage(true)
    return trayIcon
  }

  // Windows / Linux: draw the brand mark ourselves at 1x and 2x, tinted for the
  // current OS theme. Down-scaling the full-color 1024² app icon to 16px ends
  // up muddy and nearly invisible at tray size; a monochrome, high-contrast
  // mark with a @2x representation stays crisp and legible on any taskbar.
  return brandMarkImage({ tint: true })
}

/** Dark glyph on light chrome, light glyph on dark chrome. */
function themeGlyphColor(): readonly [number, number, number] {
  return nativeTheme.shouldUseDarkColors ? [232, 232, 232] : [26, 26, 26]
}

/** A crisp high-DPI nativeImage for one tray menu glyph (Windows/Linux only). */
function menuGlyphImage(name: MenuIconName): Electron.NativeImage {
  const color = themeGlyphColor()
  const img = nativeImage.createEmpty()
  img.addRepresentation({ scaleFactor: 1, width: 16, height: 16, buffer: menuIconPng(name, color, 16) })
  img.addRepresentation({ scaleFactor: 2, width: 32, height: 32, buffer: menuIconPng(name, color, 32) })
  return img
}

/** One brand-mark representation, optionally re-tinted and with a status dot. */
function brandMarkRep(size: 16 | 32, opts: { tint?: boolean; dot?: StatusColor | null }): Buffer {
  const rep = nativeImage.createFromPath(join(getIconsDir(), `${size}x${size}.png`))
  const bitmap = rep.toBitmap()
  if (!bitmap || bitmap.length === 0) return Buffer.alloc(0)
  let tinted = bitmap
  if (opts.tint) tinted = recolorBitmap(bitmap, themeGlyphColor())
  if (opts.dot) tinted = overlayDotOnBitmap(tinted, size, size, opts.dot)
  return nativeImage.createFromBitmap(tinted, { width: size, height: size }).toPNG()
}

/** Multi-resolution tray image: the brand mark, optionally theme-tinted + status dot. */
function brandMarkImage(opts: { tint?: boolean; dot?: StatusColor | null } = {}): Electron.NativeImage {
  const img = nativeImage.createEmpty()
  for (const size of [16, 32] as const) {
    const png = brandMarkRep(size, opts)
    if (png.length === 0) continue
    img.addRepresentation({ scaleFactor: size / 16, width: size, height: size, buffer: png })
  }
  return img
}

const TASK_NAME = 'ClarityStartup'
/** The only arguments the startup task is allowed to carry — verified after registration. */
const TASK_ARGUMENTS = '--startup'

async function applyAutoLaunchWin32(enabled: boolean): Promise<void> {
  // Use Task Scheduler with RunLevel HighestAvailable so the app starts
  // elevated at logon. The HKCU Run key is NOT a viable fallback because
  // the exe manifest is requireAdministrator — Windows silently skips
  // Run-key entries for executables with an admin manifest.
  const exePath = app.getPath('exe')

  if (enabled) {
    // Remove any stale task first, then create a fresh one
    try {
      await execNativeUtf8('schtasks',[
        '/Delete', '/TN', TASK_NAME, '/F'
      ], { timeout: 10000 })
    } catch { /* task may not exist yet */ }

    // Build the task via XML so the /TR value is never subject to
    // schtasks command-line quoting quirks (common cause of silent failures
    // when the exe path contains spaces, e.g. "C:\Program Files\...").
    const xml = [
      '<?xml version="1.0" encoding="UTF-16"?>',
      '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
      '  <Triggers>',
      '    <LogonTrigger><Enabled>true</Enabled></LogonTrigger>',
      '    <SessionStateChangeTrigger>',
      '      <Enabled>true</Enabled>',
      '      <StateChange>ConsoleConnect</StateChange>',
      '    </SessionStateChangeTrigger>',
      '  </Triggers>',
      '  <Principals>',
      '    <Principal id="Author">',
      '      <LogonType>InteractiveToken</LogonType>',
      '      <RunLevel>HighestAvailable</RunLevel>',
      '    </Principal>',
      '  </Principals>',
      '  <Settings>',
      '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>',
      '    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>',
      '    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>',
      '    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>',
      '    <Enabled>true</Enabled>',
      '  </Settings>',
      '  <Actions Context="Author">',
      `    <Exec>`,
      `      <Command>${escapeXml(exePath)}</Command>`,
      `      <Arguments>${escapeXml(TASK_ARGUMENTS)}</Arguments>`,
      '    </Exec>',
      '  </Actions>',
      '</Task>'
    ].join('\r\n')

    // The XML lands in %LOCALAPPDATA%\Temp, which any process running as this
    // user can write \u2014 including a non-elevated one. Since schtasks reads it
    // back elevated and the task carries RunLevel HighestAvailable, a swap
    // between our write and its read would register an attacker's command as a
    // logon-triggered admin task. A random name denies the attacker a path to
    // camp on, and the post-registration check below is what actually settles
    // it: whatever ends up registered has to be the command we asked for.
    const { writeFile, unlink, mkdtemp, rmdir } = await import('fs/promises')
    const tmpDir = await mkdtemp(join(app.getPath('temp'), 'clarity-task-'))
    const tmpPath = join(tmpDir, `${randomUUID()}.xml`)
    await writeFile(tmpPath, '\uFEFF' + xml, 'utf-16le')

    try {
      await execNativeUtf8('schtasks',[
        '/Create',
        '/TN', TASK_NAME,
        '/XML', tmpPath,
        '/F',
      ], { timeout: 10000 })
    } finally {
      await unlink(tmpPath).catch(() => {})
      await rmdir(tmpDir).catch(() => {})
    }

    // Verify what was actually registered, not merely that something was.
    // If the definition isn't the one we submitted, the XML was tampered with
    // in the window above \u2014 tear the task down rather than leave an elevated
    // logon entry running something else.
    //
    // A query that fails or times out is also a failure to verify, and is
    // treated the same way: an unverified elevated logon task must not survive
    // this function, whatever the reason we couldn't check it.
    let verified = false
    try {
      const { stdout: registered } = await execNativeUtf8('schtasks',[
        '/Query', '/TN', TASK_NAME, '/XML', 'ONE'
      ], { timeout: 10000 })
      verified = registeredTaskMatches(registered, exePath, TASK_ARGUMENTS)
    } catch { /* treated as unverified below */ }

    if (!verified) {
      await execNativeUtf8('schtasks',[
        '/Delete', '/TN', TASK_NAME, '/F'
      ], { timeout: 10000 }).catch(() => {})
      throw new Error('Startup task verification failed \u2014 the registered task did not match')
    }
  } else {
    try {
      await execNativeUtf8('schtasks',[
        '/Delete', '/TN', TASK_NAME, '/F'
      ], { timeout: 10000 })
    } catch { /* task may not exist */ }
  }

  // Clear any leftover Electron Run-key entry so it doesn't conflict
  app.setLoginItemSettings({ openAtLogin: false })
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Is the registered task definition exactly the one we asked for?
 *
 * Task Scheduler runs the whole <Actions> block at HighestAvailable, so
 * matching the command alone is not enough. Arguments decide what that command
 * does — `--inspect-brk` would turn our own binary into arbitrary elevated code
 * execution — and a definition may carry action types other than Exec
 * (ComHandler, SendEmail, ShowMessage) that run without naming a command at
 * all. So this requires precisely one Exec action, the expected command, the
 * expected arguments, and no other action of any kind.
 *
 * Returns false on anything it cannot account for, so an unparseable or empty
 * read is a failed verification rather than a pass.
 */
function registeredTaskMatches(taskXml: string, exePath: string, expectedArgs: string): boolean {
  const actionsBlock = taskXml.match(/<Actions\b[^>]*>([\s\S]*?)<\/Actions>/i)
  if (!actionsBlock) return false
  const actions = actionsBlock[1]

  // Any element directly under <Actions> is an action. Exactly one, and it
  // must be an Exec.
  const actionTags = [...actions.matchAll(/<([A-Za-z][\w.-]*)\b/g)]
    .map((m) => m[1])
    .filter((tag) => !TASK_EXEC_CHILD_TAGS.has(tag))
  if (actionTags.length !== 1 || actionTags[0].toLowerCase() !== 'exec') return false

  const commands = [...actions.matchAll(/<Command>([\s\S]*?)<\/Command>/gi)]
  if (commands.length !== 1) return false
  const command = decodeXmlEntities(commands[0][1].trim().replace(/^"|"$/g, '')).toLowerCase()
  if (command !== exePath.trim().toLowerCase()) return false

  // Arguments may legitimately be absent only if we asked for none.
  const argMatches = [...actions.matchAll(/<Arguments>([\s\S]*?)<\/Arguments>/gi)]
  if (argMatches.length > 1) return false
  const args = argMatches.length === 1 ? decodeXmlEntities(argMatches[0][1].trim()) : ''
  return args === expectedArgs.trim()
}

/** Elements that appear *inside* an Exec action rather than being actions themselves. */
const TASK_EXEC_CHILD_TAGS = new Set(['Command', 'Arguments', 'WorkingDirectory'])

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

async function applyAutoLaunch(enabled: boolean): Promise<void> {
  // Only register auto-launch when packaged — in dev mode this would register
  // the bare Electron binary, causing a generic "Getting Started" window on reboot.
  if (!app.isPackaged) return

  if (process.platform === 'win32') {
    await applyAutoLaunchWin32(enabled)
  } else {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      args: ['--startup']
    })
  }
}

// ─── Tray ─────────────────────────────────────────────────
const TRAY_REFRESH_MS = 60_000

let trayRefreshTimer: ReturnType<typeof setInterval> | null = null
let quickScanInFlight = false
let lastTrayFingerprint = ''
let lastStatusColor: StatusColor | null = null

/** Routes the tray can jump to. The renderer validates them again on receipt. */
const TRAY_NAV_ITEMS: { route: string; icon: MenuIconName; labelKey: string }[] = [
  { route: '/', icon: 'home', labelKey: 'trayOpenDashboard' },
  { route: '/cleaner', icon: 'eraser', labelKey: 'trayOpenCleaner' },
  { route: '/malware', icon: 'bug', labelKey: 'trayOpenMalware' },
  { route: '/performance', icon: 'gauge', labelKey: 'trayOpenPerformance' },
  { route: '/settings', icon: 'sliders', labelKey: 'trayOpenSettings' },
]

function showMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  } else {
    createWindow()
  }
}

function navigateFromTray(route: string): void {
  showMainWindow()
  const win = mainWindow
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC.TRAY_NAVIGATE, route)
  }
}

async function runTrayQuickScan(): Promise<void> {
  if (quickScanInFlight) return
  quickScanInFlight = true
  refreshTrayMenu()
  try {
    const results = await runSystemScan(() => mainWindow)
    const totalSize = results.reduce((s, r) => s + r.totalSize, 0)
    const itemCount = results.reduce((s, r) => s + r.itemCount, 0)
    notifyScheduledScanComplete(totalSize, itemCount)
  } catch (err) {
    console.error('Tray quick scan failed:', err)
  } finally {
    quickScanInFlight = false
    refreshTrayMenu()
  }
}

async function runTrayRestorePoint(): Promise<void> {
  const result = await createRestorePoint('Clarity tray restore point')
  if (Notification.isSupported()) {
    new Notification({
      title: t(result.success ? 'trayRestorePointOkTitle' : 'trayRestorePointFailTitle'),
      body: result.success
        ? t('trayRestorePointOkBody')
        : t('trayRestorePointFailBody', { error: result.error ?? '' }),
      silent: true
    }).show()
  }
}

function formatNextScan(date: Date): string {
  const lang = getSettings().language || 'en'
  const now = new Date()
  const time = new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit' }).format(date)
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (sameDay) return `${t('trayToday')} ${time}`
  return new Intl.DateTimeFormat(lang, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(date)
}

interface TrayStatus {
  nextScanLabel: string | null
  alerts: number
  threats: number
  showThreatNotifications: boolean
  scheduleEnabled: boolean
}

function readTrayStatus(): TrayStatus {
  const settings = getSettings()
  const next = getNextScanTime(settings)
  const snapshot = threatMonitor.getThreatSnapshot()
  return {
    nextScanLabel: next ? formatNextScan(next) : null,
    alerts: alertMonitor.getHistory().length,
    threats: snapshot ? snapshot.flaggedConnections.length + snapshot.flaggedDns.length : 0,
    showThreatNotifications: settings.showThreatNotifications,
    scheduleEnabled: hasEnabledSchedules(settings),
  }
}

function trayFingerprint(s: TrayStatus): string {
  return [
    s.nextScanLabel, s.alerts, s.threats, s.showThreatNotifications, s.scheduleEnabled, quickScanInFlight,
    // The glyph colour is baked into every menu icon at build time, so the OS
    // theme is part of what the menu displays. Without it here the fingerprint
    // matched after a light/dark switch, refreshTrayMenu() returned early, and
    // the icons kept the old colour — dark glyphs on a dark menu bar.
    nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
  ].join('|')
}

function statusColorFor(s: TrayStatus): StatusColor | null {
  if (s.threats > 0 || s.alerts > 0) return 'red'
  if (s.scheduleEnabled || s.nextScanLabel) return 'amber'
  return null
}

function buildTrayContextMenu(s: TrayStatus): Electron.Menu {
  const statusSubmenu: Electron.MenuItemConstructorOptions[] = [
    s.nextScanLabel
      ? { label: `${t('trayNextScan')}: ${s.nextScanLabel}`, enabled: false }
      : { label: t('trayNoSchedule'), enabled: false },
    { label: `${t('trayAlerts')}: ${s.alerts}`, enabled: false },
    { label: `${t('trayThreatFlags')}: ${s.threats}`, enabled: false },
    { type: 'separator' },
    {
      label: t('trayThreatNotifications'),
      type: 'checkbox',
      checked: s.showThreatNotifications,
      click: (item) => setSettings({ showThreatNotifications: item.checked }),
    },
  ]

  const win32 = process.platform === 'win32'

  return Menu.buildFromTemplate([
    { label: t('openClarity'), icon: menuGlyphImage('home'), click: showMainWindow },
    { type: 'separator' },
    {
      label: t('trayQuickScan'),
      icon: menuGlyphImage('quickScan'),
      enabled: !quickScanInFlight,
      click: () => { void runTrayQuickScan() },
    },
    {
      label: t('trayRunScheduledScan'),
      icon: menuGlyphImage('play'),
      enabled: s.scheduleEnabled,
      click: () => { runSoonestScheduleNow(() => mainWindow) },
    },
    ...(win32 ? [{
      label: t('trayRestorePoint'),
      icon: menuGlyphImage('restorePoint'),
      click: () => { void runTrayRestorePoint() },
    }] : []),
    { type: 'separator' },
    {
      label: t('trayStatus'),
      icon: menuGlyphImage('activity'),
      submenu: statusSubmenu,
    },
    {
      label: t('trayOpenMenu'),
      icon: menuGlyphImage('sliders'),
      submenu: TRAY_NAV_ITEMS.map((item) => ({
        label: t(item.labelKey),
        icon: menuGlyphImage(item.icon),
        click: () => navigateFromTray(item.route),
      })),
    },
    { type: 'separator' },
    { label: t('quit'), icon: menuGlyphImage('power'), click: () => app.quit() },
  ])
}

/**
 * Tray icon variant with a colored status dot (red = attention, amber = active).
 * The base mark is re-tinted to the current theme first — the dot variant has to
 * be a regular (non-template) image, and a raw black template mark would vanish
 * on a dark menu bar.
 */
function createStatusTrayIcon(color: StatusColor): Electron.NativeImage {
  const img = brandMarkImage({ tint: true, dot: color })
  if (process.platform === 'darwin') img.setTemplateImage(false)
  return img
}

function updateTrayStatusIcon(force = false): void {
  if (!tray) return
  const color = statusColorFor(readTrayStatus())
  if (color === lastStatusColor && !force) return
  lastStatusColor = color
  if (!color) {
    tray.setImage(createTrayIcon())
    return
  }
  tray.setImage(createStatusTrayIcon(color))
}

/**
 * Rebuild the tray context menu only when something it displays actually
 * changed, so an open menu isn't closed on a fixed 60s cadence for no reason.
 */
function refreshTrayMenu(): void {
  if (!tray) return
  const status = readTrayStatus()
  const fp = trayFingerprint(status)
  if (fp === lastTrayFingerprint) return
  lastTrayFingerprint = fp
  tray.setToolTip(t('trayTooltip'))
  tray.setContextMenu(buildTrayContextMenu(status))
  updateTrayStatusIcon()
}

function createTray(): void {
  if (tray) return

  tray = new Tray(createTrayIcon())
  tray.setToolTip(t('trayTooltip'))
  tray.setContextMenu(buildTrayContextMenu(readTrayStatus()))
  tray.on('double-click', showMainWindow)
  lastTrayFingerprint = trayFingerprint(readTrayStatus())

  // Keep "next scan", alert counts and the icon status dot current while running
  trayRefreshTimer = setInterval(refreshTrayMenu, TRAY_REFRESH_MS)
}

/**
 * Redraw the tray for the current OS theme.
 *
 * Every glyph — the brand mark on Windows/Linux and all the menu icons — is
 * rasterized in a single colour chosen from `nativeTheme` at build time. Nothing
 * was listening for a theme change, so switching the OS between light and dark
 * left those pixels as they were: on macOS the menu icons, and on Windows/Linux
 * the tray icon itself, became near-invisible against the new chrome until
 * something else happened to invalidate the fingerprint.
 *
 * The status icon is forced because its colour is unchanged by a theme switch —
 * only the tint underneath it is — so the usual equality guard would skip it.
 */
function handleThemeChange(): void {
  if (!tray) return
  lastTrayFingerprint = ''
  refreshTrayMenu()
  updateTrayStatusIcon(true)
}

/** Force a full tray rebuild (e.g. after a language change). */
function rebuildTrayMenu(): void {
  lastTrayFingerprint = ''
  lastStatusColor = null
  refreshTrayMenu()
}

function destroyTray(): void {
  if (trayRefreshTimer) {
    clearInterval(trayRefreshTimer)
    trayRefreshTimer = null
  }
  if (tray) {
    tray.destroy()
    tray = null
  }
  lastTrayFingerprint = ''
  lastStatusColor = null
}

function createWindow(): void {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize
  const defaultWidth = Math.round(screenWidth * 0.75)
  const defaultHeight = Math.round(screenHeight * 0.8)

  // Reopen at the size/position the user left the window at (issue #270).
  const { width, height, x, y, isMaximized } = loadWindowState({
    width: defaultWidth,
    height: defaultHeight
  })

  const icon = nativeImage.createFromPath(getIconPath())

  mainWindow = new BrowserWindow({
    width,
    height,
    // Omitted when no saved position survived validation, so Electron centres.
    ...(x !== undefined && y !== undefined ? { x, y } : {}),
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    frame: false,
    backgroundColor: '#09090b',
    icon,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Chromium's renderer sandbox uses Linux namespaces that fail
      // when running as root (e.g. after pkexec relaunch).  The
      // --no-sandbox switch only covers the browser/GPU processes;
      // this flag must also be false to prevent a blank grey window.
      sandbox: !isRoot
    }
  })

  // Maximize before first paint so the window never flashes at its restored
  // size; getNormalBounds() keeps the un-maximized geometry for later.
  if (isMaximized) mainWindow.maximize()

  trackWindowState(mainWindow)

  const settings = getSettings()
  // Detect startup launch: --startup flag (Windows Task Scheduler / Linux),
  // or macOS wasOpenedAtLogin (since macOS 13+ drops argv from login items).
  const isStartupLaunch = process.argv.includes('--startup')
    || (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin)

  attachRendererDiagnostics(mainWindow)

  mainWindow.on('ready-to-show', () => {
    // If launched at startup with minimize-to-tray, stay hidden
    if (isStartupLaunch && settings.minimizeToTray) {
      // Don't show — just sit in tray
    } else {
      mainWindow?.show()
    }
  })

  // Intercept close to minimize to tray if enabled
  mainWindow.on('close', (e) => {
    if (isQuitting) return
    const currentSettings = getSettings()
    if (currentSettings.minimizeToTray && mainWindow && !mainWindow.isDestroyed()) {
      e.preventDefault()
      mainWindow.hide()
    }
  })

  // Whether a navigation target is still the app's own document.
  //
  // Compared against where the app is *known* to live rather than against
  // webContents.getURL(): that is the empty string until the first load
  // completes, so a guard derived from it would classify the app's own opening
  // document as external the one time it cannot afford to. Packaged builds load
  // from file:// (opaque "null" origin, so the scheme is the only usable test);
  // the dev server has a real http origin that compares properly.
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  const appOrigin = rendererUrl ? new URL(rendererUrl).origin : null
  const isInternalNavigation = (target: string): boolean => {
    try {
      const t = new URL(target)
      return appOrigin ? t.origin === appOrigin : t.protocol === 'file:'
    } catch {
      return false
    }
  }

  mainWindow.webContents.setWindowOpenHandler((details) => {
    // Only allow opening HTTPS URLs externally
    try {
      const url = new URL(details.url)
      if (url.protocol === 'https:') {
        shell.openExternal(details.url)
      }
    } catch {
      // Invalid URL, ignore
    }
    return { action: 'deny' }
  })

  // Navigation lockdown.
  //
  // setWindowOpenHandler above only covers window.open and target="_blank". It
  // does not see in-page navigation, so a link without a target, an HTTP
  // redirect, or a stray location.href would replace the app with a remote
  // document *in the window that has the preload bridge attached* — handing that
  // page the whole IPC surface.
  //
  // Nothing here navigates legitimately: routing is react-router operating on
  // history state, which raises did-navigate-in-page rather than will-navigate.
  // So the app's own document is allowed through (this is what keeps the dev
  // server's reload working) and everything else is refused, with https handed
  // to the real browser for consistency with the handler above.
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (isInternalNavigation(targetUrl)) return
    event.preventDefault()
    try {
      if (new URL(targetUrl).protocol === 'https:') shell.openExternal(targetUrl)
    } catch {
      // Not a URL worth handing anywhere.
    }
  })

  // Register IPC handlers only once to avoid stacking on window recreation
  if (!ipcRegistered) {
    // Window control IPC — use current mainWindow reference
    ipcMain.on(IPC.WINDOW_MINIMIZE, () => mainWindow?.minimize())
    ipcMain.on(IPC.WINDOW_MAXIMIZE, () => {
      if (mainWindow?.isMaximized()) {
        mainWindow.unmaximize()
      } else {
        mainWindow?.maximize()
      }
    })
    ipcMain.on(IPC.WINDOW_CLOSE, () => mainWindow?.close())

    // Register all IPC handlers (pass getter so handlers always use current window)
    registerCleanerIpc(() => mainWindow)

    ipcRegistered = true
  }

  // Load the app
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    if (!mainWindow.isVisible()) mainWindow.show()
    mainWindow.focus()
  }
})

app.whenReady().then(() => {
  // On macOS, ensure the Dock icon is visible.  When relaunched as root
  // via osascript the binary is executed directly (not through `open` /
  // LaunchServices), so the Dock icon won't appear automatically.
  if (process.platform === 'darwin' && app.dock) {
    app.dock.show()
  }

  // Ensure an Edit menu exists so clipboard shortcuts (Cmd+C/V/X on macOS,
  // Ctrl+C/V/X elsewhere) work in the frameless window.  On macOS Cmd+V
  // relies on an Edit menu with the paste role — without an explicit menu
  // the shortcuts break when the app is relaunched as root.
  // We preserve the default appMenu role so Cmd+Q, Cmd+H, About, etc. stay.
  const appMenu = Menu.buildFromTemplate([
    { role: 'appMenu' },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    }
  ])
  Menu.setApplicationMenu(appMenu)

  // The Wi-Fi tool needs macOS Location Services: without it CoreWLAN withholds
  // every BSSID and country code. Electron has no API to raise that prompt, but
  // it routes `navigator.geolocation` through CoreLocation on macOS — so the
  // Wi-Fi page asks for a position purely to trigger the system dialog, and
  // this handler is what lets that request through. Only geolocation is
  // allowed; everything else a page could ask for is refused.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'geolocation')
  })
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => permission === 'geolocation')

  const settings = getSettings()

  // Apply auto-launch setting
  applyAutoLaunch(settings.runAtStartup).catch((err) => {
    console.error('Failed to configure auto-launch:', err)
  })

  // Create tray if minimize-to-tray is enabled or any schedule is active
  if (settings.minimizeToTray || settings.schedules.some((s) => s.enabled)) {
    createTray()
  }

  createWindow()

  // Initialize auto-updater
  initAutoUpdater()

  // Start the scheduled scan checker
  startScheduler(() => mainWindow)

  // Start the Network Security tool's scheduled catalog scans (self-guards on autoProbeEnabled)
  startSecurityScheduler()

  // Start the proactive alert monitor (self-guards on alerts.enabled)
  alertMonitor.start()

  // Start the threat monitor with the bundled seed blacklist — free and offline.
  installThreatMonitorAlerts()
  threatMonitor.start()

  // Listen for settings changes to update auto-launch and tray
  ipcMain.handle(IPC.SETTINGS_APPLY_STARTUP, async (_event, enabled: boolean) => {
    await applyAutoLaunch(enabled)
  })

  ipcMain.on(IPC.SETTINGS_APPLY_TRAY, (_event, enabled: boolean) => {
    if (enabled) {
      createTray()
    } else if (!getSettings().schedules.some((s) => s.enabled)) {
      destroyTray()
    }
  })

  // Rebuild tray menu when language changes so labels update immediately
  app.on('clarity:language-changed' as any, () => {
    rebuildTrayMenu()
  })

  // Redraw tray glyphs when the OS switches between light and dark.
  nativeTheme.on('updated', handleThemeChange)

  // IPC to get next scan time for the UI
  ipcMain.handle(IPC.SCHEDULE_NEXT_SCAN, () => {
    const s = getSettings()
    const next = getNextScanTime(s)
    return next ? next.toISOString() : null
  })

  // Handle scheduled scan completion notification from renderer
  ipcMain.on(IPC.SCHEDULE_SCAN_COMPLETE, (_event, totalSize: number, itemCount: number) => {
    notifyScheduledScanComplete(totalSize, itemCount)
  })

  // Handle multi-schedule run completion
  const VALID_RUN_STATUSES = new Set(['success', 'partial', 'failed', 'never'])
  ipcMain.on(IPC.SCHEDULE_RUN_COMPLETE, (_event, scheduleId: unknown, status: unknown) => {
    if (typeof scheduleId !== 'string' || typeof status !== 'string') return
    if (!VALID_RUN_STATUSES.has(status)) return
    completeScheduleRun(scheduleId, status as 'success' | 'partial' | 'failed' | 'never')
  })

  // Run a schedule immediately (Run Now)
  ipcMain.on(IPC.SCHEDULE_RUN_NOW, (_event, scheduleId: unknown) => {
    if (typeof scheduleId !== 'string') return
    runScheduleNow(scheduleId, () => mainWindow)
  })

  app.on('activate', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Window exists but may be hidden (minimize-to-tray) — restore it
      mainWindow.show()
      mainWindow.focus()
    } else if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  const settings = getSettings()
  // Don't quit if minimize-to-tray or any schedule is enabled
  if (settings.minimizeToTray || settings.schedules.some((s) => s.enabled)) {
    // Stay alive in tray
    return
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// On macOS, autoUpdater.quitAndInstall() closes all windows *before* emitting
// before-quit, so mark quitting from this earlier signal too. Electron 41's
// typings omit this event overload, but it is a real runtime event.
app.on('before-quit-for-update' as 'before-quit', () => {
  isQuitting = true
})

app.on('before-quit', () => {
  isQuitting = true
  stopScheduler()
  stopSecurityScheduler()
  // Kill any active child processes (reg.exe, cmd.exe, etc.) to prevent orphans
  killAllChildren()
})

} // end initGui
