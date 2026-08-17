import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  PUBLIC_IP_ENDPOINTS,
  getCachedPublicIp,
  getPublicIp,
  lookupPublicIp,
  networkFingerprint,
  parsePublicIpResponse,
  resetPublicIpCache,
  type FetchLike,
} from './public-ip'

/** A fetch double that answers with `body`, or throws to simulate no route. */
function fetchReturning(body: string, ok = true): FetchLike {
  return vi.fn(async () => ({ ok, text: async () => body })) as unknown as FetchLike
}

function fetchThrowing(): FetchLike {
  return vi.fn(async () => {
    throw new Error('getaddrinfo ENOTFOUND')
  }) as unknown as FetchLike
}

describe('parsePublicIpResponse', () => {
  it('accepts a bare routable IPv4, with surrounding whitespace', () => {
    expect(parsePublicIpResponse('93.184.216.34')).toBe('93.184.216.34')
    // icanhazip returns a trailing newline.
    expect(parsePublicIpResponse('93.184.216.34\n')).toBe('93.184.216.34')
    expect(parsePublicIpResponse('  1.1.1.1  ')).toBe('1.1.1.1')
  })

  it('rejects a private address — a public-IP service returning one is not the internet', () => {
    // What a captive portal or a hijacked DNS answer looks like.
    expect(parsePublicIpResponse('192.168.1.1')).toBeNull()
    expect(parsePublicIpResponse('10.0.0.1')).toBeNull()
    expect(parsePublicIpResponse('127.0.0.1')).toBeNull()
    expect(parsePublicIpResponse('100.64.0.1')).toBeNull()
  })

  it('rejects a captive portal HTML page', () => {
    expect(parsePublicIpResponse('<!DOCTYPE html><html><body>Sign in</body></html>')).toBeNull()
    expect(parsePublicIpResponse('Redirecting to login...')).toBeNull()
  })

  it('rejects malformed addresses', () => {
    expect(parsePublicIpResponse('999.1.1.1')).toBeNull()
    expect(parsePublicIpResponse('1.2.3')).toBeNull()
    expect(parsePublicIpResponse('1.2.3.4.5')).toBeNull()
    expect(parsePublicIpResponse('01.2.3.4')).toBeNull() // non-canonical leading zero
    expect(parsePublicIpResponse('2606:4700::1111')).toBeNull() // IPv6, this is the v4 lookup
  })

  it('rejects an oversized body rather than scanning it', () => {
    expect(parsePublicIpResponse('8.8.8.8'.padEnd(500, ' '))).toBeNull()
  })

  it('handles nullish and empty input', () => {
    expect(parsePublicIpResponse(null)).toBeNull()
    expect(parsePublicIpResponse(undefined)).toBeNull()
    expect(parsePublicIpResponse('')).toBeNull()
  })
})

describe('lookupPublicIp', () => {
  it('returns the address from the first endpoint that answers', async () => {
    const res = await lookupPublicIp({ fetchImpl: fetchReturning('93.184.216.34'), now: 1000 })
    expect(res).toEqual({ address: '93.184.216.34', state: 'ok', checkedAt: 1000 })
  })

  it('reports offline — not an error — when there is no route', async () => {
    // The whole point: no internet is an expected state, never a throw.
    const res = await lookupPublicIp({ fetchImpl: fetchThrowing(), now: 2000 })
    expect(res).toEqual({ address: null, state: 'offline', checkedAt: 2000 })
  })

  it('falls through to the second endpoint when the first is unusable', async () => {
    let call = 0
    const impl = vi.fn(async () => {
      call += 1
      if (call === 1) throw new Error('blocked')
      return { ok: true, text: async () => '1.1.1.1' }
    }) as unknown as FetchLike
    const res = await lookupPublicIp({ fetchImpl: impl, now: 3000 })
    expect(res.state).toBe('ok')
    expect(res.address).toBe('1.1.1.1')
    expect(call).toBe(2)
  })

  it('treats a non-OK response as unusable and tries the next endpoint', async () => {
    const impl = fetchReturning('93.184.216.34', false)
    const res = await lookupPublicIp({ fetchImpl: impl, now: 4000 })
    expect(res.state).toBe('offline')
    // Both endpoints attempted before giving up.
    expect(impl).toHaveBeenCalledTimes(PUBLIC_IP_ENDPOINTS.length)
  })

  it('treats a captive portal reply as offline', async () => {
    const res = await lookupPublicIp({ fetchImpl: fetchReturning('<html>Login required</html>'), now: 5000 })
    expect(res).toEqual({ address: null, state: 'offline', checkedAt: 5000 })
  })
})

