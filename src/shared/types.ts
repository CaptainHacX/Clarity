export interface PlatformInfo {
  platform: 'win32' | 'darwin' | 'linux'
  features: {
    registry: boolean
    debloater: boolean
    drivers: boolean
    restorePoint: boolean
    bootTrace: boolean
    gameMode: boolean
    firewallAudit: boolean
    contextMenu: boolean
    portManager: boolean
  }
}

export interface ScanHistoryCategory {
  name: string
  itemsFound: number
  itemsCleaned: number
  spaceSaved: number
}

export type HistoryEntryType =
  | 'cleaner'
  | 'registry'
  | 'debloater'
  | 'network'
  | 'drivers'
  | 'malware'
  | 'privacy'
  | 'startup'
  | 'services'
  | 'software-update'
  | 'cve-scan'

export interface ScanHistoryEntry {
  id: string
  type: HistoryEntryType
  timestamp: string
  duration: number
  totalItemsFound: number
  totalItemsCleaned: number
  totalItemsSkipped: number
  totalSpaceSaved: number
  categories: ScanHistoryCategory[]
  errorCount: number
  /** true when the entry was created by the scheduler rather than a manual action */
  scheduled?: boolean
  /** Name of the schedule that triggered this entry */
  scheduleName?: string
  /**
   * ISO timestamps bounding the clean phase of this entry. Used to look up the
   * individual deleted paths in the deletion log, which is written separately
   * so a 100k-file clean never has to travel through a history entry.
   * Absent on entries recorded before the deletion log existed.
   */
  cleanedFrom?: string
  cleanedTo?: string
}

/** Which surface triggered a deletion. */
export type DeletionOrigin = 'local' | 'cloud' | 'cli'

/** One deleted path, as persisted to the deletion log. */
export interface DeletedFileRecord {
  /** ISO timestamp of the deletion */
  ts: string
  path: string
  size: number
  category: string
  /**
   * Surface that triggered the deletion. A cloud-triggered clean can overlap a
   * manual one, so history filters on this rather than trusting the time window
   * alone. Absent on records written before origins were tracked; treated as
   * 'local'.
   */
  origin?: DeletionOrigin
  /**
   * On a directory record, how many further descendants existed beyond the
   * per-item listing cap. Present only when the list was capped, so a truncated
   * audit trail never reads as a complete one.
   */
  truncated?: number
}

/** A windowed page of deletion-log records, plus the context the UI needs. */
export interface DeletionLogPage {
  records: DeletedFileRecord[]
  /** Total records matching the window, before offset/limit are applied */
  total: number
  /** Absolute path of the log file, for reveal/export affordances */
  logPath: string
  /** Whether deletion logging is currently enabled in settings */
  enabled: boolean
}

export interface ScanItem {
  id: string
  path: string
  size: number
  category: string
  subcategory: string
  lastModified: number
  selected: boolean
}

export interface ScanResult {
  category: string
  subcategory: string
  group?: string
  items: ScanItem[]
  totalSize: number
  itemCount: number
}

export interface CleanResult {
  totalCleaned: number
  filesDeleted: number
  filesSkipped: number
  errors: CleanError[]
  needsElevation: boolean
}

export interface CleanError {
  path: string
  reason: string
}

export interface ProgressData {
  phase: 'scanning' | 'cleaning'
  category: string
  currentPath: string
  progress: number
  itemsFound: number
  sizeFound: number
}

export interface RegistryFixAction {
  op: 'delete-value' | 'delete-key' | 'set-value' | 'disable-task' | 'delete-task'
  key?: string        // full registry key (overrides keyPath if abbreviated)
  value?: string      // value name (overrides valueName if different)
  regType?: string    // REG_DWORD, REG_SZ
  data?: string       // value data to set
}

export interface RegistryEntry {
  id: string
  type: 'obsolete' | 'invalid' | 'orphaned' | 'broken' | 'vulnerability' | 'privacy' | 'performance' | 'network' | 'service' | 'task'
  keyPath: string
  valueName: string
  issue: string
  risk: 'low' | 'medium' | 'high'
  selected: boolean
  fix?: RegistryFixAction
}

export interface StartupItem {
  id: string
  name: string
  displayName: string
  command: string
  location: string
  source: 'registry-hkcu' | 'registry-hklm' | 'startup-folder' | 'task-scheduler'
    | 'launch-agent-user' | 'launch-agent-global' | 'login-item'
    | 'systemd-user' | 'autostart-desktop' | 'cron'
  enabled: boolean
  publisher: string
  impact: 'high' | 'medium' | 'low' | 'none'
  /** The program this entry launches is no longer installed. */
  stale?: boolean
}

export interface StartupBootEntry {
  name: string
  displayName: string
  delayMs: number
  source: StartupItem['source']
  impact: StartupItem['impact']
}

export interface StartupBootTrace {
  totalBootMs: number
  lastBootDate: string | null
  mainPathMs: number
  startupAppsMs: number
  entries: StartupBootEntry[]
  available: boolean
  needsAdmin: boolean
}



export interface DiskNode {
  name: string
  path: string
  size: number
  children?: DiskNode[]
  isFile?: boolean
}

export interface DriveInfo {
  letter: string
  label: string
  totalSize: number
  freeSpace: number
  usedSpace: number
}

export interface FileTypeInfo {
  extension: string
  totalSize: number
  fileCount: number
}

export interface AppStats {
  totalSpaceSaved: number
  totalFilesCleaned: number
  totalScans: number
  lastScanDate: string | null
  recentActivity: ActivityEntry[]
}

export interface ActivityEntry {
  id: string
  type: 'clean' | 'registry' | 'startup' | 'scan' | 'drivers' | 'network'
  message: string
  timestamp: string
  spaceSaved?: number
}

/**
 * Last known main-window geometry, persisted so a resized/moved window comes
 * back the same way on the next launch.  `x`/`y` are omitted when the window
 * has never been positioned explicitly (first run) or when the saved position
 * no longer lands on a connected display.
 */
export interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  isMaximized: boolean
}

export interface BloatwareApp {
  id: string
  name: string
  packageName: string
  publisher: string
  category: 'microsoft' | 'oem' | 'gaming' | 'media' | 'communication' | 'utility'
  description: string
  size: string
  selected: boolean
}

export interface NetworkItem {
  id: string
  type: 'dns-cache' | 'wifi-profile' | 'arp-cache' | 'network-history'
  label: string
  detail: string
  selected: boolean
}

export interface NetworkCleanResult {
  cleaned: number
  failed: number
  details: string[]
}

export interface MalwareThreat {
  id: string
  path: string
  fileName: string
  size: number
  detectionName: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  source: 'defender' | 'heuristic' | 'signature'
  details: string
  selected: boolean
}

export type MalwareScanStep =
  | 'init'
  | 'discovering'
  | 'heuristics'
  | 'scripts'
  | 'system'
  | 'persistence'
  | 'defender'
  | 'complete'

