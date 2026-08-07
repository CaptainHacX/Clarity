import { describe, it, expect } from 'vitest'
import { isLanTarget, isLanTargetAny, probePort, scanRange, FULL_SCAN_CONNECT_TIMEOUT_MS } from './port-scanner'

describe('isLanTarget', () => {
  it('rejects public, loopback and malformed addresses', () => {
    expect(isLanTarget('8.8.8.8', '192.168.1.14')).toBe(false)
    expect(isLanTarget('1.1.1.1', null)).toBe(false)
    expect(isLanTarget('127.0.0.1', '192.168.1.14')).toBe(false)
    expect(isLanTarget('not-an-ip', '192.168.1.14')).toBe(false)
    expect(isLanTarget('', '192.168.1.14')).toBe(false)
  })

  it('accepts private addresses when no host context is known', () => {
    expect(isLanTarget('10.0.0.5', null)).toBe(true)
    expect(isLanTarget('172.20.0.5', undefined)).toBe(true)
    expect(isLanTarget('192.168.1.99', '')).toBe(true)
    expect(isLanTarget('169.254.10.1', null)).toBe(true)
  })

  it('requires same /24 on 192.168 and link-local, /16 on 10/172', () => {
    expect(isLanTarget('192.168.1.30', '192.168.1.14')).toBe(true)
    expect(isLanTarget('192.168.2.30', '192.168.1.14')).toBe(false)
    expect(isLanTarget('169.254.10.20', '169.254.10.1')).toBe(true)
    expect(isLanTarget('169.254.11.20', '169.254.10.1')).toBe(false)
    expect(isLanTarget('10.0.1.5', '10.0.2.3')).toBe(true)
    expect(isLanTarget('10.1.1.5', '10.0.2.3')).toBe(false)
    expect(isLanTarget('172.20.5.1', '172.20.9.1')).toBe(true)
    expect(isLanTarget('172.21.5.1', '172.20.9.1')).toBe(false)
  })

  it('treats the host itself as a valid target', () => {
    expect(isLanTarget('192.168.1.14', '192.168.1.14')).toBe(true)
  })
})

describe('isLanTargetAny', () => {
  it('accepts when the target shares a subnet with any known private host', () => {
    const hosts = ['10.8.0.1', '192.168.1.14']
    expect(isLanTargetAny('192.168.1.30', hosts)).toBe(true)
    expect(isLanTargetAny('10.8.0.5', hosts)).toBe(true)
  })

  it('rejects when the target matches no known private host subnet', () => {
    const hosts = ['10.8.0.1', '192.168.1.14']
    expect(isLanTargetAny('192.168.2.30', hosts)).toBe(false)
    expect(isLanTargetAny('10.9.0.5', hosts)).toBe(false)
  })

  it('rejects public targets even when a host subnet matches', () => {
    expect(isLanTargetAny('8.8.8.8', ['192.168.1.14'])).toBe(false)
  })

  it('ignores non-private host entries and falls back to private-only', () => {
    expect(isLanTargetAny('192.168.1.30', ['1.2.3.4', '8.8.8.8'])).toBe(true)
    expect(isLanTargetAny('10.0.0.5', [null, undefined, ''])).toBe(true)
  })
})

describe('probePort', () => {
  it('reports closed for a closed loopback port quickly', async () => {
    const start = Date.now()
    const state = await probePort('127.0.0.1', 1, 800)
    expect(state).toBe('closed')
    expect(Date.now() - start).toBeLessThan(800)
  })

  it('reports filtered for an unroutable private address', async () => {
    const state = await probePort('10.255.255.254', 443, 300)
    expect(state).toBe('filtered')
  })
})

describe('scanRange', () => {
  it('walks a tiny range and reports open ports', async () => {
    const result = await scanRange('127.0.0.1', 0, 0, { timeoutMs: 50 })
    expect(result.open).toEqual([])
  })

  it('aborts when cancelled between probes', async () => {
    const result = await scanRange('127.0.0.1', 1, 70000, {
      timeoutMs: 10,
      concurrency: 1,
      isCancelled: () => true,
    })
    expect(result.aborted).toBe(true)
    expect(result.checked).toBe(0)
  })

  it('reports progress via callback', async () => {
    let last: { checked: number; open: number } | null = null
    const result = await scanRange('127.0.0.1', 1, 10, {
      timeoutMs: 20,
      concurrency: 2,
      onProgress: (p) => {
        last = p
      },
    })
    expect(result.checked).toBe(10)
    const lastReport = last as { checked: number; open: number } | null
    expect(lastReport?.checked).toBe(10)
    expect(lastReport?.open).toBe(result.open.length)
    expect(result.closed).toBeGreaterThan(0)
  })

  it('honours the timeout constant', () => {
    expect(FULL_SCAN_CONNECT_TIMEOUT_MS).toBe(350)
  })
})
