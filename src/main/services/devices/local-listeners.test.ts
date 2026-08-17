import { describe, it, expect } from 'vitest'
import {
  hostsFilePath,
  parseHostsLoopbackNames,
  parseLsofLine,
  parseNetstatLine,
  readHostsLoopbackNames,
} from './local-listeners'

describe('local-listeners parseLsofLine', () => {
  it('parses a real macOS TCP listener row (NAME spans two columns)', () => {
    const line = 'ControlCe   622 koushik    9u  IPv4 0x33d082bab4452316      0t0  TCP *:7000 (LISTEN)'
    expect(parseLsofLine(line)).toMatchObject({
      port: 7000,
      process: 'ControlCe',
      pid: 622,
      address: '*',
      protocol: 'tcp',
    })
  })

  it('parses an IPv6 loopback listener', () => {
    const line = 'postgres   740 koushik    7u  IPv6 0x602a03f0d8f9c013      0t0  TCP [::1]:5432 (LISTEN)'
    expect(parseLsofLine(line)).toMatchObject({ port: 5432, address: '::1', protocol: 'tcp' })
  })

  it('parses a numbered UDP row', () => {
    const line = 'replicato   707 koushik    8u  IPv6 0x1335b48c520e7258      0t0  UDP *:63857'
    expect(parseLsofLine(line)).toMatchObject({ port: 63857, address: '*', protocol: 'udp' })
  })

  it('skips unnumbered UDP rows and the header', () => {
    expect(parseLsofLine('identitys   671 koushik    7u  IPv4 0x40fdaa96a21a7ab4      0t0  UDP *:*')).toBeNull()
    expect(parseLsofLine('COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME')).toBeNull()
  })
})

describe('local-listeners parseNetstatLine', () => {
  it('parses a Windows TCP LISTENING row', () => {
    const line = '  TCP    0.0.0.0:445    0.0.0.0:0    LISTENING       4'
    expect(parseNetstatLine(line)).toMatchObject({
      port: 445,
      pid: 4,
      address: '*',
      protocol: 'tcp',
    })
  })

  it('ignores non-listening TCP rows but keeps UDP', () => {
    expect(parseNetstatLine('  TCP    0.0.0.0:500    0.0.0.0:0    ESTABLISHED    100')).toBeNull()
    expect(parseNetstatLine('  UDP    0.0.0.0:123    *:*                             4')?.protocol).toBe('udp')
  })
})

describe('local-listeners parseHostsLoopbackNames', () => {
  it('collects every alias on a loopback line', () => {
    const names = parseHostsLoopbackNames('127.0.0.1\tlocalhost app.local api.local\n')
    expect(names).toEqual(['localhost', 'app.local', 'api.local'])
  })

  it('reads IPv6 loopback and the whole 127.0.0.0/8 range', () => {
    expect(parseHostsLoopbackNames('::1 ip6-localhost')).toEqual(['ip6-localhost'])
    expect(parseHostsLoopbackNames('127.0.1.1 secondary')).toEqual(['secondary'])
  })

  it('ignores comments, including a fully commented-out entry', () => {
    // This is the Windows default: the localhost lines ship commented out
    // because Windows resolves the name in DNS instead.
    const windowsDefault = [
      '# Copyright (c) 1993-2009 Microsoft Corp.',
      '#\t127.0.0.1       localhost',
      '#\t::1             localhost',
    ].join('\r\n')
    expect(parseHostsLoopbackNames(windowsDefault)).toEqual([])
  })

  it('strips trailing comments but keeps the aliases before them', () => {
    expect(parseHostsLoopbackNames('127.0.0.1 localhost # the usual')).toEqual(['localhost'])
  })

  it('skips non-loopback addresses', () => {
    expect(parseHostsLoopbackNames('192.168.1.10 nas.local\n10.0.0.1 router')).toEqual([])
  })

  it('handles CRLF line endings and blank lines', () => {
    expect(parseHostsLoopbackNames('\r\n127.0.0.1 a\r\n\r\n127.0.0.1 b\r\n')).toEqual(['a', 'b'])
  })

  it('de-duplicates a name repeated across lines', () => {
    expect(parseHostsLoopbackNames('127.0.0.1 localhost\n::1 localhost')).toEqual(['localhost'])
  })
})

describe('local-listeners hostsFilePath', () => {
  it('points at the platform hosts file', () => {
    const p = hostsFilePath()
    if (process.platform === 'win32') {
      // Under the system root, not a hardcoded C:\Windows — the location moves
      // with a non-standard install.
      expect(p.toLowerCase()).toContain('system32')
      expect(p.toLowerCase()).toContain('drivers')
      expect(p.toLowerCase()).toMatch(/hosts$/)
    } else {
      expect(p).toBe('/etc/hosts')
    }
  })
})

describe('local-listeners readHostsLoopbackNames', () => {
  it('reads the real hosts file without throwing on any platform', () => {
    // Deliberately asserts no specific names: a hosts file is machine state, and
    // Windows ships its localhost entries commented out. An unreadable or
    // alias-free file is a valid outcome, not a failure.
    const names = readHostsLoopbackNames()
    expect(Array.isArray(names)).toBe(true)
    expect(names.every((n) => typeof n === 'string')).toBe(true)
  })
})
