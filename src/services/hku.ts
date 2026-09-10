/**
 * HKU connection primitives used by the dashboard.
 *
 * The browser UI never receives a password or a Cookie. The dashboard reads
 * normalized fields from the local bridge (configured with
 * VITE_HKU_BRIDGE_URL). Opening a school's page remains the official way to
 * complete SSO/MFA, so this module deliberately does not try to automate it.
 */

export type HkuSite = 'portal' | 'sis' | 'moodle'
export type ConnectionState = 'disconnected' | 'login_pending' | 'connected' | 'error'
export type DataMode = 'demo' | 'live'

export type SiteConnection = {
  state: ConnectionState
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
    // Official PeopleSoft timetable page. The user still completes SSO/MFA
    // in the official browser session before the connector reads the page.
    url: 'https://sis-main.hku.hk/psp/sisprod/EMPLOYEE/PSFT_CS/c/SA_LEARNER_SERVICES.SSR_SSENRL_SCHD_W.GBL?pslnkid=Z_HC_SSR_SSENRL_SCHD_W_LNK',
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
const BASELINE_KEY = 'myhku-notification-baseline'
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

export function getConnectionStates(): Record<HkuSite, SiteConnection> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STATE_KEY) || '{}') as Partial<Record<HkuSite, SiteConnection>>
    return { ...defaultStates(), ...parsed }
  } catch {
    return defaultStates()
  }
}

function save(states: Record<HkuSite, SiteConnection>) {
  localStorage.setItem(STATE_KEY, JSON.stringify(states))
  return states
}

/** Remember that the user opened an official login link. The UI anchor owns navigation. */
export function openOfficialLogin(site: HkuSite): Record<HkuSite, SiteConnection> {
  const states = getConnectionStates()
  states[site] = { state: 'login_pending', detail: '已打开官方登录页，请完成 SSO/MFA 后返回应用' }
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
  const sites: HkuSite[] = ['portal', 'sis', 'moodle']
  const entries = await Promise.all(sites.map(async site => [site, await checkConnection(site)] as const))
  return Object.fromEntries(entries) as Record<HkuSite, SiteConnection>
}

/** Normalized payload supplied by the local bridge during live sync. */
export type LiveSnapshot = {
  fetchedAt: string
  schedule: LiveClass[]
  scheduleWeek?: { start: string; end: string }
  courses: LiveCourse[]
  assignments: LiveAssignment[]
  resources: LiveResource[]
  grades: LiveGrade[]
  announcements: LiveAnnouncement[]
}

export type LiveClass = { id: string; title: string; code?: string; date?: string; day?: string; start: string; end: string; room?: string; teacher?: string }
export type LiveCourse = { id: string; title: string; code?: string }
export type LiveAssignment = { id: string; title: string; course: string; due?: string; completed?: boolean }
export type LiveResource = { id: string; title: string; course: string; url?: string }
export type LiveGrade = { id: string; title: string; course: string; value?: string; released?: boolean }
export type LiveAnnouncement = { id: string; title: string; course: string; published?: string; url?: string }

