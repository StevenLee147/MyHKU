/**
 * HKU connection primitives used by the dashboard.
 *
 * The browser UI never receives a password or a Cookie. The dashboard reads
 * normalized fields from the local bridge (configured with
 * VITE_HKU_BRIDGE_URL). Opening a school's page remains the official way to
 * complete SSO/MFA, so this module deliberately does not try to automate it.
 */

import { clearNotificationState, evaluateSnapshotNotifications, type NavTarget } from './notifications'

export type HkuSite = 'portal' | 'sis' | 'moodle'
export type ConnectionState = 'disconnected' | 'checking' | 'login_pending' | 'connected' | 'error'
export type DataMode = 'demo' | 'live'
export type ThemeMode = 'system' | 'light' | 'dark'

export type SiteConnection = {
  state: ConnectionState
  nativeState?: string
  checkedAt?: string
  detail?: string
}

export const HKU_SITES: Record<HkuSite, { label: string; description: string; url: string }> = {
  portal: {
    label: 'Student Portal',
    description: '官方登录入口与校园服务',
    url: 'https://studentportal.hku.hk/',
  },
  sis: {
    label: 'SIS',
    description: '从已登录的 SIS 获取课表',
    url: 'https://sweb.hku.hk/student/servlet/MyWeekly/showTimetable',
  },
  moodle: {
    label: 'HKU Moodle',
    description: '课程、资料、待办和成绩',
    url: 'https://moodle.hku.hk/login/index.php?authCAS=CAS',
  },
}

/** Only allow downloads that stay on HTTPS HKU hosts. */
export function safeHkuUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && (url.hostname === 'hku.hk' || url.hostname.endsWith('.hku.hk')) ? url.toString() : undefined
  } catch {
    return undefined
  }
}

const STATE_KEY = 'myhku-connection-state'
const MODE_KEY = 'myhku-data-mode'
const MODE_SELECTED_KEY = 'myhku-data-mode-selected'
const SNAPSHOT_KEY = 'myhku-live-snapshot'
const THEME_KEY = 'myhku-theme-mode'
const LAST_SYNC_KEY = 'myhku-last-sync'
const LAST_SYNC_MS_KEY = 'myhku-last-sync-ms'
// The desktop shell starts the loopback bridge itself. A browser preview may
// also use this default when `npm run bridge` is running; deployments can
// disable it explicitly with VITE_HKU_BRIDGE_URL=.
const bridgeBase = ((import.meta.env.VITE_HKU_BRIDGE_URL as string | undefined) ?? 'http://127.0.0.1:17321')?.replace(/\/$/, '')

const defaultStates = (): Record<HkuSite, SiteConnection> => ({
  portal: { state: 'disconnected' },
  sis: { state: 'disconnected' },
  moodle: { state: 'disconnected' },
})

export function getDataMode(): DataMode {
  const stored = localStorage.getItem(MODE_KEY)
  const nativeShell = Boolean(window.myhkuDesktop || window.myhkuAndroid)
  // A browser preview may have left a demo-mode value in shared storage.
  // Native shells should begin with the real bridge after the first login;
  // only an explicit user choice of demo mode overrides that default.
  if (stored === 'live') return 'live'
  if (stored === 'demo' && (!nativeShell || localStorage.getItem(MODE_SELECTED_KEY) === '1')) return 'demo'
  // Packaged shells have a real native/session bridge; the plain browser
  // preview keeps demo data until the user explicitly enables live mode.
  return nativeShell ? 'live' : 'demo'
}

export function setDataMode(mode: DataMode) {
  localStorage.setItem(MODE_KEY, mode)
  localStorage.setItem(MODE_SELECTED_KEY, '1')
}

export function getThemeMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(THEME_KEY)
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw
  } catch { /* ignore */ }
  return 'system'
}

export function applyThemeMode(theme: ThemeMode) {
  const root = document.documentElement
  if (theme === 'system') {
    delete root.dataset.theme
    root.style.colorScheme = 'light dark'
  } else {
    root.dataset.theme = theme
    root.style.colorScheme = theme === 'dark' ? 'only dark' : 'only light'
  }
}

export function setThemeMode(theme: ThemeMode) {
  try { localStorage.setItem(THEME_KEY, theme) } catch { /* ignore */ }
  applyThemeMode(theme)
}

export function getConnectionStates(): Record<HkuSite, SiteConnection> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STATE_KEY) || '{}') as Partial<Record<HkuSite, SiteConnection>>
    return { ...defaultStates(), ...parsed }
  } catch {
    return defaultStates()
  }
}

