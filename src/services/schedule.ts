import type { LiveClass, LiveSnapshot } from './hku'

export type PlacedScheduleEvent = {
  item: LiveClass
  start: number
  end: number
  col: number
  cols: number
}

export const TIMETABLE_PIXELS_PER_HOUR = 56
export const TIMETABLE_TONE_COUNT = 6

export type ScheduleGridBounds = {
  firstHour: number
  lastHour: number
}

export function computeScheduleGridBounds(
  events: ReadonlyArray<{ start: number; end: number }>,
): ScheduleGridBounds {
  if (!events.length) {
    return { firstHour: 9, lastHour: 18 }
  }
  const earliest = Math.min(...events.map(e => Math.floor(e.start / 60)))
  const latest = Math.max(...events.map(e => Math.ceil(e.end / 60)))
  const firstHour = Math.max(0, Math.min(9, earliest))
  const lastHour = Math.min(24, Math.max(firstHour + 8, Math.max(17, latest)))
  return { firstHour, lastHour }
}

export function extractCourseKey(code?: string, title?: string): string {
  const combined = `${code || ''} ${title || ''}`.trim()
  const codeMatch = combined.match(/\b([A-Za-z]{4})\s*-?\s*(\d{4})\b/)
  if (codeMatch) {
    return `${codeMatch[1].toUpperCase()}${codeMatch[2]}`
  }
  return (code || title || 'course').trim().toUpperCase()
}

export function buildCourseToneMap(
  keys: Iterable<string>,
  paletteSize = TIMETABLE_TONE_COUNT,
): Map<string, number> {
  const unique = Array.from(new Set(Array.from(keys).filter(Boolean))).sort()
  const map = new Map<string, number>()
  unique.forEach((key, idx) => {
    map.set(key, idx % paletteSize)
  })
  return map
}

export function hongKongDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function hongKongGreeting(now = new Date()): string {
  const hourStr = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Hong_Kong', hour: '2-digit', hour12: false }).format(now)
  const hour = Number.parseInt(hourStr, 10)
  if (hour >= 5 && hour < 12) return '早上好'
  if (hour >= 12 && hour < 14) return '中午好'
  if (hour >= 14 && hour < 18) return '下午好'
  return '晚上好'
}

export function parseClockMinutes(value?: string): number | null {
  const raw = String(value || '').trim()
  const match = raw.match(/(\d{1,2})(?::|：)(\d{2})\s*(AM|PM)?/i)
  if (!match) return null
  let hour = Number(match[1])
  const minute = Number(match[2])
  const suffix = match[3]?.toUpperCase()
  if (suffix === 'PM' && hour < 12) hour += 12
  if (suffix === 'AM' && hour === 12) hour = 0
  if (hour > 23 || minute > 59) return null
  return hour * 60 + minute
}

type TemporalPlainDateLike = {
  year: number
  month: number
  day: number
  dayOfWeek: number
  add(duration: { days: number }): TemporalPlainDateLike
  toString(): string
}

const TemporalPlainDate = (
  globalThis as {
    Temporal?: {
      PlainDate?: {
        from(item: string): TemporalPlainDateLike
      }
    }
  }
).Temporal?.PlainDate

export function parsePlainDateParts(value?: string): { year: number; month: number; day: number } | null {
  const iso = String(value || '').trim().slice(0, 10)
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  if (TemporalPlainDate) {
    try {
      const plain = TemporalPlainDate.from(iso)
      return { year: plain.year, month: plain.month, day: plain.day }
    } catch {
      return null
    }
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() + 1 !== month || probe.getUTCDate() !== day) {
    return null
  }
  return { year, month, day }
}

