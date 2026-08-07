/**
 * The in-app web viewer for a device's own admin page.
 *
 * The convenience of "just open the printer's page" without pointing your
 * everyday browser at an untrusted LAN device. The window is **locked to one
 * origin**: navigation, sub-resources and window.open are all refused if they
 * leave that host:port, and the session is in-memory, so nothing — history,
 * cookies, cache — outlives the window.
 */
import { BrowserWindow, session } from 'electron'
import { isPrivateIpv4 } from '../../../shared/devices'

export interface WebViewerRequest {
  ip: string
  port: number
  scheme: 'http' | 'https'
  path?: string
}

const openViewers = new Map<string, BrowserWindow>()
let partitionSeq = 0

export function buildViewerUrl(req: WebViewerRequest): string | null {
  if (!isPrivateIpv4(req.ip)) return null
  if (!Number.isInteger(req.port) || req.port < 1 || req.port > 65535) return null
  if (req.scheme !== 'http' && req.scheme !== 'https') return null
  let path = req.path ?? '/'
  if (!path.startsWith('/')) path = `/${path}`
  // Only a path is accepted — a caller can't smuggle a different host in.
  if (path.includes('//') || path.includes('\\')) path = '/'
  return `${req.scheme}://${req.ip}:${req.port}${path}`
}

/** True when `url` addresses exactly the locked host and port. */
export function isSameLockedOrigin(url: string, ip: string, port: number): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    const parsedPort = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80
    return parsed.hostname === ip && parsedPort === port
  } catch {
    return false
  }
}

/**
 * Open (or focus) a viewer locked to one device. Returns the URL that was
 * loaded, or null when the request was refused.
 */
export function openWebViewer(req: WebViewerRequest, parent: BrowserWindow | null): string | null {
  const url = buildViewerUrl(req)
  if (!url) return null

  const key = `${req.scheme}://${req.ip}:${req.port}`
  const existing = openViewers.get(key)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    void existing.loadURL(url)
    return url
  }

  // No `persist:` prefix — Electron gives an in-memory session that is discarded
  // with the window.
  const partition = `clarity-web-viewer-${partitionSeq++}`
  const viewerSession = session.fromPartition(partition)

  // Belt and braces: even a page that finds a way to issue a cross-host request
  // (an <img>, an XHR, a redirect) is cancelled at the network layer.
  viewerSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isSameLockedOrigin(details.url, req.ip, req.port) })
  })
  // The device is on the LAN and its certificate is self-signed by
  // construction; nothing confidential is typed into this window by Clarity.
  viewerSession.setCertificateVerifyProc((request, callback) => {
    callback(request.hostname === req.ip ? 0 : -2)
  })

  const win = new BrowserWindow({
    width: 1000,
    height: 760,
    parent: parent ?? undefined,
    title: `${req.ip}:${req.port}`,
    backgroundColor: '#09090b',
    autoHideMenuBar: true,
    webPreferences: {
      partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  })

  win.webContents.on('will-navigate', (event, target) => {
    if (!isSameLockedOrigin(target, req.ip, req.port)) event.preventDefault()
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())
  win.on('closed', () => {
    openViewers.delete(key)
    void viewerSession.clearStorageData().catch(() => undefined)
  })

  openViewers.set(key, win)
  void win.loadURL(url)
  return url
}
