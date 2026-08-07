import type { PlatformSecurity } from '../types'

export function createDarwinSecurity(): PlatformSecurity {
  return {
    async isServer() { return false },
  }
}
