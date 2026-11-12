// Typed wrappers over window.api
// This file re-exports the window.api as a typed module for easy imports

import type { ElectronAPI } from '../../../preload/index'

declare global {
  interface Window {
    api: ElectronAPI
    platform: NodeJS.Platform
  }
}

export const api = window.api
