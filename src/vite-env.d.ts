/// <reference types="vite/client" />
interface Window {
  myhkuDesktop?: {
    platform?: string
    version?: string
    refreshHku?: () => Promise<number>
  }
  myhkuAndroid?: {
    getSnapshot?: () => string
    getSession?: (site: string) => string
    refreshHku?: () => string
  }
}
