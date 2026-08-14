import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getVersion: () => '1.0.3',
  },
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openExternal: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('./settings-store', () => ({
  getSettings: () => ({ autoUpdate: true, autoRestart: true, updateCheckIntervalHours: 4 }),
}))

vi.mock('electron-updater', () => ({
  autoUpdater: { on: vi.fn(), checkForUpdates: vi.fn(), downloadUpdate: vi.fn(), quitAndInstall: vi.fn() },
}))

import { isNewerVersion } from './auto-updater'

describe('isNewerVersion', () => {
  it('returns true when the candidate is a patch ahead', () => {
    expect(isNewerVersion('1.0.4', '1.0.3')).toBe(true)
  })

  it('returns true when the candidate is a minor ahead', () => {
    expect(isNewerVersion('1.2.0', '1.0.3')).toBe(true)
  })

  it('returns true when the candidate is a major ahead', () => {
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(true)
  })

  it('returns false when versions are equal', () => {
    expect(isNewerVersion('1.0.3', '1.0.3')).toBe(false)
  })

  it('returns false when the candidate is older', () => {
    expect(isNewerVersion('1.0.2', '1.0.3')).toBe(false)
  })

  it('returns false when the candidate has fewer segments', () => {
    expect(isNewerVersion('1.0', '1.0.3')).toBe(false)
  })

  it('returns true when the candidate has more segments and is ahead', () => {
    expect(isNewerVersion('1.0.3.1', '1.0.3')).toBe(true)
  })

  it('handles a leading v prefix', () => {
    expect(isNewerVersion('v1.0.4', '1.0.3')).toBe(true)
  })
})
