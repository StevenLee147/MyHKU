import type { LiveClass, LiveSnapshot } from './hku'

export type PlacedScheduleEvent = {
  item: LiveClass
  start: number
  end: number
  col: number
  cols: number
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

export function scheduleDate(item: LiveClass, week?: LiveSnapshot['scheduleWeek']): string | undefined {
  const raw = (item.date || item.day || '').trim()
  const iso = raw.match(/\b(\d{4}-\d{2}-\d{2})\b/)
  if (iso) return iso[1]
  const full = raw.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/)
  if (full) return `${full[3]}-${full[2].padStart(2, '0')}-${full[1].padStart(2, '0')}`
  if (!week) return undefined
  const start = new Date(`${week.start}T00:00:00Z`)
  if (Number.isNaN(start.getTime())) return undefined
  const short = raw.match(/\b(\d{1,2})\/(\d{1,2})\b/)
  for (let offset = 0; offset < 7; offset++) {
    const date = new Date(start.getTime() + offset * 86400000)
    const day = date.getUTCDay()
    const matches = short
      ? date.getUTCMonth() + 1 === Number(short[1]) && date.getUTCDate() === Number(short[2])
      : new RegExp(`\\b${['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][day]}`, 'i').test(raw) || raw.includes(`周${'日一二三四五六'[day]}`) || raw.includes(`星期${'日一二三四五六'[day]}`)
    if (matches) return date.toISOString().slice(0, 10)
  }
  return undefined
}

export function todayClasses(snapshot: LiveSnapshot, now = new Date()): LiveClass[] {
  const today = hongKongDate(now)
  const start = new Date(`${today}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - start.getUTCDay())
  const matchingWeek = snapshot.scheduleWeeks?.find(w => today >= w.start && today <= w.end)
  const week = matchingWeek || (snapshot.scheduleWeek && today >= snapshot.scheduleWeek.start && today <= snapshot.scheduleWeek.end
    ? snapshot.scheduleWeek
    : snapshot.schedule.some(item => Boolean(item.date))
      ? { start: start.toISOString().slice(0, 10), end: today }
      : snapshot.scheduleWeek || { start: start.toISOString().slice(0, 10), end: today })
  return snapshot.schedule
    .filter(item => scheduleDate(item, week) === today)
    .sort((a, b) => (parseClockMinutes(a.start) ?? 0) - (parseClockMinutes(b.start) ?? 0) || a.start.localeCompare(b.start))
}

export function currentHongKongWeekStart(now = new Date()): Date {
  const todayIso = hongKongDate(now)
  const parsed = new Date(`${todayIso}T00:00:00`)
  const value = Number.isNaN(parsed.getTime()) ? new Date() : parsed
  value.setHours(0, 0, 0, 0)
  value.setDate(value.getDate() - value.getDay())
  return value
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
  const parsed = raw ? new Date(`${raw.slice(0, 10)}T00:00:00`) : new Date(`${todayIso}T00:00:00`)
  const value = Number.isNaN(parsed.getTime()) ? new Date() : parsed
  value.setHours(0, 0, 0, 0)
  if (!todayMatch && !snapshot.scheduleWeek) {
    value.setDate(value.getDate() - value.getDay())
  }
  return value
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
