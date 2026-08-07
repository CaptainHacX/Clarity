import { describe, it, expect } from 'vitest'
import { parsePingTimes, parsePingTimesWin, computeLinkQuality } from './icmp-provider'

describe('icmp-provider parsePingTimes', () => {
  it('parses macOS per-reply time= lines', () => {
    const out = [
      'PING 192.168.1.1 (192.168.1.1): 56 data bytes',
      '64 bytes from 192.168.1.1: icmp_seq=0 ttl=64 time=1.234 ms',
      '64 bytes from 192.168.1.1: icmp_seq=1 ttl=64 time=0.891 ms',
      '--- 192.168.1.1 ping statistics ---',
      '2 packets transmitted, 2 packets received, 0.0% packet loss',
    ].join('\n')
    expect(parsePingTimes(out)).toEqual([1.234, 0.891])
  })

  it('parses the macOS sub-millisecond form (time<1 ms)', () => {
    expect(parsePingTimes('64 bytes from 10.0.0.2: icmp_seq=0 ttl=64 time<1 ms')).toEqual([1])
  })

  it('returns empty for a probe with no replies', () => {
    expect(parsePingTimes('Request timeout for icmp_seq 0')).toEqual([])
  })
})

describe('icmp-provider parsePingTimesWin', () => {
  it('parses Windows time=ms lines', () => {
    const out = [
      'Reply from 192.168.1.1: bytes=32 time=3ms TTL=64',
      'Reply from 192.168.1.1: bytes=32 time=2ms TTL=64',
    ].join('\n')
    expect(parsePingTimesWin(out)).toEqual([3, 2])
  })
})

describe('icmp-provider computeLinkQuality', () => {
  it('computes min/avg/variability/loss from a burst', () => {
    const q = computeLinkQuality([10, 20, 30], 4)
    expect(q.latencyMs).toBe(10)
    expect(q.avgMs).toBeCloseTo(20)
    expect(q.variabilityMs).toBeCloseTo(Math.sqrt((100 + 0 + 100) / 3))
    expect(q.packetLossPct).toBeCloseTo(0.25)
    expect(q.measuredAt).toBeGreaterThan(0)
  })

  it('handles a fully lost burst', () => {
    const q = computeLinkQuality([], 3)
    expect(q.latencyMs).toBeNull()
    expect(q.avgMs).toBeNull()
    expect(q.packetLossPct).toBeCloseTo(1)
  })
})