export interface MalwareCategoryProgress {
  id: MalwareScanStep
  label: string
  status: 'pending' | 'running' | 'done' | 'skipped'
  /** 0-100 within this category */
  progress: number
  threatsFound: number
  itemsScanned: number
  totalItems: number
}

export interface MalwareScanProgress {
  phase: 'scanning' | 'quarantining' | 'deleting'
  step: MalwareScanStep
  stepLabel: string
  currentPath: string
  progress: number
  threatsFound: number
  filesScanned: number
  totalFiles: number
  engine: string
  completedSteps: string[]
  /** Per-category progress for the multi-phase UI */
  categories: MalwareCategoryProgress[]
}

export interface MalwareScanResult {
  threats: MalwareThreat[]
  filesScanned: number
  duration: number
  engines: string[]
}

export interface MalwareActionResult {
  succeeded: number
  failed: number
  errors: { path: string; reason: string }[]
}

export interface QuarantinedItem {
  quarantinedPath: string
  originalPath: string
  originalFileName: string
  quarantinedAt: number
  size: number
  /** Why the file was flagged — captured at quarantine time (optional for legacy entries). */
  detectionName?: string
  severity?: 'critical' | 'high' | 'medium' | 'low'
  source?: 'defender' | 'heuristic' | 'signature'
  details?: string
}

/** A file the user marked as a false positive. Detections whose content hash
 *  matches `sha256` are suppressed on future scans. Path/fileName/detectionName
 *  are retained for display in the allowlist management UI only. */
export interface MalwareAllowlistEntry {
  sha256: string
  path: string
  fileName: string
  detectionName?: string
  addedAt: number
}

/** Detection metadata passed alongside a path when quarantining, so the
 *  quarantine list can show why each file was flagged. */
export interface QuarantineMeta {
  path: string
  detectionName?: string
  severity?: 'critical' | 'high' | 'medium' | 'low'
  source?: 'defender' | 'heuristic' | 'signature'
  details?: string
}

// ─── Privacy Shield ──────────────────────────────────────────
export interface PrivacySetting {
  id: string
  category: 'telemetry' | 'ads' | 'search' | 'services' | 'tasks' | 'sync' | 'kernel' | 'network' | 'access' | 'ai' | 'browser'
  label: string
  description: string
  enabled: boolean          // true = privacy-friendly (tracking disabled)
  reversible: boolean       // true = can be reverted to Windows default
  requiresAdmin: boolean
  dependsOn?: string        // ID of a setting that must be enabled first
}

export interface PrivacyShieldState {
  settings: PrivacySetting[]
  score: number             // 0-100 privacy score
  total: number             // total settings count
  protected: number         // settings already privacy-friendly
}

export interface PrivacyScanProgress {
  current: number
  total: number
  currentLabel: string
  category: string
}

export interface PrivacyApplyResult {
  succeeded: number
  failed: number
  errors: { id: string; label: string; reason: string }[]
}

// ─── Driver Manager ─────────────────────────────────────────
export interface DriverPackage {
  id: string
  publishedName: string       // e.g. "oem42.inf"
  originalName: string        // e.g. "nvlddmkm.inf"
  provider: string
  className: string           // e.g. "Display adapters"
  version: string
  date: string
  signer: string
  folderPath: string          // full path in FileRepository
  size: number                // bytes
  isCurrent: boolean          // true = actively bound to hardware
  selected: boolean
}

export interface DriverScanResult {
  packages: DriverPackage[]
  totalStaleSize: number
  totalStaleCount: number
  totalCurrentCount: number
}

export interface DriverCleanResult {
  removed: number
  failed: number
  spaceRecovered: number
  errors: { publishedName: string; reason: string }[]
}

export interface DriverScanProgress {
  phase: 'enumerating' | 'analyzing' | 'measuring'
  current: number
  total: number
  currentDriver: string
}

export interface DriverUpdate {
  id: string
  updateId: string            // Windows Update Identity.UpdateID (used for install matching)
  deviceName: string
  deviceId: string
  className: string
  currentVersion: string
  currentDate: string
  availableVersion: string
  availableDate: string
  provider: string
  updateTitle: string       // Windows Update title string
  downloadSize: string      // human-readable size from WU
  selected: boolean
}

export interface DriverUpdateScanResult {
  updates: DriverUpdate[]
  totalAvailable: number
  scanDuration: number
  // True when Windows is configured to exclude drivers from Windows Update
  // (policy / device-installation setting), so no WU driver scan was performed.
  updatesDisabled: boolean
}

export interface DriverUpdateInstallResult {
  installed: number
  failed: number
  rebootRequired: boolean
  errors: { deviceName: string; reason: string }[]
}

export interface DriverUpdateProgress {
  phase: 'checking' | 'downloading' | 'installing'
  current: number
  total: number
  currentDevice: string
  percent: number
}

export interface RestorePointResult {
  success: boolean
  error?: string
}

// ─── Performance Monitor ────────────────────────────────────
export interface PerfSystemInfo {
  cpuModel: string
  cpuCores: number
  cpuThreads: number
  totalMemBytes: number
  osVersion: string
  hostname: string
}

/** Lightweight stats for dashboard gauges — no systeminformation dependency */
export interface PerfQuickStats {
  cpuPercent: number
  memUsedBytes: number
  memTotalBytes: number
  memPercent: number
}

export interface PerfSnapshot {
  timestamp: number
  cpu: { overall: number; perCore: number[] }
  memory: { usedBytes: number; totalBytes: number; cachedBytes: number; percent: number }
  disk: { readBytesPerSec: number; writeBytesPerSec: number }
  network: { rxBytesPerSec: number; txBytesPerSec: number }
  uptime: number
}

export interface PerfProcess {
  pid: number
  name: string
  cpuPercent: number
  memBytes: number
  memPercent: number
  user: string
  started: string
  isStartupItem?: boolean
  startupItemName?: string
}

export interface PerfProcessList {
  timestamp: number
  processes: PerfProcess[]
  totalCount: number
}

export interface PerfKillResult {
  success: boolean
  error?: string
  requiresAdmin?: boolean
}

/**
 * Thermal + battery health snapshot. Pushed on a slow cadence (30s) — the
 * underlying sensors (si.cpuTemperature/si.battery/si.graphics) are far too
 * slow to run on the 1s snapshot tick.
 */
export interface HardwareHealthSnapshot {
  timestamp: number
  /** CPU temperature in °C. null when the platform exposes no sensor. */
  cpuTemperature: number | null
  /** Per-GPU temperatures in °C (may be empty or null where unsupported). */
  gpuTemperatures: Array<{ name: string; temperature: number | null }>
  /** null on desktops with no battery present. */
  battery: {
    present: boolean
    percent: number | null
    isCharging: boolean | null
    acConnected: boolean | null
    /** Seconds until empty (on battery) or until full (charging). */
    timeRemainingSec: number | null
    cycleCount: number | null
    /** maxCapacity / designedCapacity. null when the battery can't report it. */
    healthPercent: number | null
  } | null
}

