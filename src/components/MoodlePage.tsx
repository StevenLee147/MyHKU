import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  ArrowLeft,
  Bell,
  BookOpen,
  Calculator,
  ChevronRight,
  Download,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Star,
  Trash2,
  Trophy,
  X,
} from 'lucide-react'
import { CATEGORY_LABELS, mergeWithCustomTasks, type CustomTask, type UnifiedAssignment } from '../services/customTasks'
import { enqueueDownloadTask } from '../services/downloadQueue'
import { safeHkuUrl, type DataMode, type LiveResource, type LiveSnapshot } from '../services/hku'
import { tr, type Locale } from '../services/i18n'
import { getWebFallbackStoragePrefs, isDirectDownloadableUrl } from '../services/materials'
import {
  defaultMoodleCoursePrefs,
  enrichMoodleCourses,
  matchesMoodleCourseItem,
  matchesMoodleQuery,
  setSingleCourseVisibility,
  togglePinnedMoodleCourse,
  type EnrichedMoodleCourse,
  type MoodleCourseKindFilter,
  type MoodleCoursePrefs,
  type MoodleCourseSortMode,
  type MoodleSearchScope,
} from '../services/moodleCourses'
import { cleanDueDisplay, formatDueBadge, formatSubmissionStatusLabel, sortAssignmentsByDue } from '../services/notifications'
import { GpaSimulatorPanel } from './GpaSimulatorPanel'

function formatGradeDisplay(grade: LiveSnapshot['grades'][number], locale: Locale): string {
  if (grade.released === false) return tr(locale, '未发布', 'Unreleased')
  if (grade.value !== undefined && grade.value.trim() !== '') return grade.value
  return tr(locale, '未获取', 'Unavailable')
}

