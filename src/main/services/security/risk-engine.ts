import type { PortFinding, PortRiskTier, PortCatalogEntry, SecuritySeverity } from '../../../shared/types'

function capitalize(s: string): string {
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

function findingFor(entry: PortCatalogEntry): PortFinding | null {
  const { service, port, category, risk } = entry
  if (risk === 'none') return null
  const verb = 'Port ' + port + ' (' + service + ') is open'

  switch (category) {
    case 'remote-access': {
      if (service === 'Telnet') {
        return {
          port,
          service,
          risk,
          title: 'Telnet is exposed — it sends passwords in clear text',
          explanation:
            verb + '. Telnet has no encryption: the username and password travel over the network readable by anyone listening.',
          advice: 'Switch to SSH (port 22). If Telnet must stay on, restrict it to a trusted management device.',
        }
      }
      if (service === 'RDP') {
        return {
          port,
          service,
          risk,
          title: 'Remote Desktop is reachable from your network',
          explanation:
            verb + '. A reachable RDP service is a common target for brute-force sign-in attacks, especially without network-level authentication.',
          advice: 'Turn on network-level authentication, use a strong password, and block RDP from the internet at the router.',
        }
      }
      if (service === 'VNC') {
        return {
          port,
          service,
          risk,
          title: 'VNC remote control is reachable',
          explanation:
            verb + '. VNC often uses weak passwords and has no built-in protection against guessing attempts.',
          advice: 'Require a long VNC password, tunnel VNC through SSH, or switch to a tool with modern encryption.',
        }
      }
      return {
        port,
        service,
        risk,
        title: service + ' remote access is exposed',
        explanation: verb + ', so someone on your network can reach a remote-control service.',
        advice: 'Restrict access to devices and accounts you trust, and make sure the service is patched.',
      }
    }
    case 'file-sharing': {
      if (service === 'FTP') {
        return {
          port,
          service,
          risk,
          title: 'FTP is exposed — logins are sent unencrypted',
          explanation:
            verb + '. FTP sends usernames and passwords in plain text, and allows unauthenticated anonymous access if enabled.',
          advice: 'Move to SFTP or FTPS. If FTP must stay, disable anonymous access and change the account password.',
        }
      }
      if (service === 'NFS') {
        return {
          port,
          service,
          risk,
          title: 'NFS shares are reachable',
          explanation:
            verb + '. NFS exports are usually trusted only inside a private network; an open export can expose whole filesystems.',
          advice: 'Confirm every export in /etc/exports is restricted to the exact hosts that need it.',
        }
      }
      return {
        port,
        service,
        risk,
        title: service + ' file sharing is exposed',
        explanation: verb + ', so other devices on the network may be able to read files this device shares.',
        advice: 'Check who can access the shares and turn off any share that is not in active use.',
      }
    }
    case 'web-iot': {
      if (service === 'MQTT') {
        return {
          port,
          service,
          risk,
          title: 'MQTT broker is exposed to the network',
          explanation:
            verb + '. An unprotected broker lets anyone on the network publish and read messages — including device control commands.',
          advice: 'Enable broker authentication, use TLS, and restrict the broker to devices that need it.',
        }
      }
      return {
        port,
        service,
        risk,
        title: service + ' admin or control interface is exposed',
        explanation:
          verb + '. This is often a device or app control page that can change settings if it reaches a web interface.',
        advice: 'Check whether this page needs a password, and change any default credentials on the device.',
      }
    }
    case 'database': {
      return {
        port,
        service,
        risk,
        title: service + ' database is reachable from your network',
        explanation:
          verb + '. Databases exposed to the LAN are a top target: many are left with no password or default credentials.',
        advice:
          'Make sure the database has a strong password, bind it to localhost or trusted hosts, and never forward the port to the internet.',
      }
    }
    default:
      return null
  }
}

export function buildFindings(openEntries: PortCatalogEntry[]): PortFinding[] {
  const out: PortFinding[] = []
  for (const entry of openEntries) {
    const finding = findingFor(entry)
    if (finding) out.push(finding)
  }
  return out
}

export function computeSeverity(findings: PortFinding[], probed: boolean): SecuritySeverity {
  if (!probed) return 'untested'
  if (findings.some((f) => f.risk === 'high')) return 'high'
  if (findings.some((f) => f.risk === 'medium')) return 'medium'
  return 'low'
}

export function summarizeFindings(findings: PortFinding[]): string {
  if (findings.length === 0) return 'No risky open ports found.'
  const parts = findings.slice(0, 3).map((f) => f.title)
  const rest = findings.length - 3
  const tail = rest > 0 ? ' (+' + rest + ' more)' : ''
  return capitalize(parts.join(' — ')) + tail
}

export type { PortRiskTier }
