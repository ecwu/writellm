import type { DesktopApi } from '../src/preload/desktop-api'

declare global {
  interface Window {
    desktop: DesktopApi
  }
}
