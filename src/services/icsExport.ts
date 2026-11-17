import type { LiveAssignment, LiveClass, LiveSnapshot } from './hku'
import type { CustomTask } from './customTasks'

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

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

function sanitizeUid(raw: string): string {
  return 'myhku-' + raw.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120)
}

function formatUtcStamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  )
}

function formatHkLocalStamp(ms: number): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms))
  const get = (type: string) => parts.find(p => p.type === type)?.value || '00'
  return `${get('year')}${get('month')}${get('day')}T${get('hour')}${get('minute')}${get('second')}`
}

function parseClockHm(raw?: string): { h: number; m: number } | null {
  if (!raw) return null
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return { h, m: min }
}

function resolveClassIsoDate(item: LiveClass, fallbackWeekStart?: string): string | null {
  if (item.date && /^\d{4}-\d{2}-\d{2}/.test(item.date)) {
    return item.date.slice(0, 10)
  }
  if (!fallbackWeekStart || !/^\d{4}-\d{2}-\d{2}$/.test(fallbackWeekStart) || !item.day) return null
  const raw = item.day.toLowerCase()
  const names = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  let dayIdx = names.findIndex(name => raw.includes(name))
  if (dayIdx < 0) {
    const zh = ['日', '一', '二', '三', '四', '五', '六']
    dayIdx = zh.findIndex(ch => raw.includes(`星期${ch}`) || raw.includes(`周${ch}`))
  }
  if (dayIdx < 0) return null
  const base = new Date(`${fallbackWeekStart}T00:00:00Z`)
  if (Number.isNaN(base.getTime())) return null
  const offset = (dayIdx - base.getUTCDay() + 7) % 7
  base.setUTCDate(base.getUTCDate() + offset)
  return base.toISOString().slice(0, 10)
}

