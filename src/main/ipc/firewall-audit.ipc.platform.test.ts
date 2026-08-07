import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mocks ──

const { mockExecFile, mockCollectLinuxFirewallStatus } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockCollectLinuxFirewallStatus: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}))

vi.mock('child_process', () => {
  const execFile = (...args: unknown[]): unknown => mockExecFile(...args)
  // promisify(execFile) must yield { stdout, stderr } like the real one does.
  ;(execFile as unknown as Record<symbol, unknown>)[
    Symbol.for('nodejs.util.promisify.custom')
  ] = (...args: unknown[]): unknown => mockExecFile(...args)
  return { execFile }
})

vi.mock('../services/linux-firewall', () => ({
  collectLinuxFirewallStatus: (...args: unknown[]) => mockCollectLinuxFirewallStatus(...args),
}))

import { scanFirewallRules, applyFirewallChanges, parseDarwinAppLine } from './firewall-audit.ipc'

const originalPlatform = process.platform

function setPlatform(p: string): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

function resolveExecFile(stdout: string): void {
  mockExecFile.mockResolvedValue({ stdout, stderr: '' })
}

beforeEach(() => {
  mockExecFile.mockReset()
  mockCollectLinuxFirewallStatus.mockReset()
  setPlatform('darwin')
})

afterEach(() => {
  setPlatform(originalPlatform)
})

describe('parseDarwinAppLine', () => {
  it('parses an allow line with explicit mode', () => {
    expect(parseDarwinAppLine('  1234 : /Applications/Google Chrome.app    ( Allow incoming connections )'))
      .toEqual({ id: '1234', path: '/Applications/Google Chrome.app', allow: true })
  })

  it('parses a line without a mode annotation (listed apps default to allow)', () => {
    expect(parseDarwinAppLine('5678 : /System/Library/CoreServices/ARDAgent.app'))
      .toEqual({ id: '5678', path: '/System/Library/CoreServices/ARDAgent.app', allow: true })
  })

  it('keeps parentheses that belong to the path, not the mode', () => {
    expect(parseDarwinAppLine('99 : /Applications/App (Free).app    ( Allow incoming connections )'))
      .toEqual({ id: '99', path: '/Applications/App (Free).app', allow: true })
  })

  it('skips blocked apps', () => {
    expect(parseDarwinAppLine('42 : /Applications/Steam.app    ( Block incoming connections )')).toBeNull()
  })

  it('skips apps with no effective rule', () => {
    expect(parseDarwinAppLine('42 : /Applications/Thing.app    ( No socketfilterfw rules apply )')).toBeNull()
  })

  it('rejects header/blank lines', () => {
    expect(parseDarwinAppLine('')).toBeNull()
    expect(parseDarwinAppLine('    ')).toBeNull()
    expect(parseDarwinAppLine('Socket Filter Firewall Applications')).toBeNull()
  })

  it('rejects relative paths', () => {
    expect(parseDarwinAppLine('1 : MyApp.app')).toBeNull()
  })
})

describe('scanFirewallRules on macOS', () => {
  it('returns empty when the global firewall is disabled', async () => {
    resolveExecFile('Firewall is disabled. (State = 0)')
    const result = await scanFirewallRules()
    expect(result.rules).toEqual([])
    expect(result.totalCount).toBe(0)
  })

  it('builds a rule per allowed app, flagging stale paths as high risk', async () => {
    mockExecFile.mockImplementation((file: string, args: string[]) => {
      if (args.includes('--getglobalstate')) {
        return Promise.resolve({ stdout: 'Firewall is enabled. (State = 2)', stderr: '' })
      }
      if (args.includes('--listapps')) {
        return Promise.resolve({
          stdout: [
            '  1234 : /Applications/ClarityTestApp-DoesNotExist.app    ( Allow incoming connections )',
            '  5678 : /usr/bin/true    ( Allow incoming connections )',
            '  42 : /Applications/Blocked.app    ( Block incoming connections )',
            '  /Applications/NotAnAppLine.app',
          ].join('\n'),
          stderr: '',
        })
      }
      return Promise.reject(new Error('unexpected args'))
    })

    const result = await scanFirewallRules()
    expect(result.totalCount).toBe(2)
    expect(result.rules).toHaveLength(2)

    // Third-party app under a nonexistent path → stale, high.
    const chrome = result.rules[0]
    expect(chrome.name).toBe('/Applications/ClarityTestApp-DoesNotExist.app')
    expect(chrome.displayName).toBe('ClarityTestApp-DoesNotExist.app')
    expect(chrome.risk).toBe('high')
    expect(chrome.issues).toContain('stale')

    // Apple system app → built-in, low.
    const agent = result.rules[1]
    expect(agent.builtin).toBe(true)
    expect(agent.risk).toBe('low')
    expect(agent.issues).toEqual([])
    expect(result.staleCount).toBe(1)
  })

  it('marks Apple system paths as signed', async () => {
    mockExecFile.mockImplementation((file: string, args: string[]) => {
      if (args.includes('--getglobalstate')) {
        return Promise.resolve({ stdout: 'Firewall is enabled. (State = 2)', stderr: '' })
      }
      if (args.includes('--listapps')) {
        return Promise.resolve({ stdout: '  5678 : /usr/libexec/someDaemon', stderr: '' })
      }
      return Promise.reject(new Error('unexpected args'))
    })

    const result = await scanFirewallRules()
    expect(result.rules[0].signature).toBe('signed')
    expect(result.rules[0].builtin).toBe(true)
  })
})

