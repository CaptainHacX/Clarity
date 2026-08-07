import { execFile } from 'child_process'
import { promisify } from 'util'
import { stat } from 'fs/promises'

const execFileAsync = promisify(execFile)

/**
 * Linux firewall detection.
 *
 * Shared between the system health report and the Firewall Audit UI so both
 * surfaces read the same tool, the same active state, and the same allowed-port
 * set. Front-end first (ufw, firewalld), then raw rulesets (nftables, iptables),
 * then "none".
 */

export interface LinuxFirewallStatus {
  tool: 'ufw' | 'nftables' | 'iptables' | 'firewalld' | 'none'
  active: boolean
  allowedPorts: number[]
  rawRules: string
}

/** Check multiple candidate paths and return the first that exists, or null. */
export async function findBinary(candidates: string[]): Promise<string | null> {
  for (const p of candidates) {
    try {
      await stat(p)
      return p
    } catch { /* not at this path */ }
  }
  return null
}

/** Parse unique port numbers from matches. */
function uniquePorts(ports: number[]): number[] {
  return [...new Set(ports)].sort((a, b) => a - b)
}

export async function collectLinuxFirewallStatus(): Promise<LinuxFirewallStatus> {
  const CMD_TIMEOUT = 5_000
  const RAW_RULES_MAX = 3_000

  // ── 1. ufw (front-end) ──────────────────────────────
  // Only return when ufw is actively enforcing. An inactive ufw can mask
  // a backend firewall (nftables/iptables from Docker, k8s, cloud-init).
  const ufwPath = await findBinary(['/usr/sbin/ufw', '/usr/bin/ufw'])
  if (ufwPath) {
    try {
      const { stdout } = await execFileAsync(ufwPath, ['status', 'verbose'], { timeout: CMD_TIMEOUT })
      if (/^Status:\s*active/m.test(stdout)) {
        const rawRules = stdout.slice(0, RAW_RULES_MAX)
        const allowedPorts: number[] = []
        for (const m of stdout.matchAll(/^\s*(\d+)(?:\/\w+)?\s+ALLOW/gm)) {
          allowedPorts.push(parseInt(m[1], 10))
        }
        return { tool: 'ufw', active: true, allowedPorts: uniquePorts(allowedPorts), rawRules }
      }
    } catch { /* ufw failed — fall through */ }
  }

  // ── 2. firewalld (front-end) ──────────────────────────
  // Same fall-through logic: only return when firewalld is running.
  const fwCmdPath = await findBinary(['/usr/bin/firewall-cmd', '/usr/sbin/firewall-cmd'])
  if (fwCmdPath) {
    let active = false
    try {
      const { stdout } = await execFileAsync('systemctl', ['is-active', 'firewalld'], { timeout: CMD_TIMEOUT })
      active = stdout.trim() === 'active'
    } catch { /* not active */ }

    if (active) {
      let rawRules = ''
      const allowedPorts: number[] = []
      try {
        // Query all zones so interfaces/sources bound to non-default zones
        // are included.  Falls back to --list-all if --list-all-zones fails.
        let stdout: string
        try {
          ({ stdout } = await execFileAsync(fwCmdPath, ['--list-all-zones'], { timeout: CMD_TIMEOUT }))
        } catch {
          ({ stdout } = await execFileAsync(fwCmdPath, ['--list-all'], { timeout: CMD_TIMEOUT }))
        }
        rawRules = stdout.slice(0, RAW_RULES_MAX)

        // Parse "ports:" line — e.g. "ports: 8080/tcp 9090/udp"
        const portsLine = stdout.match(/^\s*ports:\s*(.+)/m)
        if (portsLine) {
          for (const m of portsLine[1].matchAll(/(\d+)\/\w+/g)) {
            allowedPorts.push(parseInt(m[1], 10))
          }
        }

        // Parse "services:" line — map common service names to ports
        const serviceMap: Record<string, number> = {
          ssh: 22, http: 80, https: 443, ftp: 21, smtp: 25, dns: 53,
          'imap': 143, 'imaps': 993, 'pop3': 110, 'pop3s': 995,
          'ntp': 123, 'mysql': 3306, 'postgresql': 5432, 'redis': 6379,
        }
        const servicesLine = stdout.match(/^\s*services:\s*(.+)/m)
        if (servicesLine) {
          for (const svc of servicesLine[1].trim().split(/\s+/)) {
            const port = serviceMap[svc]
            if (port) allowedPorts.push(port)
          }
        }
      } catch { /* couldn't list rules */ }

      return { tool: 'firewalld', active: true, allowedPorts: uniquePorts(allowedPorts), rawRules }
    }
  }

  // ── 3. nftables ───────────────────────────────────────
  // Detect from ruleset content, not systemd — rules may be loaded by
  // boot scripts or cloud-init while nftables.service is inactive.
  // Only consider the firewall active if there is a chain hooked into the
  // input path (type filter hook input); nat-only or dormant tables don't
  // count.  Parse allowed ports only from those input chains.
  const nftPath = await findBinary(['/usr/sbin/nft', '/usr/bin/nft'])
  if (nftPath) {
    let active = false
    let rawRules = ''
    const allowedPorts: number[] = []

    try {
      const { stdout } = await execFileAsync(nftPath, ['list', 'ruleset'], { timeout: CMD_TIMEOUT })
      rawRules = stdout.slice(0, RAW_RULES_MAX)

      // Split ruleset into per-chain blocks so we can scope parsing
      // to input-facing filter chains only.
      const chainBlocks: string[] = []
      let current = ''
      for (const line of stdout.split('\n')) {
        if (/\bchain\s+\w+\s*\{/.test(line)) {
          if (current) chainBlocks.push(current)
          current = ''
        }
        current += line + '\n'
      }
      if (current) chainBlocks.push(current)

      for (const block of chainBlocks) {
        if (!/type\s+filter\s+hook\s+input\b/.test(block)) continue
        // A filter chain hooked into input means nftables is actively filtering
        active = true

        for (const line of block.split('\n')) {
          if (!/\baccept\b/i.test(line)) continue
          // Set syntax: "tcp dport { 22, 80, 443 }" / "udp dport { 53, 123 }"
          for (const m of line.matchAll(/(?:tcp|udp)\s+dport\s*\{([^}]+)\}/g)) {
            for (const p of m[1].matchAll(/(\d+)/g)) {
              allowedPorts.push(parseInt(p[1], 10))
            }
          }
          // Single-port syntax: "tcp dport 22" / "udp dport 51820"
          for (const m of line.matchAll(/(?:tcp|udp)\s+dport\s+(\d+)/g)) {
            allowedPorts.push(parseInt(m[1], 10))
          }
        }
      }
    } catch { /* nft not usable — skip */ }

    // Only return from the nftables branch if it is actually filtering
    // input.  Otherwise fall through to iptables — some hosts ship nft
    // by default but enforce ingress rules via iptables-legacy.
    if (active) {
      return { tool: 'nftables', active, allowedPorts: uniquePorts(allowedPorts), rawRules }
    }
  }

  // ── 4. iptables ───────────────────────────────────────
  const iptablesPath = await findBinary(['/usr/sbin/iptables', '/sbin/iptables'])
  if (iptablesPath) {
    let active = false
    let rawRules = ''
    const allowedPorts: number[] = []

    try {
      const { stdout } = await execFileAsync(iptablesPath, ['-L', 'INPUT', '-n', '--line-numbers'], { timeout: CMD_TIMEOUT })
      rawRules = stdout.slice(0, RAW_RULES_MAX)

      // A non-ACCEPT default policy means the firewall is filtering even without explicit rules
      const policyMatch = stdout.match(/^Chain INPUT \(policy (\w+)\)/m)
      const hasNonAcceptPolicy = policyMatch != null && policyMatch[1] !== 'ACCEPT'

      const ruleLines = stdout.split('\n').filter(l => {
        const trimmed = l.trim()
        return trimmed && !trimmed.startsWith('Chain ') && !trimmed.startsWith('num ')
          && !trimmed.startsWith('target ')
      })
      active = hasNonAcceptPolicy || ruleLines.length > 0

      if (active) {
        // Parse ACCEPT rules:
        //   single port  — "dpt:22"
        //   port range   — "dpts:80:443"
        //   multiport    — "multiport dports 80,443,8080"
        for (const line of ruleLines) {
          if (!/\bACCEPT\b/.test(line)) continue
          // Multiport comma list: "multiport dports 80,443,8080"
          const mpMatch = line.match(/multiport\s+dports\s+([\d,]+)/)
          if (mpMatch) {
            for (const p of mpMatch[1].split(',')) {
              const n = parseInt(p, 10)
              if (!isNaN(n)) allowedPorts.push(n)
            }
          }
          // Single port: dpt:22
          for (const m of line.matchAll(/dpt:(\d+)/g)) {
            allowedPorts.push(parseInt(m[1], 10))
          }
          // Port range: dpts:80:443
          for (const m of line.matchAll(/dpts:(\d+):(\d+)/g)) {
            const lo = parseInt(m[1], 10)
            const hi = parseInt(m[2], 10)
            for (let p = lo; p <= hi && p - lo < 100; p++) {
              allowedPorts.push(p)
            }
          }
        }
      }
    } catch { /* iptables failed — treat as not found */ }

    return { tool: 'iptables', active, allowedPorts: uniquePorts(allowedPorts), rawRules }
  }

  // ── 5. none ────────────────────────────────────────────
  return { tool: 'none', active: false, allowedPorts: [], rawRules: '' }
}
