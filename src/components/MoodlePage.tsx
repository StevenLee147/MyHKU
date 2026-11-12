import { useMemo } from 'react'
import { ArrowLeft, Bell, BookOpen, ChevronRight, Download, ExternalLink, FileText, RefreshCw, Trophy } from 'lucide-react'
import { safeHkuUrl, type LiveCourse, type LiveSnapshot } from '../services/hku'
import { formatDueBadge, sortAssignmentsByDue } from '../services/notifications'

function matchesCourse(itemCourse: string, target: LiveCourse): boolean {
  const normalizedItem = itemCourse.trim().toLowerCase()
  const normalizedTitle = target.title.trim().toLowerCase()
  if (normalizedItem === normalizedTitle) return true
  if (normalizedItem.includes(normalizedTitle) || normalizedTitle.includes(normalizedItem)) return true
  if (target.code) {
    const code = target.code.trim().toLowerCase()
    if (code && normalizedItem.includes(code)) return true
  }
  return false
}

function formatGradeDisplay(grade: LiveSnapshot['grades'][number]): string {
  if (grade.released === false) return '未发布'
  if (grade.value !== undefined && grade.value.trim() !== '') return grade.value
  return '未获取'
}

export function MoodlePage({
  snapshot,
  query,
  selectedCourseId,
  onSelectCourse,
  onOpenMaterials,
  onRefresh,
}: {
  snapshot: LiveSnapshot
  query: string
  selectedCourseId: string | null
  onSelectCourse: (courseId: string | null) => void
  onOpenMaterials: () => void
  onRefresh: () => void
}) {
  const keyword = query.trim().toLowerCase()

  const filtered = useMemo(() => {
    const match = (text: string) => !keyword || text.toLowerCase().includes(keyword)
    return {
      courses: snapshot.courses.filter(c => match(`${c.title} ${c.code || ''}`)),
      assignments: sortAssignmentsByDue(snapshot.assignments.filter(a => match(`${a.title} ${a.course} ${a.submissionStatus || ''}`))),
      grades: snapshot.grades.filter(g => match(`${g.title} ${g.course} ${g.value || ''}`)),
      announcements: snapshot.announcements.filter(n => match(`${n.title} ${n.course}`)),
      resources: snapshot.resources.filter(r => match(`${r.title} ${r.course}`)),
    }
  }, [snapshot, keyword])

  const selectedCourse = useMemo(
    () => (selectedCourseId ? snapshot.courses.find(c => c.id === selectedCourseId || c.title === selectedCourseId) || null : null),
    [selectedCourseId, snapshot.courses],
  )

  if (selectedCourse) {
    const courseAssignments = sortAssignmentsByDue(snapshot.assignments.filter(item => matchesCourse(item.course, selectedCourse)))
    const courseAnnouncements = snapshot.announcements.filter(item => matchesCourse(item.course, selectedCourse))
    const courseGrades = snapshot.grades.filter(item => matchesCourse(item.course, selectedCourse))
    const courseResources = snapshot.resources.filter(item => matchesCourse(item.course, selectedCourse))

    return (
      <section className="panel live-page course-detail-page">
        <div className="panel-head">
          <div>
            <button type="button" className="back-inline-btn" onClick={() => onSelectCourse(null)}>
              <ArrowLeft size={14} /> 返回全部 Moodle 课程
            </button>
            <h2>
              {selectedCourse.title}
              {selectedCourse.code && !selectedCourse.title.includes(selectedCourse.code) ? ` · ${selectedCourse.code}` : ''}
            </h2>
            <p>
              {courseAssignments.filter(a => !a.completed).length} 项待完成作业 · {courseResources.length} 项资料 · {courseGrades.length} 项成绩记录
            </p>
          </div>
          <button className="text-btn" onClick={onRefresh}>
            <RefreshCw size={13} /> 刷新
          </button>
        </div>

        <div className="course-detail-grid">
          <div className="detail-section">
            <h3 className="subheading">作业与待办</h3>
            {courseAssignments.length ? (
              courseAssignments.map(item => {
                const badge = formatDueBadge(item.due, item.completed)
                return (
                  <div className="live-row" key={item.id}>
                    <span className={`due-check ${item.completed ? 'done' : badge.tone === 'urgent' ? 'urgent' : ''}`}>
                      {item.completed ? '✓' : badge.tone === 'urgent' ? '!' : ''}
                    </span>
                    <span>
                      <strong>{item.title}</strong>
                      <small>截止：{item.due || '未提供截止时间'}（{badge.text}）</small>
                      <small>{item.submissionStatus || (item.completed === true ? '已提交' : item.completed === false ? '未提交' : '提交状态未提供')}</small>
                    </span>
                  </div>
                )
              })
            ) : (
              <p className="empty-state">该课程暂无作业记录</p>
            )}
          </div>

          <div className="detail-section">
            <h3 className="subheading">课程成绩</h3>
            {courseGrades.length ? (
              courseGrades.map(item => (
                <div className="live-row" key={item.id}>
                  <Trophy size={15} />
                  <span>
                    <strong>{item.title}</strong>
                    <small className={item.released === false ? 'muted-tag' : 'grade-value-tag'}>
                      {formatGradeDisplay(item)}
                    </small>
                  </span>
                </div>
              ))
            ) : (
              <p className="empty-state">该课程暂无可见成绩</p>
            )}
          </div>

          <div className="detail-section">
            <div className="subheading-row">
              <h3 className="subheading">课程资料</h3>
              {courseResources.length > 0 && (
                <button type="button" className="text-btn" onClick={onOpenMaterials}>
                  前往下载页 →
                </button>
              )}
            </div>
            {courseResources.length ? (
              courseResources.map(item => {
                const safe = safeHkuUrl(item.url)
                return (
                  <div className="live-row" key={item.id}>
                    <FileText size={15} />
                    <span>
                      <strong>{item.title}</strong>
                    </span>
                    {safe && (
                      <button type="button" className="mini-action-btn" onClick={onOpenMaterials}>
                        <Download size={12} /> 管理下载
                      </button>
                    )}
                  </div>
                )
              })
            ) : (
              <p className="empty-state">该课程暂无资料</p>
            )}
          </div>

          <div className="detail-section">
            <h3 className="subheading">课程公告</h3>
            {courseAnnouncements.length ? (
              courseAnnouncements.map(item => {
                const safe = safeHkuUrl(item.url)
                return (
                  <div className="live-row" key={item.id}>
                    <Bell size={15} />
                    <span>
                      {safe ? (
                        <a href={safe} target="_blank" rel="noreferrer">
                          {item.title} <ExternalLink size={11} />
                        </a>
                      ) : (
                        item.title
                      )}
                      {item.published && <small>{item.published}</small>}
                    </span>
                  </div>
                )
              })
            ) : (
              <p className="empty-state">该课程暂无公告</p>
            )}
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="panel live-page">
      <div className="panel-head">
        <div>
          <h2>Moodle</h2>
          <p>
            {filtered.courses.length} 门课程（点击课程可按课程查看详情） · {filtered.assignments.filter(item => !item.completed).length} 项待办 · {filtered.grades.length} 项成绩
          </p>
        </div>
        <button className="text-btn" onClick={onRefresh}>
          <RefreshCw size={13} /> 刷新
        </button>
      </div>
      <div className="live-columns">
        <div>
          <h3 className="subheading">课程</h3>
          {filtered.courses.length ? (
            filtered.courses.map(item => (
              <button
                type="button"
                className="live-row course-select-row"
                key={item.id}
                onClick={() => onSelectCourse(item.id)}
              >
                <BookOpen size={15} />
                <span>
                  {item.title}
                  {item.code && !item.title.includes(item.code) ? ` · ${item.code}` : ''}
                </span>
                <ChevronRight size={14} className="row-chevron" />
              </button>
            ))
          ) : (
            <p className="empty-state">暂无课程</p>
          )}
        </div>
        <div>
          <h3 className="subheading">待办</h3>
          {filtered.assignments.length ? (
            filtered.assignments.map(item => {
              const badge = formatDueBadge(item.due, item.completed)
              return (
                <div className="live-row" key={item.id}>
                  <span className={`due-check ${item.completed ? 'done' : badge.tone === 'urgent' ? 'urgent' : ''}`}>
                    {item.completed ? '✓' : badge.tone === 'urgent' ? '!' : ''}
                  </span>
                  <span>
                    {item.title}
                    <small>{item.course}</small>
                    <small>截止：{item.due || '未提供截止时间'}</small>
                    <small>{item.submissionStatus || (item.completed === true ? '已提交' : item.completed === false ? '未提交' : '提交状态未提供')}</small>
                  </span>
                </div>
              )
            })
          ) : (
            <p className="empty-state">暂无待办</p>
          )}
        </div>
        <div>
          <h3 className="subheading">成绩</h3>
          {filtered.grades.length ? (
            filtered.grades.map(item => (
              <div className="live-row" key={item.id}>
                <Trophy size={15} />
                <span>
                  {item.title}
                  <small>
                    {item.course} · {formatGradeDisplay(item)}
                  </small>
                </span>
              </div>
            ))
          ) : (
            <p className="empty-state">暂无可见成绩</p>
          )}
        </div>
      </div>
      <div className="live-announcements">
        <h3 className="subheading">公告</h3>
        {filtered.announcements.length ? (
          filtered.announcements.slice(0, 12).map(item => {
            const safe = safeHkuUrl(item.url)
            return (
              <div className="live-row" key={item.id}>
                <Bell size={15} />
                <span>
                  {safe ? (
                    <a href={safe} target="_blank" rel="noreferrer">
                      {item.title}
                    </a>
                  ) : (
                    item.title
                  )}
                  <small>
                    {item.course}
                    {item.published ? ` · ${item.published}` : ''}
                  </small>
                </span>
              </div>
            )
          })
        ) : (
          <p className="empty-state">暂无公告</p>
        )}
      </div>
    </section>
  )
}
