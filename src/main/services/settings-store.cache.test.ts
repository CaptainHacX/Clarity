import { describe, it, expect, afterAll, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { rmSync, existsSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'

const TEST_DIR = join(tmpdir(), `clarity-cache-test-${randomUUID()}`)

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => TEST_DIR,
  },
}))

import { getSettings, setSettings, flushSettings } from './settings-store'

// getDataDir() appends Clarity-Dev when app.isPackaged is false.
const CONFIG_PATH = join(TEST_DIR, 'Clarity-Dev', 'config.json')

/**
 * The store memoizes its parse of config.json so a clean doesn't re-read and
 * re-merge the file once per deleted file. These cover the three ways that memo
 * has to be given up: our own writes, another process's writes, and the file
 * going away entirely.
 */
describe('settings store read memoization', () => {
  afterAll(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it('reflects a write made by this process', async () => {
    setSettings({ language: 'de' })
    await flushSettings()
    expect(getSettings().language).toBe('de')
  })

  it('serves repeated reads from one snapshot while the file is unchanged', () => {
    // Same object identity is the observable proof the parse was reused — this
    // is what makes a per-file getSettings() call cheap enough to keep.
    expect(getSettings()).toBe(getSettings())
  })

  it('picks up a config.json rewritten by another process', () => {
    // The elevated instance (--clarity-data-dir) and --cli runs write this same
    // file; a memo that ignored them would silently discard their settings.
    writeFileSync(CONFIG_PATH, JSON.stringify({ settings: { language: 'fr' } }), 'utf-8')
    expect(getSettings().language).toBe('fr')
  })

  it('keeps merging defaults into an externally written partial config', () => {
    // The external write above carried only `language`, so everything else must
    // still come from defaults rather than being dropped.
    const settings = getSettings()
    expect(settings.theme).toBe('dark')
    expect(settings.cleaner.protectRecycleBin).toBe(true)
  })

  it('falls back to defaults when config.json is removed', () => {
    rmSync(CONFIG_PATH, { force: true })
    expect(getSettings().language).toBe('en')
  })

  it('still persists and reads back after the file was removed', async () => {
    setSettings({ language: 'ja' })
    await flushSettings()
    expect(getSettings().language).toBe('ja')
  })
})
