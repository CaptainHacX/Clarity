import { describe, it, expect, beforeEach, vi } from 'vitest'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'fs'

const appPath = join('/tmp', 'clarity-security-store-test-' + process.pid)

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: (_name: string) => appPath,
  },
}))

beforeEach(() => {
  rmSync(appPath, { recursive: true, force: true })
  mkdirSync(appPath, { recursive: true })
})

import {
  loadSecuritySettings,
  saveSecuritySettings,
  validateSecuritySettings,
  validateCustomPort,
  loadSecurityResults,
  saveSecurityResults,
  validateSecurityResult,
} from './security-store'

describe('security-store settings', () => {
  it('defaults when no file exists', () => {
    const s = loadSecuritySettings()
    expect(s.autoProbeEnabled).toBe(false)
    expect(s.autoProbeIntervalHours).toBe(6)
    expect(s.customPorts).toEqual([])
    expect(s.inspectAutomatically).toBe(true)
  })

  it('round-trips settings', () => {
    saveSecuritySettings({ autoProbeEnabled: true, autoProbeIntervalHours: 12, customPorts: [{ port: 9000, description: 'Portainer' }], inspectAutomatically: false })
    const loaded = loadSecuritySettings()
    expect(loaded.autoProbeEnabled).toBe(true)
    expect(loaded.autoProbeIntervalHours).toBe(12)
    expect(loaded.customPorts).toEqual([{ port: 9000, description: 'Portainer' }])
    expect(loaded.inspectAutomatically).toBe(false)
  })

  it('clamps interval to 1..168 and drops invalid custom ports', () => {
    const s = validateSecuritySettings({
      autoProbeEnabled: true,
      autoProbeIntervalHours: 999,
      customPorts: [{ port: 0, description: 'x' }, { port: 12345, description: 'ok' }, { port: 12345, description: 'dup' }],
      inspectAutomatically: true,
    })
    expect(s.autoProbeIntervalHours).toBe(168)
    expect(s.customPorts).toEqual([{ port: 12345, description: 'ok' }])
  })

  it('caps custom ports at 200 and trims descriptions', () => {
    const ports = Array.from({ length: 250 }, (_, i) => ({ port: 1000 + i, description: '  desc ' + i + '  ' }))
    const s = validateSecuritySettings({ autoProbeEnabled: false, autoProbeIntervalHours: 6, customPorts: ports, inspectAutomatically: true })
    expect(s.customPorts).toHaveLength(200)
    expect(s.customPorts[0].description).toBe('desc 0')
  })

  it('validateCustomPort rejects non-integers and out-of-range', () => {
    expect(validateCustomPort({ port: 80, description: 'ok' })).toEqual({ port: 80, description: 'ok' })
    expect(validateCustomPort({ port: 1.5, description: 'x' })).toBeNull()
    expect(validateCustomPort({ port: 70000, description: 'x' })).toBeNull()
    expect(validateCustomPort(null)).toBeNull()
  })

  it('recovers from corrupt file', () => {
    writeFileSync(join(appPath, 'security-settings.json'), '{broken', 'utf-8')
    expect(loadSecuritySettings().autoProbeEnabled).toBe(false)
  })
})

describe('security-store results', () => {
  const valid: Parameters<typeof saveSecurityResults>[0] = {
    'aa:bb:cc:dd:ee:ff': {
      deviceId: 'aa:bb:cc:dd:ee:ff',
      ip: '192.168.1.10',
      hostname: 'nas',
      kind: 'iot',
      online: true,
      severity: 'high',
      findings: [{ port: 3306, service: 'MySQL', risk: 'high', title: 't', explanation: 'e', advice: 'a' }],
      catalog: [{ port: 3306, service: 'MySQL', state: 'open', risk: 'high', category: 'database', custom: false }],
      openPorts: [{ port: 3306, service: 'MySQL', state: 'open', risk: true }],
      lastScannedAt: 123,
      fullScan: { state: 'idle', from: 1, to: 1024, checked: 0, open: 0, current: null, startedAt: null, finishedAt: null, error: null },
    },
  }

  it('round-trips results', () => {
    saveSecurityResults(valid)
    const loaded = loadSecurityResults()
    expect(loaded['aa:bb:cc:dd:ee:ff'].severity).toBe('high')
    expect(loaded['aa:bb:cc:dd:ee:ff'].findings).toHaveLength(1)
    expect(loaded['aa:bb:cc:dd:ee:ff'].catalog[0].state).toBe('open')
    expect(loaded['aa:bb:cc:dd:ee:ff'].fullScan.state).toBe('idle')
  })

  it('drops malformed entries on load', () => {
    writeFileSync(join(appPath, 'security-results.json'), JSON.stringify({
      'aa:bb:cc:dd:ee:ff': valid['aa:bb:cc:dd:ee:ff'],
      'bad-ip': { ...valid['aa:bb:cc:dd:ee:ff'], ip: '999.1.1.1' },
      'no-ip': { ...valid['aa:bb:cc:dd:ee:ff'], ip: undefined },
    }), 'utf-8')
    const loaded = loadSecurityResults()
    expect(loaded['aa:bb:cc:dd:ee:ff']).toBeDefined()
    expect(loaded['bad-ip']).toBeUndefined()
    expect(loaded['no-ip']).toBeUndefined()
  })

  it('validateSecurityResult rejects missing deviceId/ip and normalises kinds', () => {
    expect(validateSecurityResult(null)).toBeNull()
    expect(validateSecurityResult({ ...valid['aa:bb:cc:dd:ee:ff'], deviceId: '' })).toBeNull()
    const r = validateSecurityResult({ ...valid['aa:bb:cc:dd:ee:ff'], kind: 'gadget', severity: 'whatever' })
    expect(r?.kind).toBe('gadget')
    expect(r?.severity).toBe('untested')
  })

  it('recovers from a corrupt results file', () => {
    writeFileSync(join(appPath, 'security-results.json'), 'nope', 'utf-8')
    expect(loadSecurityResults()).toEqual({})
  })

  it('writes atomic files (no leftover tmp)', () => {
    saveSecurityResults(valid)
    expect(existsSync(join(appPath, 'security-results.json'))).toBe(true)
    expect(existsSync(join(appPath, 'security-results.json.tmp'))).toBe(false)
    expect(JSON.parse(readFileSync(join(appPath, 'security-results.json'), 'utf-8'))).toBeTruthy()
  })
})