export function addCalendarDaysIso(iso: string, days: number): string | null {
  const cleanIso = String(iso || '').trim().slice(0, 10)
  if (TemporalPlainDate) {
    try {
      return TemporalPlainDate.from(cleanIso).add({ days }).toString()
    } catch {
      return null
    }
  }
  const parts = parsePlainDateParts(cleanIso)
  if (!parts) return null
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days))
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`
}

export function calendarWeekday(iso: string): number | null {
  const cleanIso = String(iso || '').trim().slice(0, 10)
  if (TemporalPlainDate) {
    try {
      return TemporalPlainDate.from(cleanIso).dayOfWeek % 7
    } catch {
      return null
    }
  }
  const parts = parsePlainDateParts(cleanIso)
  if (!parts) return null
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()
}

export function calendarDaysBetween(startIso: string, endIso: string): number | null {
  const start = parsePlainDateParts(startIso)
  const end = parsePlainDateParts(endIso)
  if (!start || !end) return null
  const startMs = Date.UTC(start.year, start.month - 1, start.day)
  const endMs = Date.UTC(end.year, end.month - 1, end.day)
  return Math.round((endMs - startMs) / 86_400_000)
}

function localCalendarDateFromIso(iso: string): Date | null {
  const parts = parsePlainDateParts(iso)
  if (!parts) return null
  return new Date(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0)
}

export function scheduleDate(item: LiveClass, week?: LiveSnapshot['scheduleWeek']): string | undefined {
  const raw = (item.date || item.day || '').trim()
  const iso = raw.match(/\b(\d{4}-\d{2}-\d{2})\b/)
  if (iso && parsePlainDateParts(iso[1])) return iso[1]
  const full = raw.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/)
  if (full) {
    const candidate = `${full[3]}-${full[2].padStart(2, '0')}-${full[1].padStart(2, '0')}`
    if (parsePlainDateParts(candidate)) return candidate
  }
  if (!week || !parsePlainDateParts(week.start)) return undefined
  const short = raw.match(/\b(\d{1,2})\/(\d{1,2})\b/)
  for (let offset = 0; offset < 7; offset++) {
    const candidateIso = addCalendarDaysIso(week.start, offset)
    if (!candidateIso) continue
    const parts = parsePlainDateParts(candidateIso)
    const day = calendarWeekday(candidateIso)
    if (!parts || day === null) continue
    const matches = short
      ? parts.month === Number(short[1]) && parts.day === Number(short[2])
      : new RegExp(`\\b${['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][day]}`, 'i').test(raw) || raw.includes(`周${'日一二三四五六'[day]}`) || raw.includes(`星期${'日一二三四五六'[day]}`)
    if (matches) return candidateIso
  }
  return undefined
}

export function todayClasses(snapshot: LiveSnapshot, now = new Date()): LiveClass[] {
  const today = hongKongDate(now)
  const todayDow = calendarWeekday(today) ?? 0
  const weekStartIso = addCalendarDaysIso(today, -todayDow) ?? today
  const matchingWeek = snapshot.scheduleWeeks?.find(w => today >= w.start && today <= w.end)
  const week = matchingWeek || (snapshot.scheduleWeek && today >= snapshot.scheduleWeek.start && today <= snapshot.scheduleWeek.end
    ? snapshot.scheduleWeek
    : snapshot.schedule.some(item => Boolean(item.date))
      ? { start: weekStartIso, end: today }
      : snapshot.scheduleWeek || { start: weekStartIso, end: today })
  return snapshot.schedule
    .filter(item => scheduleDate(item, week) === today)
    .sort((a, b) => (parseClockMinutes(a.start) ?? 0) - (parseClockMinutes(b.start) ?? 0) || a.start.localeCompare(b.start))
}

export function currentHongKongWeekStart(now = new Date()): Date {
  const todayIso = hongKongDate(now)
  const todayDow = calendarWeekday(todayIso) ?? 0
  const sundayIso = addCalendarDaysIso(todayIso, -todayDow) ?? todayIso
  return localCalendarDateFromIso(sundayIso) ?? new Date()
}

export function baseWeekStartDate(
  snapshot: LiveSnapshot,
  now = new Date(),
  options?: { preferCurrentWeek?: boolean },
): Date {
  if (options?.preferCurrentWeek) return currentHongKongWeekStart(now)
  const todayIso = hongKongDate(now)
  const todayMatch = snapshot.scheduleWeeks?.find(w => todayIso >= w.start && todayIso <= w.end)
  const raw = todayMatch?.start || snapshot.scheduleWeek?.start || snapshot.schedule.find(item => item.date)?.date
  const anchorIso = (raw && parsePlainDateParts(raw.slice(0, 10)) ? raw.slice(0, 10) : null) ?? todayIso
  if (!todayMatch && !snapshot.scheduleWeek) {
    const dow = calendarWeekday(anchorIso) ?? 0
    const sundayIso = addCalendarDaysIso(anchorIso, -dow) ?? anchorIso
    return localCalendarDateFromIso(sundayIso) ?? currentHongKongWeekStart(now)
  }
  return localCalendarDateFromIso(anchorIso) ?? currentHongKongWeekStart(now)
}

export function formatIsoLocalDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function isWeekRangeCached(snapshot: LiveSnapshot, weekStartIso: string, weekEndIso: string): boolean {
  const ranges = [
    ...(snapshot.scheduleWeeks || []),
    ...(snapshot.scheduleWeek ? [snapshot.scheduleWeek] : []),
  ]
  if (ranges.some(r => r.start <= weekStartIso && r.end >= weekEndIso)) return true
  return snapshot.schedule.some(item => {
    const d = scheduleDate(item)
    return Boolean(d && d >= weekStartIso && d <= weekEndIso)
  })
}

