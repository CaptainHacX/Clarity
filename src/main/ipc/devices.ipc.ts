import { ipcMain } from 'electron'
import { IPC } from '../../shared/channels'
import { scanDevices, probeDevice, measureLinkQuality } from '../services/device-scanner'
import { loadDeviceHistory, clearDeviceHistory } from '../services/device-history-store'
import { setDeviceTag, clearDeviceTag } from '../services/device-tags-store'
import { saveDeviceProbeResults } from '../services/device-probes-store'
import { inspectService } from '../services/devices/service-inspector'
import { openWebViewer } from '../services/devices/web-viewer'
import { isIpv4 } from '../../shared/devices'
import {
  validateDeviceTagInput,
  validateLinkQualityRequest,
  validateProbeDeviceRequest,
} from '../services/ipc-validation'

export function registerDevicesIpc(getWindow: () => Electron.BrowserWindow | null = () => null): void {
  ipcMain.handle(IPC.DEVICES_SCAN, () => scanDevices())

  ipcMain.handle(IPC.DEVICES_OPEN_WEB_VIEWER, (_event, request: unknown) => {
    if (request === null || typeof request !== 'object' || Array.isArray(request)) return null
    const obj = request as Record<string, unknown>
    const ip = typeof obj.ip === 'string' ? obj.ip : ''
    const scheme = obj.scheme === 'https' ? 'https' : 'http'
    if (!isIpv4(ip)) return null
    if (typeof obj.port !== 'number' || !Number.isInteger(obj.port) || obj.port < 1 || obj.port > 65535) return null
    const path = typeof obj.path === 'string' && obj.path.length <= 200 ? obj.path : '/'
    return openWebViewer({ ip, port: obj.port, scheme, path }, getWindow())
  })

  // Read-only look inside one open port. The renderer only calls this when the
  // user has opted in (Settings → live inspection) or pressed Inspect.
  ipcMain.handle(IPC.DEVICES_INSPECT_SERVICE, (_event, request: unknown) => {
    if (request === null || typeof request !== 'object' || Array.isArray(request)) return null
    const obj = request as Record<string, unknown>
    const ip = typeof obj.ip === 'string' ? obj.ip : null
    if (!isIpv4(ip)) return null
    if (typeof obj.port !== 'number' || !Number.isInteger(obj.port) || obj.port < 1 || obj.port > 65535) return null
    return inspectService(ip, obj.port)
  })

  ipcMain.handle(IPC.DEVICES_LINK_QUALITY, async (_event, request: unknown) => {
    const validated = validateLinkQualityRequest(request)
    if (!validated) return null
    return measureLinkQuality(validated.ip, validated.burst)
  })

  ipcMain.handle(IPC.DEVICES_PROBE_DEVICE, async (_event, ip: unknown) => {
    const validated = validateProbeDeviceRequest(ip)
    if (!validated) return null
    return probeDevice(validated)
  })

  ipcMain.handle(IPC.DEVICES_TAG_SET, (_event, input: unknown) => {
    const validated = validateDeviceTagInput(input)
    if (!validated) return null
    return setDeviceTag(validated.deviceId, {
      name: validated.name,
      kind: validated.kind,
      muted: validated.muted,
    })
  })

  ipcMain.handle(IPC.DEVICES_TAG_CLEAR, (_event, deviceId: unknown) => {
    if (typeof deviceId !== 'string' || deviceId.length === 0 || deviceId.length > 64) return false
    return clearDeviceTag(deviceId)
  })

  ipcMain.handle(IPC.DEVICES_HISTORY_GET, () => loadDeviceHistory())
  ipcMain.handle(IPC.DEVICES_HISTORY_CLEAR, () => clearDeviceHistory())

  // Written by the Security tool after a probe so the Devices list can show
  // what each device had open.
  ipcMain.handle(IPC.DEVICES_PORT_RESULTS_SET, (_event, input: unknown) => {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) return false
    const obj = input as Record<string, unknown>
    if (typeof obj.deviceId !== 'string' || obj.deviceId.length === 0 || obj.deviceId.length > 64) return false
    if (!Array.isArray(obj.ports) || obj.ports.length > 1000) return false
    saveDeviceProbeResults(obj.deviceId, obj.ports)
    return true
  })
}
