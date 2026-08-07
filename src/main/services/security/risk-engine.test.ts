import { describe, it, expect } from 'vitest'
import { buildFindings, computeSeverity, summarizeFindings } from './risk-engine'
import { getBuiltinCatalog } from './port-catalog'

function entry(port: number) {
  return getBuiltinCatalog().find((e) => e.port === port)!
}

describe('risk-engine', () => {
  it('generates a finding for every high/medium open catalog port', () => {
    const findings = buildFindings([
      entry(23),
      entry(3306),
      entry(22),
      entry(5353),
    ])
    expect(findings).toHaveLength(3)
    expect(findings.map((f) => f.port)).toEqual([23, 3306, 22])
  })

  it('skips no-risk open ports (discovery/media/dev)', () => {
    const findings = buildFindings([entry(5353), entry(7000), entry(3000), entry(443)])
    expect(findings).toHaveLength(0)
  })

  it('each finding has plain-English title, explanation and advice', () => {
    for (const f of buildFindings([entry(23), entry(445), entry(1883), entry(5432), entry(5900), entry(21)])) {
      expect(f.title.length).toBeGreaterThan(10)
      expect(f.explanation.length).toBeGreaterThan(20)
      expect(f.advice.length).toBeGreaterThan(10)
      expect(f.explanation).toContain('open')
    }
  })

  it('severity is high when any high-risk port is open', () => {
    expect(computeSeverity(buildFindings([entry(3306)]), true)).toBe('high')
    expect(computeSeverity(buildFindings([entry(22), entry(3306)]), true)).toBe('high')
  })

  it('severity drops to medium when only medium-risk ports are open', () => {
    expect(computeSeverity(buildFindings([entry(22)]), true)).toBe('medium')
  })

  it('severity is low for a clean probe and untested when never probed', () => {
    expect(computeSeverity(buildFindings([entry(5353)]), true)).toBe('low')
    expect(computeSeverity([], true)).toBe('low')
    expect(computeSeverity([], false)).toBe('untested')
  })

  it('summarizeFindings covers empty and long lists', () => {
    expect(summarizeFindings([])).toBe('No risky open ports found.')
    const many = [entry(23), entry(22), entry(445), entry(3306), entry(6379)]
    expect(summarizeFindings(buildFindings(many))).toContain('(+')
  })
})