export function layoutDayEvents(rawEvents: Array<{ item: LiveClass; start: number; end: number }>): PlacedScheduleEvent[] {
  const sorted = [...rawEvents].sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start))
  const placed: PlacedScheduleEvent[] = []
  let cluster: Array<{ item: LiveClass; start: number; end: number; col: number }> = []
  let clusterMaxEnd = -1

  const flushCluster = () => {
    if (!cluster.length) return
    const cols = Math.max(...cluster.map(e => e.col)) + 1
    for (const entry of cluster) {
      placed.push({ ...entry, cols })
    }
    cluster = []
    clusterMaxEnd = -1
  }

  for (const event of sorted) {
    if (cluster.length > 0 && event.start >= clusterMaxEnd) {
      flushCluster()
    }
    const columnEnds: number[] = []
    for (const existing of cluster) {
      columnEnds[existing.col] = Math.max(columnEnds[existing.col] ?? -1, existing.end)
    }
    let assignedCol = columnEnds.findIndex(end => end === undefined || end <= event.start)
    if (assignedCol < 0) assignedCol = columnEnds.length
    cluster.push({ ...event, col: assignedCol })
    clusterMaxEnd = Math.max(clusterMaxEnd, event.end)
  }
  flushCluster()
  return placed
}

export type NextClassFocus = {
  status: 'ongoing' | 'upcoming'
  item: LiveClass
  dateIso: string
  dayOffset: number
  minutesUntilStart: number
  minutesUntilEnd: number
  progressPct: number
}

export function hongKongClockMinutes(now = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Hong_Kong',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const h = Number(parts.find(p => p.type === 'hour')?.value || '0')
  const m = Number(parts.find(p => p.type === 'minute')?.value || '0')
  return h * 60 + m
}

export function findNextOrCurrentClass(snapshot: LiveSnapshot, now = new Date()): NextClassFocus | null {
  if (!snapshot.schedule.length) return null
  const todayIso = hongKongDate(now)
  const nowMins = hongKongClockMinutes(now)

  for (let dayOffset = 0; dayOffset <= 7; dayOffset += 1) {
    const targetIso = dayOffset === 0 ? todayIso : addCalendarDaysIso(todayIso, dayOffset)
    if (!targetIso) continue
    const dow = calendarWeekday(targetIso) ?? 0
    const weekStartIso = addCalendarDaysIso(targetIso, -dow) ?? targetIso
    const weekEndIso = addCalendarDaysIso(weekStartIso, 6) ?? targetIso
    const matchingWeek = snapshot.scheduleWeeks?.find(w => targetIso >= w.start && targetIso <= w.end)
    const week = matchingWeek || (
      snapshot.scheduleWeek && targetIso >= snapshot.scheduleWeek.start && targetIso <= snapshot.scheduleWeek.end
        ? snapshot.scheduleWeek
        : snapshot.schedule.some(item => Boolean(item.date))
          ? { start: weekStartIso, end: weekEndIso }
          : dayOffset === 0 ? snapshot.scheduleWeek : undefined
    )
    if (!week && !snapshot.schedule.some(item => Boolean(item.date))) continue
    const dayItems = snapshot.schedule
      .filter(item => scheduleDate(item, week) === targetIso)
      .map(item => {
        const start = parseClockMinutes(item.start)
        const end = parseClockMinutes(item.end)
        return start !== null ? { item, start, end: end !== null && end > start ? end : start + 50 } : null
      })
      .filter((entry): entry is { item: LiveClass; start: number; end: number } => entry !== null)
      .sort((a, b) => a.start - b.start)

    for (const entry of dayItems) {
      if (dayOffset === 0 && nowMins >= entry.start && nowMins < entry.end) {
        const duration = Math.max(1, entry.end - entry.start)
        return {
          status: 'ongoing',
          item: entry.item,
          dateIso: targetIso,
          dayOffset: 0,
          minutesUntilStart: 0,
          minutesUntilEnd: entry.end - nowMins,
          progressPct: Math.min(100, Math.max(0, Math.round(((nowMins - entry.start) / duration) * 100))),
        }
      }
      if (dayOffset > 0 || entry.start > nowMins) {
        const minsUntil = dayOffset * 1440 + (entry.start - nowMins)
        return {
          status: 'upcoming',
          item: entry.item,
          dateIso: targetIso,
          dayOffset,
          minutesUntilStart: Math.max(1, minsUntil),
          minutesUntilEnd: Math.max(1, minsUntil + (entry.end - entry.start)),
          progressPct: 0,
        }
      }
    }
  }
  return null
}
