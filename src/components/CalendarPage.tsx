import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { CalendarPlus, ChevronLeft, ChevronRight, Clock3, Plus, RefreshCw } from 'lucide-react'
import { CATEGORY_LABELS, mergeWithCustomTasks, type CustomTask, type UnifiedAssignment } from '../services/customTasks'
import type { DataMode, LiveSnapshot } from '../services/hku'
import { tr, type Locale } from '../services/i18n'
// calendar i18n imported
import { cleanDueDisplay, parseDueTimestamp, sortAssignmentsByDue } from '../services/notifications'
import {
  TIMETABLE_PIXELS_PER_HOUR,
  baseWeekStartDate,
  buildCourseToneMap,
  calendarDaysBetween,
  computeScheduleGridBounds,
  currentHongKongWeekStart,
  extractCourseKey,
  formatIsoLocalDate,
  hongKongClockMinutes,
  hongKongDate,
  isWeekRangeCached,
  layoutDayEvents,
  parseClockMinutes,
  scheduleDate,
} from '../services/schedule'

function addDays(value: Date, count: number): Date {
  const next = new Date(value)
  next.setDate(next.getDate() + count)
  return next
}

function formatWeekRangeLabel(start: Date, end: Date): string {
  const fmt = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' })
  return `${fmt.format(start)} – ${fmt.format(end)}`
}

function scheduleDayIndex(item: LiveSnapshot['schedule'][number], weekStart: Date): number {
  if (item.date) {
    const diff = calendarDaysBetween(formatIsoLocalDate(weekStart), item.date.slice(0, 10))
    if (diff !== null) return diff
  }
  const raw = (item.day || '').toLowerCase()
  const names = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  const english = names.findIndex(name => raw.includes(name))
  if (english >= 0) return (english - weekStart.getDay() + 7) % 7
  const chinese = ['一', '二', '三', '四', '五', '六', '日']
  const index = chinese.findIndex(name => raw.includes(`星期${name}`) || raw.includes(`周${name}`))
  if (index < 0) return index
  const absolute = index === 6 ? 0 : index + 1
  return (absolute - weekStart.getDay() + 7) % 7
}