export async function fetchLiveSnapshot(signal?: AbortSignal): Promise<LiveSnapshot> {
  try {
    const raw = window.myhkuAndroid?.getSnapshot?.()
    if (raw) {
      const native = JSON.parse(raw) as Partial<LiveSnapshot> & { capturedAt?: string; connected?: boolean }
      if (native.connected !== false && (native.fetchedAt || native.capturedAt)) {
        return {
          fetchedAt: native.fetchedAt || native.capturedAt || new Date().toISOString(),
          schedule: Array.isArray(native.schedule) ? native.schedule : [],
          ...(native.scheduleWeek && typeof native.scheduleWeek.start === 'string' && typeof native.scheduleWeek.end === 'string' ? { scheduleWeek: native.scheduleWeek } : {}),
          courses: Array.isArray(native.courses) ? native.courses : [],
          assignments: Array.isArray(native.assignments) ? native.assignments : [],
          resources: Array.isArray(native.resources) ? native.resources : [],
          grades: Array.isArray(native.grades) ? native.grades : [],
          announcements: Array.isArray(native.announcements) ? native.announcements : [],
        }
      }
    }
  } catch { /* native bridge may not be present or may have no data */ }
  if (!bridgeBase) throw new Error('MyHKU 本地数据服务不可用，请重新打开应用后重试')
  const response = await fetch(`${bridgeBase}/api/snapshot`, { credentials: 'omit', signal })
  if (!response.ok) throw new Error(`桥接同步失败（HTTP ${response.status}）`)
  const payload = await response.json() as Partial<LiveSnapshot>
  if (typeof payload.fetchedAt !== 'string' || Number.isNaN(Date.parse(payload.fetchedAt))) {
    throw new Error('尚未收到 HKU 页面数据。请在应用内完成官方登录，再点击立即刷新。')
  }
  return {
    fetchedAt: payload.fetchedAt,
    schedule: Array.isArray(payload.schedule) ? payload.schedule : [],
    ...(payload.scheduleWeek && typeof payload.scheduleWeek.start === 'string' && typeof payload.scheduleWeek.end === 'string' ? { scheduleWeek: payload.scheduleWeek } : {}),
    courses: Array.isArray(payload.courses) ? payload.courses : [],
    assignments: Array.isArray(payload.assignments) ? payload.assignments : [],
    resources: Array.isArray(payload.resources) ? payload.resources : [],
    grades: Array.isArray(payload.grades) ? payload.grades : [],
    announcements: Array.isArray(payload.announcements) ? payload.announcements : [],
  }
}

/**
 * Development/browser cache for the last normalized snapshot. Native shells
 * should replace this with encrypted SQLite protected by the platform keystore.
 * It contains no cookies, passwords, or access tokens.
 */
export function getCachedSnapshot(): LiveSnapshot | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || 'null') as Partial<LiveSnapshot> | null
    if (!parsed || typeof parsed.fetchedAt !== 'string') return null
    return {
      fetchedAt: parsed.fetchedAt,
      schedule: Array.isArray(parsed.schedule) ? parsed.schedule : [],
      ...(parsed.scheduleWeek && typeof parsed.scheduleWeek.start === 'string' && typeof parsed.scheduleWeek.end === 'string' ? { scheduleWeek: parsed.scheduleWeek } : {}),
      courses: Array.isArray(parsed.courses) ? parsed.courses : [],
      assignments: Array.isArray(parsed.assignments) ? parsed.assignments : [],
      resources: Array.isArray(parsed.resources) ? parsed.resources : [],
      grades: Array.isArray(parsed.grades) ? parsed.grades : [],
      announcements: Array.isArray(parsed.announcements) ? parsed.announcements : [],
    }
  } catch {
    return null
  }
}

export function cacheSnapshot(snapshot: LiveSnapshot) {
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot))
}

/** Notify only on changes after the first successful baseline sync. */
export function notifySnapshotChanges(next: LiveSnapshot): number {
  let previous: Partial<LiveSnapshot> | null = null
  try { previous = JSON.parse(localStorage.getItem(BASELINE_KEY) || 'null') } catch { previous = null }
  localStorage.setItem(BASELINE_KEY, JSON.stringify(next))
  if (!previous) return 0
  const oldAssignments = new Set((previous.assignments || []).map(item => item.id))
  const oldAnnouncements = new Set((previous.announcements || []).map(item => item.id))
  const oldClasses = new Map((previous.schedule || []).map(item => [item.id, `${item.start}|${item.end}|${item.room || ''}`]))
  const messages: string[] = []
  for (const item of next.assignments) if (!oldAssignments.has(item.id) && !item.completed) messages.push(`新待办：${item.title}`)
  for (const item of next.announcements) if (!oldAnnouncements.has(item.id)) messages.push(`新公告：${item.title}`)
  for (const item of next.schedule) {
    const before = oldClasses.get(item.id)
    const after = `${item.start}|${item.end}|${item.room || ''}`
    if (before && before !== after) messages.push(`课表有变化：${item.title}`)
  }
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    for (const message of messages.slice(0, 5)) new Notification('MyHKU', { body: message })
  }
  return messages.length
}

export function clearConnections() {
  localStorage.removeItem(STATE_KEY)
  localStorage.removeItem(SNAPSHOT_KEY)
  localStorage.removeItem(BASELINE_KEY)
}