export function MoodlePage({
  locale = 'zh',
  snapshot,
  rawSnapshot,
  coursePrefs = defaultMoodleCoursePrefs(),
  onChangeCoursePrefs,
  onOpenCourseSelector,
  customTasks = [],
  query,
  dataMode = 'live',
  selectedCourseId,
  onSelectCourse,
  onOpenMaterials,
  onOpenDownloads,
  onNotice,
  onRefresh,
  onOpenAddTask,
  onToggleCustomTask,
  onEditCustomTask,
  onDeleteCustomTask,
}: {
  locale?: Locale
  snapshot: LiveSnapshot
  rawSnapshot?: LiveSnapshot
  dataMode?: DataMode
  coursePrefs?: MoodleCoursePrefs
  onChangeCoursePrefs?: (next: MoodleCoursePrefs) => void
  onOpenCourseSelector?: () => void
  customTasks?: CustomTask[]
  query: string
  selectedCourseId: string | null
  onSelectCourse: (courseId: string | null) => void
  onOpenMaterials: () => void
  onOpenDownloads?: () => void
  onNotice?: (message: string) => void
  onRefresh: () => void
  onOpenAddTask?: (defaultCourse?: string) => void
  onToggleCustomTask?: (id: string) => void
  onEditCustomTask?: (task: CustomTask) => void
  onDeleteCustomTask?: (id: string) => void
}) {
  const handleQuickDownloadResource = (item: LiveResource) => {
    const safe = safeHkuUrl(item.url)
    if (!safe || !isDirectDownloadableUrl(safe)) {
      onOpenMaterials()
      return
    }
    const { deduplicated } = enqueueDownloadTask({
      resource: item,
      url: safe,
      organizeMode: getWebFallbackStoragePrefs().organizeMode,
      dataMode,
    })
    onNotice?.(
      deduplicated
        ? tr(locale, `「${item.title}」已在下载队列中`, `${item.title} is already in the download queue`)
        : tr(locale, `已加入下载队列：${item.title}`, `Added to download queue: ${item.title}`),
    )
    if (onOpenDownloads && deduplicated) onOpenDownloads()
  }
  const [showGpa, setShowGpa] = useState(true)
  const [localQuery, setLocalQuery] = useState('')
  const [scope, setScope] = useState<MoodleSearchScope>('all')
  const [kindFilter, setKindFilter] = useState<MoodleCourseKindFilter>('all')
  const [termFilter, setTermFilter] = useState('all')
  const [sortMode, setSortMode] = useState<MoodleCourseSortMode>('smart')
  const [pendingOnly, setPendingOnly] = useState(false)
  const [includeHidden, setIncludeHidden] = useState(false)

  const searchInputId = useId()
  const lastCompEndRef = useRef<number | null>(null)
  const fullSnapshot = rawSnapshot || snapshot
  const effectiveQuery = [query.trim(), localQuery.trim()].filter(Boolean).join(' ')

  const allEnrichedCourses = useMemo(() => enrichMoodleCourses(fullSnapshot.courses, coursePrefs), [fullSnapshot.courses, coursePrefs])
  const visibleEnrichedCourses = useMemo(() => allEnrichedCourses.filter(c => c.isVisible), [allEnrichedCourses])
  const hiddenCount = allEnrichedCourses.length - visibleEnrichedCourses.length
  const activeSourceSnapshot = includeHidden ? fullSnapshot : snapshot
  const activeCoursesPool = includeHidden ? allEnrichedCourses : visibleEnrichedCourses

  const availableTerms = useMemo(() => {
    const set = new Set<string>()
    for (const c of allEnrichedCourses) if (c.term) set.add(c.term)
    return [...set].sort((a, b) => b.localeCompare(a))
  }, [allEnrichedCourses])

  const unifiedActive = useMemo(() => mergeWithCustomTasks(activeSourceSnapshot.assignments, customTasks), [activeSourceSnapshot.assignments, customTasks])

  const pendingCountByCourseId = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of allEnrichedCourses) {
      map.set(c.id, unifiedActive.filter(item => !item.completed && matchesMoodleCourseItem(item, c, allEnrichedCourses)).length)
    }
    return map
  }, [allEnrichedCourses, unifiedActive])

  const filtered = useMemo(() => {
    const scopedCourses = activeCoursesPool.filter(c => {
      if (kindFilter === 'main' && (c.isSubclass || c.isNonAcademic)) return false
      if (kindFilter === 'subclass' && !c.isSubclass) return false
      if (kindFilter === 'starred' && !c.isPinned) return false
      if (termFilter !== 'all' && c.term !== termFilter) return false
      return true
    })
    const hasCourseMetaFilter = kindFilter !== 'all' || termFilter !== 'all'
    const inScopedCourses = (item: { course: string; courseId?: string }) =>
      !hasCourseMetaFilter || scopedCourses.some(c => matchesMoodleCourseItem(item, c, allEnrichedCourses))

    const matchedCourses = scopedCourses
      .filter(c => matchesMoodleQuery(effectiveQuery, c.title, c.code, c.shortname, c.section, c.term, c.category))
      .sort((a, b) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
        if (sortMode === 'code') return (a.code || a.title).localeCompare(b.code || b.title)
        if (sortMode === 'tasks') {
          const diff = (pendingCountByCourseId.get(b.id) || 0) - (pendingCountByCourseId.get(a.id) || 0)
          if (diff !== 0) return diff
        }
        if (a.isSubclass !== b.isSubclass) return a.isSubclass ? 1 : -1
        if (a.isNonAcademic !== b.isNonAcademic) return a.isNonAcademic ? 1 : -1
        const pDiff = (pendingCountByCourseId.get(b.id) || 0) - (pendingCountByCourseId.get(a.id) || 0)
        return pDiff !== 0 ? pDiff : (a.code || a.title).localeCompare(b.code || b.title)
      })

    const matchedAssignments = sortAssignmentsByDue(
      unifiedActive.filter(a => (!pendingOnly || !a.completed) && inScopedCourses(a) && matchesMoodleQuery(effectiveQuery, a.title, a.course, a.submissionStatus, a.note, a.due)),
    ) as UnifiedAssignment[]

    return {
      courses: matchedCourses,
      assignments: matchedAssignments,
      grades: activeSourceSnapshot.grades.filter(g => inScopedCourses(g) && matchesMoodleQuery(effectiveQuery, g.title, g.course, g.value)),
      announcements: activeSourceSnapshot.announcements.filter(n => inScopedCourses(n) && matchesMoodleQuery(effectiveQuery, n.title, n.course, n.published)),
      resources: activeSourceSnapshot.resources.filter(r => inScopedCourses(r) && matchesMoodleQuery(effectiveQuery, r.title, r.course)),
    }
  }, [activeCoursesPool, activeSourceSnapshot, allEnrichedCourses, effectiveQuery, kindFilter, pendingCountByCourseId, pendingOnly, sortMode, termFilter, unifiedActive])

  const hiddenSearchMatchesCount = useMemo(() => {
    if (includeHidden || !effectiveQuery || hiddenCount === 0) return 0
    const hiddenPool = allEnrichedCourses.filter(c => !c.isVisible)
    const belongsToHidden = (item: { course: string; courseId?: string }) => hiddenPool.some(c => matchesMoodleCourseItem(item, c, allEnrichedCourses))
    return (
      hiddenPool.filter(c => matchesMoodleQuery(effectiveQuery, c.title, c.code, c.shortname, c.section, c.term, c.category)).length +
      fullSnapshot.assignments.filter(a => belongsToHidden(a) && matchesMoodleQuery(effectiveQuery, a.title, a.course, a.submissionStatus)).length +
      fullSnapshot.resources.filter(r => belongsToHidden(r) && matchesMoodleQuery(effectiveQuery, r.title, r.course)).length
    )
  }, [allEnrichedCourses, effectiveQuery, fullSnapshot.assignments, fullSnapshot.resources, hiddenCount, includeHidden])

  const selectedCourse: EnrichedMoodleCourse | null = useMemo(
    () => (selectedCourseId ? allEnrichedCourses.find(c => c.id === selectedCourseId || c.title === selectedCourseId || c.code === selectedCourseId) || null : null),
    [selectedCourseId, allEnrichedCourses],
  )

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (event.nativeEvent.isComposing || event.keyCode === 229) return
      if (lastCompEndRef.current !== null && Math.abs(event.timeStamp - lastCompEndRef.current) < 50) return
    }
  }

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
    const unifiedForDetail = mergeWithCustomTasks(fullSnapshot.assignments, customTasks)
    const courseAssignments = sortAssignmentsByDue(
      unifiedForDetail.filter(
        item =>
          matchesMoodleCourseItem(item, selectedCourse, allEnrichedCourses) &&
          matchesMoodleQuery(effectiveQuery, item.title, item.submissionStatus, item.note, item.due),
      ),
    ) as UnifiedAssignment[]
    const courseAnnouncements = fullSnapshot.announcements.filter(
      item => matchesMoodleCourseItem(item, selectedCourse, allEnrichedCourses) && matchesMoodleQuery(effectiveQuery, item.title, item.published),
    )
    const courseGrades = fullSnapshot.grades.filter(
      item => matchesMoodleCourseItem(item, selectedCourse, allEnrichedCourses) && matchesMoodleQuery(effectiveQuery, item.title, item.value),
    )
    const courseResources = fullSnapshot.resources.filter(
      item => matchesMoodleCourseItem(item, selectedCourse, allEnrichedCourses) && matchesMoodleQuery(effectiveQuery, item.title),
    )

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
              {selectedCourse.isSubclass && (
                <em className="course-badge subclass inline-head-badge">
                  {selectedCourse.section ? `Subclass ${selectedCourse.section}` : 'Subclass'}
                </em>
              )}
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
            {onChangeCoursePrefs && (
              <button
                type="button"
                className="mini-action-btn"
                onClick={() => {
                  const nextVisible = !selectedCourse.isVisible
                  onChangeCoursePrefs(setSingleCourseVisibility(coursePrefs, selectedCourse.id, nextVisible))
                  if (!nextVisible) onSelectCourse(null)
                }}
              >
                {selectedCourse.isVisible ? <EyeOff size={12} /> : <Eye size={12} />}{' '}
                {selectedCourse.isVisible ? tr(locale, '隐藏此课', 'Hide Course') : tr(locale, '恢复显示', 'Unhide Course')}
              </button>
            )}
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

        <div className="moodle-search-toolbar compact-detail-search">
          <label className="moodle-inline-search" htmlFor={searchInputId}>
            <Search size={15} />
            <input
              id={searchInputId}
              type="search"
              value={localQuery}
              onChange={e => setLocalQuery(e.target.value)}
              onCompositionEnd={e => { lastCompEndRef.current = e.timeStamp }}
              onKeyDown={handleSearchKeyDown}
              placeholder={tr(locale, '在本课程内检索作业、课件、成绩或公告…', 'Search tasks, materials, grades or notices in this course…')}
            />
            {localQuery && (
              <button type="button" className="clear-search-btn" aria-label="Clear" onClick={() => setLocalQuery('')}>
                <X size={13} />
              </button>
            )}
          </label>
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
                      isDirectDownloadableUrl(safe) ? (
                        <button type="button" className="mini-action-btn" onClick={() => handleQuickDownloadResource(item)}>
                          <Download size={12} /> {tr(locale, '下载', 'Download')}
                        </button>
                      ) : (
                        <a href={safe} target="_blank" rel="noreferrer" className="mini-action-btn dl-ext-link">
                          <ExternalLink size={12} /> {tr(locale, '查看', 'Open')}
                        </a>
                      )
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

  const showCoursesCol = scope === 'all' || scope === 'courses'
  const showTasksCol = scope === 'all' || scope === 'assignments'
  const showGradesCol = scope === 'all' || scope === 'grades'
  const showResourcesSection = scope === 'resources' || (scope === 'all' && Boolean(effectiveQuery) && filtered.resources.length > 0)
  const showAnnouncementsSection = scope === 'all' || scope === 'announcements'

  return (
    <section className="panel live-page">
      <div className="panel-head">
        <div>
          <h2>{tr(locale, 'Moodle', 'Moodle & GPA')}</h2>
          <p>
            {tr(
              locale,
              `${filtered.courses.length} 门显示课程${hiddenCount > 0 && !includeHidden ? `（已隐藏 ${hiddenCount} 门）` : ''} · ${filtered.assignments.filter(item => !item.completed).length} 项待办 · ${filtered.resources.length} 份资料 · ${filtered.grades.length} 项成绩`,
              `${filtered.courses.length} courses shown${hiddenCount > 0 && !includeHidden ? ` (${hiddenCount} hidden)` : ''} · ${filtered.assignments.filter(item => !item.completed).length} pending · ${filtered.resources.length} files · ${filtered.grades.length} grades`,
            )}
          </p>
        </div>
        <div className="head-inline-actions">
          {onOpenCourseSelector && (
            <button type="button" className="mini-action-btn manage-courses-btn" onClick={onOpenCourseSelector}>
              <SlidersHorizontal size={12} />{' '}
              {tr(locale, `管理显示课程 (${visibleEnrichedCourses.length}/${allEnrichedCourses.length})`, `Manage Courses (${visibleEnrichedCourses.length}/${allEnrichedCourses.length})`)}
            </button>
          )}
          <button type="button" className="mini-action-btn" onClick={() => setShowGpa(prev => !prev)}>
            <Calculator size={12} /> {showGpa ? tr(locale, '收起 GPA 模拟', 'Hide GPA Sim') : tr(locale, 'GPA 模拟器', 'GPA Simulator')}
          </button>
          <button className="text-btn" onClick={onRefresh}>
            <RefreshCw size={13} /> {tr(locale, '刷新', 'Refresh')}
          </button>
        </div>
      </div>

      <div className="moodle-search-toolbar">
        <div className="moodle-search-row">
          <label className="moodle-inline-search" htmlFor={searchInputId}>
            <Search size={15} />
            <input
              id={searchInputId}
              type="search"
              value={localQuery}
              onChange={e => setLocalQuery(e.target.value)}
              onCompositionEnd={e => { lastCompEndRef.current = e.timeStamp }}
              onKeyDown={handleSearchKeyDown}
              placeholder={tr(locale, '多关键词检索 Moodle（如 GLIS 1901 essay、COMP7901 slides、Subclass 1A）…', 'Multi-keyword Moodle search (e.g. GLIS 1901 essay, COMP7901 slides, Subclass)…')}
            />
            {localQuery && (
              <button type="button" className="clear-search-btn" aria-label="Clear" onClick={() => setLocalQuery('')}>
                <X size={13} />
              </button>
            )}
          </label>

          {availableTerms.length > 1 && (
            <select className="moodle-mini-select" aria-label={tr(locale, '按学期筛选', 'Filter by term')} value={termFilter} onChange={e => setTermFilter(e.target.value)}>
              <option value="all">{tr(locale, '全部学期', 'All Terms')}</option>
              {availableTerms.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}

          <select className="moodle-mini-select" aria-label={tr(locale, '课程排序方式', 'Sort courses')} value={sortMode} onChange={e => setSortMode(e.target.value as MoodleCourseSortMode)}>
            <option value="smart">{tr(locale, '排序：星标与主课优先', 'Sort: Smart')}</option>
            <option value="code">{tr(locale, '排序：课程代码 A–Z', 'Sort: Code A–Z')}</option>
            <option value="tasks">{tr(locale, '排序：待办数量优先', 'Sort: Pending Tasks')}</option>
          </select>
        </div>

        <div className="moodle-filter-pills">
          <div className="pill-group" role="tablist" aria-label={tr(locale, '检索范围', 'Search scope')}>
            {([
              { key: 'all', zh: '全部模块', en: 'All' },
              { key: 'courses', zh: `课程 (${filtered.courses.length})`, en: `Courses (${filtered.courses.length})` },
              { key: 'assignments', zh: `待办 (${filtered.assignments.length})`, en: `Tasks (${filtered.assignments.length})` },
              { key: 'resources', zh: `资料 (${filtered.resources.length})`, en: `Files (${filtered.resources.length})` },
              { key: 'grades', zh: `成绩 (${filtered.grades.length})`, en: `Grades (${filtered.grades.length})` },
              { key: 'announcements', zh: `公告 (${filtered.announcements.length})`, en: `Notices (${filtered.announcements.length})` },
            ] as const).map(item => (
              <button key={item.key} type="button" role="tab" aria-selected={scope === item.key} className={`filter-pill ${scope === item.key ? 'active' : ''}`} onClick={() => setScope(item.key)}>
                {locale === 'en' ? item.en : item.zh}
              </button>
            ))}
          </div>

          <div className="pill-group secondary-pills">
            {([
              { key: 'all', zh: '全部已选', en: 'All Selected' },
              { key: 'main', zh: '仅常规主课', en: 'Main Only' },
              { key: 'subclass', zh: '仅 Subclass', en: 'Subclasses' },
              { key: 'starred', zh: '★ 星标', en: '★ Starred' },
            ] as const).map(item => (
              <button key={item.key} type="button" className={`filter-pill subtle ${kindFilter === item.key ? 'active' : ''}`} onClick={() => setKindFilter(item.key)}>
                {locale === 'en' ? item.en : item.zh}
              </button>
            ))}
            <button type="button" className={`filter-pill subtle ${pendingOnly ? 'active' : ''}`} onClick={() => setPendingOnly(prev => !prev)}>
              {tr(locale, '仅未完成待办', 'Incomplete Only')}
            </button>
            {hiddenCount > 0 && (
              <button type="button" className={`filter-pill subtle ${includeHidden ? 'active' : ''}`} onClick={() => setIncludeHidden(prev => !prev)}>
                {includeHidden ? <Eye size={11} /> : <EyeOff size={11} />} {tr(locale, `包含已隐藏 (${hiddenCount})`, `Include Hidden (${hiddenCount})`)}
              </button>
            )}
          </div>
        </div>

        {hiddenSearchMatchesCount > 0 && (
          <div className="hidden-match-banner">
            <span>{tr(locale, `在已隐藏的 Subclass / 课程中还找到 ${hiddenSearchMatchesCount} 项匹配结果`, `Found ${hiddenSearchMatchesCount} additional matches inside hidden courses`)}</span>
            <button type="button" className="text-btn" onClick={() => setIncludeHidden(true)}>
              {tr(locale, '临时展开查看', 'Show Hidden Matches')}
            </button>
          </div>
        )}
      </div>

      {showGpa && scope === 'all' && <GpaSimulatorPanel locale={locale} courses={snapshot.courses} selectedCourse={null} />}

      {(showCoursesCol || showTasksCol || showGradesCol) && (
        <div className={`live-columns ${scope !== 'all' ? 'single-scope-columns' : ''}`}>
          {showCoursesCol && (
            <div>
              <div className="subheading-row">
                <h3 className="subheading">{tr(locale, '课程', 'Courses')}</h3>
                {onOpenCourseSelector && (
                  <button type="button" className="text-btn" onClick={onOpenCourseSelector}>
                    {tr(locale, '选择显示课程', 'Select')}
                  </button>
                )}
              </div>
              {filtered.courses.length ? (
                filtered.courses.map(item => {
                  const pendingForCourse = pendingCountByCourseId.get(item.id) || 0
                  return (
                    <div className={`course-row-shell ${item.isVisible ? '' : 'temp-revealed'}`} key={item.id}>
                      <button type="button" className="live-row course-select-row" onClick={() => onSelectCourse(item.id)}>
                        <BookOpen size={15} />
                        <span className="course-row-body">
                          <span className="course-row-title">
                            {item.title}
                            {item.code && !item.title.includes(item.code) ? ` · ${item.code}` : ''}
                          </span>
                          <span className="course-meta-badges">
                            {item.isSubclass && <em className="course-badge subclass">{item.section ? `Subclass ${item.section}` : 'Subclass'}</em>}
                            {item.isNonAcademic && <em className="course-badge admin">{tr(locale, '系统/培训', 'Admin')}</em>}
                            {!item.isVisible && <em className="course-badge muted">{tr(locale, '已隐藏', 'Hidden')}</em>}
                            {pendingForCourse > 0 && <em className="course-badge pending">{tr(locale, `${pendingForCourse} 待办`, `${pendingForCourse} due`)}</em>}
                          </span>
                        </span>
                        <ChevronRight size={14} className="row-chevron" />
                      </button>
                      {onChangeCoursePrefs && (
                        <button
                          type="button"
                          className={`icon-inline-btn course-pin-inline ${item.isPinned ? 'pinned' : ''}`}
                          aria-label={item.isPinned ? tr(locale, '取消置顶课程', 'Unpin') : tr(locale, '星标置顶课程', 'Pin')}
                          onClick={() => onChangeCoursePrefs(togglePinnedMoodleCourse(coursePrefs, item.id))}
                        >
                          <Star size={12} fill={item.isPinned ? 'currentColor' : 'none'} />
                        </button>
                      )}
                    </div>
                  )
                })
              ) : (
                <p className="empty-state">
                  {hiddenCount > 0 && !includeHidden
                    ? tr(locale, '当前筛选下暂无显示课程（可在上方管理显示课程）', 'No visible courses match (manage course selection above)')
                    : tr(locale, '暂无课程', 'No courses')}
                </p>
              )}
            </div>
          )}

          {showTasksCol && (
            <div>
              <div className="subheading-row">
                <h3 className="subheading">{tr(locale, '待办与倒计时', 'Tasks & Countdowns')}</h3>
                {onOpenAddTask && (
                  <button type="button" className="text-btn" onClick={() => onOpenAddTask()}>
                    <Plus size={12} /> {tr(locale, '新建', 'New')}
                  </button>
                )}
              </div>
              {filtered.assignments.length ? filtered.assignments.map(item => renderTaskRow(item, true)) : <p className="empty-state">{tr(locale, '暂无待办', 'No pending tasks')}</p>}
            </div>
          )}

          {showGradesCol && (
            <div>
              <h3 className="subheading">{tr(locale, '成绩', 'Grades')}</h3>
              {filtered.grades.length ? (
                filtered.grades.map(item => (
                  <div className="live-row" key={item.id}>
                    <Trophy size={15} />
                    <span>
                      {item.title}
                      <small>{item.course} · {formatGradeDisplay(item, locale)}</small>
                    </span>
                  </div>
                ))
              ) : (
                <p className="empty-state">{tr(locale, '暂无可见成绩', 'No released grades')}</p>
              )}
            </div>
          )}
        </div>
      )}

      {showResourcesSection && (
        <div className="live-announcements moodle-resources-results">
          <div className="subheading-row">
            <h3 className="subheading">{tr(locale, '匹配的课程资料', 'Matching Course Materials')}</h3>
            <button type="button" className="text-btn" onClick={onOpenMaterials}>{tr(locale, '打开资料下载中心 →', 'Open Materials Center →')}</button>
          </div>
          {filtered.resources.length ? (
            filtered.resources.slice(0, 24).map(item => {
              const safe = safeHkuUrl(item.url)
              return (
                <div className="live-row" key={item.id}>
                  <FileText size={15} />
                  <span><strong>{item.title}</strong><small>{item.course}</small></span>
                  {safe && isDirectDownloadableUrl(safe) ? (
                    <button type="button" className="mini-action-btn" onClick={() => handleQuickDownloadResource(item)}>
                      <Download size={12} /> {tr(locale, '加入下载', 'Download')}
                    </button>
                  ) : (
                    <button type="button" className="mini-action-btn" onClick={onOpenMaterials}>
                      <Download size={12} /> {tr(locale, '前往资料页', 'Materials')}
                    </button>
                  )}
                </div>
              )
            })
          ) : (
            <p className="empty-state">{tr(locale, '没有匹配的课程资料', 'No matching materials')}</p>
          )}
        </div>
      )}

      {showAnnouncementsSection && (
        <div className="live-announcements">
          <h3 className="subheading">{tr(locale, '公告', 'Announcements')}</h3>
          {filtered.announcements.length ? (
            filtered.announcements.slice(0, 12).map(item => {
              const safe = safeHkuUrl(item.url)
              return (
                <div className="live-row" key={item.id}>
                  <Bell size={15} />
                  <span>
                    {safe ? <a href={safe} target="_blank" rel="noreferrer">{item.title}</a> : item.title}
                    <small>{item.course}{item.published ? ` · ${item.published}` : ''}</small>
                  </span>
                </div>
              )
            })
          ) : (
            <p className="empty-state">{tr(locale, '暂无公告', 'No announcements')}</p>
          )}
        </div>
      )}
    </section>
  )
}
// end MoodlePage