// ─── WiFi & Network Security ───────────────────────────────
export type WifiSecurityLevel = 'secured' | 'weak' | 'open' | 'unknown'

export interface WifiConnectionInfo {
  ssid: string | null
  /** True when macOS redacted the SSID (e.g. `"<redacted>"`) because the process lacks Location Services permission. */
  ssidRedacted: boolean
  bssid: string | null
  /** Wi-Fi band derived from the frequency: '2.4 GHz' | '5 GHz' | '6 GHz' | null. */
  band: string | null
  /** Signal strength in dBm (closer to 0 is stronger). null when unknown. */
  signalDbm: number | null
  /** Signal strength as 0-100 percentage (best-effort conversion). */
  signalPercent: number | null
  channel: number | null
  frequency: number | null
  security: string | null
  securityLevel: WifiSecurityLevel
  txRate: number | null
  quality: number | null
}

export interface NearbyWifiInfo {
  ssid: string | null
  /** True when macOS redacted the SSID (e.g. `"<redacted>"`) because the process lacks Location Services permission. */
  ssidRedacted: boolean
  bssid: string
  /** Wi-Fi band derived from the frequency: '2.4 GHz' | '5 GHz' | '6 GHz' | null. */
  band: string | null
  channel: number | null
  frequency: number | null
  signalDbm: number | null
  quality: number | null
  security: string[]
  securityLevel: WifiSecurityLevel
}

export interface NetworkInterfaceInfo {
  iface: string
  ifaceName: string | null
  internal: boolean
  virtual: boolean
  ip4: string | null
  ip6: string | null
  mac: string | null
  type: 'wireless' | 'ethernet' | 'virtual' | 'unknown'
  speed: number | null
  operstate: string | null
}

export interface NetworkSecurityStatus {
  collectedAt: number
  wifi: {
    connected: WifiConnectionInfo | null
    nearby: NearbyWifiInfo[]
    /** Security posture of the active connection: 'secured' | 'weak' | 'open' | 'unknown' | 'none'. */
    securitySummary: WifiSecurityLevel | 'none'
  }
  interfaces: NetworkInterfaceInfo[]
  gateway: string | null
  vpn: {
    detected: boolean
    interfaces: string[]
  }
  /** Primary (non-virtual, external) IPv4 address. */
  ipv4: string | null
  /** Primary (non-virtual, external) IPv6 address. */
  ipv6: string | null
  /** macOS Location Services permission for this process. Drives SSID/BSSID redaction. */
  locationAccess: LocationAccessStatus
}

/** macOS `systemPreferences.getMediaAccessStatus('location')` value. `unknown` on non-macOS. */
export type LocationAccessStatus = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'

// ─── Wi-Fi Scanner (netfox-style network tool) ─────────────
export type WifiNetworkType = 'infrastructure' | 'adhoc' | 'unknown'

export interface WifiNetworkDetail {
  ssid: string | null
  /** True when macOS redacted the SSID (e.g. `"<redacted>"`) because the process lacks Location Services permission. */
  ssidRedacted: boolean
  /** True when the AP leaves its name out of the beacon (a genuinely hidden network, not a permission problem). */
  isHidden: boolean
  /** Radio MAC of the access point. null when the platform hides it (macOS without Location permission). */
  bssid: string | null
  /** Access-point manufacturer, derived from the BSSID OUI. null when the BSSID is unavailable or unregistered. */
  vendor: string | null
  channel: number | null
  /** Wi-Fi band derived from the channel/frequency: '2.4 GHz' | '5 GHz' | '6 GHz' | null. */
  band: string | null
  /** Channel width in MHz (20/40/80/160). null when unknown. */
  channelWidthMhz: number | null
  frequency: number | null
  security: string[]
  /** Single canonical security label, e.g. "WPA2 Personal". */
  securityLabel: string | null
  /** Short tag for the row subtitle, e.g. "WPA2". */
  securityShort: string | null
  securityLevel: WifiSecurityLevel
  /** ISO 3166-1 alpha-2 country code broadcast by the AP. null when the platform doesn't expose it. */
  countryCode: string | null
  /** Beacon interval in milliseconds (often 100ms). null when the platform doesn't expose it. */
  beaconIntervalMs: number | null
  networkType: WifiNetworkType
  /** Supported PHY modes, e.g. ['802.11a', '802.11n', '802.11ac']. */
  phyModes: string[]
  /** Signal strength in dBm (closer to 0 is stronger). null when unknown. */
  signalDbm: number | null
  /** Signal strength as 0-100 percentage (best-effort conversion). */
  signalPercent: number | null
  /** Noise floor in dBm. null when the platform doesn't expose it. */
  noiseDbm: number | null
  /** Signal-to-noise ratio (signal - noise) in dB. null when either part is missing. */
  snrDbm: number | null
  /** Current transmit rate in Mbit/s. */
  txRateMbps: number | null
  isConnected: boolean
  lastSeen: number
}

export interface WifiScanSnapshot {
  collectedAt: number
  /** BSSID of the currently connected network, when known. */
  connectedBssid: string | null
  /** Networks sorted by signal strength (strongest first). */
  networks: WifiNetworkDetail[]
  /** Wireless interface the scan came from, e.g. "en1" / "wlan0". */
  interfaceName: string | null
  /** False when the machine has no usable Wi-Fi radio at all. */
  supported: boolean
  /** False when the radio is switched off. */
  powerOn: boolean
  /** True when the scan swept the radio rather than reading the driver's cache. */
  active: boolean
  /** macOS Location Services state, inferred from whether BSSIDs came back. */
  locationAccess: LocationAccessStatus
  /** True when the platform withheld every BSSID (macOS without Location access). */
  bssidHidden: boolean
  /** Regulatory country code of the radio, when known. */
  countryCode: string | null
  /** Non-fatal reason the scan returned nothing useful. */
  error: string | null
}

/** One point of the live signal history for a single network. */
export interface WifiSignalSample {
  /** Epoch ms. */
  t: number
  signalDbm: number | null
  noiseDbm: number | null
}

/** Payload serialized to JSON when the user exports the Wi-Fi tool's data. */
export interface WifiExportPayload {
  exportedAt: number
  generatedBy: string
  connected: WifiNetworkDetail | null
  networks: WifiNetworkDetail[]
  /** Per-network signal histories (keyed by networkKey). */
  samples: Record<string, WifiSignalSample[]>
}

export interface DiskSmartInfo {
  device: string
  model: string
  type: 'SSD' | 'HDD' | 'NVMe' | 'Unknown'
  sizeBytes: number
  temperature: number | null
  healthStatus: 'Healthy' | 'Caution' | 'Bad' | 'Unknown'
  powerOnHours: number | null
  /** SSD/NVMe remaining life percentage (100 = new, 0 = worn out) */
  remainingLife: number | null
  readErrors: number | null
  writeErrors: number | null
  reallocatedSectors: number | null
  smartAttributes: SmartAttribute[]
}

