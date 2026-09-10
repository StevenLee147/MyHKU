/// <reference types="vite/client" />
type DesktopSessions = Record<'portal' | 'sis' | 'moodle', { state: string; detail?: string; checkedAt?: string }>
interface Window {
  myhkuDesktop?: {
    platform?: string
    version?: string
    refreshHku?: () => Promise<number>
    authSessions?: () => Promise<DesktopSessions>
    loginSite?: (site: 'portal' | 'sis' | 'moodle') => Promise<DesktopSessions>
    accountStatus?: () => Promise<{ configured: boolean; localUsername?: string; email?: string; authState?: string; detail?: string; sessions?: DesktopSessions }>
    saveAccount?: (value: { localUsername: string; email: string; password: string }) => Promise<{ configured: boolean; localUsername?: string; email?: string }>
    beginLogin?: (show?: boolean) => Promise<unknown>
    clearAccount?: () => Promise<unknown>
    changeScheduleWeek?: (offset: number) => Promise<unknown>
    onHkuUpdated?: (listener: (payload?: { site?: string; fetchedAt?: string }) => void) => () => void
    onAuthStatus?: (listener: (payload?: { state?: string; url?: string; detail?: string; requires2fa?: boolean; sessions?: DesktopSessions }) => void) => () => void
  }
  myhkuAndroid?: {
    getSnapshot?: () => string
    getSession?: (site: string) => string
    refreshHku?: () => string
  }
}
