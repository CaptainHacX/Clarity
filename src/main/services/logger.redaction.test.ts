import { describe, it, expect, vi } from 'vitest'
import { homedir } from 'os'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/clarity-logger-redaction-test' },
}))

import { redactHome } from './logger'

const HOME = homedir()

describe('redactHome', () => {
  it('replaces the home directory in a stack frame', () => {
    const line = `Error: boom\n    at scan (${HOME}/Projects/clarity/out/main/index.js:12:3)`
    const out = redactHome(line)
    expect(out).not.toContain(HOME)
    expect(out).toContain('~/Projects/clarity/out/main/index.js:12:3')
  })

  it('strips the account name that absolute paths embed', () => {
    // The point of the whole exercise: clarity.log is attached to bug reports,
    // and on macOS and Windows the home path contains the user's account name.
    const account = HOME.split(/[\\/]/).filter(Boolean).pop()
    expect(account).toBeTruthy()
    const out = redactHome(`ENOENT: no such file, open '${HOME}/Desktop/tax-return.pdf'`)
    expect(out).toBe("ENOENT: no such file, open '~/Desktop/tax-return.pdf'")
    expect(out).not.toContain(account as string)
  })

  it('replaces every occurrence, not just the first', () => {
    const out = redactHome(`copy ${HOME}/a.txt -> ${HOME}/b.txt`)
    expect(out).toBe('copy ~/a.txt -> ~/b.txt')
  })

  it('leaves text with no home path untouched', () => {
    const line = 'NVD fetch failed for cpe:2.3:a:google:chrome: HTTP 503'
    expect(redactHome(line)).toBe(line)
  })

  it('does not touch system paths outside the home directory', () => {
    expect(redactHome('/usr/bin/true')).toBe('/usr/bin/true')
    expect(redactHome('/Applications/Clarity.app')).toBe('/Applications/Clarity.app')
  })

  it('is safe on empty input', () => {
    expect(redactHome('')).toBe('')
  })

  it('handles a home path written with forward slashes', () => {
    // A Windows home is C:\Users\name, but JS stack frames sometimes report it
    // with forward slashes, so both spellings have to be covered.
    const forward = HOME.replace(/\\/g, '/')
    const out = redactHome(`at load (${forward}/app/main.js:1:1)`)
    expect(out).toContain('~/app/main.js:1:1')
  })
})
