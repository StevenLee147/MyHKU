import { useMemo, useState } from 'react'
import { ArrowLeft, Bell, BookOpen, Calculator, ChevronRight, Download, Edit3, ExternalLink, FileText, Plus, RefreshCw, Trash2, Trophy } from 'lucide-react'
import { CATEGORY_LABELS, mergeWithCustomTasks, type CustomTask, type UnifiedAssignment } from '../services/customTasks'
import { safeHkuUrl, type LiveCourse, type LiveSnapshot } from '../services/hku'
import { tr, type Locale } from '../services/i18n'
import { cleanDueDisplay, formatDueBadge, formatSubmissionStatusLabel, sortAssignmentsByDue } from '../services/notifications'
import { GpaSimulatorPanel } from './GpaSimulatorPanel'
// imports updated

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

function formatGradeDisplay(grade: LiveSnapshot['grades'][number], locale: Locale): string {
  if (grade.released === false) return tr(locale, '未发布', 'Unreleased')
  if (grade.value !== undefined && grade.value.trim() !== '') return grade.value
  return tr(locale, '未获取', 'Unavailable')
}

export function MoodlePage({
  locale = 'zh',
  snapshot,
  customTasks = [],
  query,
  selectedCourseId,
  onSelectCourse,
  onOpenMaterials,
  onRefresh,
  onOpenAddTask,
  onToggleCustomTask,
  onEditCustomTask,
  onDeleteCustomTask,
}: {
  locale?: Locale
  snapshot: LiveSnapshot
  customTasks?: CustomTask[]
  query: string
  selectedCourseId: string | null
  onSelectCourse: (courseId: string | null) => void
  onOpenMaterials: () => void
  onRefresh: () => void
  onOpenAddTask?: (defaultCourse?: string) => void
  onToggleCustomTask?: (id: string) => void
  onEditCustomTask?: (task: CustomTask) => void
  onDeleteCustomTask?: (id: string) => void
}) {
  const [showGpa, setShowGpa] = useState(true)
  const keyword = query.trim().toLowerCase()
  // state ready

  const unifiedAll = useMemo(() => mergeWithCustomTasks(snapshot.assignments, customTasks), [snapshot.assignments, customTasks])

  const filtered = useMemo(() => {
    const match = (text: string) => !keyword || text.toLowerCase().includes(keyword)
    return {
      courses: snapshot.courses.filter(c => match(`${c.title} ${c.code || ''}`)),
      assignments: sortAssignmentsByDue(unifiedAll.filter(a => match(`${a.title} ${a.course} ${a.submissionStatus || ''} ${a.note || ''}`))) as UnifiedAssignment[],
      grades: snapshot.grades.filter(g => match(`${g.title} ${g.course} ${g.value || ''}`)),
      announcements: snapshot.announcements.filter(n => match(`${n.title} ${n.course}`)),
      resources: snapshot.resources.filter(r => match(`${r.title} ${r.course}`)),
    }
  }, [snapshot, unifiedAll, keyword])

  const selectedCourse = useMemo(
    () => (selectedCourseId ? snapshot.courses.find(c => c.id === selectedCourseId || c.title === selectedCourseId) || null : null),
    [selectedCourseId, snapshot.courses],
  )

  const renderTaskRow = (item: UnifiedAssignment, showCourseName: boolean) => {
    const badge = formatDueBadge(item.due, item.completed)
    const rawCustom = item.isCustom ? customTasks.find(t => t.id === item.id) : undefined
    return (
      <div className="live-row" key={item.id}>
        <button
          type="button"
          className={`due-check due-check-btn ${item.completed ? 'done' : badge.tone === 'urgent' ? 'urgent' : ''}`}
          disabled={!item.isCustom || !onToggleCustomTask}
          aria-label={item.isCustom ? (item.completed ? '标记为未完成' : '标记为已完成') : '官方作业状态'}
          onClick={() => item.isCustom && onToggleCustomTask?.(item.id)}
        >
          {item.completed ? '✓' : badge.tone === 'urgent' ? '!' : ''}
        </button>
        <span>
          <strong>
            {item.title}
            {item.isCustom && item.category && (
              <em className={`task-tag tag-${item.category}`}>{CATEGORY_LABELS[item.category]}</em>
            )}
          </strong>
          {showCourseName && <small>{item.course}</small>}
          <small>截止：{cleanDueDisplay(item.due)}（{badge.text}）</small>
          <small>{item.isCustom ? (item.submissionStatus || '自建事项') : formatSubmissionStatusLabel(item.submissionStatus, item.completed)}</small>
        </span>
        {item.isCustom && (
          <div className="task-row-actions">
            {rawCustom && onEditCustomTask && (
              <button type="button" className="icon-inline-btn" aria-label="编辑自建事项" onClick={() => onEditCustomTask(rawCustom)}>
                <Edit3 size={12} />
              </button>
            )}
            {onDeleteCustomTask && (
              <button type="button" className="icon-inline-btn danger" aria-label="删除自建事项" onClick={() => onDeleteCustomTask(item.id)}>
                <Trash2 size={12} />
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  if (selectedCourse) {
    const courseAssignments = sortAssignmentsByDue(unifiedAll.filter(item => matchesCourse(item.course, selectedCourse))) as UnifiedAssignment[]
    const courseAnnouncements = snapshot.announcements.filter(item => matchesCourse(item.course, selectedCourse))
    const courseGrades = snapshot.grades.filter(item => matchesCourse(item.course, selectedCourse))
    const courseResources = snapshot.resources.filter(item => matchesCourse(item.course, selectedCourse))

    return (
      <section className="panel live-page course-detail-page">
        <div className="panel-head">
          <div>
            <button type="button" className="back-inline-btn" onClick={() => onSelectCourse(null)}>
              <ArrowLeft size={14} /> {tr(locale, '返回全部 Moodle 课程', 'Back to All Courses')}
            </button>
            <h2>
              {selectedCourse.title}
              {selectedCourse.code && !selectedCourse.title.includes(selectedCourse.code) ? ` · ${selectedCourse.code}` : ''}
            </h2>
            <p>
              {tr(
                locale,
                `${courseAssignments.filter(a => !a.completed).length} 项待完成事项 · ${courseResources.length} 项资料 · ${courseGrades.length} 项成绩记录`,
                `${courseAssignments.filter(a => !a.completed).length} pending · ${courseResources.length} materials · ${courseGrades.length} grades`,
              )}
            </p>
          </div>
          <div className="head-inline-actions">
            {onOpenAddTask && (
              <button type="button" className="mini-action-btn" onClick={() => onOpenAddTask(selectedCourse.code || selectedCourse.title)}>
                <Plus size={12} /> {tr(locale, '添加本课倒计时', 'Add Task')}
              </button>
            )}
            <button className="text-btn" onClick={onRefresh}>
              <RefreshCw size={13} /> {tr(locale, '刷新', 'Refresh')}
            </button>
          </div>
        </div>

        <GpaSimulatorPanel
          locale={locale}
          courses={snapshot.courses}
          selectedCourse={selectedCourse}
          courseGrades={courseGrades}
        />

        <div className="course-detail-grid">
          <div className="detail-section">
            <h3 className="subheading">{tr(locale, '作业与待办', 'Assignments & Tasks')}</h3>
            {courseAssignments.length ? (
              courseAssignments.map(item => renderTaskRow(item, false))
            ) : (
              <p className="empty-state">{tr(locale, '该课程暂无作业记录', 'No assignments recorded')}</p>
            )}
          </div>

          <div className="detail-section">
            <h3 className="subheading">{tr(locale, '课程成绩', 'Course Grades')}</h3>
            {courseGrades.length ? (
              courseGrades.map(item => (
                <div className="live-row" key={item.id}>
                  <Trophy size={15} />
                  <span>
                    <strong>{item.title}</strong>
                    <small className={item.released === false ? 'muted-tag' : 'grade-value-tag'}>
                      {formatGradeDisplay(item, locale)}
                    </small>
                  </span>
                </div>
              ))
            ) : (
              <p className="empty-state">{tr(locale, '该课程暂无可见成绩', 'No released grades yet')}</p>
            )}
          </div>

          <div className="detail-section">
            <div className="subheading-row">
              <h3 className="subheading">{tr(locale, '课程资料', 'Course Materials')}</h3>
              {courseResources.length > 0 && (
                <button type="button" className="text-btn" onClick={onOpenMaterials}>
                  {tr(locale, '前往下载页 →', 'Materials →')}
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
                        <Download size={12} /> {tr(locale, '管理下载', 'Downloads')}
                      </button>
                    )}
                  </div>
                )
              })
            ) : (
              <p className="empty-state">{tr(locale, '该课程暂无资料', 'No materials available')}</p>
            )}
          </div>

          <div className="detail-section">
            <h3 className="subheading">{tr(locale, '课程公告', 'Announcements')}</h3>
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
              <p className="empty-state">{tr(locale, '该课程暂无公告', 'No announcements')}</p>
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
          <h2>{tr(locale, 'Moodle', 'Moodle & GPA')}</h2>
          <p>
            {tr(
              locale,
              `${filtered.courses.length} 门课程（点击课程可按课程查看详情） · ${filtered.assignments.filter(item => !item.completed).length} 项待办 · ${filtered.grades.length} 项成绩`,
              `${filtered.courses.length} courses (click for details & What-if) · ${filtered.assignments.filter(item => !item.completed).length} pending · ${filtered.grades.length} grades`,
            )}
          </p>
        </div>
        <div className="head-inline-actions">
          <button type="button" className="mini-action-btn" onClick={() => setShowGpa(prev => !prev)}>
            <Calculator size={12} /> {showGpa ? tr(locale, '收起 GPA 模拟', 'Hide GPA Sim') : tr(locale, 'GPA 模拟器', 'GPA Simulator')}
          </button>
          <button className="text-btn" onClick={onRefresh}>
            <RefreshCw size={13} /> {tr(locale, '刷新', 'Refresh')}
          </button>
        </div>
      </div>

      {showGpa && (
        <GpaSimulatorPanel locale={locale} courses={snapshot.courses} selectedCourse={null} />
      )}

      <div className="live-columns">
        <div>
          <h3 className="subheading">{tr(locale, '课程', 'Courses')}</h3>
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
            <p className="empty-state">{tr(locale, '暂无课程', 'No courses')}</p>
          )}
        </div>
        <div>
          <div className="subheading-row">
            <h3 className="subheading">{tr(locale, '待办与倒计时', 'Tasks & Countdowns')}</h3>
            {onOpenAddTask && (
              <button type="button" className="text-btn" onClick={() => onOpenAddTask()}>
                <Plus size={12} /> {tr(locale, '新建', 'New')}
              </button>
            )}
          </div>
          {filtered.assignments.length ? (
            filtered.assignments.map(item => renderTaskRow(item, true))
          ) : (
            <p className="empty-state">{tr(locale, '暂无待办', 'No pending tasks')}</p>
          )}
        </div>
        <div>
          <h3 className="subheading">{tr(locale, '成绩', 'Grades')}</h3>
          {filtered.grades.length ? (
            filtered.grades.map(item => (
              <div className="live-row" key={item.id}>
                <Trophy size={15} />
                <span>
                  {item.title}
                  <small>
                    {item.course} · {formatGradeDisplay(item, locale)}
                  </small>
                </span>
              </div>
            ))
          ) : (
            <p className="empty-state">{tr(locale, '暂无可见成绩', 'No released grades')}</p>
          )}
        </div>
      </div>
      <div className="live-announcements">
        <h3 className="subheading">{tr(locale, '公告', 'Announcements')}</h3>
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
          <p className="empty-state">{tr(locale, '暂无公告', 'No announcements')}</p>
        )}
      </div>
    </section>
  )
}
// end MoodlePage
