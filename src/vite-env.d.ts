/// <reference types="vite/client" />
type DesktopSessions = Record<'portal' | 'sis' | 'moodle', { state: string; detail?: string; checkedAt?: string; revision?: number }>
type DesktopDownloadResult = { count: number; paths: string[]; directory: string }
interface Window {
  myhkuDesktop?: {
    legalStatus?: () => Promise<{ accepted: boolean; version: string }>
    acceptLegal?: (version: string) => Promise<void>
    declineLegal?: () => Promise<void>
    platform?: string
    version?: string
    refreshHku?: () => Promise<number>
    downloadResource?: (url: string) => Promise<number>
    downloadResourceDetailed?: (url: string) => Promise<DesktopDownloadResult>
    openDownloadedFile?: (filePath: string) => Promise<boolean>
    revealDownloadedFile?: (filePath: string) => Promise<boolean>
    authSessions?: () => Promise<DesktopSessions>
    loginSite?: (site: 'portal' | 'sis' | 'moodle') => Promise<DesktopSessions>
    accountStatus?: () => Promise<{ configured: boolean; localUsername?: string; email?: string; authState?: string; detail?: string; sessions?: DesktopSessions }>
    saveAccount?: (value: { localUsername: string; email: string; password: string }) => Promise<{ configured: boolean; localUsername?: string; email?: string }>
    beginLogin?: (show?: boolean) => Promise<unknown>
    clearAccount?: () => Promise<unknown>
    changeScheduleWeek?: (request: number | { offset: number; targetStartIso?: string }) => Promise<unknown>
    onHkuUpdated?: (listener: (payload?: { site?: string; fetchedAt?: string; at?: string }) => void) => () => void
    onAuthStatus?: (listener: (payload?: { state?: string; configured?: boolean; url?: string; detail?: string; requires2fa?: boolean; sessions?: DesktopSessions }) => void) => () => void
  }
  myhkuAndroid?: {
    hasAcceptedLegal?: () => boolean
    getSnapshot?: () => string
    getLatestSnapshot?: () => string
    getSession?: (site: string) => string
    refreshHku?: () => string
    openLogin?: (site: string) => string
    downloadResource?: (url: string) => boolean
    clearAccount?: () => boolean
  }
}
