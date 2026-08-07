import { describe, it, expect } from 'vitest'
import { getBuiltinCatalog, getCustomCatalog, getFullCatalog, getCategories, categoryLabel, riskLabel } from './port-catalog'
import type { CustomPortSetting } from '../../../shared/types'

describe('port-catalog', () => {
  it('ships a curated catalog with unique ports', () => {
    const catalog = getBuiltinCatalog()
    const ports = catalog.map((e) => e.port)
    expect(ports.length).toBeGreaterThan(20)
    expect(new Set(ports).size).toBe(ports.length)
  })

  it('covers every shipped category with at least one entry', () => {
    const shipped = getCategories().filter((c) => c !== 'custom')
    for (const c of shipped) {
      expect(getBuiltinCatalog().some((e) => e.category === c)).toBe(true)
    }
  })

  it('marks databases and telnet high risk', () => {
    const byPort = new Map(getBuiltinCatalog().map((e) => [e.port, e]))
    expect(byPort.get(23)?.risk).toBe('high')
    expect(byPort.get(3306)?.risk).toBe('high')
    expect(byPort.get(5432)?.risk).toBe('high')
    expect(byPort.get(6379)?.risk).toBe('high')
    expect(byPort.get(27017)?.risk).toBe('high')
  })

  it('marks discovery, media and dev servers no risk', () => {
    const byPort = new Map(getBuiltinCatalog().map((e) => [e.port, e]))
    expect(byPort.get(5353)?.risk).toBe('none')
    expect(byPort.get(7000)?.risk).toBe('none')
    expect(byPort.get(3000)?.risk).toBe('none')
    expect(byPort.get(443)?.risk).toBe('none')
  })

  it('adds custom ports flagged as custom, skipping builtin and invalid entries', () => {
    const custom: CustomPortSetting[] = [
      { port: 9000, description: 'Portainer' },
      { port: 445, description: 'dupe' },
      { port: 0, description: 'bad' },
      { port: 70000, description: 'bad' },
      { port: 9000, description: 'dup-in-list' },
    ]
    const out = getCustomCatalog(custom)
    expect(out).toHaveLength(1)
    expect(out[0].port).toBe(9000)
    expect(out[0].service).toBe('Portainer')
    expect(out[0].custom).toBe(true)
    expect(out[0].risk).toBe('none')
  })

  it('strips empty descriptions and falls back to a port label', () => {
    const out = getCustomCatalog([{ port: 12345, description: '   ' }])
    expect(out[0].service).toBe('Port 12345')
  })

  it('getFullCatalog merges builtin and custom', () => {
    const custom: CustomPortSetting[] = [{ port: 9001, description: 'Foo' }]
    const full = getFullCatalog(custom)
    expect(full).toHaveLength(getBuiltinCatalog().length + 1)
    expect(full.some((e) => e.port === 9001)).toBe(true)
  })

  it('labels categories and risks', () => {
    expect(categoryLabel('database')).toBe('Databases')
    expect(categoryLabel('custom')).toBe('Custom')
    expect(riskLabel('high')).toBe('High risk')
    expect(riskLabel('none')).toBe('No risk')
  })
})
