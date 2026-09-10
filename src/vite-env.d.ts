/// <reference types="vite/client" />
interface Window {
  myhkuDesktop?: {
    platform?: string
    version?: string
    refreshHku?: () => Promise<number>
    accountStatus?: () => Promise<{ configured: boolean; localUsername?: string; email?: string; authState?: string; detail?: string }>
    saveAccount?: (value: { localUsername: string; email: string; password: string }) => Promise<{ configured: boolean; localUsername?: string; email?: string }>
    beginLogin?: (show?: boolean) => Promise<unknown>
    clearAccount?: () => Promise<unknown>
    changeScheduleWeek?: (offset: number) => Promise<unknown>
    onHkuUpdated?: (listener: (payload?: { site?: string; fetchedAt?: string }) => void) => () => void
    onAuthStatus?: (listener: (payload?: { state?: string; url?: string; detail?: string; requires2fa?: boolean }) => void) => () => void
  }
  myhkuAndroid?: {
    getSnapshot?: () => string
    getSession?: (site: string) => string
    refreshHku?: () => string
  }
}