export interface SmartAttribute {
  id: number
  name: string
  value: number
  worst: number
  thresh: number
  raw: number
}

// ─── System Health Report ─────────────────────────────────
export interface SystemHealthReportDisk {
  mount: string
  type: string
  totalGb: number
  usedGb: number
  freeGb: number
  percent: number
}

/** A one-shot snapshot of overall system health, rendered as a report. */
export interface SystemHealthReport {
  generatedAt: number
  app: {
    version: string
    platform: string
    arch: string
  }
  system: {
    hostname: string
    os: string
    kernel: string
    arch: string
    uptimeHours: number
    manufacturer: string
    model: string
    cpuModel: string
    cpuCores: number
    cpuThreads: number
    totalMemGb: number
  }
  disk: SystemHealthReportDisk[]
  health: {
    cpuTemperatureC: number | null
    batteryPercent: number | null
    batteryHealthPercent: number | null
    batteryCharging: boolean | null
    batteryPresent: boolean
  }
  network: {
    wifiSecurity: string
    vpnDetected: boolean
    gateway: string | null
    ipv4: string | null
  }
  alerts: AlertEvent[]
  /** Pre-rendered markdown document for export / copy. */
  markdown: string
}

// ─── Auto-Updater ────────────────────────────────────────────
export interface UpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  progress?: number
  error?: string
}

// ─── Program Uninstaller ────────────────────────────────────
export interface InstalledProgram {
  id: string
  displayName: string
  publisher: string
  displayVersion: string
  installDate: string
  estimatedSize: number
  installLocation: string
  uninstallString: string
  quietUninstallString: string
  displayIcon: string
  registryKey: string
  isSystemComponent: boolean
  isWindowsInstaller: boolean
  lastUsed: number              // timestamp ms, 0 = unknown/never seen in Prefetch
}

export interface UninstallerListResult {
  programs: InstalledProgram[]
  totalCount: number
}

export interface UninstallProgress {
  phase: 'listing' | 'uninstalling' | 'scanning-leftovers' | 'cleaning-leftovers' | 'force-removing'
  currentProgram: string
  progress: number
  detail: string
}

export interface UninstallResult {
  success: boolean
  programName: string
  exitCode: number | null
  error?: string
  leftoversFound: number
  leftoversCleaned: number
  leftoversSize: number
}

// ─── Schedules ────────────────────────────────────────────
export type ScheduleTaskType =
  | 'cleaner:system'
  | 'cleaner:browsers'
  | 'cleaner:apps'
  | 'cleaner:gaming'
  | 'cleaner:recycleBin'
  | 'cleaner:databases'
  | 'registry'
  | 'drivers'
  | 'software-update'
  | 'cve-scan'

export type ScheduleRunStatus = 'success' | 'partial' | 'failed' | 'never'

export interface ScheduleEntry {
  id: string
  name: string
  enabled: boolean
  frequency: 'daily' | 'weekly' | 'monthly'
  day: number
  hour: number
  /** Minute of the hour (0-59). Defaults to 0 for backward compatibility. */
  minute?: number
  tasks: ScheduleTaskType[]
  autoApply: boolean
  lastRunAt: string | null
  lastRunStatus: ScheduleRunStatus
  createdAt: string
}

export type AlertType = 'cpu-usage' | 'cpu-temp' | 'memory' | 'disk-space' | 'battery'
export type AlertSeverity = 'info' | 'warning' | 'critical'

/** A single proactive system-health alert raised by the alert monitor. */
export interface AlertEvent {
  id: string
  type: AlertType
  severity: AlertSeverity
  title: string
  message: string
  timestamp: number
  /** Machine-readable values for localized message interpolation. */
  data?: Record<string, number | string>
}

/**
 * Thresholds and delivery prefs for proactive system alerts. All thresholds
 * are best-effort: a sensor that can't be read simply never fires its alert.
 */
export interface AlertsConfig {
  /** Master switch — when false the monitor does no sampling at all. */
  enabled: boolean
  /** Show alerts as in-app toast notifications. */
  showInApp: boolean
  /** Show alerts as native OS notifications. */
  showSystem: boolean
  /** CPU usage (percent) at or above which a warning fires. */
  cpuUsageThreshold: number
  /** CPU temperature (°C) at or above which a critical alert fires. */
  cpuTempThreshold: number
  /** Memory usage (percent) at or above which a warning fires. */
  memoryThreshold: number
  /** Free space (GB) on the main disk at or below which a warning fires. */
  diskSpaceThresholdGb: number
  /** Battery charge (percent) at or below which a warning fires (while on battery). */
  batteryThreshold: number
  /** Minimum interval between repeated alerts of the same type (minutes). */
  cooldownMinutes: number
}

export interface ClaritySettings {
  theme: 'dark' | 'light' | 'system'
  language: string
  minimizeToTray: boolean
  showNotificationOnComplete: boolean
  showThreatNotifications: boolean
  runAtStartup: boolean
  autoUpdate: boolean
  /** Automatically restart the app to apply downloaded updates */
  autoRestart: boolean
  /** How often (in hours) to check for updates in the background */
  updateCheckIntervalHours: number
  cleaner: {
    skipRecentMinutes: number
    secureDelete: boolean
    closeBrowsersBeforeClean: boolean
    createRestorePoint: boolean
    protectRecycleBin: boolean
    /**
     * Record every deleted path to the deletion log so past cleans can be
     * audited from Scan History. Off by default: the log is a plaintext index
     * of file paths, which is not something to write without being asked.
     */
    keepDeletionLog: boolean
  }
  exclusions: string[]
  ignoredSoftwareUpdates: string[]
  /** Folder where backups (registry, shell extensions, etc.) are written. Empty = use default. */
  backupPath: string
  /**
   * How registry fixes are backed up before applying.
   * `targeted` (default): export only the keys being modified into one consolidated .reg per run.
   * `full`: export entire hives (HKLM\SOFTWARE, HKCR branches, etc.) — safer but can grow to hundreds of MB.
   */
  backupMode: 'targeted' | 'full'
  schedule: {
    enabled: boolean
    frequency: 'daily' | 'weekly' | 'monthly'
    day: number
    hour: number
  }
  schedules: ScheduleEntry[]
  /**
   * Preferred Windows package manager for Software Updater.
   * @deprecated Superseded by `windowsPackageManagers` (multi-manager aggregation).
   * Retained for backward compatibility and as a migration seed.
   */
  windowsPackageManager: 'winget' | 'choco'
  /**
   * Windows package managers to scan and aggregate in the Software Updater.
   * Results from every enabled+installed manager are merged into one list,
   * each package routed back to its own manager on update. When undefined,
   * all supported managers are scanned.
   */
  windowsPackageManagers?: WindowsPackageManager[]
  gameMode: GameModeConfig
  /**
   * Registry-cleaner tweaks the user has chosen to ignore. Recurring advisory
   * recommendations (e.g. "disable SysMain") whose signature is listed here are
   * never pre-selected on a scan, so they aren't applied by accident on a later
   * run. Signatures are `keyPath|valueName` lowercased — see `tweakSignature`
   * in `shared/registry-tweaks.ts` and issue #172.
   */
  registryIgnoredTweaks: string[]
  /**
   * Files the user has marked as false positives in the malware scanner. Any
   * detection whose file content hash matches an entry here is suppressed on
   * future scans. Keyed by content SHA-256 so a known-good file stays trusted
   * even if moved, while a different binary at the same path is still scanned.
   */
  malwareAllowlist: MalwareAllowlistEntry[]
  /** Proactive system-health alert thresholds and delivery preferences. */
  alerts: AlertsConfig
}

