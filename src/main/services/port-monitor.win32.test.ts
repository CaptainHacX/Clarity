import { describe, it, expect } from 'vitest'
import {
  isListenerSocket,
  parseNetstatAno,
  parseWindowsServiceCsv,
  splitNetstatAddress,
} from './port-monitor'

/**
 * Windows enumerates sockets through `netstat -ano` rather than
 * systeminformation, whose win32 branch reads every row as TCP-shaped and so
 * mis-reads the PID of every UDP row. These cover the shape handling that
 * correctness depends on — a wrong PID here is a process terminated by mistake.
 */

// Real `netstat -ano` output: TCP rows carry State then PID, UDP rows omit State.
const SAMPLE = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1044
  TCP    127.0.0.1:5432         0.0.0.0:0              LISTENING       7420
  TCP    192.168.1.20:52344     93.184.216.34:443      ESTABLISHED     9001
  TCP    [::]:445               [::]:0                 LISTENING       4
  UDP    0.0.0.0:500            *:*                                    4340
  UDP    [::1]:1900             *:*                                    5852
`

describe('splitNetstatAddress', () => {
  it('splits IPv4 host and port', () => {
    expect(splitNetstatAddress('0.0.0.0:135')).toEqual({ host: '0.0.0.0', port: '135' })
  })

  it('splits bracketed IPv6 on the last colon and strips brackets', () => {
    expect(splitNetstatAddress('[::]:445')).toEqual({ host: '::', port: '445' })
    expect(splitNetstatAddress('[::1]:1900')).toEqual({ host: '::1', port: '1900' })
    expect(splitNetstatAddress('[fe80::1%12]:5353')).toEqual({ host: 'fe80::1%12', port: '5353' })
  })

  it('handles the wildcard foreign address UDP rows carry', () => {
    expect(splitNetstatAddress('*:*')).toEqual({ host: '*', port: '*' })
  })

  it('returns an empty port when there is no colon', () => {
    expect(splitNetstatAddress('0.0.0.0')).toEqual({ host: '0.0.0.0', port: '' })
  })
})

describe('parseNetstatAno', () => {
  const rows = parseNetstatAno(SAMPLE)

  it('skips the banner and header lines', () => {
    expect(rows).toHaveLength(6)
  })

  it('reads the PID from column 5 on TCP rows', () => {
    const listener = rows.find((r) => r.protocol === 'tcp' && r.localPort === 135)
    expect(listener?.pid).toBe(1044)
    expect(listener?.state).toBe('LISTEN')
  })

  it('reads the PID from column 4 on UDP rows, where there is no State', () => {
    // This is the case systeminformation gets wrong: it would report pid null
    // and a state of "4340".
    const udp = rows.find((r) => r.protocol === 'udp' && r.localPort === 500)
    expect(udp?.pid).toBe(4340)
    expect(udp?.state).not.toBe('4340')
  })

  it('does not mistake a UDP PID for a state', () => {
    for (const row of rows.filter((r) => r.protocol === 'udp')) {
      expect(row.state).not.toMatch(/^\d+$/)
    }
  })

  it('normalizes LISTENING to LISTEN', () => {
    expect(rows.filter((r) => r.state === 'LISTENING')).toHaveLength(0)
    expect(rows.filter((r) => r.state === 'LISTEN')).toHaveLength(3)
  })

  it('keeps established connections and their peer', () => {
    const conn = rows.find((r) => r.localPort === 52344)
    expect(conn?.state).toBe('ESTABLISHED')
    expect(conn?.peerAddress).toBe('93.184.216.34')
    expect(conn?.peerPort).toBe('443')
    expect(conn?.pid).toBe(9001)
  })

  it('parses IPv6 listeners', () => {
    const v6 = rows.find((r) => r.localAddress === '::' && r.localPort === 445)
    expect(v6?.pid).toBe(4)
    expect(v6?.state).toBe('LISTEN')
  })

  it('marks TCP listeners and bound UDP as listener sockets', () => {
    const tcpListener = rows.find((r) => r.localPort === 135)!
    const udpBound = rows.find((r) => r.localPort === 500)!
    const established = rows.find((r) => r.localPort === 52344)!
    expect(isListenerSocket(tcpListener)).toBe(true)
    expect(isListenerSocket(udpBound)).toBe(true)
    expect(isListenerSocket(established)).toBe(false)
  })

  it('treats a TCP row with foreign port 0 as listening even when the state word is localized', () => {
    // A German Windows prints ABHÖREN. The foreign port is the trustworthy signal.
    const german = parseNetstatAno('  TCP    0.0.0.0:80    0.0.0.0:0    ABHÖREN    2200')
    expect(german).toHaveLength(1)
    expect(german[0].state).toBe('LISTEN')
    expect(german[0].pid).toBe(2200)
    expect(isListenerSocket(german[0])).toBe(true)
  })

  it('drops malformed and non-IP rows rather than inventing sockets', () => {
    expect(parseNetstatAno('')).toEqual([])
    expect(parseNetstatAno('garbage line here')).toEqual([])
    // A TCP row missing its PID column is malformed, not a UDP row.
    expect(parseNetstatAno('  TCP    0.0.0.0:80    0.0.0.0:0    LISTENING')).toEqual([])
    // Non-numeric port.
    expect(parseNetstatAno('  TCP    0.0.0.0:http    0.0.0.0:0    LISTENING    5')).toEqual([])
  })

  it('accepts CRLF line endings', () => {
    const crlf = parseNetstatAno('  TCP    0.0.0.0:135    0.0.0.0:0    LISTENING    1044\r\n')
    expect(crlf).toHaveLength(1)
    expect(crlf[0].pid).toBe(1044)
  })
})

describe('parseWindowsServiceCsv', () => {
  it('maps quoted PID,Name rows', () => {
    const map = parseWindowsServiceCsv('"ProcessId","Name"\r\n"1044","RpcSs"\r\n"7420","postgresql"')
    expect(map.get(1044)).toBe('RpcSs')
    expect(map.get(7420)).toBe('postgresql')
  })

  it('joins several services sharing one svchost PID', () => {
    const map = parseWindowsServiceCsv('"920","Dhcp"\n"920","Dnscache"\n"920","Dhcp"')
    // De-duped, so a service listed twice does not appear twice.
    expect(map.get(920)).toBe('Dhcp, Dnscache')
  })

  it('ignores the header, blanks, and rows without a usable PID or name', () => {
    const map = parseWindowsServiceCsv('"ProcessId","Name"\n\n"0","Idle"\n"abc","Nope"\n"55",""')
    expect(map.size).toBe(0)
  })
})
