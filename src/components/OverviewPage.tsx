import { useMemo } from 'react'
import { Bell, BookOpen, CalendarDays, Clock3, Download, ExternalLink, Link2, RefreshCw, ShieldCheck, Sparkles, Trophy } from 'lucide-react'
import { safeHkuUrl, type DataMode, type LiveSnapshot } from '../services/hku'
import { formatDueBadge, sortAssignmentsByDue, type NavTarget } from '../services/notifications'
import { todayClasses } from '../services/schedule'

export type ConnectionPhase = 'checking' | 'connected' | 'manual' | 'disconnected'

export function OverviewPage({
  snapshot,
  dataMode,
  query,
  error,
  connectionPhase,
  todayLabel,
  onNavigate,
  onSelectCourse,
  onRefresh,
}: {
  snapshot: LiveSnapshot | null
  dataMode: DataMode
  query: string
  error: string
  connectionPhase: ConnectionPhase
  todayLabel: { weekday: string; date: string }
  onNavigate: (target: NavTarget) => void
  onSelectCourse: (courseTitleOrId: string) => void
  onRefresh: () => void
}) {
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
    const incomplete = snapshot.assignments.filter(item => !item.completed)
    const filtered = keyword
      ? incomplete.filter(item => `${item.title} ${item.course}`.toLowerCase().includes(keyword))
      : incomplete
    return sortAssignmentsByDue(filtered)
  }, [snapshot, keyword])

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
            <small>今日课程</small>
            <strong>{classesToday.length} 节</strong>
          </div>
          <span className="stat-trend">{snapshot.schedule.length} 节已缓存</span>
        </div>

        <div className="stat-card" onClick={() => onNavigate('moodle')} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && onNavigate('moodle')}>
          <div className="stat-icon amber">
            <Clock3 size={18} />
          </div>
          <div>
            <small>待完成</small>
            <strong>{pendingAssignments.length} 项</strong>
          </div>
          {urgentCount > 0 && <span className="stat-trend amber-text">{urgentCount} 项临近截止</span>}
        </div>

        <div className="stat-card" onClick={() => onNavigate('moodle')} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && onNavigate('moodle')}>
          <div className="stat-icon green">
            <Trophy size={18} />
          </div>
          <div>
            <small>{dataMode === 'demo' ? '示例已发布成绩' : '已获取成绩'}</small>
            <strong>{releasedGradesCount} 项</strong>
          </div>
          <span className="stat-trend green-text">{snapshot.courses.length} 门课程</span>
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="panel schedule">
          <div className="panel-head">
            <div>
              <h2>今日课表</h2>
              <p>
                {todayLabel.date}，{todayLabel.weekday} · Asia/Hong_Kong
              </p>
            </div>
            <button className="text-btn" onClick={() => onNavigate('calendar')}>
              查看完整课表 <span>→</span>
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
                      {item.code || '未提供课程代码'} <span>·</span> {item.teacher || '未提供教师'}
                    </p>
                  </div>
                  <div className="room">{item.room || '未提供地点'}</div>
                </article>
              ))
            ) : (
              <p className="empty-state">{keyword ? '今日没有匹配搜索条件的课程' : '今天没有课表记录'}</p>
            )}
          </div>
        </section>

        <section className="panel deadlines">
          <div className="panel-head">
            <div>
              <h2>近期截止</h2>
              <p>来自 Moodle 的待办事项</p>
            </div>
            <button className="text-btn" onClick={() => onNavigate('moodle')}>
              查看全部 <span>→</span>
            </button>
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
                    onClick={() => onSelectCourse(item.course)}
                  >
                    <span className={`due-check ${isUrgent ? 'urgent' : ''}`}>{isUrgent ? '!' : ''}</span>
                    <div>
                      <h3>{item.title}</h3>
                      <p>{item.course}</p>
                    </div>
                    <time className={isUrgent ? 'urgent-text' : ''}>{badge.text}</time>
                  </article>
                )
              })
            ) : (
              <p className="empty-state">{keyword ? '没有匹配搜索条件的待办事项' : '暂无未完成待办'}</p>
            )}
          </div>
          <button className="all-tasks" onClick={() => onNavigate('moodle')}>
            进入 Moodle 课程视图 <span>→</span>
          </button>
        </section>
      </div>

      {recentAnnouncements.length > 0 && (
        <section className="panel overview-announcements">
          <div className="panel-head">
            <div>
              <h2>最新公告</h2>
              <p>来自课程论坛与通知</p>
            </div>
            <button className="text-btn" onClick={() => onNavigate('moodle')}>
              全部公告 <span>→</span>
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
            <h2>学习快捷入口</h2>
            <p>按模块快速浏览课程与资料</p>
          </div>
        </div>
        <div className="quick-actions">
          <button onClick={() => onNavigate('moodle')}>
            <BookOpen size={17} />
            <span>Moodle 课程</span>
            <small>{snapshot.courses.length} 门课程</small>
          </button>
          <button onClick={() => onNavigate('materials')}>
            <Download size={17} />
            <span>课程资料</span>
            <small>{snapshot.resources.length} 份文件</small>
          </button>
          <button onClick={() => onNavigate('calendar')}>
            <CalendarDays size={17} />
            <span>周课表视图</span>
            <small>{snapshot.schedule.length} 节记录</small>
          </button>
        </div>
      </section>
    </>
  )
}