// ─── Game Mode ──────────────────────────────────────────────

export type GameModeOptimizationId =
  | 'svc-wsearch'
  | 'svc-sysmain'
  | 'svc-wuauserv'
  | 'svc-spooler'
  | 'svc-diagtrack'
  | 'proc-kill-browsers'
  | 'proc-kill-chat'
  | 'proc-kill-updaters'
  | 'proc-kill-custom'
  | 'mem-clear-standby'
  | 'sys-focus-assist'
  | 'sys-power-plan'
  | 'sys-prevent-sleep'
  | 'sys-disable-game-bar'
  | 'sys-disable-fse-opt'
  | 'sys-disable-transparency'
  | 'net-flush-dns'
  | 'net-disable-nagle'

export type GameModeCategory = 'services' | 'processes' | 'memory' | 'system' | 'network'

export interface GameModeConfig {
  enabledOptimizations: GameModeOptimizationId[]
  customProcessKillList: string[]
  /** Automatically activate Game Mode when a game process is detected */
  autoDetect: boolean
  /** Automatically deactivate Game Mode when the detected game exits */
  autoDeactivate: boolean
  /** User-specified game executable names to watch for (e.g. "mygame.exe") */
  customGameProcesses: string[]
}

export interface GameModeSnapshot {
  activatedAt: string
  // True while Game Mode is actively applied. Set to false when deactivation
  // runs but leaves unrestored items — the snapshot is kept so the user can
  // retry restoration without losing the captured pre-Game-Mode state.
  active: boolean
  services: Array<{ name: string; originalStartType: string; wasRunning: boolean }>
  killedProcesses: Array<{ pid: number; name: string }>
  originalPowerPlanGuid: string | null
  originalFocusAssistState: number | null
  powerSaveBlockerId: number | null
  nagleInterfaces: Array<{ path: string; originalTcpNoDelay: number | null; originalTcpAckFrequency: number | null }>
  registryTweaks: Array<{ path: string; name: string; originalValue: number | null }>
  // Why the last deactivation left items behind. Persisted so the cleanup
  // banner can name the offending step after an app restart.
  restoreErrors?: Array<{ optimizationId: string; reason: string }>
}

export interface GameModeActivateResult {
  succeeded: number
  failed: number
  errors: Array<{ optimizationId: string; reason: string }>
  snapshot: GameModeSnapshot | null
}

export interface GameModeDeactivateResult {
  restored: number
  failed: number
  errors: Array<{ optimizationId: string; reason: string }>
}

export interface GameModeProgress {
  phase: 'activating' | 'deactivating'
  current: number
  total: number
  currentLabel: string
}

export interface GameModeStatus {
  active: boolean
  activatedAt: string | null
  /** True when a previous deactivation left items unrestored. The toggle is
   * not "on", but a cleanup retry is available. */
  pendingRestore: boolean
  /** Reason the first unrestored item failed, or null when unknown. */
  pendingReason: string | null
}

// ─── Service Manager ────────────────────────────────────────
export type ServiceStatus =
  | 'Running'
  | 'Stopped'
  | 'StartPending'
  | 'StopPending'
  | 'Paused'
  | 'Unknown'

export type ServiceStartType =
  | 'Automatic'
  | 'AutomaticDelayed'
  | 'Manual'
  | 'Disabled'
  | 'Boot'
  | 'System'

export type ServiceSafety = 'safe' | 'caution' | 'unsafe'

export type ServiceCategory =
  | 'telemetry'
  | 'xbox'
  | 'print'
  | 'fax'
  | 'media'
  | 'network'
  | 'bluetooth'
  | 'remote'
  | 'hyper-v'
  | 'developer'
  | 'misc'
  | 'core'
  | 'security'
  | 'unknown'

export interface WindowsService {
  name: string
  displayName: string
  description: string
  status: ServiceStatus
  startType: ServiceStartType
  safety: ServiceSafety
  category: ServiceCategory
  isMicrosoft: boolean
  dependsOn: string[]
  dependents: string[]
  selected: boolean
  originalStartType: ServiceStartType
}

export interface ServiceScanResult {
  services: WindowsService[]
  totalCount: number
  runningCount: number
  disabledCount: number
  safeToDisableCount: number
}

export interface ServiceApplyResult {
  succeeded: number
  failed: number
  errors: { name: string; displayName: string; reason: string }[]
}

export interface ServiceScanProgress {
  phase: 'enumerating' | 'classifying'
  current: number
  total: number
  currentService: string
}

// ─── Firewall Audit (Windows-only) ──────────────────────────
export type FirewallProfile = 'Domain' | 'Private' | 'Public' | 'Any'
export type FirewallSignatureStatus = 'signed' | 'unsigned' | 'unknown' | 'not-applicable'
export type FirewallIssue = 'stale' | 'unsigned' | 'broad-scope' | 'any-remote'
export type FirewallRiskLevel = 'high' | 'medium' | 'low'

export interface FirewallRule {
  // Internal name (used as -Name when disabling/removing). Unique per rule.
  name: string
  displayName: string
  description: string
  group: string
  profiles: FirewallProfile[]
  protocol: string
  localPort: string
  remoteAddress: string
  // Raw program path as Windows stores it (may contain %SystemRoot% etc.)
  program: string
  // Expanded/resolved absolute path. Empty if rule has no program filter.
  programResolved: string
  programExists: boolean
  signature: FirewallSignatureStatus
  // Microsoft-shipped rule: program lives under Windows/Program Files OR the
  // description is an MUI resource reference (e.g. "@FirewallAPI.dll,-25000").
  // We suppress broad-scope/any-remote findings on these — they're default
  // system rules and removing them tends to break Windows features.
  builtin: boolean
  enabled: boolean
  issues: FirewallIssue[]
  risk: FirewallRiskLevel
  selected: boolean
}

export interface FirewallScanResult {
  rules: FirewallRule[]
  totalCount: number
  staleCount: number
  unsignedCount: number
  broadScopeCount: number
  // Set when the scan was cut short (timeout) or returned fewer rules than it
  // enumerated. The findings shown are real but incomplete, so the UI must not
  // present them as a full audit.
  truncated?: boolean
}

