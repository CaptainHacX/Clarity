import { describe, it, expect } from 'vitest'
import {
  buildPortEntries,
  isListenerSocket,
  isProtectedProcessName,
  normalizeProtocol,
  validateKillPid,
  type NormalizedSocket,
  type ProcessInfo
} from './port-monitor'

function sock(partial: Partial<NormalizedSocket> & { localPort: number }): NormalizedSocket {
  return {
    protocol: 'tcp',
    localAddress: '0.0.0.0',
    localPort: partial.localPort,
    peerAddress: '*',
    peerPort: '*',
    state: 'UNKNOWN',
    pid: null,
    processPath: null,
    ...partial,
  }
}

describe('normalizeProtocol', () => {
  it('maps tcp/udp families to their protocol', () => {
    expect(normalizeProtocol('tcp4')).toBe('tcp')
    expect(normalizeProtocol('tcp6')).toBe('tcp')
    expect(normalizeProtocol('TCP')).toBe('tcp')
    expect(normalizeProtocol('udp46')).toBe('udp')
    expect(normalizeProtocol('udp')).toBe('udp')
  })

  it('rejects unknown protocols and nullish values', () => {
    expect(normalizeProtocol('raw')).toBeNull()
    expect(normalizeProtocol('')).toBeNull()
    expect(normalizeProtocol(null)).toBeNull()
    expect(normalizeProtocol(undefined)).toBeNull()
  })
})

describe('isListenerSocket', () => {
  it('treats TCP LISTEN as a listener', () => {
    expect(isListenerSocket({ protocol: 'tcp', state: 'LISTEN', peerPort: '*', peerAddress: '*' })).toBe(true)
  })

  it('does not treat TCP connections as listeners', () => {
    expect(isListenerSocket({ protocol: 'tcp', state: 'ESTABLISHED', peerPort: '443', peerAddress: '1.2.3.4' })).toBe(false)
  })

  it('treats unbound UDP sockets (wildcard peer) as listeners', () => {
    expect(isListenerSocket({ protocol: 'udp', state: 'UNKNOWN', peerPort: '*', peerAddress: '*' })).toBe(true)
    expect(isListenerSocket({ protocol: 'udp', state: 'UNKNOWN', peerPort: '*', peerAddress: '0.0.0.0' })).toBe(true)
  })

  it('does not treat UDP sockets tied to a peer as listeners', () => {
    expect(isListenerSocket({ protocol: 'udp', state: 'UNKNOWN', peerPort: '443', peerAddress: '8.8.8.8' })).toBe(false)
  })
})

