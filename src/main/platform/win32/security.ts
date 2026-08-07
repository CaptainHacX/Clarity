import type { PlatformSecurity } from '../types'

export function createWin32Security(): PlatformSecurity {
  return {
    async isServer() { return false },
  }
}