export interface FirewallApplyResult {
  succeeded: number
  failed: number
  errors: { name: string; displayName: string; reason: string }[]
}

export interface FirewallScanProgress {
  phase: 'enumerating' | 'classifying' | 'verifying'
  current: number
  total: number
  currentRule: string
}

export type FirewallAction = 'disable' | 'delete'

// ─── Software Updater ──────────────────────────────────────
export type UpdateSeverity = 'major' | 'minor' | 'patch' | 'unknown'

/** Package managers Clarity can aggregate on Windows. */
export type WindowsPackageManager = 'winget' | 'choco' | 'scoop' | 'npm'

/** All package-manager names Clarity can report, across every platform. */
export type PackageManagerName =
  | 'winget'
  | 'choco'
  | 'scoop'
  | 'npm'
  | 'brew'
  | 'apt'
  | 'dnf'
  | 'pacman'

/** Per-manager status returned by an aggregated update check. */
export interface PackageManagerStatus {
  name: PackageManagerName
  /** Whether the manager's CLI is installed and reachable. */
  available: boolean
  /** Number of outdated packages this manager reported. */
  outdatedCount: number
}

/** A single package to update, tagged with the manager that owns it. */
export interface UpdateRequestItem {
  id: string
  source: string
}

export interface UpdatableApp {
  id: string
  name: string
  currentVersion: string
  availableVersion: string
  source: string
  severity: UpdateSeverity
  selected: boolean
}

export interface UpToDateApp {
  id: string
  name: string
  version: string
  source: string
}

export interface UpdateCheckResult {
  apps: UpdatableApp[]
  upToDate: UpToDateApp[]
  totalCount: number
  majorCount: number
  minorCount: number
  patchCount: number
  /** True when at least one scanned manager is installed and reachable. */
  packageManagerAvailable: boolean
  /**
   * Primary manager name. On single-manager platforms (macOS/Linux) this is
   * the active manager. On Windows aggregation it is the first available
   * manager, or null when none are installed. Prefer `managers` for details.
   */
  packageManagerName: PackageManagerName | null
  /**
   * Per-manager status for every manager that was scanned. Single-manager
   * platforms report a single entry; Windows aggregation reports one per
   * enabled manager (winget/choco/scoop/npm).
   */
  managers: PackageManagerStatus[]
}

export interface UpdateProgress {
  phase: 'checking' | 'updating'
  current: number
  total: number
  currentApp: string
  percent: number
  status: 'in-progress' | 'done' | 'failed'
}

export interface UpdateResult {
  succeeded: number
  failed: number
  /**
   * Failed packages. `source` is set on Windows aggregation so a failure can be
   * matched to the exact package when the same id exists under two managers
   * (e.g. choco + scoop "git"); it is omitted on single-manager platforms.
   */
  errors: { appId: string; name: string; reason: string; source?: string }[]
}

// ─── Disk Repair ───────────────────────────────────────────
export interface DiskRepairProgress {
  tool: 'sfc' | 'dism' | 'chkdsk'
  phase: 'running' | 'done' | 'failed'
  percent: number
  message: string
}

export interface DiskRepairResult {
  tool: 'sfc' | 'dism' | 'chkdsk'
  success: boolean
  exitCode: number | null
  summary: string
  log: string
  requiresReboot: boolean
  needsAdmin: boolean
}

// ─── Disk Maintenance (SSD TRIM) ───────────────────────────
export type TrimMediaType = 'SSD' | 'NVMe' | 'HDD' | 'Unknown'
export type TrimSupport = 'supported' | 'disabled' | 'unsupported' | 'macos-managed'
export type TrimStatus =
  | 'recently-trimmed'
  | 'ok'
  | 'recommended'
  | 'not-applicable'
  | 'disabled'
  | 'unknown'

/**
 * One row in the Disk Maintenance UI.
 * `id` is the stable key — Windows: drive letter ('C'); Linux: mountpoint; macOS: BSD name.
 */
export interface TrimDriveInfo {
  id: string
  letter?: string
  mountPoint?: string
  label: string
  totalSize: number
  freeSpace: number
  mediaType: TrimMediaType
  busType?: string
  filesystem?: string
  isRemovable: boolean
  isEncrypted: boolean
  trimSupport: TrimSupport
  status: TrimStatus
  statusReason: string
  lastTrimAt: number | null
  estimatedDiscardBytes?: number
}

export interface TrimRunResult {
  driveId: string
  success: boolean
  needsAdmin?: boolean
  throttled?: boolean
  bytesDiscarded?: number
  durationMs: number
  exitCode: number | null
  summary: string
  log: string
  timestamp: number
}

export interface TrimProgress {
  driveId: string
  phase: 'starting' | 'running' | 'done' | 'failed'
  /** -1 = indeterminate (Windows Optimize-Volume doesn't report clean percentages) */
  percent: number
  message: string
}

// ─── Threat Monitor ────────────────────────────────────────

export interface FlaggedConnection {
  remoteAddress: string
  remotePort: number
  pid: number | null
  matchedRule: string
  matchType: 'ip' | 'cidr'
  detectedAt: string
}

export interface FlaggedDnsEntry {
  domain: string
  resolvedAddress: string | null
  matchedRule: string
  detectedAt: string
}

export interface ThreatSnapshot {
  flaggedConnections: FlaggedConnection[]
  flaggedDns: FlaggedDnsEntry[]
  blacklistVersion: string | null
  lastConnectionScanAt: string | null
  lastDnsScanAt: string | null
}

export interface ThreatBlacklist {
  version: string
  updatedAt: string
  domains: string[]
  ips: string[]
  cidrs: string[]
}

// ─── CVE Vulnerability Scanner ────────────────────────────

export type CveSeverity = 'critical' | 'high' | 'medium' | 'low' | 'none'

export interface CveVulnerability {
  id: number
  cveId: string
  appName: string
  installedVersion: string
  severity: CveSeverity
  cvssScore: number | null
  fixedIn: string | null
  description: string | null
  firstDetectedAt: string
  lastScannedAt: string
}

/** Unfiltered severity counts (always the full picture, ignoring any active severity filter) */
export interface CveSummary {
  critical: number
  high: number
  medium: number
  low: number
}

export interface CvePageResult {
  vulnerabilities: CveVulnerability[]
  summary: CveSummary
  total: number
  nextPageUrl: string | null
  /** Total CVE entries tracked in the server database */
  librarySize: number
}

// ─── Large File Finder ────────────────────────────────────

export interface LargeFileScanOptions {
  directory: string
  minFileSize: number
  maxDepth: number
  excludePatterns: string[]
}

export interface LargeFileEntry {
  path: string
  name: string
  size: number
  lastModified: number
  extension: string
}

export interface LargeFileScanResult {
  files: LargeFileEntry[]
  totalFilesScanned: number
  duration: number
  cancelled: boolean
}

export interface LargeFileScanProgress {
  currentPath: string
  filesScanned: number
  largeFilesFound: number
  progress: number
}

