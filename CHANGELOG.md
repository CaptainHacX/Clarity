# [1.1.0](https://github.com/CaptainHacX/Clarity/compare/v1.0.3...v1.1.0) (2026-08-17)

### Bug Fixes

* **network:** correct VPN detection and separate local from public IP ([c238184](https://github.com/CaptainHacX/Clarity/commit/c2381847f995fa33ad36ffbc989735ccd3fb5496))

### Features

* **brand:** new logo and a regenerable icon pipeline ([de8cf71](https://github.com/CaptainHacX/Clarity/commit/de8cf714144aea5a583d2145e14b7cf6a1c1aef3))
* **cve:** version-accurate findings, remediation plan, coverage and KEV ([7ded32b](https://github.com/CaptainHacX/Clarity/commit/7ded32bc01a4e9c84ad3b56c1be6903416a9c8a4))
* **network:** consolidate the network section into four tabs ([b37c6b5](https://github.com/CaptainHacX/Clarity/commit/b37c6b55f1a28a5edce20cfb67502d5903c81e1b))
* **ports:** enumerate ports on Windows ([53d9776](https://github.com/CaptainHacX/Clarity/commit/53d9776b94b048e1e31ba8b9643b9cf1f055b3f7))
* **tray:** redraw the menu glyphs and refresh them on theme change ([00559f2](https://github.com/CaptainHacX/Clarity/commit/00559f295537fe818ecbd05120e9b5da226e4287))
* **wifi:** read CoreWLAN in-process so the Location grant applies ([0396367](https://github.com/CaptainHacX/Clarity/commit/039636758d4d283549c23d348a67092f25a805bc))

### Performance Improvements

* **settings:** memoize config.json reads ([7384646](https://github.com/CaptainHacX/Clarity/commit/7384646c39a5db8cefbc67db7d946d5009abb013))

# [1.0.3](https://github.com/CaptainHacX/Clarity/releases/tag/v1.0.3) (2026-08-15)

### Features

* **release:** sign Windows installers via SignPath Foundation, publishing a trusted, SmartScreen-friendly `Clarity-Setup.exe`
* **updater:** keep "Check for updates" working on any build by falling back to the GitHub releases API when the packaged update metadata is absent

### Bug Fixes

* **updater:** stop "Check for updates" from crashing with ENOENT on locally built (`--dir`) packages
* **build:** restore type compatibility with Electron 41 and systeminformation

### Chore

* add unit tests for the version-comparison helper used by the updater fallback

# [1.0.2](https://github.com/CaptainHacX/Clarity/releases/tag/v1.0.2) (2026-08-15)

### Features

* **tray:** add menu glyph icons and status-dot overlays to the system tray menu
* **settings:** expand the settings page with new controls and options
* **scheduler:** improve scheduled-task handling and edge cases
* **perf:** add live system telemetry improvements and sensor capability handling
* **cleaner:** refine context-menu cleaning and system-health reporting

### Bug Fixes

* **sidebar:** fix nested flyout menus being clipped/unclickable in light theme (backdrop-filter containing block)
* **sidebar:** fix the theme toggle being invisible in light theme
* **ui:** eliminate scroll lag by removing the full-window blend-mode and reducing backdrop-filter blur radii

### Chore

* add unit tests for the tray icon toolkit and scheduler

# [1.0.1](https://github.com/CaptainHacX/Clarity/releases/tag/v1.0.1) (2026-08-11)

### Features

* **perf:** rebuild the performance monitor with live refresh controls, swap and disk-volume telemetry, GPU/VRAM tracking, per-core gauges, and a sensor capability model
* **cleaner:** add summary cards, result groups, and smart recommendations UI
* **cve:** surface risk-accepted statuses and expand scanner result handling
* **i18n:** expand translation coverage across all supported locales

### Chore

* refresh app branding and icons, update release documentation and download links

# [1.0.0](https://github.com/CaptainHacX/Clarity/releases/tag/v1.0.0) (2026-08-08)


### Bug Fixes

* **malware:** bind quarantine/delete to a real detection, gate remote quarantine ([#281](https://github.com/CaptainHacX/Clarity/issues/281)) ([6691097](https://github.com/CaptainHacX/Clarity/commit/66910978997f302d1b608d5a7a4e31900035c073))
* triage and fix the four remaining open security advisories ([#283](https://github.com/CaptainHacX/Clarity/issues/283)) ([04a3c77](https://github.com/CaptainHacX/Clarity/commit/04a3c779b23488070b1e50e2f85c7490754de7ff))


### Features

* **services:** allow re-enabling a disabled service ([#282](https://github.com/CaptainHacX/Clarity/issues/282)) ([3d8e955](https://github.com/CaptainHacX/Clarity/commit/3d8e955f073ae7b3ade0a3d4cabd7d219acdc3d4))
* **window:** remember window size and position across restarts ([#284](https://github.com/CaptainHacX/Clarity/issues/284)) ([582cacd](https://github.com/CaptainHacX/Clarity/commit/582cacd69f5f4adb40f8e00f319e9e22be7adc75))