function save(states: Record<HkuSite, SiteConnection>) {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(states)) } catch { /* UI still receives live state when storage is unavailable */ }
  return states
}

// Compare only observations from this renderer lifetime. Native revisions
// restart with the app and must never be compared with persisted UI state.
const latestDesktopSessions: Partial<DesktopSessions> = {}

/** Native auth state is independent of whether course extraction has finished. */
export function applyDesktopSessions(sessions: DesktopSessions): Record<HkuSite, SiteConnection> {
  const states = defaultStates()
  for (const site of Object.keys(states) as HkuSite[]) {
    const incoming = sessions[site]
    const previous = latestDesktopSessions[site]
    const item = previous && (previous.revision ?? -1) > (incoming?.revision ?? -1) ? previous : incoming || previous || { state: 'disconnected' }
    latestDesktopSessions[site] = item
    const state: ConnectionState = item.state === 'connected' ? 'connected'
      : ['queued', 'checking'].includes(item.state) ? 'checking'
      : ['manual_required', 'needs_2fa'].includes(item.state) ? 'login_pending'
      : item.state === 'error' ? 'error' : 'disconnected'
    states[site] = { state, nativeState: item.state, detail: item.detail, checkedAt: item.checkedAt }
  }
  return save(states)
}

export async function openOfficialLogin(site: HkuSite): Promise<Record<HkuSite, SiteConnection>> {
  if (window.myhkuDesktop?.loginSite) return applyDesktopSessions(await window.myhkuDesktop.loginSite(site))
  if (window.myhkuAndroid?.openLogin) {
    window.myhkuAndroid.openLogin(site)
    const states = getConnectionStates()
    states[site] = { state: 'login_pending', detail: '请在官方页面完成登录，连接状态会自动更新' }
    return save(states)
  }
  window.open(HKU_SITES[site].url, '_blank', 'noopener,noreferrer')
  const states = getConnectionStates()
  states[site] = { state: 'login_pending', detail: '请在官方页面完成登录，连接状态会自动更新' }
  return save(states)
}

function nativeSession(site: HkuSite): SiteConnection | null {
  try {
    const raw = window.myhkuAndroid?.getSession?.(site)
    if (!raw) return null
    const payload = JSON.parse(raw) as { connected?: boolean; detail?: string; checkedAt?: string }
    return { state: payload.connected ? 'connected' : 'disconnected', detail: payload.detail, checkedAt: payload.checkedAt }
  } catch { return null }
}

/**
 * Ask the local bridge whether it has received data from a logged-in page.
 * This does not validate or expose the native authentication session.
 */
