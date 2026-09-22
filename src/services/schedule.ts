import type { LiveClass, LiveSnapshot } from './hku'

export function hongKongDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
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
  const week = snapshot.scheduleWeek || { start: start.toISOString().slice(0, 10), end: today }
  return snapshot.schedule.filter(item => scheduleDate(item, week) === today).sort((a, b) => a.start.localeCompare(b.start))
}