export type LargeFileDeleteMode = 'recycle' | 'permanent'

export interface LargeFileDeleteResult {
  deleted: number
  failed: number
  spaceRecovered: number
  errors: { path: string; reason: string }[]
}

// ─── Empty Folder Cleaner ─────────────────────────────────

export interface EmptyFolderScanOptions {
  directory: string
  maxDepth: number
  excludePatterns: string[]
}

export interface EmptyFolderEntry {
  path: string
  name: string
  depth: number
}

export interface EmptyFolderScanResult {
  folders: EmptyFolderEntry[]
  totalFoldersScanned: number
  duration: number
  cancelled: boolean
}

export interface EmptyFolderScanProgress {
  currentPath: string
  foldersScanned: number
  emptyFound: number
  progress: number
}

export type EmptyFolderDeleteMode = 'recycle' | 'permanent'

export interface EmptyFolderDeleteResult {
  deleted: number
  failed: number
  errors: { path: string; reason: string }[]
}

// ─── File Shredder ───────────────────────────────────────

export interface ShredderEntry {
  path: string
  name: string
  size: number
  isDirectory: boolean
}

export interface ShredderProgress {
  currentPath: string
  filesShredded: number
  totalFiles: number
  bytesShredded: number
  totalBytes: number
  progress: number
}

export interface ShredderResult {
  shredded: number
  failed: number
  bytesShredded: number
  duration: number
  errors: { path: string; reason: string }[]
  cancelled: boolean
}

// ─── Port Manager ───────────────────────────────────────

export interface PortEntry {
  protocol: 'tcp' | 'udp'
  port: number
  localAddress: string
  /** Primary socket state: LISTEN for bound sockets, otherwise the most common state. */
  state: string | null
  pid: number | null
  processName: string | null
  command: string | null
  user: string | null
  /** Best-effort service name: systemd unit on Linux, launchd label on macOS. */
  serviceName: string | null
  /** Number of sockets aggregated into this row. */
  connectionCount: number
  /** Distinct remote peers, e.g. "10.0.0.5:443". */
  remoteSummary: string[]
  isListener: boolean
  /** True when the owning process is owned by another user / requires elevation to kill. */
  killRequiresAdmin: boolean
}

export interface PortScanResult {
  ports: PortEntry[]
  totalPorts: number
  listeners: number
  connections: number
  duration: number
  error?: string
}

export interface PortKillResult {
  success: boolean
  pid: number | null
  processName: string | null
  /** Ports that were owned by the process and are now free. */
  freedPorts: number[]
  error?: string
  requiresAdmin?: boolean
}

// ─── Duplicate Finder ─────────────────────────────────────

export interface DuplicateScanOptions {
  directory: string
  minFileSize: number
  maxFileSize: number | null
  excludePatterns: string[]
  extensionFilter: string[]
  maxDepth: number
}

export interface DuplicateFile {
  path: string
  size: number
  lastModified: number
}

export interface DuplicateGroup {
  hash: string
  fullHash: string
  fileSize: number
  files: DuplicateFile[]
  reclaimableSpace: number
}

export interface DuplicateScanResult {
  groups: DuplicateGroup[]
  totalDuplicates: number
  totalReclaimable: number
  totalFilesScanned: number
  duration: number
  cancelled: boolean
}

export type DuplicateScanPhase = 'walking' | 'grouping' | 'partial-hash' | 'full-hash' | 'complete'

export interface DuplicateScanProgress {
  phase: DuplicateScanPhase
  currentPath: string
  filesScanned: number
  duplicatesFound: number
  reclaimableSpace: number
  progress: number
  filesToHash?: number
  filesHashed?: number
}

export type DuplicateDeleteMode = 'recycle' | 'permanent'

export interface DuplicateDeleteResult {
  deleted: number
  failed: number
  spaceRecovered: number
  errors: { path: string; reason: string }[]
}

// ─── Context Menu Cleaner ──────────────────────────────────────────────

export type ContextMenuEntryKind = 'verb' | 'handler'

export type ContextMenuScope =
  | 'AllFiles'
  | 'Directory'
  | 'DirectoryBackground'
  | 'Folder'
  | 'Drive'
  | 'AllFilesystemObjects'
  | 'ProgID'

export type ContextMenuHive = 'HKCR' | 'HKCU'

export type ContextMenuSource =
  | '7-Zip'
  | 'WinRAR'
  | 'OneDrive'
  | 'Notepad++'
  | 'VSCode'
  | 'Defender'
  | 'Git'
  | 'Dropbox'
  | 'Google Drive'
  | 'PowerToys'
  | 'Microsoft'
  | 'Windows'
  | 'Unknown'

export type ContextMenuStatus = 'enabled' | 'disabled'

export type ContextMenuAction = 'disable' | 'enable' | 'delete'

export interface ContextMenuEntry {
  id: string
  kind: ContextMenuEntryKind
  keyPath: string
  name: string
  displayName: string
  scope: ContextMenuScope
  hive: ContextMenuHive
  clsid: string | null
  dllPath: string | null
  command: string | null
  source: ContextMenuSource
  status: ContextMenuStatus
  protected: boolean
  requiresAdmin: boolean
  selected: boolean
}

export interface ContextMenuScanResult {
  entries: ContextMenuEntry[]
  scanDuration: number
  scanned: number
}

export interface ContextMenuApplyRequest {
  entryId: string
  action: ContextMenuAction
}

export interface ContextMenuApplyResult {
  succeeded: number
  failed: number
  errors: { entryId: string; displayName: string; reason: string }[]
  updates: { entryId: string; status: ContextMenuStatus }[]
}

export interface ContextMenuApplyProgress {
  current: number
  total: number
  currentLabel: string
}

// ─────────────────────────────────────────────────────────────
// Devices tool (LAN device list & history)
// ─────────────────────────────────────────────────────────────

export type DeviceKind =
  | 'computer'
  | 'phone'
  | 'tablet'
  | 'speaker'
  | 'tv'
  | 'printer'
  | 'router'
  | 'media'
  | 'camera'
  | 'iot'
  | 'unknown'

/** Which discovery provider reported a device. */
export type DeviceSource = 'arp' | 'bonjour' | 'ssdp' | 'netbios' | 'icmp'

export interface DeviceServiceAd {
  /** Instance name, e.g. "Living Room". */
  name: string
  /** DNS-SD service type, e.g. "_airplay._tcp". */
  type: string
  port: number
  /** Self-declared model, e.g. "AppleTV5,3". */
  model?: string
}

export interface DeviceRoles {
  gateway: boolean
  dns: boolean
  dhcp: boolean
}

export interface LinkQuality {
  /** Fastest round trip of the burst (ms). */
  latencyMs: number | null
  /** Typical round trip (ms). */
  avgMs: number | null
  /** Standard deviation of the burst trips (ms). */
  variabilityMs: number | null
  /** Fraction of checks that got no answer, 0–1. */
  packetLossPct: number | null
  /** When the burst was measured. */
  measuredAt: number | null
}

