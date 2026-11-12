import type { LiveAssignment, LiveSnapshot } from './hku'

export type NavTarget = 'overview' | 'calendar' | 'moodle' | 'materials' | 'settings'

export type AppNotificationItem = {
  id: string
  title: string
  body: string
  target: NavTarget
  course?: string
  createdAt: string
  read?: boolean
}

const BASELINE_KEY = 'myhku-notification-baseline'
const DEADLINE_KEY = 'myhku-deadline-reminders'
const FEED_KEY = 'myhku-notification-feed'

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
}

function hkYearMonthDay(now = new Date()): { year: number; month: number; day: number } {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  const [y, m, d] = formatted.split('-').map(Number)
  return { year: y, month: m, day: d }
}

function parseClock(text: string): { hour: number; minute: number } {
  const match = text.match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)?\b/i)
  if (!match) return { hour: 23, minute: 59 }
  let hour = Number(match[1])
  const minute = Number(match[2])
  const ampm = match[3]?.toUpperCase()
  if (ampm === 'PM' && hour < 12) hour += 12
  if (ampm === 'AM' && hour === 12) hour = 0
  return { hour: Math.min(23, hour), minute: Math.min(59, minute) }
}

function buildHkEpoch(year: number, month: number, day: number, hour: number, minute: number): number {
  // Asia/Hong_Kong is permanently UTC+08:00 without DST.
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`
  return Date.parse(iso)
}

/** Parse ISO timestamps or Moodle human-readable due strings in Asia/Hong_Kong. */
export function parseDueTimestamp(raw?: string, now = new Date()): number | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    const ms = Date.parse(trimmed)
    return Number.isNaN(ms) ? null : ms
  }
  const isoDateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}:\d{2}(?:\s*(?:AM|PM))?))?$/i)
  if (isoDateOnly) {
    const clock = parseClock(isoDateOnly[4] || '23:59')
    return buildHkEpoch(Number(isoDateOnly[1]), Number(isoDateOnly[2]), Number(isoDateOnly[3]), clock.hour, clock.minute)
  }
  const hkNow = hkYearMonthDay(now)
  const clock = parseClock(trimmed)
  if (/^(?:today|今天|今日)\b/i.test(trimmed)) {
    return buildHkEpoch(hkNow.year, hkNow.month, hkNow.day, clock.hour, clock.minute)
  }
  if (/^(?:tomorrow|明天|明日)\b/i.test(trimmed)) {
    return buildHkEpoch(hkNow.year, hkNow.month, hkNow.day, clock.hour, clock.minute) + 86_400_000
  }
  // e.g. "Thursday, 17 September, 11:59 PM" or "22 September 2026, 11:59 PM"
  const dayMonth = trimmed.match(/\b(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?\b/)
  if (dayMonth) {
    const day = Number(dayMonth[1])
    const month = MONTHS[dayMonth[2].toLowerCase()]
    if (month) {
      let year = dayMonth[3] ? Number(dayMonth[3]) : hkNow.year
      let candidate = buildHkEpoch(year, month, day, clock.hour, clock.minute)
      if (!dayMonth[3] && candidate < now.getTime() - 180 * 86_400_000) {
        year += 1
        candidate = buildHkEpoch(year, month, day, clock.hour, clock.minute)
      }
      return Number.isNaN(candidate) ? null : candidate
    }
  }
  const monthDay = trimmed.match(/\b([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?\b/)
  if (monthDay) {
    const month = MONTHS[monthDay[1].toLowerCase()]
    const day = Number(monthDay[2])
    if (month) {
      const year = monthDay[3] ? Number(monthDay[3]) : hkNow.year
      const candidate = buildHkEpoch(year, month, day, clock.hour, clock.minute)
      return Number.isNaN(candidate) ? null : candidate
    }
  }
  const zhDate = trimmed.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/)
  if (zhDate) {
    const candidate = buildHkEpoch(hkNow.year, Number(zhDate[1]), Number(zhDate[2]), clock.hour, clock.minute)
    return Number.isNaN(candidate) ? null : candidate
  }
  return null
}

export function sortAssignmentsByDue(items: LiveAssignment[], now = new Date()): LiveAssignment[] {
  return [...items].sort((a, b) => {
    if (Boolean(a.completed) !== Boolean(b.completed)) return a.completed ? 1 : -1
    const ta = parseDueTimestamp(a.due, now)
    const tb = parseDueTimestamp(b.due, now)
    if (ta !== null && tb !== null) return ta - tb
    if (ta !== null) return -1
    if (tb !== null) return 1
    return a.title.localeCompare(b.title)
  })
}

export function formatDueBadge(due?: string, completed?: boolean, now = new Date()): { text: string; tone: 'urgent' | 'soon' | 'normal' | 'done' } {
  if (completed) return { text: '已完成', tone: 'done' }
  const ms = parseDueTimestamp(due, now)
  if (ms === null) return { text: due || '未提供截止时间', tone: 'normal' }
  const diffHours = (ms - now.getTime()) / 3_600_000
  if (diffHours < 0) return { text: '已过截止时间', tone: 'urgent' }
  if (diffHours <= 1) return { text: `${Math.max(1, Math.round(diffHours * 60))} 分钟内截止`, tone: 'urgent' }
  if (diffHours <= 24) return { text: `${Math.round(diffHours)} 小时后截止`, tone: 'urgent' }
  if (diffHours <= 72) return { text: `${Math.ceil(diffHours / 24)} 天内截止`, tone: 'soon' }
  return { text: due || '', tone: 'normal' }
}

export function getNotificationFeed(): AppNotificationItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(FEED_KEY) || '[]')
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

export function markAllNotificationsRead(): AppNotificationItem[] {
  const next = getNotificationFeed().map(item => ({ ...item, read: true }))
  try { localStorage.setItem(FEED_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  return next
}

export function clearNotificationState() {
  for (const key of [BASELINE_KEY, DEADLINE_KEY, FEED_KEY]) {
    try { localStorage.removeItem(key) } catch { /* ignore */ }
  }
}

export function evaluateSnapshotNotifications(
  next: LiveSnapshot,
  onNavigate?: (target: NavTarget, course?: string) => void,
  now = new Date(),
): AppNotificationItem[] {
  let previous: Partial<LiveSnapshot> | null = null
  try { previous = JSON.parse(localStorage.getItem(BASELINE_KEY) || 'null') } catch { previous = null }
  try { localStorage.setItem(BASELINE_KEY, JSON.stringify(next)) } catch { /* ignore */ }

  let sentDeadlines: Record<string, number> = {}
  try { sentDeadlines = JSON.parse(localStorage.getItem(DEADLINE_KEY) || '{}') || {} } catch { sentDeadlines = {} }

  const created: AppNotificationItem[] = []
  const nowIso = now.toISOString()

  if (previous) {
    const oldAssignments = new Set((previous.assignments || []).map(item => item.id))
    const oldAnnouncements = new Set((previous.announcements || []).map(item => item.id))
    const oldClasses = new Map((previous.schedule || []).map(item => [item.id, item]))
    const nextClassIds = new Set(next.schedule.map(item => item.id))

    for (const item of next.assignments) {
      if (!oldAssignments.has(item.id) && !item.completed) {
        created.push({
          id: `new-assign-${item.id}-${now.getTime()}`,
          title: '新作业待办',
          body: `${item.course}：${item.title}`,
          target: 'moodle',
          course: item.course,
          createdAt: nowIso,
        })
      }
    }
    for (const item of next.announcements) {
      if (!oldAnnouncements.has(item.id)) {
        created.push({
          id: `new-ann-${item.id}-${now.getTime()}`,
          title: '新课程公告',
          body: `${item.course}：${item.title}`,
          target: 'moodle',
          course: item.course,
          createdAt: nowIso,
        })
      }
    }
    const syncedWeeks = next.scheduleWeeks?.length ? next.scheduleWeeks : (next.scheduleWeek ? [next.scheduleWeek] : [])
    const inSyncedRange = (date?: string) => Boolean(date && syncedWeeks.some(w => date >= w.start && date <= w.end))

    for (const item of next.schedule) {
      const before = oldClasses.get(item.id)
      if (!before) {
        if (inSyncedRange(item.date)) {
          created.push({
            id: `new-class-${item.id}-${now.getTime()}`,
            title: '课表新增课程',
            body: `${item.title}（${item.start}–${item.end}）`,
            target: 'calendar',
            createdAt: nowIso,
          })
        }
      } else if (`${before.start}|${before.end}|${before.room || ''}` !== `${item.start}|${item.end}|${item.room || ''}`) {
        created.push({
          id: `chg-class-${item.id}-${now.getTime()}`,
          title: '课表时间或地点变化',
          body: `${item.title}：${item.start}–${item.end} · ${item.room || '未提供地点'}`,
          target: 'calendar',
          createdAt: nowIso,
        })
      }
    }
    for (const [id, oldItem] of oldClasses.entries()) {
      if (!nextClassIds.has(id) && inSyncedRange(oldItem.date)) {
        created.push({
          id: `del-class-${id}-${now.getTime()}`,
          title: '课表课程取消或调整',
          body: `${oldItem.title}（原 ${oldItem.date || ''} ${oldItem.start}）`,
          target: 'calendar',
          createdAt: nowIso,
        })
      }
    }
  }

  // Deadline reminders (24h and 1h) — suppressed on baseline establishment to avoid notification flood,
  // except we mark already-within-window baseline items as seen unless it's a subsequent check.
  for (const item of next.assignments) {
    if (item.completed) continue
    const dueMs = parseDueTimestamp(item.due, now)
    if (dueMs === null) continue
    const remainingMs = dueMs - now.getTime()
    if (remainingMs <= 0) continue
    const bucket = remainingMs <= 3_600_000 ? '1h' : remainingMs <= 86_400_000 ? '24h' : null
    if (!bucket) continue
    const dedupeKey = `${item.id}:${bucket}:${dueMs}`
    if (sentDeadlines[dedupeKey]) continue
    sentDeadlines[dedupeKey] = now.getTime()
    if (previous) {
      created.push({
        id: `due-${dedupeKey}`,
        title: bucket === '1h' ? '作业将在 1 小时内截止' : '作业将在 24 小时内截止',
        body: `${item.course} · ${item.title}`,
        target: 'moodle',
        course: item.course,
        createdAt: nowIso,
      })
    }
  }

  try { localStorage.setItem(DEADLINE_KEY, JSON.stringify(sentDeadlines)) } catch { /* ignore */ }

  if (created.length > 0) {
    const mergedFeed = [...created, ...getNotificationFeed()].slice(0, 40)
    try { localStorage.setItem(FEED_KEY, JSON.stringify(mergedFeed)) } catch { /* ignore */ }
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      for (const alert of created.slice(0, 5)) {
        try {
          const nativeNotif = new Notification(`MyHKU · ${alert.title}`, { body: alert.body })
          if (onNavigate) {
            nativeNotif.onclick = () => {
              window.focus()
              onNavigate(alert.target, alert.course)
            }
          }
        } catch { /* notification API restricted in some WebViews */ }
      }
    }
  }

  return created
}
