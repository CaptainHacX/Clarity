import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { hardenedPath } from './path-hardening'

const ROOT = 'C:\\Windows'
const SYS32 = join(ROOT, 'System32')
const WBEM = join(ROOT, 'System32', 'Wbem')
const PS = join(ROOT, 'System32', 'WindowsPowerShell', 'v1.0')

function parts(value: string): string[] {
  return value.split(';')
}

describe('hardenedPath', () => {
  it('puts the real PowerShell directory ahead of an attacker-writable one', () => {
    // The whole point: powershell.exe is resolved by walking PATH, so whoever
    // appears first owns what this elevated app executes.
    const evil = 'C:\\tools'
    const next = hardenedPath(`${evil};${SYS32}`, ROOT)
    expect(next).not.toBeNull()
    const order = parts(next as string)
    expect(order.indexOf(PS)).toBeLessThan(order.indexOf(evil))
    expect(order[0]).toBe(SYS32)
  })

  it('prepends all four system directories', () => {
    const order = parts(hardenedPath('C:\\other', ROOT) as string)
    expect(order.slice(0, 4)).toEqual([SYS32, ROOT, WBEM, PS])
  })

  it('keeps third-party directories reachable, just later', () => {
    // winget and choco genuinely live outside System32 and are still spawned by
    // bare name, so PATH is prepended to rather than replaced.
    const winget = 'C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps'
    const choco = 'C:\\ProgramData\\chocolatey\\bin'
    const order = parts(hardenedPath(`${winget};${choco}`, ROOT) as string)
    expect(order).toContain(winget)
    expect(order).toContain(choco)
    expect(order.indexOf(SYS32)).toBeLessThan(order.indexOf(winget))
  })

  it('does not duplicate a system directory already present', () => {
    const order = parts(hardenedPath(`${SYS32};C:\\other`, ROOT) as string)
    expect(order.filter((p) => p === SYS32)).toHaveLength(1)
  })

  it('deduplicates case-insensitively, as Windows paths compare', () => {
    const order = parts(hardenedPath(`${SYS32.toUpperCase()};C:\\other`, ROOT) as string)
    const sys32Count = order.filter((p) => p.toLowerCase() === SYS32.toLowerCase()).length
    expect(sys32Count).toBe(1)
  })

  it('is idempotent — a second pass changes nothing', () => {
    const once = hardenedPath('C:\\other', ROOT) as string
    expect(hardenedPath(once, ROOT)).toBeNull()
  })

  it('drops empty PATH segments rather than preserving them', () => {
    const order = parts(hardenedPath(`;;C:\\other;;`, ROOT) as string)
    expect(order).not.toContain('')
  })

  it('does nothing without a system root, instead of inventing C:\\Windows', () => {
    expect(hardenedPath('C:\\other', undefined)).toBeNull()
    expect(hardenedPath('C:\\other', '')).toBeNull()
  })

  it('handles an absent PATH', () => {
    const order = parts(hardenedPath(undefined, ROOT) as string)
    expect(order).toEqual([SYS32, ROOT, WBEM, PS])
  })

  it('honours a relocated Windows install', () => {
    const order = parts(hardenedPath('C:\\other', 'D:\\WinNT') as string)
    expect(order[0]).toBe(join('D:\\WinNT', 'System32'))
  })
})
