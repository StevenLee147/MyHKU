import { useMemo } from 'react'
import { Bell, BookOpen, CalendarDays, CalendarPlus, Clock3, Download, ExternalLink, Link2, Plus, RefreshCw, ShieldCheck, Sparkles, Trophy } from 'lucide-react'
import { CATEGORY_LABELS, mergeWithCustomTasks, type CustomTask, type UnifiedAssignment } from '../services/customTasks'
import { safeHkuUrl, type DataMode, type LiveSnapshot } from '../services/hku'
import { tr, type Locale } from '../services/i18n'
import { formatDueBadge, sortAssignmentsByDue, type NavTarget } from '../services/notifications'
import { todayClasses } from '../services/schedule'

export type ConnectionPhase = 'checking' | 'connected' | 'manual' | 'disconnected'

export function OverviewPage({
  locale = 'zh',
  snapshot,
  customTasks = [],
  dataMode,
  query,
  error,
  connectionPhase,
  todayLabel,
  onNavigate,
  onSelectCourse,
  onRefresh,
  onOpenAddTask,
  onToggleCustomTask,
  onExportIcs,
}: {
  locale?: Locale
  snapshot: LiveSnapshot | null
  customTasks?: CustomTask[]
  dataMode: DataMode
  query: string
  error: string
  connectionPhase: ConnectionPhase
  todayLabel: { weekday: string; date: string }
  onNavigate: (target: NavTarget) => void
  onSelectCourse: (courseTitleOrId: string) => void
  onRefresh: () => void
  onOpenAddTask?: () => void
  onToggleCustomTask?: (id: string) => void
  onExportIcs?: () => void
}) {
  // locale enabled
  const keyword = query.trim().toLowerCase()

  const classesToday = useMemo(() => {
    if (!snapshot) return []
    const base = todayClasses(snapshot)
    if (!keyword) return base
    return base.filter(item =>
      `${item.title} ${item.code || ''} ${item.room || ''} ${item.teacher || ''}`.toLowerCase().includes(keyword),
    )
  }, [snapshot, keyword])

  const pendingAssignments = useMemo(() => {
    if (!snapshot) return []
    const combined = mergeWithCustomTasks(snapshot.assignments, customTasks)
    const incomplete = combined.filter(item => !item.completed)
    const filtered = keyword
      ? incomplete.filter(item => `${item.title} ${item.course} ${item.note || ''}`.toLowerCase().includes(keyword))
      : incomplete
    return sortAssignmentsByDue(filtered) as UnifiedAssignment[]
  }, [snapshot, customTasks, keyword])

  const recentAnnouncements = useMemo(() => {
    if (!snapshot) return []
    const base = snapshot.announcements
    return (keyword ? base.filter(item => `${item.title} ${item.course}`.toLowerCase().includes(keyword)) : base).slice(0, 4)
  }, [snapshot, keyword])

  if (!snapshot) {
    const automatic = connectionPhase === 'checking' || connectionPhase === 'connected'
    const heading =
      connectionPhase === 'checking'
        ? '正在自动连接 HKU'
        : connectionPhase === 'connected'
          ? 'HKU 已连接，正在读取数据'
          : connectionPhase === 'manual'
            ? '等待官方身份验证'
            : '等待连接 HKU'
    const detail =
      connectionPhase === 'checking'
        ? '正在复用官方登录会话，完成后会自动显示课表和课程。'
        : connectionPhase === 'connected'
          ? error || '登录已完成，课表和课程读取后会自动显示。'
          : connectionPhase === 'manual'
            ? '请在官方窗口完成验证，完成后会自动连接并同步数据。'
            : error || '应用会自动恢复官方会话；可在设置中查看各服务状态。'
    return (
      <section className="panel placeholder live-placeholder">
        <div className="placeholder-icon">
          {automatic ? <RefreshCw size={25} className="spin" /> : <ShieldCheck size={25} />}
        </div>
        <h2>{heading}</h2>
        <p>{detail}</p>
        <div className="placeholder-actions">
          <button className="outline-btn" onClick={() => onNavigate('settings')}>
            <Link2 size={16} /> 查看连接状态
          </button>
          {!automatic && (
            <button className="outline-btn" onClick={onRefresh}>
              <RefreshCw size={15} /> 重新检查
            </button>
          )}
        </div>
      </section>
    )
  }

  const releasedGradesCount = snapshot.grades.filter(g => g.released !== false).length
  const urgentCount = pendingAssignments.filter(item => formatDueBadge(item.due, item.completed).tone === 'urgent').length
  const dueTop = pendingAssignments.slice(0, 5)

  return (
    <>
      <section className="stats">
        <div className="stat-card" onClick={() => onNavigate('calendar')} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && onNavigate('calendar')}>
          <div className="stat-icon blue">
            <CalendarDays size={18} />
          </div>
          <div>
            <small>{tr(locale, '今日课程', 'Classes Today')}</small>
            <strong>{tr(locale, `${classesToday.length} 节`, `${classesToday.length}`)}</strong>
          </div>
          <span className="stat-trend">{tr(locale, `${snapshot.schedule.length} 节已缓存`, `${snapshot.schedule.length} cached`)}</span>
        </div>

        <div className="stat-card" onClick={() => onNavigate('moodle')} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && onNavigate('moodle')}>
          <div className="stat-icon amber">
            <Clock3 size={18} />
          </div>
          <div>
            <small>{tr(locale, '待完成', 'Pending Tasks')}</small>
            <strong>{tr(locale, `${pendingAssignments.length} 项`, `${pendingAssignments.length}`)}</strong>
          </div>
          {urgentCount > 0 && <span className="stat-trend amber-text">{tr(locale, `${urgentCount} 项临近截止`, `${urgentCount} due soon`)}</span>}
        </div>

        <div className="stat-card" onClick={() => onNavigate('moodle')} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && onNavigate('moodle')}>
          <div className="stat-icon green">
            <Trophy size={18} />
          </div>
          <div>
            <small>{dataMode === 'demo' ? tr(locale, '示例已发布成绩', 'Sample Grades') : tr(locale, '已获取成绩', 'Released Grades')}</small>
            <strong>{tr(locale, `${releasedGradesCount} 项`, `${releasedGradesCount}`)}</strong>
          </div>
          <span className="stat-trend green-text">{tr(locale, `${snapshot.courses.length} 门课程`, `${snapshot.courses.length} courses`)}</span>
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="panel schedule">
          <div className="panel-head">
            <div>
              <h2>{tr(locale, '今日课表', "Today's Timetable")}</h2>
              <p>
                {todayLabel.date}，{todayLabel.weekday} · Asia/Hong_Kong
              </p>
            </div>
            <button className="text-btn" onClick={() => onNavigate('calendar')}>
              {tr(locale, '查看完整课表', 'Full Timetable')} <span>→</span>
            </button>
          </div>
          <div className="class-list">
            {classesToday.length ? (
              classesToday.map((item, idx) => (
                <article className="class-item" key={item.id}>
                  <div className={`class-time ${idx % 2 === 0 ? 'blue' : 'violet'}`}>
                    <strong>{item.start}</strong>
                    <span>{item.end}</span>
                  </div>
                  <div className="class-info">
                    <h3>{item.title}</h3>
                    <p>
                      {item.code || tr(locale, '未提供课程代码', 'No course code')} <span>·</span> {item.teacher || tr(locale, '未提供教师', 'No instructor')}
                    </p>
                  </div>
                  <div className="room">{item.room || tr(locale, '未提供地点', 'TBA')}</div>
                </article>
              ))
            ) : (
              <p className="empty-state">{keyword ? tr(locale, '今日没有匹配搜索条件的课程', 'No matching classes today') : tr(locale, '今天没有课表记录', 'No classes scheduled today')}</p>
            )}
          </div>
        </section>

        <section className="panel deadlines">
          <div className="panel-head">
            <div>
              <h2>{tr(locale, '近期截止与考试倒计时', 'Upcoming Deadlines & Countdowns')}</h2>
              <p>{tr(locale, '融合 Moodle 作业与个人自建日程', 'Moodle assignments merged with personal countdowns')}</p>
            </div>
            <div className="head-inline-actions">
              {onOpenAddTask && (
                <button type="button" className="mini-action-btn" onClick={onOpenAddTask}>
                  <Plus size={12} /> {tr(locale, '新建倒计时', 'Add Task')}
                </button>
              )}
              <button className="text-btn" onClick={() => onNavigate('moodle')}>
                {tr(locale, '查看全部', 'All')} <span>→</span>
              </button>
            </div>
          </div>
          <div className="due-list">
            {dueTop.length ? (
              dueTop.map(item => {
                const badge = formatDueBadge(item.due, item.completed)
                const isUrgent = badge.tone === 'urgent'
                return (
                  <article
                    className="due-item clickable-row"
                    key={item.id}
                    onClick={() => {
                      if (item.isCustom && onToggleCustomTask) onToggleCustomTask(item.id)
                      else onSelectCourse(item.course)
                    }}
                  >
                    <span
                      className={`due-check ${isUrgent ? 'urgent' : ''} ${item.isCustom ? 'custom-check' : ''}`}
                      title={item.isCustom ? tr(locale, '点击标记完成', 'Click to toggle done') : undefined}
                    >
                      {isUrgent ? '!' : ''}
                    </span>
                    <div>
                      <h3>
                        {item.title}
                        {item.isCustom && item.category && (
                          <em className={`task-tag tag-${item.category}`}>{CATEGORY_LABELS[item.category]}</em>
                        )}
                      </h3>
                      <p>
                        {item.course}
                        {item.note ? ` · ${item.note}` : ''}
                      </p>
                    </div>
                    <time className={isUrgent ? 'urgent-text' : ''}>{badge.text}</time>
                  </article>
                )
              })
            ) : (
              <p className="empty-state">{keyword ? tr(locale, '没有匹配搜索条件的待办事项', 'No matching tasks') : tr(locale, '暂无未完成待办', 'All caught up!')}</p>
            )}
          </div>
          <button className="all-tasks" onClick={() => onNavigate('moodle')}>
            {tr(locale, '进入 Moodle 与待办管理', 'Open Moodle & GPA View')} <span>→</span>
          </button>
        </section>
      </div>

      {recentAnnouncements.length > 0 && (
        <section className="panel overview-announcements">
          <div className="panel-head">
            <div>
              <h2>{tr(locale, '最新公告', 'Recent Announcements')}</h2>
              <p>{tr(locale, '来自课程论坛与通知', 'From Moodle course forums')}</p>
            </div>
            <button className="text-btn" onClick={() => onNavigate('moodle')}>
              {tr(locale, '全部公告', 'All')} <span>→</span>
            </button>
          </div>
          <div className="due-list">
            {recentAnnouncements.map(item => {
              const safe = safeHkuUrl(item.url)
              return (
                <article className="due-item" key={item.id}>
                  <Bell size={15} className="announcement-icon" />
                  <div>
                    <h3>
                      {safe ? (
                        <a href={safe} target="_blank" rel="noreferrer">
                          {item.title} <ExternalLink size={11} />
                        </a>
                      ) : (
                        item.title
                      )}
                    </h3>
                    <p>{item.course}</p>
                  </div>
                  {item.published && <time>{item.published}</time>}
                </article>
              )
            })}
          </div>
        </section>
      )}

      <section className="panel quick">
        <div className="quick-title">
          <Sparkles size={18} />
          <div>
            <h2>{tr(locale, '学习快捷入口', 'Quick Shortcuts')}</h2>
            <p>{tr(locale, '按模块快速浏览课程与资料', 'Jump to courses, materials, or calendar')}</p>
          </div>
        </div>
        <div className="quick-actions">
          <button onClick={() => onNavigate('moodle')}>
            <BookOpen size={17} />
            <span>{tr(locale, 'Moodle 课程', 'Moodle & GPA')}</span>
            <small>{tr(locale, `${snapshot.courses.length} 门课程`, `${snapshot.courses.length} courses`)}</small>
          </button>
          <button onClick={() => onNavigate('materials')}>
            <Download size={17} />
            <span>{tr(locale, '课程资料', 'Materials')}</span>
            <small>{tr(locale, `${snapshot.resources.length} 份文件`, `${snapshot.resources.length} files`)}</small>
          </button>
          <button onClick={() => onNavigate('calendar')}>
            <CalendarDays size={17} />
            <span>{tr(locale, '周课表视图', 'Weekly Timetable')}</span>
            <small>{tr(locale, `${snapshot.schedule.length} 节记录`, `${snapshot.schedule.length} sessions`)}</small>
          </button>
          {onExportIcs && (
            <button onClick={onExportIcs}>
              <CalendarPlus size={17} />
              <span>{tr(locale, '导出 .ics 日历', 'Export .ics Calendar')}</span>
              <small>{tr(locale, '导入系统日历与提醒', 'Import to Apple/Google/Outlook')}</small>
            </button>
          )}
        </div>
      </section>
    </>
  )
}
// end OverviewPage