describe('buildPortEntries', () => {
  const processMap = new Map<number, ProcessInfo>([
    [100, { pid: 100, name: 'nginx', command: '/usr/sbin/nginx', params: '', user: 'kudu' }],
  ])

  it('aggregates connected sockets on the same port and pid into one row', () => {
    const entries = buildPortEntries([
      sock({ localPort: 443, pid: 100, state: 'ESTABLISHED', peerAddress: '1.2.3.4', peerPort: '50000' }),
      sock({ localPort: 443, pid: 100, state: 'ESTABLISHED', peerAddress: '5.6.7.8', peerPort: '50001' }),
    ], processMap)

    expect(entries).toHaveLength(1)
    const entry = entries[0]
    expect(entry.port).toBe(443)
    expect(entry.pid).toBe(100)
    expect(entry.processName).toBe('nginx')
    expect(entry.isListener).toBe(false)
    expect(entry.connectionCount).toBe(2)
    expect(entry.remoteSummary).toEqual(['1.2.3.4:50000', '5.6.7.8:50001'])
  })

  it('marks a row as listening when any socket in it is a listener', () => {
    const entries = buildPortEntries([
      sock({ localPort: 8080, pid: 100, state: 'LISTEN', peerAddress: '*', peerPort: '*' }),
      sock({ localPort: 8080, pid: 100, state: 'ESTABLISHED', peerAddress: '1.2.3.4', peerPort: '51000' }),
    ], processMap)

    expect(entries[0].isListener).toBe(true)
    expect(entries[0].state).toBe('LISTEN')
    expect(entries[0].connectionCount).toBe(2)
  })

  it('marks UDP bound sockets as listeners', () => {
    const entries = buildPortEntries([
      sock({ protocol: 'udp', localPort: 5353, pid: 100, state: 'UNKNOWN', peerAddress: '*', peerPort: '*' }),
    ], processMap)

    expect(entries[0].isListener).toBe(true)
    expect(entries[0].protocol).toBe('udp')
  })

  it('keeps kernel-owned sockets with null pid and resolves process name from the map', () => {
    const entries = buildPortEntries([
      sock({ localPort: 137, pid: null, state: 'LISTEN' }),
    ], processMap)

    expect(entries[0].pid).toBeNull()
    expect(entries[0].processName).toBeNull()
    expect(entries[0].killRequiresAdmin).toBe(false)
  })

  it('flags rows owned by another user for elevation', () => {
    const otherUserMap = new Map<number, ProcessInfo>([
      [200, { pid: 200, name: 'root-app', command: 'root-app', params: '', user: 'root' }],
    ])
    const entries = buildPortEntries([
      sock({ localPort: 9000, pid: 200, state: 'LISTEN' }),
    ], otherUserMap)

    expect(entries[0].killRequiresAdmin).toBe(true)
  })

  it('drops sockets without a usable port', () => {
    const entries = buildPortEntries([
      sock({ localPort: 0, state: 'LISTEN' }),
      sock({ localPort: 99999, state: 'LISTEN' }),
      sock({ localPort: 8080, state: 'LISTEN' }),
    ], processMap)

    expect(entries).toHaveLength(1)
    expect(entries[0].port).toBe(8080)
  })

  it('sorts listeners first, then by protocol and port', () => {
    const entries = buildPortEntries([
      sock({ localPort: 9000, pid: 100, state: 'ESTABLISHED', peerAddress: '1.2.3.4', peerPort: '52000' }),
      sock({ protocol: 'udp', localPort: 53, pid: 100, state: 'UNKNOWN', peerAddress: '*', peerPort: '*' }),
      sock({ localPort: 8080, pid: 100, state: 'LISTEN' }),
    ], processMap)

    expect(entries.map((e) => [e.isListener, e.protocol, e.port])).toEqual([
      [true, 'tcp', 8080],
      [true, 'udp', 53],
      [false, 'tcp', 9000],
    ])
  })
})

describe('validateKillPid', () => {
  it('rejects non-integers, negatives and zero', () => {
    expect(validateKillPid(0)).toBeTruthy()
    expect(validateKillPid(-5)).toBeTruthy()
    expect(validateKillPid(1.5)).toBeTruthy()
    expect(validateKillPid(NaN)).toBeTruthy()
    expect(validateKillPid('123' as unknown)).toBeTruthy()
  })

  it('blocks critical low PIDs (kernel / PID 1)', () => {
    expect(validateKillPid(1)).toBeTruthy()
    expect(validateKillPid(2)).toBeTruthy()
    expect(validateKillPid(4)).toBeTruthy()
  })

  it('blocks killing Clarity itself', () => {
    expect(validateKillPid(process.pid)).toBe('Cannot kill own process')
  })

  it('allows normal user-space PIDs', () => {
    expect(validateKillPid(12345)).toBeNull()
    expect(validateKillPid(process.pid + 1000)).toBeNull()
  })
})

describe('isProtectedProcessName', () => {
  it('blocks known critical system processes', () => {
    expect(isProtectedProcessName('launchd')).toBe(true)
    expect(isProtectedProcessName('systemd')).toBe(true)
    expect(isProtectedProcessName('lsass.exe')).toBe(true)
    expect(isProtectedProcessName('kernel_task')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isProtectedProcessName('SystemD')).toBe(true)
    expect(isProtectedProcessName('LaunchD')).toBe(true)
  })

  it('allows normal application processes', () => {
    expect(isProtectedProcessName('nginx')).toBe(false)
    expect(isProtectedProcessName('node')).toBe(false)
    expect(isProtectedProcessName(null)).toBe(false)
    expect(isProtectedProcessName('')).toBe(false)
  })
})
