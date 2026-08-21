import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getVersion: () => '1.1.0', getPath: () => '/tmp/clarity-metrics-args-test', exit: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  dialog: {},
  shell: {},
  net: {},
  BrowserWindow: class {},
  Menu: { setApplicationMenu: vi.fn() },
  Notification: class {},
  nativeTheme: { on: vi.fn() },
  nativeImage: { createEmpty: () => ({}) },
  screen: {},
  session: {},
  Tray: class {},
  crashReporter: { start: vi.fn() },
}))

import { parseMetricsServerArgs } from './cli'

describe('parseMetricsServerArgs', () => {
  it('binds loopback when no host is given', () => {
    // The security-relevant default: an exporter started with no arguments must
    // not be readable by the rest of the network.
    expect(parseMetricsServerArgs([])).toEqual({ host: '127.0.0.1', port: 9100 })
  })

  it('honours an explicit host, so cross-host scraping stays possible', () => {
    expect(parseMetricsServerArgs(['--host', '0.0.0.0'])).toEqual({
      host: '0.0.0.0',
      port: 9100,
    })
  })

  it('honours an explicit port', () => {
    expect(parseMetricsServerArgs(['--port', '9200']).port).toBe(9200)
  })

  it('takes host and port together, in either order', () => {
    expect(parseMetricsServerArgs(['--port', '9300', '--host', '10.0.0.5'])).toEqual({
      host: '10.0.0.5',
      port: 9300,
    })
    expect(parseMetricsServerArgs(['--host', '10.0.0.5', '--port', '9300'])).toEqual({
      host: '10.0.0.5',
      port: 9300,
    })
  })

  it('falls back to loopback when --host is passed with no value', () => {
    // `--host` last, or immediately followed by another flag, must not be read as
    // an empty host — Node treats an empty host as "all interfaces", which is the
    // exact outcome this default exists to prevent.
    expect(parseMetricsServerArgs(['--host']).host).toBe('127.0.0.1')
    expect(parseMetricsServerArgs(['--host', '--port', '9200']).host).toBe('127.0.0.1')
    expect(parseMetricsServerArgs(['--host', '   ']).host).toBe('127.0.0.1')
  })

  it('rejects unusable ports rather than listening somewhere unintended', () => {
    for (const bad of ['0', '-1', '70000', 'abc', '']) {
      expect(parseMetricsServerArgs(['--port', bad]).port).toBe(9100)
    }
    expect(parseMetricsServerArgs(['--port']).port).toBe(9100)
  })

  it('ignores unrelated arguments', () => {
    expect(parseMetricsServerArgs(['--json', '-q', '--all'])).toEqual({
      host: '127.0.0.1',
      port: 9100,
    })
  })
})
