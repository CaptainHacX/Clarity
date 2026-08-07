import { describe, it, expect } from 'vitest'
import {
  inspectService,
  parseHttpResponse,
  parsePostgresAuth,
  parseRedisPing,
  productFromBanner,
  productFromHttp,
  protocolForPort,
} from './service-inspector'

describe('protocolForPort', () => {
  it('classifies the ports the inspector knows how to read', () => {
    expect(protocolForPort(80)).toBe('http')
    expect(protocolForPort(8080)).toBe('http')
    expect(protocolForPort(443)).toBe('https')
    expect(protocolForPort(6379)).toBe('redis')
    expect(protocolForPort(5432)).toBe('postgres')
    expect(protocolForPort(22)).toBe('banner')
    expect(protocolForPort(9999)).toBe('unknown')
  })
})

describe('parseHttpResponse', () => {
  const raw = [
    'HTTP/1.1 200 OK',
    'Server: HP HTTP Server; HP ENVY 5000 series',
    'Content-Type: text/html',
    '',
    '<html><head><title>HP ENVY 5000 series</title></head><body>hi</body></html>',
  ].join('\r\n')

  it('reads status, server and title', () => {
    expect(parseHttpResponse(raw)).toMatchObject({
      status: 200,
      server: 'HP HTTP Server; HP ENVY 5000 series',
      title: 'HP ENVY 5000 series',
      realm: null,
    })
  })

  it('reads the authentication realm from a 401', () => {
    const guarded = 'HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="Router Admin"\r\n\r\n'
    expect(parseHttpResponse(guarded)).toMatchObject({ status: 401, realm: 'Router Admin' })
  })

  it('survives a body with no headers block', () => {
    expect(parseHttpResponse('garbage')).toMatchObject({ status: null, server: null, title: null })
  })
})

describe('productFromHttp', () => {
  it('names the product behind a web port', () => {
    expect(productFromHttp('HP HTTP Server', null, null)).toBe('HP printer')
    expect(productFromHttp(null, 'Synology DiskStation', null)).toBe('Synology NAS')
    expect(productFromHttp('nginx/1.24.0', null, null)).toBe('nginx')
    expect(productFromHttp(null, null, 'Home Assistant')).toBe('Home Assistant')
  })

  it('returns null rather than guessing', () => {
    expect(productFromHttp(null, null, null)).toBeNull()
    expect(productFromHttp('SomeUnknownServer/1.0', null, null)).toBeNull()
  })
})

describe('productFromBanner', () => {
  it('reads an SSH identification line', () => {
    expect(productFromBanner('SSH-2.0-OpenSSH_9.6\r\n')).toBe('OpenSSH 9.6')
    expect(productFromBanner('SSH-2.0-dropbear_2022.83')).toBe('Dropbear 2022.83')
  })

  it('reads an FTP greeting', () => {
    expect(productFromBanner('220 ProFTPD Server ready.\r\n')).toBe('ProFTPD Server ready.')
  })

  it('returns null for an empty banner', () => {
    expect(productFromBanner('   ')).toBeNull()
  })
})

describe('parseRedisPing', () => {
  it('catches a database reachable with no password', () => {
    expect(parseRedisPing(Buffer.from('+PONG\r\n'))).toEqual({
      posture: 'open-no-auth',
      detail: 'Answered PING with no password',
    })
  })

  it('recognises a password-protected instance', () => {
    expect(parseRedisPing(Buffer.from('-NOAUTH Authentication required.\r\n')).posture).toBe('auth-required')
  })

  it('reports unknown when nothing came back', () => {
    expect(parseRedisPing(Buffer.alloc(0)).posture).toBe('unknown')
  })
})

describe('parsePostgresAuth', () => {
  function authResponse(type: number): Buffer {
    const buf = Buffer.alloc(9)
    buf.writeUInt8(0x52, 0) // 'R'
    buf.writeInt32BE(8, 1)
    buf.writeInt32BE(type, 5)
    return buf
  }

  it('flags AuthenticationOk as an exposed database', () => {
    expect(parsePostgresAuth(authResponse(0))).toEqual({
      posture: 'open-no-auth',
      detail: 'Accepted the connection with no password',
    })
  })

  it('names the authentication a protected server asks for', () => {
    expect(parsePostgresAuth(authResponse(10))).toEqual({
      posture: 'auth-required',
      detail: 'Requires SASL / SCRAM',
    })
    expect(parsePostgresAuth(authResponse(5)).detail).toBe('Requires MD5 password')
  })

  it('treats an ErrorResponse as auth-required', () => {
    const err = Buffer.concat([Buffer.from([0x45]), Buffer.alloc(4), Buffer.from('SFATAL\0no pg_hba entry\0')])
    expect(parsePostgresAuth(err).posture).toBe('auth-required')
  })

  it('reports unknown on silence', () => {
    expect(parsePostgresAuth(Buffer.alloc(0)).posture).toBe('unknown')
  })
})

describe('inspectService guards', () => {
  it('refuses anything that is not a LAN address', async () => {
    const result = await inspectService('8.8.8.8', 80)
    expect(result.error).toMatch(/local network/i)
  })

  it('refuses an out-of-range port', async () => {
    const result = await inspectService('192.168.1.10', 70000)
    expect(result.error).toBe('Invalid port.')
  })
})