describe('applyFirewallChanges on macOS', () => {
  it('blocks an app by passing its path as an argument', async () => {
    resolveExecFile('')
    const result = await applyFirewallChanges([
      { name: '/Applications/Google Chrome.app', action: 'disable' },
    ])
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
    expect(mockExecFile).toHaveBeenCalledWith(
      '/usr/libexec/ApplicationFirewall/socketfilterfw',
      ['--setappmode', '/Applications/Google Chrome.app', 'block'],
      expect.objectContaining({ timeout: 15_000 })
    )
  })

  it('reports a failure when blocking requires privileges the process lacks', async () => {
    mockExecFile.mockRejectedValue(new Error('Operation not permitted'))
    const result = await applyFirewallChanges([
      { name: '/Applications/SomeApp.app', action: 'disable' },
    ])
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0].reason).toMatch(/administrator privileges/i)
  })

  it('rejects non-absolute rule names without shelling out', async () => {
    const result = await applyFirewallChanges([
      { name: 'not-a-path', action: 'disable' },
    ])
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('does not support removal on macOS', async () => {
    const result = await applyFirewallChanges([
      { name: '/Applications/Google Chrome.app', action: 'delete' },
    ])
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0].reason).toMatch(/not supported on macOS/i)
    expect(mockExecFile).not.toHaveBeenCalled()
  })
})

describe('scanFirewallRules on Linux', () => {
  it('reports a high-risk finding when no firewall is active', async () => {
    setPlatform('linux')
    mockCollectLinuxFirewallStatus.mockResolvedValue({
      tool: 'none',
      active: false,
      allowedPorts: [],
      rawRules: '',
    })
    const result = await scanFirewallRules()
    expect(result.totalCount).toBe(1)
    expect(result.rules[0].name).toBe('firewall-inactive')
    expect(result.rules[0].issues).toContain('broad-scope')
    expect(result.rules[0].risk).toBe('high')
    expect(result.broadScopeCount).toBe(1)
  })

  it('builds a low-risk rule per allowed port when a firewall is active', async () => {
    setPlatform('linux')
    mockCollectLinuxFirewallStatus.mockResolvedValue({
      tool: 'ufw',
      active: true,
      allowedPorts: [22, 80, 443],
      rawRules: 'Status: active',
    })
    const result = await scanFirewallRules()
    expect(result.totalCount).toBe(3)
    expect(result.rules.map((r) => r.localPort)).toEqual(['22', '80', '443'])
    expect(result.rules.every((r) => r.risk === 'low' && r.builtin === true)).toBe(true)
    expect(result.broadScopeCount).toBe(0)
  })

  it('reports a low-risk status rule for an active firewall with no inbound allows', async () => {
    setPlatform('linux')
    mockCollectLinuxFirewallStatus.mockResolvedValue({
      tool: 'nftables',
      active: true,
      allowedPorts: [],
      rawRules: '',
    })
    const result = await scanFirewallRules()
    expect(result.totalCount).toBe(1)
    expect(result.rules[0].name).toBe('firewall-default-deny')
    expect(result.rules[0].risk).toBe('low')
  })
})

describe('applyFirewallChanges on Linux', () => {
  it('deletes a ufw allow rule for a validated port', async () => {
    setPlatform('linux')
    mockCollectLinuxFirewallStatus.mockResolvedValue({
      tool: 'ufw',
      active: true,
      allowedPorts: [22],
      rawRules: '',
    })
    resolveExecFile('Rule deleted')
    const result = await applyFirewallChanges([
      { name: 'port-22', action: 'disable' },
    ])
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
    expect(mockExecFile).toHaveBeenCalledWith(
      '/usr/sbin/ufw',
      ['delete', 'allow', '22'],
      expect.objectContaining({ timeout: 15_000 })
    )
  })

  it('refuses to modify rules when a non-ufw firewall is active', async () => {
    setPlatform('linux')
    mockCollectLinuxFirewallStatus.mockResolvedValue({
      tool: 'nftables',
      active: true,
      allowedPorts: [22],
      rawRules: '',
    })
    const result = await applyFirewallChanges([
      { name: 'port-22', action: 'disable' },
    ])
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0].reason).toMatch(/ufw allow rules/i)
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('rejects rule names that are not port rules', async () => {
    setPlatform('linux')
    mockCollectLinuxFirewallStatus.mockResolvedValue({
      tool: 'ufw',
      active: true,
      allowedPorts: [],
      rawRules: '',
    })
    const result = await applyFirewallChanges([
      { name: 'firewall-inactive', action: 'disable' },
    ])
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('does not support removal on Linux', async () => {
    setPlatform('linux')
    mockCollectLinuxFirewallStatus.mockResolvedValue({
      tool: 'ufw',
      active: true,
      allowedPorts: [22],
      rawRules: '',
    })
    const result = await applyFirewallChanges([
      { name: 'port-22', action: 'delete' },
    ])
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0].reason).toMatch(/not supported on Linux/i)
    expect(mockExecFile).not.toHaveBeenCalled()
  })
})