function parseDueMsForIcs(raw?: string, now = new Date()): number | null {
  if (!raw) return null
  const cleaned = raw
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const explicit = cleaned.match(
    /(?:\b(?:due(?:\s+date)?|closes?|closing(?:\s+date)?|deadline)\b|截止(?:日期|时间|時間)?|到期(?:日期|时间|時間)?)\s*[:：]?\s*(.+?)(?=\s+(?:\b(?:opened|opens?|opening|time\s+remaining|grading\s+status|submission\s+status)\b|开放|開放)|$)/i,
  )
  const target = (explicit?.[1] || cleaned).trim()
  if (!target) return null
  if (/^\d{4}-\d{2}-\d{2}T/.test(target)) {
    const ms = Date.parse(target)
    return Number.isNaN(ms) ? null : ms
  }
  const parseClock = (s: string) => {
    const cm = s.match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)?\b/i)
    if (!cm) return { h: 23, m: 59 }
    let h = Number(cm[1])
    const m = Number(cm[2])
    const ap = cm[3]?.toUpperCase()
    if (ap === 'PM' && h < 12) h += 12
    if (ap === 'AM' && h === 12) h = 0
    return { h: Math.min(23, h), m: Math.min(59, m) }
  }
  const hkEpoch = (y: number, mo: number, d: number, h: number, mi: number) =>
    Date.parse(`${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:00+08:00`)

  const iso = target.match(/^(\d{4})-(\d{2})-(\d{2})(?:[,\s]+(\d{1,2}:\d{2}(?:\s*(?:AM|PM))?))?$/i)
  if (iso) {
    const c = parseClock(iso[4] || '23:59')
    return hkEpoch(Number(iso[1]), Number(iso[2]), Number(iso[3]), c.h, c.m)
  }
  const hkToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(now)
    .split('-')
    .map(Number)
  const clock = parseClock(target)
  if (/^(?:today|今天|今日)\b/i.test(target)) return hkEpoch(hkToday[0], hkToday[1], hkToday[2], clock.h, clock.m)
  if (/^(?:tomorrow|明天|明日)\b/i.test(target)) return hkEpoch(hkToday[0], hkToday[1], hkToday[2], clock.h, clock.m) + 86_400_000
  const dm = target.match(/\b(\d{1,2})\s+([A-Za-z]+)(?:[,\s]+(\d{4}))?\b/)
  if (dm && MONTHS[dm[2].toLowerCase()]) {
    let y = dm[3] ? Number(dm[3]) : hkToday[0]
    let ms = hkEpoch(y, MONTHS[dm[2].toLowerCase()], Number(dm[1]), clock.h, clock.m)
    if (!dm[3] && ms < now.getTime() - 180 * 86_400_000) ms = hkEpoch(y + 1, MONTHS[dm[2].toLowerCase()], Number(dm[1]), clock.h, clock.m)
    return Number.isNaN(ms) ? null : ms
  }
  const md = target.match(/\b([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?\b/)
  if (md && MONTHS[md[1].toLowerCase()]) {
    const y = md[3] ? Number(md[3]) : hkToday[0]
    const ms = hkEpoch(y, MONTHS[md[1].toLowerCase()], Number(md[2]), clock.h, clock.m)
    return Number.isNaN(ms) ? null : ms
  }
  return null
}

export type IcsExportOptions = {
  includeClasses?: boolean
  includeAssignments?: boolean
  includeCompletedAssignments?: boolean
  now?: Date
}

export function buildIcsCalendar(
  snapshot: Pick<LiveSnapshot, 'schedule' | 'scheduleWeek' | 'assignments'>,
  customTasks: CustomTask[] = [],
  options: IcsExportOptions = {},
): { ics: string; classCount: number; ddlCount: number } {
  const includeClasses = options.includeClasses !== false
  const includeAssignments = options.includeAssignments !== false
  const includeCompleted = Boolean(options.includeCompletedAssignments)
  const now = options.now || new Date()
  const dtstamp = formatUtcStamp(now)
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MyHKU//Learning Dashboard//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:MyHKU 课表与待办',
    'X-WR-TIMEZONE:Asia/Hong_Kong',
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Hong_Kong',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0800',
    'TZOFFSETTO:+0800',
    'TZNAME:HKT',
    'END:STANDARD',
    'END:VTIMEZONE',
  ]

  let classCount = 0
  let ddlCount = 0

  if (includeClasses) {
    const seenClassUids = new Set<string>()
    for (const item of snapshot.schedule) {
      const dateIso = resolveClassIsoDate(item, snapshot.scheduleWeek?.start)
      const startHm = parseClockHm(item.start)
      const endHm = parseClockHm(item.end)
      if (!dateIso || !startHm || !endHm) continue
      const ymd = dateIso.replace(/-/g, '')
      const dtStart = `${ymd}T${String(startHm.h).padStart(2, '0')}${String(startHm.m).padStart(2, '0')}00`
      const dtEnd = `${ymd}T${String(endHm.h).padStart(2, '0')}${String(endHm.m).padStart(2, '0')}00`
      const uid = sanitizeUid(`class-${item.id || `${item.title}-${dateIso}-${item.start}`}`)
      if (seenClassUids.has(uid)) continue
      seenClassUids.add(uid)
      classCount += 1
      const summary = item.code && !item.title.includes(item.code) ? `${item.code} · ${item.title}` : item.title
      const descParts = [
        item.code ? `课程代码：${item.code}` : '',
        item.teacher ? `教师：${item.teacher}` : '',
        item.room ? `教室：${item.room}` : '',
      ].filter(Boolean)
      lines.push(
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART;TZID=Asia/Hong_Kong:${dtStart}`,
        `DTEND;TZID=Asia/Hong_Kong:${dtEnd}`,
        `SUMMARY:${escapeIcsText(summary)}`,
        ...(item.room ? [`LOCATION:${escapeIcsText(item.room)}`] : []),
        ...(descParts.length ? [`DESCRIPTION:${escapeIcsText(descParts.join('\n'))}`] : []),
        'BEGIN:VALARM',
        'TRIGGER:-PT15M',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeIcsText(`即将上课：${summary}`)}`,
        'END:VALARM',
        'END:VEVENT',
      )
    }
  }

  if (includeAssignments) {
    const combined: Array<LiveAssignment & { tagLabel?: string; note?: string }> = [
      ...snapshot.assignments.map(a => ({ ...a, tagLabel: 'DDL' })),
      ...customTasks.map(t => ({
        id: t.id,
        title: t.title,
        course: t.course,
        due: t.due,
        completed: t.completed,
        tagLabel: t.category === 'exam' ? '考试' : t.category === 'quiz' ? 'Quiz' : t.category === 'project' ? 'Project' : '自建DDL',
        note: t.note,
      })),
    ]
    const seenDdlUids = new Set<string>()
    for (const item of combined) {
      if (!includeCompleted && item.completed) continue
      const dueMs = parseDueMsForIcs(item.due, now)
      if (dueMs === null) continue
      const startMs = dueMs - 30 * 60_000
      const uid = sanitizeUid(`ddl-${item.id || `${item.course}-${item.title}`}`)
      if (seenDdlUids.has(uid)) continue
      seenDdlUids.add(uid)
      ddlCount += 1
      const prefix = item.tagLabel || 'DDL'
      const summary = `[${prefix}] ${item.course}：${item.title}`
      const desc = [
        `课程：${item.course}`,
        item.submissionStatus ? `状态：${item.submissionStatus}` : '',
        item.note ? `备注：${item.note}` : '',
      ].filter(Boolean)
      lines.push(
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART;TZID=Asia/Hong_Kong:${formatHkLocalStamp(startMs)}`,
        `DTEND;TZID=Asia/Hong_Kong:${formatHkLocalStamp(dueMs)}`,
        `SUMMARY:${escapeIcsText(summary)}`,
        `DESCRIPTION:${escapeIcsText(desc.join('\n'))}`,
        'BEGIN:VALARM',
        'TRIGGER:-PT24H',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeIcsText(`24小时内截止：${item.title}`)}`,
        'END:VALARM',
        'BEGIN:VALARM',
        'TRIGGER:-PT1H',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeIcsText(`1小时内截止：${item.title}`)}`,
        'END:VALARM',
        'END:VEVENT',
      )
    }
  }

  lines.push('END:VCALENDAR')
  return {
    ics: lines.join('\r\n') + '\r\n',
    classCount,
    ddlCount,
  }
}

export function downloadIcsFile(icsContent: string, filename = 'myhku-schedule.ics'): void {
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 5000)
}