export async function checkConnection(site: HkuSite): Promise<SiteConnection> {
  if (window.myhkuDesktop?.authSessions) return applyDesktopSessions(await window.myhkuDesktop.authSessions())[site]
  const native = nativeSession(site)
  if (native) { save({ ...getConnectionStates(), [site]: native }); return native }
  if (!bridgeBase) {
    const result = { state: 'error' as const, detail: 'MyHKU 本地数据服务不可用，请重新打开应用后重试' }
    save({ ...getConnectionStates(), [site]: result })
    return result
  }
  try {
    const response = await fetch(`${bridgeBase}/api/session/${site}`, { credentials: 'omit' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const payload = (await response.json()) as { connected?: boolean; detail?: string }
    const result: SiteConnection = {
      state: payload.connected ? 'connected' : 'disconnected',
      checkedAt: new Date().toISOString(),
      detail: payload.detail,
    }
    save({ ...getConnectionStates(), [site]: result })
    return result
  } catch {
    const result = { state: 'error' as const, detail: '无法连接本地桥接，请确认应用服务正在运行' }
    save({ ...getConnectionStates(), [site]: result })
    return result
  }
}

export async function checkAllConnections() {
  if (window.myhkuDesktop?.authSessions) return applyDesktopSessions(await window.myhkuDesktop.authSessions())
  const sites: HkuSite[] = ['portal', 'sis', 'moodle']
  const entries = await Promise.all(sites.map(async site => [site, await checkConnection(site)] as const))
  return Object.fromEntries(entries) as Record<HkuSite, SiteConnection>
}

/** Normalized payload supplied by the local bridge during live sync. */
export type LiveSnapshot = {
  fetchedAt: string
  schedule: LiveClass[]
  scheduleWeek?: { start: string; end: string }
  scheduleWeeks?: Array<{ start: string; end: string }>
  courses: LiveCourse[]
  assignments: LiveAssignment[]
  resources: LiveResource[]
  grades: LiveGrade[]
  announcements: LiveAnnouncement[]
}

export type LiveClass = { id: string; title: string; code?: string; date?: string; day?: string; start: string; end: string; room?: string; teacher?: string }
export type LiveCourse = { id: string; title: string; code?: string }
export type LiveAssignment = { id: string; title: string; course: string; due?: string; completed?: boolean; submissionStatus?: string }
export type LiveResource = { id: string; title: string; course: string; url?: string }
export type LiveGrade = { id: string; title: string; course: string; value?: string; released?: boolean }
export type LiveAnnouncement = { id: string; title: string; course: string; published?: string; url?: string }

function normalizeSnapshotPayload(payload: Partial<LiveSnapshot>, fallbackFetchedAt?: string): LiveSnapshot {
  const weeks = Array.isArray(payload.scheduleWeeks)
    ? payload.scheduleWeeks.filter(w => w && typeof w.start === 'string' && typeof w.end === 'string')
    : undefined
  return {
    fetchedAt: payload.fetchedAt || fallbackFetchedAt || new Date().toISOString(),
    schedule: Array.isArray(payload.schedule) ? payload.schedule : [],
    ...(payload.scheduleWeek && typeof payload.scheduleWeek.start === 'string' && typeof payload.scheduleWeek.end === 'string' ? { scheduleWeek: payload.scheduleWeek } : {}),
    ...(weeks && weeks.length > 0 ? { scheduleWeeks: weeks } : {}),
    courses: Array.isArray(payload.courses) ? payload.courses : [],
    assignments: Array.isArray(payload.assignments) ? payload.assignments : [],
    resources: Array.isArray(payload.resources) ? payload.resources : [],
    grades: Array.isArray(payload.grades) ? payload.grades : [],
    announcements: Array.isArray(payload.announcements) ? payload.announcements : [],
  }
}

export async function fetchLiveSnapshot(signal?: AbortSignal): Promise<LiveSnapshot> {
  try {
    const raw = window.myhkuAndroid?.getSnapshot?.() || window.myhkuAndroid?.getLatestSnapshot?.()
    if (raw) {
      const native = JSON.parse(raw) as Partial<LiveSnapshot> & { capturedAt?: string; connected?: boolean }
      if (native.connected !== false && (native.fetchedAt || native.capturedAt)) {
        return normalizeSnapshotPayload(native, native.capturedAt)
      }
    }
  } catch { /* native bridge may not be present or may have no data */ }
  if (!bridgeBase) throw new Error('MyHKU 本地数据服务不可用，请重新打开应用后重试')
  const response = await fetch(`${bridgeBase}/api/snapshot`, { credentials: 'omit', signal })
  if (!response.ok) throw new Error(`桥接同步失败（HTTP ${response.status}）`)
  const payload = await response.json() as Partial<LiveSnapshot>
  if (typeof payload.fetchedAt !== 'string' || Number.isNaN(Date.parse(payload.fetchedAt))) {
    throw new Error('尚未收到 HKU 页面数据，数据到达后会自动更新。')
  }
  return normalizeSnapshotPayload(payload)
}

/**
 * Local renderer cache for the last normalized snapshot.
 * Contains no cookies, passwords, or access tokens.
 */
export function getCachedSnapshot(): LiveSnapshot | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || 'null') as Partial<LiveSnapshot> | null
    if (!parsed || typeof parsed.fetchedAt !== 'string') return null
    return normalizeSnapshotPayload(parsed)
  } catch {
    return null
  }
}

export function cacheSnapshot(snapshot: LiveSnapshot) {
  try { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot)) } catch { /* ignore */ }
}

/** Notify only on changes and upcoming deadlines after the first successful baseline sync. */
export function notifySnapshotChanges(
  next: LiveSnapshot,
  onNavigate?: (target: NavTarget, course?: string) => void,
): number {
  return evaluateSnapshotNotifications(next, onNavigate).length
}

export function clearConnections() {
  for (const key of Object.keys(latestDesktopSessions) as HkuSite[]) {
    delete latestDesktopSessions[key]
  }
  for (const key of [STATE_KEY, SNAPSHOT_KEY, LAST_SYNC_KEY, LAST_SYNC_MS_KEY]) {
    try { localStorage.removeItem(key) } catch { /* ignore */ }
  }
  clearNotificationState()
}

export async function signOutAccount(): Promise<void> {
  if (window.myhkuDesktop?.clearAccount) {
    await window.myhkuDesktop.clearAccount()
  } else if (window.myhkuAndroid?.clearAccount) {
    window.myhkuAndroid.clearAccount()
  } else if (bridgeBase) {
    await fetch(`${bridgeBase}/api/reset`, { method: 'POST', credentials: 'omit' }).catch(() => {})
  }
  clearConnections()
}