describe('getPublicIp caching', () => {
  beforeEach(() => {
    resetPublicIpCache()
  })

  it('reports unknown before anything has been looked up', () => {
    expect(getCachedPublicIp()).toEqual({ address: null, state: 'unknown', checkedAt: null })
  })

  it('serves a good answer from cache without hitting the network again', async () => {
    const impl = fetchReturning('93.184.216.34')
    await getPublicIp('192.168.1.105', '192.168.1.1', { fetchImpl: impl, now: 1000 })
    await getPublicIp('192.168.1.105', '192.168.1.1', { fetchImpl: impl, now: 1000 + 60_000 })
    expect(impl).toHaveBeenCalledTimes(1)
  })

  it('re-checks once the success TTL has passed', async () => {
    const impl = fetchReturning('93.184.216.34')
    await getPublicIp('192.168.1.105', '192.168.1.1', { fetchImpl: impl, now: 1000 })
    await getPublicIp('192.168.1.105', '192.168.1.1', { fetchImpl: impl, now: 1000 + 11 * 60_000 })
    expect(impl).toHaveBeenCalledTimes(2)
  })

  it('retries a failure quickly, so reconnecting shows the address promptly', async () => {
    const failing = fetchThrowing()
    const first = await getPublicIp('192.168.1.105', '192.168.1.1', { fetchImpl: failing, now: 1000 })
    expect(first.state).toBe('offline')

    // 25s later the machine is back online; the short negative TTL has expired.
    const ok = fetchReturning('93.184.216.34')
    const second = await getPublicIp('192.168.1.105', '192.168.1.1', { fetchImpl: ok, now: 1000 + 25_000 })
    expect(second.state).toBe('ok')
    expect(second.address).toBe('93.184.216.34')
  })

  it('holds a failure for a few seconds rather than retrying on every scan', async () => {
    const failing = fetchThrowing()
    await getPublicIp('192.168.1.105', '192.168.1.1', { fetchImpl: failing, now: 1000 })
    await getPublicIp('192.168.1.105', '192.168.1.1', { fetchImpl: failing, now: 1000 + 5_000 })
    expect(failing).toHaveBeenCalledTimes(PUBLIC_IP_ENDPOINTS.length) // one round, not two
  })

  it('drops the cache when the machine moves to another network', async () => {
    const impl = fetchReturning('93.184.216.34')
    await getPublicIp('192.168.1.105', '192.168.1.1', { fetchImpl: impl, now: 1000 })
    // Different LAN → the public address will differ, so the old answer is void.
    await getPublicIp('10.0.0.7', '10.0.0.1', { fetchImpl: impl, now: 1000 + 1_000 })
    expect(impl).toHaveBeenCalledTimes(2)
  })

  it('force bypasses a still-fresh cache', async () => {
    const impl = fetchReturning('93.184.216.34')
    await getPublicIp('192.168.1.105', '192.168.1.1', { fetchImpl: impl, now: 1000 })
    await getPublicIp('192.168.1.105', '192.168.1.1', { fetchImpl: impl, now: 1000, force: true })
    expect(impl).toHaveBeenCalledTimes(2)
  })
})

describe('networkFingerprint', () => {
  it('distinguishes networks and tolerates missing parts', () => {
    expect(networkFingerprint('192.168.1.105', '192.168.1.1')).not.toBe(networkFingerprint('10.0.0.7', '10.0.0.1'))
    expect(networkFingerprint(null, null)).toBe('-|-')
    // Same LAN IP behind a different router is still a different network.
    expect(networkFingerprint('192.168.1.5', '192.168.1.1')).not.toBe(networkFingerprint('192.168.1.5', '192.168.0.1'))
  })
})
