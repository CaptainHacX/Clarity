import { describe, it, expect } from 'vitest'
import { parseLsofLine, parseNetstatLine, readHostsLoopbackNames } from './local-listeners'

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

describe('local-listeners readHostsLoopbackNames', () => {
  it('returns the loopback names from the real /etc/hosts', () => {
    const names = readHostsLoopbackNames()
    expect(names.length).toBeGreaterThan(0)
    expect(names).toContain('localhost')
  })
})