export function CalendarPage({
  locale = 'zh',
  snapshot,
  customTasks = [],
  dataMode = 'live',
  sisConnected = false,
  query,
  onRefresh,
  onSyncSnapshot,
  onNotice,
  onExportIcs,
  onOpenAddTask,
}: {
  locale?: Locale
  snapshot: LiveSnapshot
  customTasks?: CustomTask[]
  dataMode?: DataMode
  sisConnected?: boolean
  query: string
  onRefresh: () => void
  onSyncSnapshot?: () => void
  onNotice: (message: string) => void
  onExportIcs?: () => void
  onOpenAddTask?: () => void
}) {
  // calendar props
  const [weekOffset, setWeekOffset] = useState(0)
  const [loadingWeek, setLoadingWeek] = useState<number | null>(null)
  const [nowHkMins, setNowHkMins] = useState(() => hongKongClockMinutes())
  const autoSyncedWeekRef = useRef<string | null>(null)
  const frozenBaseRef = useRef<Date | null>(null)
  const liveDesktopSync = dataMode === 'live' && Boolean(window.myhkuDesktop?.changeScheduleWeek)
  const todayHkIso = hongKongDate()

  useEffect(() => {
    const timer = window.setInterval(() => setNowHkMins(hongKongClockMinutes()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const toneByCourse = useMemo(() => {
    const keys: string[] = []
    for (const c of snapshot.courses) {
      keys.push(extractCourseKey(c.code, c.title))
    }
    for (const s of snapshot.schedule) {
      keys.push(extractCourseKey(s.code, s.title))
    }
    return buildCourseToneMap(keys)
  }, [snapshot.courses, snapshot.schedule])
  const baseStart = useMemo(() => {
    if (liveDesktopSync) return currentHongKongWeekStart()
    if (weekOffset === 0 || !frozenBaseRef.current) {
      const next = baseWeekStartDate(snapshot)
      frozenBaseRef.current = next
      return next
    }
    return frozenBaseRef.current
  }, [liveDesktopSync, snapshot, todayHkIso, weekOffset])
  const weekStart = useMemo(() => addDays(baseStart, weekOffset * 7), [baseStart, weekOffset])
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart])
  const weekStartIso = formatIsoLocalDate(weekStart)
  const weekEndIso = formatIsoLocalDate(weekEnd)
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart])
  const activeRange = useMemo(() => ({ start: weekStartIso, end: weekEndIso }), [weekStartIso, weekEndIso])

  const filteredSchedule = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return snapshot.schedule
    return snapshot.schedule.filter(item =>
      `${item.title} ${item.code || ''} ${item.room || ''} ${item.teacher || ''}`.toLowerCase().includes(keyword),
    )
  }, [snapshot.schedule, query])

  const { dayEvents, unplaced, weekMeetingCount } = useMemo(() => {
    const rawBuckets = days.map(() => [] as Array<{ item: LiveSnapshot['schedule'][number]; start: number; end: number }>)
    const missing: LiveSnapshot['schedule'] = []
    let count = 0
    const hasExplicitDates = filteredSchedule.some(item => Boolean(item.date))
    const fallbackRange = !hasExplicitDates || snapshot.scheduleWeek?.start === weekStartIso ? activeRange : undefined

    for (const item of filteredSchedule) {
      const date = scheduleDate(item, fallbackRange)
      const day = scheduleDayIndex(date ? { ...item, date } : item, weekStart)
      const start = parseClockMinutes(item.start)
      const parsedEnd = parseClockMinutes(item.end)
      if (start === null) {
        if (!item.date || (item.date >= weekStartIso && item.date <= weekEndIso)) missing.push(item)
        continue
      }
      if (day < 0 || day > 6) {
        if (!date && !item.day) missing.push(item)
        continue
      }
      count += 1
      const end = parsedEnd || start + 60
      rawBuckets[day].push({ item, start, end: Math.max(start + 30, end) })
    }
    return {
      dayEvents: rawBuckets.map(layoutDayEvents),
      unplaced: missing,
      weekMeetingCount: count,
    }
  }, [days, filteredSchedule, snapshot.scheduleWeek?.start, weekStart, weekStartIso, weekEndIso, activeRange])

  const syncTargetWeek = async (delta: number, targetStartIso: string) => {
    const change = liveDesktopSync ? window.myhkuDesktop?.changeScheduleWeek : undefined
    if (!change) return
    setLoadingWeek(delta)
    try {
      await change({
        offset: delta === 0 ? 0 : delta > 0 ? 1 : -1,
        targetStartIso,
      })
      onSyncSnapshot?.()
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '切换课表周次失败，显示已缓存范围')
    } finally {
      setLoadingWeek(null)
    }
  }

  useEffect(() => {
    if (!liveDesktopSync || !sisConnected || weekOffset !== 0 || loadingWeek !== null) return
    if (isWeekRangeCached(snapshot, weekStartIso, weekEndIso)) return
    if (autoSyncedWeekRef.current === weekStartIso) return
    autoSyncedWeekRef.current = weekStartIso
    void syncTargetWeek(0, weekStartIso)
  }, [liveDesktopSync, sisConnected, weekOffset, loadingWeek, snapshot, weekStartIso, weekEndIso])

  const moveWeek = async (delta: number) => {
    const targetOffset = delta === 0 ? 0 : weekOffset + delta
    const targetStart = addDays(baseStart, targetOffset * 7)
    const targetEnd = addDays(targetStart, 6)
    const targetStartIso = formatIsoLocalDate(targetStart)
    const targetEndIso = formatIsoLocalDate(targetEnd)
    setWeekOffset(targetOffset)

    if (isWeekRangeCached(snapshot, targetStartIso, targetEndIso)) {
      return
    }
    await syncTargetWeek(delta, targetStartIso)
  }

  const formatWeekday = (day: Date) =>
    new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'zh-CN', { weekday: 'short' }).format(day)
  const formatMonthDay = (day: Date) => `${day.getMonth() + 1}/${day.getDate()}`
  const allEvents = dayEvents.flat()
  const { firstHour, lastHour } = useMemo(() => computeScheduleGridBounds(allEvents), [allEvents])
  const timeLabels = Array.from({ length: lastHour - firstHour + 1 }, (_, index) => firstHour + index)
  const gridStart = firstHour * 60
  const gridEnd = lastHour * 60
  const pixelsPerHour = TIMETABLE_PIXELS_PER_HOUR
  const cachedWeeksCount = snapshot.scheduleWeeks?.length || (snapshot.scheduleWeek ? 1 : 0)

  const weekDeadlines = useMemo(() => {
    const startMs = Date.parse(`${weekStartIso}T00:00:00+08:00`)
    const endMs = Date.parse(`${weekEndIso}T23:59:59+08:00`)
    const keyword = query.trim().toLowerCase()
    const combined = mergeWithCustomTasks(snapshot.assignments, customTasks).filter(item => !item.completed)
    const inWeek = combined.filter(item => {
      if (keyword && !`${item.title} ${item.course} ${item.note || ''}`.toLowerCase().includes(keyword)) return false
      const ms = parseDueTimestamp(item.due)
      return ms !== null && ms >= startMs && ms <= endMs
    })
    return sortAssignmentsByDue(inWeek) as UnifiedAssignment[]
  }, [snapshot.assignments, customTasks, weekStartIso, weekEndIso, query])

  return (
    <section className="panel live-page">
      <div className="panel-head">
        <div>
          <h2>{tr(locale, '我的课表', 'Weekly Timetable')}</h2>
          <p>
            {tr(
              locale,
              `周视图 · ${formatWeekRangeLabel(weekStart, weekEnd)} · 本周 ${weekMeetingCount} 节课程${cachedWeeksCount > 1 ? `（已预抓 ${cachedWeeksCount} 周课表）` : ''}`,
              `Week view · ${formatWeekRangeLabel(weekStart, weekEnd)} · ${weekMeetingCount} sessions${cachedWeeksCount > 1 ? ` (${cachedWeeksCount} weeks cached)` : ''}`,
            )}
          </p>
        </div>
        <div className="calendar-actions">
          {onOpenAddTask && (
            <button type="button" className="text-btn" onClick={onOpenAddTask}>
              <Plus size={13} /> {tr(locale, '新建倒计时', 'Add Task')}
            </button>
          )}
          {onExportIcs && (
            <button type="button" className="text-btn" onClick={onExportIcs}>
              <CalendarPlus size={13} /> {tr(locale, '导出 .ics', 'Export .ics')}
            </button>
          )}
          <button className="text-btn" onClick={() => void moveWeek(-1)} disabled={loadingWeek !== null}>
            <ChevronLeft size={13} /> {tr(locale, '上周', 'Prev')}
          </button>
          <button className="text-btn" onClick={() => void moveWeek(0)} disabled={loadingWeek !== null || weekOffset === 0}>
            {tr(locale, '本周', 'This Week')}
          </button>
          <button className="text-btn" onClick={() => void moveWeek(1)} disabled={loadingWeek !== null}>
            {tr(locale, '下周', 'Next')} <ChevronRight size={13} />
          </button>
          <button className="text-btn" onClick={onRefresh} disabled={loadingWeek !== null}>
            <RefreshCw size={13} className={loadingWeek !== null ? 'spin' : ''} /> {tr(locale, '刷新', 'Refresh')}
          </button>
        </div>
      </div>
      {loadingWeek !== null && (
        <p className="empty-state">正在从 SIS 读取{loadingWeek < 0 ? '上' : loadingWeek > 0 ? '下' : '本'}周课表…</p>
      )}
      {loadingWeek === null && (
        <>
          {weekDeadlines.length > 0 && (
            <div className="week-ddl-strip" role="region" aria-label="当周截止事项">
              <span className="week-ddl-label">
                <Clock3 size={13} /> 当周到期 ({weekDeadlines.length})
              </span>
              <div className="week-ddl-chips">
                {weekDeadlines.map(item => (
                  <span className={`week-ddl-chip ${item.category === 'exam' ? 'exam' : ''}`} key={item.id}>
                    <strong>{item.course}</strong> · {item.title}
                    {item.isCustom && item.category ? ` [${CATEGORY_LABELS[item.category]}]` : ''}（{cleanDueDisplay(item.due)}）
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="schedule-scroll">
            <div
              className="schedule-board"
              style={{ '--hour-height': `${pixelsPerHour}px`, '--grid-hours': lastHour - firstHour } as CSSProperties}
            >
              <div className="schedule-corner">
                <span>HKT</span>
              </div>
              {days.map(day => {
                const dayIso = formatIsoLocalDate(day)
                const isToday = dayIso === todayHkIso
                const isWeekend = day.getDay() === 0 || day.getDay() === 6
                return (
                  <div
                    className={`schedule-day-head ${isToday ? 'today' : ''} ${isWeekend ? 'weekend' : ''}`}
                    key={dayIso}
                  >
                    <span className="schedule-day-name">{formatWeekday(day)}</span>
                    <span className="schedule-day-date">{formatMonthDay(day)}</span>
                    {isToday ? <small className="schedule-today-pill">{tr(locale, '今天', 'Today')}</small> : null}
                  </div>
                )
              })}
              <div className="schedule-time-axis">
                {timeLabels.map((hour, index) => {
                  const isFirst = index === 0
                  const isLast = index === timeLabels.length - 1
                  const tickStyle: CSSProperties = isFirst
                    ? { top: '3px' }
                    : isLast
                      ? { bottom: '3px' }
                      : { top: `${(hour - firstHour) * pixelsPerHour - 7}px` }
                  return (
                    <span
                      key={hour}
                      className={isFirst ? 'edge-start' : isLast ? 'edge-end' : ''}
                      style={tickStyle}
                    >
                      {`${String(hour).padStart(2, '0')}:00`}
                    </span>
                  )
                })}
              </div>
              {dayEvents.map((placedEvents, dayIndex) => {
                const day = days[dayIndex]
                const dayIso = formatIsoLocalDate(day)
                const isToday = dayIso === todayHkIso
                const isWeekend = day.getDay() === 0 || day.getDay() === 6
                const showNowLine = isToday && nowHkMins >= gridStart && nowHkMins <= gridEnd
                return (
                  <div
                    className={`schedule-day-track ${isToday ? 'today' : ''} ${isWeekend ? 'weekend' : ''}`}
                    key={dayIso}
                    style={{ gridColumn: dayIndex + 2 }}
                  >
                    {showNowLine && (
                      <div
                        className="schedule-now-line"
                        style={{ top: `${((nowHkMins - gridStart) / 60) * pixelsPerHour}px` }}
                        aria-hidden="true"
                      />
                    )}
                    {placedEvents.map(({ item, start, end, col, cols }, index) => {
                      const widthPct = 100 / cols
                      const leftPct = col * widthPct
                      const positionStyle: CSSProperties =
                        cols > 1
                          ? {
                              left: `calc(${leftPct}% + 3px)`,
                              width: `calc(${widthPct}% - 6px)`,
                              right: 'auto',
                            }
                          : {}
                      const clippedStart = Math.max(gridStart, start)
                      const clippedEnd = Math.min(gridEnd, end)
                      const durationMins = Math.max(30, clippedEnd - clippedStart)
                      const isCompact = durationMins < 75
                      const isTall = durationMins >= 105
                      const rawHeight = ((clippedEnd - clippedStart) / 60) * pixelsPerHour
                      const heightPx = Math.max(46, Math.round(rawHeight) - 2)
                      const topPx = Math.round(((clippedStart - gridStart) / 60) * pixelsPerHour) + 1
                      const tone = toneByCourse.get(extractCourseKey(item.code, item.title)) ?? 0
                      return (
                        <article
                          className={`schedule-event tone-${tone} ${isCompact ? 'compact' : isTall ? 'tall' : 'regular'} ${cols > 1 ? 'overlap' : ''}`}
                          key={item.id || `${item.title}-${index}`}
                          style={{
                            top: `${topPx}px`,
                            height: `${heightPx}px`,
                            ...positionStyle,
                          }}
                          title={`${item.title}${item.teacher ? ` · ${item.teacher}` : ''} · ${item.room || tr(locale, '未提供地点', 'Location TBA')}`}
                        >
                          <strong>{item.title}</strong>
                          {isCompact ? (
                            <small className="schedule-event-meta">
                              {item.start}–{item.end}
                              {item.room ? ` · ${item.room}` : ''}
                            </small>
                          ) : (
                            <>
                              <small className="schedule-event-time">
                                {item.start}–{item.end}
                              </small>
                              <small className="schedule-event-loc">
                                {item.room || tr(locale, '待定教室', 'TBA')}
                                {isTall && item.teacher && cols === 1 ? ` · ${item.teacher}` : ''}
                              </small>
                            </>
                          )}
                        </article>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
          {unplaced.length > 0 && <p className="empty-state schedule-unplaced">{unplaced.length} 节课程缺少可定位的日期或时间</p>}
          {weekMeetingCount === 0 && (
            <p className="empty-state">{query.trim() ? '当前周没有匹配搜索条件的课程' : '该周没有课表记录'}</p>
          )}
        </>
      )}
    </section>
  )
}
