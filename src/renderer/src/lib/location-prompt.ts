/**
 * Ask Chromium for a position. On macOS Electron routes this through
 * CoreLocation, which is what raises the system Location prompt for the app —
 * and that prompt is the only way to make CoreWLAN hand over BSSIDs. The
 * coordinates themselves are discarded immediately; we never read them.
 */
export function triggerLocationPrompt(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(false)
      return
    }
    let settled = false
    const finish = (ok: boolean): void => {
      if (settled) return
      settled = true
      resolve(ok)
    }
    // If the user leaves the dialog open — or the running build can't raise one
    // at all — don't hang the button forever; fall through to Settings instead.
    setTimeout(() => finish(false), 14_000)
    navigator.geolocation.getCurrentPosition(
      () => finish(true),
      () => finish(false),
      { timeout: 10_000, maximumAge: 0, enableHighAccuracy: false },
    )
  })
}
