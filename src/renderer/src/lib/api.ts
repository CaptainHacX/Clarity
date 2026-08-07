import type { ClarityAPI } from '../../../preload/index'

declare global {
  interface Window {
    clarity: ClarityAPI
  }
}

export const api = window.clarity
