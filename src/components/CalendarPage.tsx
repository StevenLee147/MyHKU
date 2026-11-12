import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import type { DataMode, LiveSnapshot } from '../services/hku'
import {
  baseWeekStartDate,
  currentHongKongWeekStart,
  formatIsoLocalDate,
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
    const parsed = new Date(`${item.date.slice(0, 10)}T00:00:00`)
    if (!Number.isNaN(parsed.getTime())) return Math.round((parsed.getTime() - weekStart.getTime()) / 86_400_000)
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
  snapshot,
  dataMode = 'live',
  sisConnected = false,
  query,
  onRefresh,
  onSyncSnapshot,
  onNotice,
}: {
  snapshot: LiveSnapshot
  dataMode?: DataMode
  sisConnected?: boolean
  query: string
  onRefresh: () => void
  onSyncSnapshot?: () => void
  onNotice: (message: string) => void
}) {
  const [weekOffset, setWeekOffset] = useState(0)
  const [loadingWeek, setLoadingWeek] = useState<number | null>(null)
  const autoSyncedWeekRef = useRef<string | null>(null)
  const frozenBaseRef = useRef<Date | null>(null)
  const liveDesktopSync = dataMode === 'live' && Boolean(window.myhkuDesktop?.changeScheduleWeek)
  const todayHkIso = hongKongDate()
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

  const formatDay = (day: Date) =>
    new Intl.DateTimeFormat('zh-CN', { weekday: 'short', month: 'numeric', day: 'numeric' }).format(day)
  const allEvents = dayEvents.flat()
  const firstHour = Math.min(8, ...allEvents.map(event => Math.floor(event.start / 60)))
  const lastHour = Math.max(19, ...allEvents.map(event => Math.ceil(event.end / 60)))
  const timeLabels = Array.from({ length: lastHour - firstHour + 1 }, (_, index) => firstHour + index)
  const gridStart = firstHour * 60
  const pixelsPerHour = 120
  const cachedWeeksCount = snapshot.scheduleWeeks?.length || (snapshot.scheduleWeek ? 1 : 0)

  return (
    <section className="panel live-page">
      <div className="panel-head">
        <div>
          <h2>我的课表</h2>
          <p>
            周视图 · {formatWeekRangeLabel(weekStart, weekEnd)} · 本周 {weekMeetingCount} 节课程
            {cachedWeeksCount > 1 ? `（已预抓 ${cachedWeeksCount} 周课表）` : ''}
          </p>
        </div>
        <div className="calendar-actions">
          <button className="text-btn" onClick={() => void moveWeek(-1)} disabled={loadingWeek !== null}>
            <ChevronLeft size={13} /> 上周
          </button>
          <button className="text-btn" onClick={() => void moveWeek(0)} disabled={loadingWeek !== null || weekOffset === 0}>
            本周
          </button>
          <button className="text-btn" onClick={() => void moveWeek(1)} disabled={loadingWeek !== null}>
            下周 <ChevronRight size={13} />
          </button>
          <button className="text-btn" onClick={onRefresh} disabled={loadingWeek !== null}>
            <RefreshCw size={13} className={loadingWeek !== null ? 'spin' : ''} /> 刷新
          </button>
        </div>
      </div>
      {loadingWeek !== null && (
        <p className="empty-state">正在从 SIS 读取{loadingWeek < 0 ? '上' : loadingWeek > 0 ? '下' : '本'}周课表…</p>
      )}
      {loadingWeek === null && (
        <>
          <div className="schedule-scroll">
            <div
              className="schedule-board"
              style={{ '--hour-height': `${pixelsPerHour}px`, '--grid-hours': lastHour - firstHour } as CSSProperties}
            >
              <div className="schedule-corner" />
              {days.map(day => {
                const dayIso = formatIsoLocalDate(day)
                const isToday = dayIso === hongKongDate()
                return (
                  <div className={`schedule-day-head ${isToday ? 'today' : ''}`} key={dayIso}>
                    {formatDay(day)}
                    {isToday ? <small>今天</small> : null}
                  </div>
                )
              })}
              <div className="schedule-time-axis">
                {timeLabels.map(hour => (
                  <span key={hour} style={{ top: `${(hour - firstHour) * pixelsPerHour - 8}px` }}>
                    {`${String(hour).padStart(2, '0')}:00`}
                  </span>
                ))}
              </div>
              {dayEvents.map((placedEvents, dayIndex) => (
                <div className="schedule-day-track" key={formatIsoLocalDate(days[dayIndex])} style={{ gridColumn: dayIndex + 2 }}>
                  {timeLabels.slice(0, -1).map(hour => (
                    <i className="schedule-hour-line" key={hour} style={{ top: `${(hour - firstHour) * pixelsPerHour}px` }} />
                  ))}
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
                    return (
                      <article
                        className={`schedule-event ${cols > 1 ? 'overlap' : ''}`}
                        key={item.id || `${item.title}-${index}`}
                        style={{
                          top: `${(Math.max(0, start - gridStart) / 60) * pixelsPerHour + 2}px`,
                          height: `${Math.max(28, ((Math.min(lastHour * 60, end) - Math.max(gridStart, start)) / 60) * pixelsPerHour - 4)}px`,
                          ...positionStyle,
                        }}
                        title={`${item.title}${item.teacher ? ` · ${item.teacher}` : ''} · ${item.room || '未提供地点'}`}
                      >
                        <strong>{item.title}</strong>
                        <small>
                          {item.start}–{item.end}
                        </small>
                        <small>
                          {item.room || '未提供地点'}
                          {item.teacher ? ` · ${item.teacher}` : ''}
                        </small>
                      </article>
                    )
                  })}
                </div>
              ))}
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