export type DevicePortState = 'open' | 'closed' | 'filtered'

export interface DevicePortEntry {
  port: number
  service: string | null
  state: DevicePortState
  /** True when the port triggered a security finding. */
  risk?: boolean
}

export type DeviceEventKind =
  | 'online'
  | 'offline'
  | 'ipv4'
  | 'hostname'
  | 'vendor'
  | 'kind'
  | 'port_opened'
  | 'port_closed'
  | 'tag'
  | 'mute'

export interface DeviceObservation {
  id: string
  at: number
  deviceId: string
  kind: DeviceEventKind
  text: string
}

export interface DeviceTag {
  name?: string
  kind?: DeviceKind
  muted: boolean
}

export interface NetworkDevice {
  id: string
  mac: string | null
  ipv4: string[]
  ipv6: string[]
  hostname: string | null
  vendor: string | null
  kind: DeviceKind
  model: string | null
  services: DeviceServiceAd[]
  roles: DeviceRoles
  status: 'online' | 'offline'
  isLocal: boolean
  sources: DeviceSource[]
  firstSeenAt: number
  lastSeenAt: number
  linkQuality: LinkQuality | null
  tag: DeviceTag | null
  /** Open services from the most recent security probe (empty before the first probe). */
  lastPorts: DevicePortEntry[]
}

/** How safely a service is exposed, as far as a read-only look can tell. */
export type ServicePosture = 'open-no-auth' | 'auth-required' | 'reachable' | 'unknown'

export interface ServiceInspection {
  port: number
  protocol: 'http' | 'https' | 'redis' | 'postgres' | 'banner' | 'unknown'
  /** The product behind the port, e.g. "HP printer" or "OpenSSH 9.6". */
  product: string | null
  /** <title> of the page, for web services. */
  title: string | null
  /** `Server:` header, for web services. */
  server: string | null
  /** The line the service sent on connect, for non-web services. */
  banner: string | null
  posture: ServicePosture
  /** The posture in plain English, e.g. "Accepted the connection with no password". */
  postureDetail: string | null
  /** Verbatim bytes behind the summary, for the Raw tab. */
  raw: string | null
  inspectedAt: number
  error: string | null
}

export interface ServiceInspectRequest {
  ip: string
  port: number
}

export interface LocalListener {
  port: number
  process: string | null
  pid: number | null
  loopbackOnly: boolean
  /** Local addresses the listener is bound to (may be many / wildcard). */
  addresses: string[]
  /** Hosts-file names that resolve to a loopback address this listener answers on. */
  hostNames: string[]
}

export interface NetworkContextInfo {
  subnetMask: string | null
  router: string | null
  dnsServers: string[]
  domain: string | null
  dhcpServer: string | null
}

export interface DevicesHostInfo {
  hostname: string
  ipv4: string[]
  ipv6: string[]
  mac: string | null
  connectionType: string | null
  /** IPv4 address plus prefix length, e.g. "192.168.1.14 /24". */
  ipCidr: string | null
}

export interface ProviderStatus {
  provider: DeviceSource
  ok: boolean
  error?: string
}

export interface DevicesSnapshot {
  devices: NetworkDevice[]
  listeners: LocalListener[]
  host: DevicesHostInfo
  networkContext: NetworkContextInfo | null
  providerStatus: ProviderStatus[]
  scannedAt: number
  /** New history observations raised since the previous scan. */
  newEvents: DeviceObservation[]
}

export interface LinkQualityRequest {
  ip: string
  burst?: number
}

export interface DevicesProbeResult {
  ip: string
  online: boolean
  linkQuality: LinkQuality | null
}

export interface DeviceTagInput {
  deviceId: string
  name?: string | null
  kind?: DeviceKind | null
  muted?: boolean
}

// ─── Network Security tool ─────────────────────────────────

export type PortRiskTier = 'none' | 'medium' | 'high'

export type PortCategory =
  | 'remote-access'
  | 'file-sharing'
  | 'web-iot'
  | 'discovery'
  | 'media'
  | 'dev'
  | 'database'
  | 'custom'

export interface PortCatalogEntry {
  port: number
  service: string
  category: PortCategory
  risk: PortRiskTier
  /** Custom ports are user-added (Settings), never shipped in the catalog. */
  custom?: boolean
}

export type SecuritySeverity = 'high' | 'medium' | 'low' | 'untested'

export interface PortFinding {
  port: number
  service: string
  risk: PortRiskTier
  /** Short plain-English headline, e.g. "Remote admin is exposed". */
  title: string
  /** Why the open port matters, in plain English. */
  explanation: string
  /** What the user can do about it. */
  advice: string
}

export interface CatalogProbeState {
  port: number
  service: string
  state: DevicePortState
  risk: PortRiskTier
  category: PortCategory
  custom: boolean
}

export type FullScanState = 'idle' | 'running' | 'done' | 'cancelled' | 'error'

export interface FullScanProgress {
  state: FullScanState
  from: number
  to: number
  checked: number
  open: number
  current: number | null
  startedAt: number | null
  finishedAt: number | null
  error: string | null
}

export interface DeviceSecurityResult {
  deviceId: string
  ip: string
  hostname: string | null
  kind: DeviceKind
  /** Manufacturer from the MAC's registered block — feeds the plain-English identity. */
  vendor: string | null
  /** MAC address, so the UI can say "Private address" instead of leaving the vendor blank. */
  mac: string | null
  /** DNS-SD service types the device advertises, for the identity line. */
  serviceTypes: string[]
  /** A name the user gave the device; overrides everything else in the UI. */
  tagName: string | null
  online: boolean
  severity: SecuritySeverity
  findings: PortFinding[]
  catalog: CatalogProbeState[]
  openPorts: DevicePortEntry[]
  lastScannedAt: number | null
  fullScan: FullScanProgress
}

/** Outcome of asking the engine to begin a full port sweep. */
export interface FullScanStartResult {
  ok: boolean
  /** Why the sweep could not start, in words the UI can show verbatim. */
  error: string | null
}

export interface SecurityScanJob {
  state: 'idle' | 'running' | 'done'
  deviceCount: number
  checked: number
  total: number
}

export interface SecuritySnapshot {
  devices: DeviceSecurityResult[]
  job: SecurityScanJob
  scannedAt: number
}

export interface SecuritySettings {
  /** Run scheduled catalog scans while the app is open. */
  autoProbeEnabled: boolean
  /** Hours between scheduled scans (1–168). */
  autoProbeIntervalHours: number
  /** User-added ports merged into the catalog. */
  customPorts: CustomPortSetting[]
  /** Open the Risk Inspector automatically when a scan finds high-risk ports. */
  inspectAutomatically: boolean
}

export interface CustomPortSetting {
  port: number
  description: string
}

export interface FullScanRequest {
  ip: string
  from: number
  to: number
}

