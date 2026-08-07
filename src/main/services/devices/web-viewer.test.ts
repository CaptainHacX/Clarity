import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  session: { fromPartition: vi.fn() },
}))

import { buildViewerUrl, isSameLockedOrigin } from './web-viewer'

describe('buildViewerUrl', () => {
  it('builds a URL for a LAN device', () => {
    expect(buildViewerUrl({ ip: '192.168.1.9', port: 8080, scheme: 'http' })).toBe('http://192.168.1.9:8080/')
    expect(buildViewerUrl({ ip: '10.0.0.5', port: 443, scheme: 'https', path: '/admin' })).toBe('https://10.0.0.5:443/admin')
  })

  it('normalises a path without a leading slash', () => {
    expect(buildViewerUrl({ ip: '192.168.1.9', port: 80, scheme: 'http', path: 'web' })).toBe('http://192.168.1.9:80/web')
  })

  it('refuses a path that tries to smuggle in another host', () => {
    expect(buildViewerUrl({ ip: '192.168.1.9', port: 80, scheme: 'http', path: '//evil.example.com/' })).toBe(
      'http://192.168.1.9:80/',
    )
    expect(buildViewerUrl({ ip: '192.168.1.9', port: 80, scheme: 'http', path: '/\\evil.example.com' })).toBe(
      'http://192.168.1.9:80/',
    )
  })

  it('refuses anything off the LAN', () => {
    expect(buildViewerUrl({ ip: '8.8.8.8', port: 80, scheme: 'http' })).toBeNull()
  })

  it('refuses an invalid port', () => {
    expect(buildViewerUrl({ ip: '192.168.1.9', port: 0, scheme: 'http' })).toBeNull()
    expect(buildViewerUrl({ ip: '192.168.1.9', port: 70000, scheme: 'http' })).toBeNull()
  })
})

describe('isSameLockedOrigin', () => {
  it('accepts only the locked host and port', () => {
    expect(isSameLockedOrigin('http://192.168.1.9:8080/admin', '192.168.1.9', 8080)).toBe(true)
    expect(isSameLockedOrigin('http://192.168.1.9:9090/', '192.168.1.9', 8080)).toBe(false)
    expect(isSameLockedOrigin('http://192.168.1.10:8080/', '192.168.1.9', 8080)).toBe(false)
  })

  it('applies the scheme default port', () => {
    expect(isSameLockedOrigin('http://192.168.1.9/', '192.168.1.9', 80)).toBe(true)
    expect(isSameLockedOrigin('https://192.168.1.9/', '192.168.1.9', 443)).toBe(true)
  })

  it('refuses non-http schemes and junk', () => {
    expect(isSameLockedOrigin('file:///etc/passwd', '192.168.1.9', 80)).toBe(false)
    expect(isSameLockedOrigin('javascript:alert(1)', '192.168.1.9', 80)).toBe(false)
    expect(isSameLockedOrigin('not a url', '192.168.1.9', 80)).toBe(false)
  })
})
