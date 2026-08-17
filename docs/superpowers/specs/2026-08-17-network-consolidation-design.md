# Network section consolidation — 6 pages into 4 tabs

Date: 2026-08-17
Status: approved

## Goal

Collapse the six children of the sidebar's **Network** group into four, losing no
feature, and fix the defects found along the way. Four sidebar entries, each its
own route (the user chose this over a single page with in-page tabs).

## Why the six are really four

Three pairs overlap:

| Page | Overlaps with | Verdict |
|------|---------------|---------|
| WiFi & Network Security | Wi-Fi | Its connected-Wi-Fi grid and nearby-networks list duplicate the Wi-Fi scanner, which shows strictly more per network (vendor, channel width, country code, beacon interval, PHY modes). Unique: interfaces table, VPN detection, gateway/IPv4/IPv6. |
| Security | Devices | Already shares `devices-store`, already deep-links via `navigate('/devices')` + `setDetailTab('ports')`. It is a risk-oriented view of the same device set. |
| Port Manager | Devices → Local Services tab | Both list local listeners. Port Manager adds protocol, state, service, connection count, remote peers, and kill. |

## Target tabs

### 1. Wi-Fi — `/wifi`
Keeps both stores: `wifi-store` (scanner) and `network-security-store` (link state).

Order: **Connection & Link** (security / connection / VPN / IP stat cards, gateway,
IPv6) → **Interfaces** table → **Scanner** (network list + detail pane with the live
RSSI/noise/SNR chart). Header: one refresh firing both scans, demo-mode toggle,
export.

Removed as redundant: the old page's connected-Wi-Fi grid and nearby list. Verified
field-by-field that the scanner already renders every field they showed.

One location-permission banner, shown when either source reports redaction
(`wifi.bssidHidden` or a redacted SSID in the network-security snapshot).

### 2. Devices — `/devices`
Top-level view switcher **Inventory | Risk**.

- Inventory: today's Devices page, minus the Local Services tab.
- Risk: the whole Security page (hero, severity pills, by-device / by-service
  views, findings + advice).
- Device detail tabs become General / Ports / History. `detailTab` type drops
  `'local'`.
- The cross-page hop becomes an in-page view switch — no `navigate`.

### 3. Ports — `/ports`
Port Manager in full (filters, search, sort, auto-refresh, multi-select, kill) plus
the Local Services grouping (loopback-only vs network-reachable) relocated from
Devices. Available on all three platforms.

### 4. Cleanup — `/network-cleanup`
Features unchanged. Renamed off `/network` to end the parent/child route collision.

## Routing

Old paths remain as `<Navigate replace>` so bookmarks, tray navigation, and deep
links keep working:

- `/network-security` → `/wifi`
- `/security` → `/devices`
- `/port-manager` → `/ports`
- `/network` → `/network-cleanup`

The Network parent group's own `path` becomes `/wifi` (its first child) so it no
longer collides with a child route.

## i18n — no locale churn

All six namespaces (`wifi`, `networkSecurity`, `devices`, `security`,
`portManager`, `network`) stay as they are. Merged pages call `useTranslation` per
section. No key is renamed, moved, or deleted, so **none of the 30 locale
directories is touched**. The four sidebar labels reuse existing `sidebar.json`
keys: `wifi`, `devices`, `portManager`, `networkCleanup`.

## Windows port support

`si.networkConnections()` has a Windows branch, but it is TCP-shaped: it reads
`state = line[3]` and `pid = line[4]`, while Windows `netstat -nao` gives UDP rows
only four columns (no State). Every UDP row would therefore carry a bogus state and
a wrong PID — and a wrong PID means killing the wrong process. So win32 does not
build on it.

- New pure `parseNetstatAno()` in `port-monitor.ts`, handling both row shapes.
  Pure and unit-tested, matching the existing parser-test style.
- `netstat` added to `ALLOWED_TOOLS` in `exec-utf8.ts`; invoked through
  `execNativeUtf8` so it inherits UTF-8 decoding and process-tree kill.
- Windows service names from PowerShell `Win32_Service` (PID → name), a nullable
  enrichment exactly like cgroup on Linux and launchctl on macOS.
- Remove the `win32` early return in `port-manager.ipc.ts`; `features.portManager`
  becomes `true` on every platform.

`process.kill(pid, 'SIGTERM'|'SIGKILL')` works on Windows (the signal is ignored
and the process is terminated), and `process.kill(pid, 0)` remains a valid liveness
probe, so termination needs no platform branch — only a comment noting the
graceful/force distinction does not exist there.

## Defects fixed

1. Windows UDP rows get a wrong PID and bogus state — new win32 parser.
2. `isCurrentUser()` reads `USER`/`LOGNAME`, undefined on Windows, so every row
   falsely shows the "needs admin" badge. Add `USERNAME`.
3. Port auto-refresh interval is torn down and rebuilt on every scan because
   `store.status` is in the effect deps.
4. `usePortManagerStore()` is called without a selector, re-rendering the whole
   table on any store change.
5. Sidebar Network parent `path: '/network'` collides with its Network Cleanup
   child.
6. Two location-permission banners would both render on the merged Wi-Fi tab.
7. `NetworkCleanupPage`'s `handleScan`/`handleClean` omit `t` from their
   `useCallback` deps, so toasts keep the language active at mount.

## Structure

New `src/renderer/src/components/network/`:

```
network/
├── wifi/ConnectionPanel.tsx      link stat cards, VPN, gateway, IPv6
├── wifi/InterfacesPanel.tsx      interfaces table
├── wifi/LocationBanner.tsx       shared permission banner
├── risk/RiskView.tsx             the former SecurityPage, as a component
└── ports/LocalServicesPanel.tsx  the former Devices Local Services tab
```

Extraction is deliberately surgical rather than a wholesale split of
`DevicesPage.tsx`. The panels above are the ones that genuinely move between pages;
shredding the rest of a 1597-line file by hand is transcription risk with no
behavioural gain, and the priority for this work is stability. `DevicesPage`'s
internal sections stay where they are, minus the relocated Local Services tab.

## Verification

- `npm test` — 2,707 passing at baseline, plus new tests for
  `parseNetstatAno()` and `isCurrentUser()`.
- `npm run typecheck`, `npm run build`.
- Drive the app on macOS to confirm all four tabs render, scan, and navigate.
- Windows and Linux cannot be executed in this environment. The win32 path is
  therefore confined to pure, unit-tested functions, and must be smoke-tested by
  the maintainer before release.
