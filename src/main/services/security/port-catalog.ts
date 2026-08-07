import type { PortCatalogEntry, PortCategory, PortRiskTier, CustomPortSetting } from '../../../shared/types'

const CATALOG: PortCatalogEntry[] = [
  // Remote access
  { port: 22, service: 'SSH', category: 'remote-access', risk: 'medium' },
  { port: 23, service: 'Telnet', category: 'remote-access', risk: 'high' },
  { port: 3389, service: 'RDP', category: 'remote-access', risk: 'medium' },
  { port: 5900, service: 'VNC', category: 'remote-access', risk: 'medium' },
  // File sharing
  { port: 21, service: 'FTP', category: 'file-sharing', risk: 'medium' },
  { port: 445, service: 'SMB', category: 'file-sharing', risk: 'medium' },
  { port: 548, service: 'AFP', category: 'file-sharing', risk: 'medium' },
  { port: 2049, service: 'NFS', category: 'file-sharing', risk: 'medium' },
  // Web & IoT control
  { port: 80, service: 'HTTP', category: 'web-iot', risk: 'medium' },
  { port: 443, service: 'HTTPS', category: 'web-iot', risk: 'none' },
  { port: 1883, service: 'MQTT', category: 'web-iot', risk: 'medium' },
  { port: 8123, service: 'Home Assistant', category: 'web-iot', risk: 'medium' },
  // Discovery
  { port: 137, service: 'NetBIOS', category: 'discovery', risk: 'none' },
  { port: 138, service: 'NetBIOS', category: 'discovery', risk: 'none' },
  { port: 139, service: 'NetBIOS-SSN', category: 'discovery', risk: 'none' },
  { port: 5353, service: 'mDNS', category: 'discovery', risk: 'none' },
  { port: 1900, service: 'SSDP', category: 'discovery', risk: 'none' },
  // Streaming & media
  { port: 7000, service: 'AirPlay', category: 'media', risk: 'none' },
  { port: 32400, service: 'Plex', category: 'media', risk: 'none' },
  { port: 51413, service: 'Transmission', category: 'media', risk: 'none' },
  // Developer servers
  { port: 3000, service: 'Node.js', category: 'dev', risk: 'none' },
  { port: 5173, service: 'Vite', category: 'dev', risk: 'none' },
  { port: 4200, service: 'Angular', category: 'dev', risk: 'none' },
  { port: 8000, service: 'Django', category: 'dev', risk: 'none' },
  { port: 8888, service: 'Jupyter', category: 'dev', risk: 'none' },
  // Databases
  { port: 3306, service: 'MySQL', category: 'database', risk: 'high' },
  { port: 5432, service: 'PostgreSQL', category: 'database', risk: 'high' },
  { port: 6379, service: 'Redis', category: 'database', risk: 'high' },
  { port: 27017, service: 'MongoDB', category: 'database', risk: 'high' },
]

export function getBuiltinCatalog(): PortCatalogEntry[] {
  return CATALOG.map((e) => ({ ...e }))
}

export function getCustomCatalog(custom: CustomPortSetting[]): PortCatalogEntry[] {
  const seen = new Set(CATALOG.map((e) => e.port))
  const out: PortCatalogEntry[] = []
  for (const c of custom) {
    if (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535) continue
    if (seen.has(c.port)) continue
    if (out.some((e) => e.port === c.port)) continue
    seen.add(c.port)
    out.push({
      port: c.port,
      service: (c.description || '').trim() || `Port ${c.port}`,
      category: 'custom',
      risk: 'none',
      custom: true,
    })
  }
  return out
}

export function getFullCatalog(custom: CustomPortSetting[]): PortCatalogEntry[] {
  return [...getBuiltinCatalog(), ...getCustomCatalog(custom)]
}

export function getCategories(): PortCategory[] {
  return ['remote-access', 'file-sharing', 'web-iot', 'discovery', 'media', 'dev', 'database', 'custom']
}

export function categoryLabel(category: PortCategory): string {
  switch (category) {
    case 'remote-access':
      return 'Remote access'
    case 'file-sharing':
      return 'File sharing'
    case 'web-iot':
      return 'Web & IoT control'
    case 'discovery':
      return 'Discovery'
    case 'media':
      return 'Streaming & media'
    case 'dev':
      return 'Developer servers'
    case 'database':
      return 'Databases'
    case 'custom':
      return 'Custom'
  }
}

export function riskLabel(risk: PortRiskTier): string {
  switch (risk) {
    case 'high':
      return 'High risk'
    case 'medium':
      return 'Medium risk'
    case 'none':
      return 'No risk'
  }
}
