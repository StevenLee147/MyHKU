import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { EyeOff, RotateCcw, Search, SlidersHorizontal, Star, X } from 'lucide-react'
import type { LiveSnapshot } from '../services/hku'
import { tr, type Locale } from '../services/i18n'
import {
  enrichMoodleCourses,
  matchesMoodleCourseItem,
  matchesMoodleQuery,
  setBatchCourseVisibility,
  setSingleCourseVisibility,
  togglePinnedMoodleCourse,
  type EnrichedMoodleCourse,
  type MoodleCoursePrefs,
} from '../services/moodleCourses'

type SelectorTab = 'all' | 'main' | 'subclass' | 'nonAcademic' | 'hidden'

export function MoodleCourseSelectorModal({
  open,
  locale = 'zh',
  rawSnapshot,
  prefs,
  onChangePrefs,
  onClose,
}: {
  open: boolean
  locale?: Locale
  rawSnapshot: LiveSnapshot
  prefs: MoodleCoursePrefs
  onChangePrefs: (next: MoodleCoursePrefs) => void
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const selectAllRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const lastCompEndRef = useRef<number | null>(null)
  const baseId = useId()
  const headingId = `${baseId}-heading`
  const searchId = `${baseId}-search`

  const [searchText, setSearchText] = useState('')
  const [tab, setTab] = useState<SelectorTab>('all')

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      setSearchText('')
      setTab('all')
      dialog.showModal()
      window.setTimeout(() => searchInputRef.current?.focus(), 0)
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  const handleBackdropFallbackClick = (event: MouseEvent<HTMLDialogElement>) => {
    const dialog = dialogRef.current
    if (!dialog || 'closedBy' in HTMLDialogElement.prototype) return
    if (event.target !== dialog) return
    const rect = dialog.getBoundingClientRect()
    const inside =
      rect.top <= event.clientY &&
      event.clientY <= rect.top + rect.height &&
      rect.left <= event.clientX &&
      event.clientX <= rect.left + rect.width
    if (!inside) dialog.close()
  }

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (event.nativeEvent.isComposing || event.keyCode === 229) return
      if (lastCompEndRef.current !== null && Math.abs(event.timeStamp - lastCompEndRef.current) < 50) return
    }
  }

  const enriched = useMemo(() => enrichMoodleCourses(rawSnapshot.courses, prefs), [rawSnapshot.courses, prefs])

  const statsByCourseId = useMemo(() => {
    const map = new Map<string, { pending: number; materials: number; grades: number }>()
    for (const c of enriched) {
      const pending = rawSnapshot.assignments.filter(a => !a.completed && matchesMoodleCourseItem(a, c, enriched)).length
      const materials = rawSnapshot.resources.filter(r => matchesMoodleCourseItem(r, c, enriched)).length
      const grades = rawSnapshot.grades.filter(g => matchesMoodleCourseItem(g, c, enriched)).length
      map.set(c.id, { pending, materials, grades })
    }
    return map
  }, [enriched, rawSnapshot.assignments, rawSnapshot.resources, rawSnapshot.grades])

  const counts = useMemo(() => {
    const subclass = enriched.filter(c => c.isSubclass).length
    const nonAcademic = enriched.filter(c => c.isNonAcademic).length
    const hidden = enriched.filter(c => !c.isVisible).length
    const main = enriched.filter(c => !c.isSubclass && !c.isNonAcademic).length
    return { total: enriched.length, visible: enriched.length - hidden, main, subclass, nonAcademic, hidden }
  }, [enriched])

  const filteredCourses = useMemo(() => {
    return enriched
      .filter(c => {
        if (tab === 'main' && (c.isSubclass || c.isNonAcademic)) return false
        if (tab === 'subclass' && !c.isSubclass) return false
        if (tab === 'nonAcademic' && !c.isNonAcademic) return false
        if (tab === 'hidden' && c.isVisible) return false
        return matchesMoodleQuery(searchText, c.title, c.code, c.shortname, c.section, c.term, c.category)
      })
      .sort((a, b) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
        if (a.isSubclass !== b.isSubclass) return a.isSubclass ? 1 : -1
        if (a.isNonAcademic !== b.isNonAcademic) return a.isNonAcademic ? 1 : -1
        return (a.code || a.title).localeCompare(b.code || b.title)
      })
  }, [enriched, tab, searchText])

  const filteredVisibleCount = useMemo(() => filteredCourses.filter(c => c.isVisible).length, [filteredCourses])
  const allFilteredChecked = filteredCourses.length > 0 && filteredVisibleCount === filteredCourses.length
  const someFilteredChecked = filteredVisibleCount > 0 && filteredVisibleCount < filteredCourses.length

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someFilteredChecked
  }, [someFilteredChecked, allFilteredChecked])

  const toggleFilteredAll = () => {
    onChangePrefs(setBatchCourseVisibility(prefs, filteredCourses.map(c => c.id), !allFilteredChecked))
  }

  const hideAllSubclasses = () => {
    const ids = enriched.filter(c => c.isSubclass).map(c => c.id)
    onChangePrefs(setBatchCourseVisibility({ ...prefs, autoHideSubclasses: true }, ids, false))
  }

  const hideAllNonAcademic = () => {
    const ids = enriched.filter(c => c.isNonAcademic).map(c => c.id)
    onChangePrefs(setBatchCourseVisibility({ ...prefs, autoHideNonAcademic: true }, ids, false))
  }

  const resetShowAll = () => {
    onChangePrefs({ ...prefs, hiddenCourseIds: [], shownCourseIds: [], autoHideSubclasses: false, autoHideNonAcademic: false })
  }

  const renderBadges = (course: EnrichedMoodleCourse) => (
    <span className="course-meta-badges">
      {course.code && <em className="course-badge code">{course.code}</em>}
      {course.isSubclass && <em className="course-badge subclass">{course.section ? `Subclass ${course.section}` : 'Subclass'}</em>}
      {!course.isSubclass && course.section && <em className="course-badge section">Sec {course.section}</em>}
      {course.isNonAcademic && <em className="course-badge admin">{tr(locale, '非学分/系统页', 'Admin / Training')}</em>}
      {course.term && <em className="course-badge term">{course.term}</em>}
      {course.moodleHidden && <em className="course-badge muted">{tr(locale, 'Moodle 已归档', 'Archived')}</em>}
    </span>
  )

  return (
    <dialog
      ref={dialogRef}
      className="myhku-modal course-selector-modal"
      aria-labelledby={headingId}
      onClick={handleBackdropFallbackClick}
      onClose={() => {
        if (dialogRef.current) dialogRef.current.returnValue = ''
        onClose()
      }}
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      <div className="modal-head">
        <div>
          <h2 id={headingId}>
            <SlidersHorizontal size={16} /> {tr(locale, '选择需要显示的 Moodle 课程', 'Manage Visible Moodle Courses')}
          </h2>
          <p className="modal-subcopy">
            {tr(
              locale,
              `当前显示 ${counts.visible} / ${counts.total} 门课程 · 未勾选课程将在 Moodle、概览、资料中心与 GPA 中隐藏（不影响周课表）`,
              `Showing ${counts.visible} of ${counts.total} courses · Hidden courses stay out of Moodle, Overview, Materials & GPA Sim`,
            )}
          </p>
        </div>
        <button type="button" className="icon-close-btn" aria-label={tr(locale, '关闭弹窗', 'Close')} onClick={() => dialogRef.current?.close()}>
          <X size={16} />
        </button>
      </div>

      <div className="course-selector-toolbar">
        <label className="moodle-inline-search" htmlFor={searchId}>
          <Search size={15} />
          <input
            ref={searchInputRef}
            id={searchId}
            type="search"
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            onCompositionEnd={e => { lastCompEndRef.current = e.timeStamp }}
            onKeyDown={handleSearchKeyDown}
            placeholder={tr(locale, '检索课程代码、名称、Subclass、学期或学院分类…', 'Filter by code, title, subclass, term or faculty…')}
          />
          {searchText && (
            <button type="button" className="clear-search-btn" aria-label="Clear" onClick={() => setSearchText('')}>
              <X size={13} />
            </button>
          )}
        </label>

        <div className="course-selector-tabs" role="tablist" aria-label={tr(locale, '课程分类筛选', 'Course category tabs')}>
          {([
            { key: 'all', zh: `全部 (${counts.total})`, en: `All (${counts.total})` },
            { key: 'main', zh: `常规主课 (${counts.main})`, en: `Main (${counts.main})` },
            { key: 'subclass', zh: `Subclass/子班 (${counts.subclass})`, en: `Subclasses (${counts.subclass})` },
            { key: 'nonAcademic', zh: `培训/系统 (${counts.nonAcademic})`, en: `Admin (${counts.nonAcademic})` },
            { key: 'hidden', zh: `已隐藏 (${counts.hidden})`, en: `Hidden (${counts.hidden})` },
          ] as const).map(item => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              className={`filter-pill ${tab === item.key ? 'active' : ''}`}
              onClick={() => setTab(item.key)}
            >
              {locale === 'en' ? item.en : item.zh}
            </button>
          ))}
        </div>

        <div className="course-selector-batch-bar">
          <label className="course-check-label select-all-label">
            <input
              ref={selectAllRef}
              type="checkbox"
              className="moodle-checkbox"
              checked={allFilteredChecked}
              disabled={filteredCourses.length === 0}
              onChange={toggleFilteredAll}
            />
            <span>{tr(locale, `全选当前筛选 (${filteredVisibleCount}/${filteredCourses.length})`, `Select filtered (${filteredVisibleCount}/${filteredCourses.length})`)}</span>
          </label>
          <div className="batch-quick-btns">
            {counts.subclass > 0 && (
              <button type="button" className="mini-action-btn" onClick={hideAllSubclasses}>
                <EyeOff size={12} /> {tr(locale, `隐藏全部 Subclass (${counts.subclass})`, `Hide Subclasses (${counts.subclass})`)}
              </button>
            )}
            {counts.nonAcademic > 0 && (
              <button type="button" className="mini-action-btn" onClick={hideAllNonAcademic}>
                <EyeOff size={12} /> {tr(locale, `隐藏系统/培训页 (${counts.nonAcademic})`, `Hide Admin (${counts.nonAcademic})`)}
              </button>
            )}
            {counts.hidden > 0 && (
              <button type="button" className="text-btn" onClick={resetShowAll}>
                <RotateCcw size={12} /> {tr(locale, '恢复全部显示', 'Show All')}
              </button>
            )}
          </div>
        </div>

        <div className="course-selector-rules">
          <label className="course-check-label rule-toggle">
            <input
              type="checkbox"
              className="moodle-checkbox"
              checked={prefs.autoHideSubclasses}
              onChange={e => onChangePrefs({ ...prefs, autoHideSubclasses: e.target.checked })}
            />
            <span>{tr(locale, '同步新课程时默认隐藏 Subclass / Tutorial 子班', 'Auto-hide newly synced Subclass / Tutorial shells')}</span>
          </label>
          <label className="course-check-label rule-toggle">
            <input
              type="checkbox"
              className="moodle-checkbox"
              checked={prefs.autoHideNonAcademic}
              onChange={e => onChangePrefs({ ...prefs, autoHideNonAcademic: e.target.checked })}
            />
            <span>{tr(locale, '默认隐藏非课程培训/迎新页', 'Auto-hide orientation & admin shells')}</span>
          </label>
        </div>
      </div>

      <div className="course-selector-list">
        {filteredCourses.length ? (
          filteredCourses.map(course => {
            const stats = statsByCourseId.get(course.id) || { pending: 0, materials: 0, grades: 0 }
            return (
              <div key={course.id} className={`course-selector-item ${course.isVisible ? '' : 'is-hidden'}`}>
                <label className="course-check-label course-item-main">
                  <input
                    type="checkbox"
                    className="moodle-checkbox"
                    checked={course.isVisible}
                    onChange={e => onChangePrefs(setSingleCourseVisibility(prefs, course.id, e.target.checked))}
                  />
                  <span className="course-item-copy">
                    <strong>{course.title}</strong>
                    {renderBadges(course)}
                    <small className="course-item-stats">
                      <span className={stats.pending > 0 ? 'has-pending-warn' : ''}>{tr(locale, `${stats.pending} 项未完成待办`, `${stats.pending} pending`)}</span>
                      {' · '}
                      <span>{tr(locale, `${stats.materials} 份资料`, `${stats.materials} files`)}</span>
                      {' · '}
                      <span>{tr(locale, `${stats.grades} 项成绩`, `${stats.grades} grades`)}</span>
                      {course.category ? ` · ${course.category}` : ''}
                    </small>
                  </span>
                </label>
                <button
                  type="button"
                  className={`pin-btn ${course.isPinned ? 'pinned' : ''}`}
                  aria-label={course.isPinned ? tr(locale, '取消星标置顶', 'Unpin course') : tr(locale, '星标置顶课程', 'Pin course')}
                  onClick={() => onChangePrefs(togglePinnedMoodleCourse(prefs, course.id))}
                >
                  <Star size={14} fill={course.isPinned ? 'currentColor' : 'none'} />
                </button>
              </div>
            )
          })
        ) : (
          <p className="empty-state course-selector-empty">{tr(locale, '没有匹配的课程记录', 'No matching courses found')}</p>
        )}
      </div>

      <div className="modal-actions course-selector-foot">
        <span className="selector-foot-note">
          {tr(locale, `共抓取到 ${counts.total} 门课程，已勾选显示 ${counts.visible} 门`, `${counts.visible} of ${counts.total} enrolled courses selected`)}
        </span>
        <button type="button" className="primary-btn" onClick={() => dialogRef.current?.close()}>
          {tr(locale, '完成', 'Done')}
        </button>
      </div>
    </dialog>
  )
}
