import type { LiveCourse, LiveSnapshot } from './hku'

export const MOODLE_COURSE_PREFS_KEY = 'myhku-moodle-course-prefs'

export type MoodleCoursePrefs = {
  hiddenCourseIds: string[]
  shownCourseIds: string[]
  pinnedCourseIds: string[]
  autoHideSubclasses: boolean
  autoHideNonAcademic: boolean
}

export type EnrichedMoodleCourse = LiveCourse & {
  code?: string
  section?: string
  term?: string
  isSubclass: boolean
  isNonAcademic: boolean
  isPinned: boolean
  isVisible: boolean
}

export type MoodleSearchScope = 'all' | 'courses' | 'assignments' | 'resources' | 'grades' | 'announcements'
export type MoodleCourseKindFilter = 'all' | 'main' | 'subclass' | 'starred'
export type MoodleCourseSortMode = 'smart' | 'code' | 'tasks'

const SUBCLASS_REGEX =
  /\b(?:sub[-\s]?class(?:es)?|tutorials?|labs?|laboratory|workshops?|practicums?|discussion\s+groups?|seminar\s+groups?|tut\s*[0-9a-z]{1,3})\b|子班|分班|辅导课|輔導課|实验课|實驗課|讨论组|討論組/i

const NON_ACADEMIC_REGEX =
  /\b(?:orientation|anti[-\s]?plagiarism|academic\s+advising|library\s+(?:orientation|training|workshop)|safety\s+training|student\s+handbook|cedars|academic\s+integrity|turnitin\s+practice|sandbox)\b|迎新|学术诚信|學術誠信|图书馆培训|安全培训/i

export function defaultMoodleCoursePrefs(): MoodleCoursePrefs {
  return {
    hiddenCourseIds: [],
    shownCourseIds: [],
    pinnedCourseIds: [],
    autoHideSubclasses: false,
    autoHideNonAcademic: false,
  }
}

export function sanitizeMoodleCoursePrefs(raw: unknown): MoodleCoursePrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaultMoodleCoursePrefs()
  const obj = raw as Record<string, unknown>
  const cleanIds = (val: unknown) =>
    Array.isArray(val)
      ? [...new Set(val.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map(x => x.trim().slice(0, 120)))].slice(0, 500)
      : []
  return {
    hiddenCourseIds: cleanIds(obj.hiddenCourseIds),
    shownCourseIds: cleanIds(obj.shownCourseIds),
    pinnedCourseIds: cleanIds(obj.pinnedCourseIds),
    autoHideSubclasses: Boolean(obj.autoHideSubclasses),
    autoHideNonAcademic: Boolean(obj.autoHideNonAcademic),
  }
}

export function getMoodleCoursePrefs(): MoodleCoursePrefs {
  try {
    const raw = localStorage.getItem(MOODLE_COURSE_PREFS_KEY)
    if (!raw) return defaultMoodleCoursePrefs()
    return sanitizeMoodleCoursePrefs(JSON.parse(raw))
  } catch {
    return defaultMoodleCoursePrefs()
  }
}

export function saveMoodleCoursePrefs(prefs: MoodleCoursePrefs): MoodleCoursePrefs {
  const normalized = sanitizeMoodleCoursePrefs(prefs)
  try {
    localStorage.setItem(MOODLE_COURSE_PREFS_KEY, JSON.stringify(normalized))
  } catch {
    /* ignore storage quota failure */
  }
  return normalized
}

export function clearMoodleCoursePrefs(): void {
  try {
    localStorage.removeItem(MOODLE_COURSE_PREFS_KEY)
  } catch {
    /* ignore */
  }
}

export function extractNormalizedCourseCode(text?: string): string {
  if (!text) return ''
  const m = text.match(/(?:^|[^A-Za-z0-9])([A-Z]{2,8})\s*[-_]?\s*(\d{3,5}[A-Z]?)(?=$|[^A-Za-z0-9])/i)
  return m ? `${m[1]}${m[2]}`.toUpperCase() : ''
}

export function extractCourseSectionAndTerm(course: Pick<LiveCourse, 'title' | 'code' | 'shortname' | 'section' | 'term'>): {
  code: string
  section: string
  term: string
} {
  const combined = `${course.shortname || ''} ${course.title || ''}`.trim()
  const code = (course.code ? extractNormalizedCourseCode(course.code) || course.code.trim().toUpperCase() : '') ||
    extractNormalizedCourseCode(course.shortname) ||
    extractNormalizedCourseCode(course.title)

  let section = course.section?.trim() || ''
  if (!section) {
    const explicitSec = combined.match(/\b(?:sub[-\s]?class|section|tutorial|lab|group)\s*[:#-]?\s*([A-Za-z0-9-]{1,8})\b/i)
    if (explicitSec && !/^20\d{2}$/.test(explicitSec[1])) {
      section = explicitSec[1].toUpperCase()
    } else if (code) {
      const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const suffix = combined.match(new RegExp(`(?:^|[^A-Za-z0-9])${escaped}[-_\s]+([0-9]{1,2}[A-Z]{1,3}|[A-Z][0-9]{1,2})(?=$|[^A-Za-z0-9])`, 'i'))
      if (suffix && !/^20\d{2}$/.test(suffix[1])) section = suffix[1].toUpperCase()
    }
  }

  let term = course.term?.trim() || ''
  if (!term) {
    const termMatch = combined.match(/(?:^|[^A-Za-z0-9])(20\d{2}\s*[-/]\s*(?:20)?\d{2}(?:\s*Sem(?:ester)?\s*[12A-Za-z]+)?|20\d{2}\s*Sem(?:ester)?\s*[12A-Za-z]+|20\d{2})(?=$|[^A-Za-z0-9])/i)
    if (termMatch) term = termMatch[1].replace(/\s+/g, ' ').trim()
  }

  return { code, section, term }
}

export function isCourseVisibleWithPrefs(
  course: { id: string; isSubclass?: boolean; isNonAcademic?: boolean },
  prefs: MoodleCoursePrefs,
): boolean {
  if (prefs.hiddenCourseIds.includes(course.id)) return false
  if (prefs.shownCourseIds.includes(course.id)) return true
  if (prefs.autoHideSubclasses && course.isSubclass) return false
  if (prefs.autoHideNonAcademic && course.isNonAcademic) return false
  return true
}

export function enrichMoodleCourses(
  courses: LiveCourse[],
  prefs: MoodleCoursePrefs = defaultMoodleCoursePrefs(),
): EnrichedMoodleCourse[] {
  const preliminary = courses.map(c => {
    const { code, section, term } = extractCourseSectionAndTerm(c)
    const combined = `${c.shortname || ''} ${c.title || ''}`
    const explicitSubclass = Boolean(c.isSubclass) || SUBCLASS_REGEX.test(combined)
    const nonAcademic = Boolean(c.isNonAcademic) || NON_ACADEMIC_REGEX.test(`${combined} ${c.category || ''}`)
    return {
      ...c,
      ...(code ? { code } : {}),
      ...(section ? { section } : {}),
      ...(term ? { term } : {}),
      explicitSubclass,
      nonAcademic,
    }
  })

  const byCode = new Map<string, typeof preliminary>()
  for (const item of preliminary) {
    if (!item.code) continue
    const list = byCode.get(item.code) || []
    list.push(item)
    byCode.set(item.code, list)
  }

  const pinnedSet = new Set(prefs.pinnedCourseIds)

  return preliminary.map(item => {
    let isSubclass = item.explicitSubclass
    if (!isSubclass && item.code && item.section) {
      const siblings = byCode.get(item.code) || []
      const sameYear = (a?: string, b?: string) => !a || !b || a.slice(0, 4) === b.slice(0, 4)
      const hasMainShell = siblings.some(
        other =>
          other.id !== item.id &&
          sameYear(item.term, other.term) &&
          (!other.section || /\b(?:combined|all\s+sections|master|main)\b/i.test(other.title)),
      )
      if (hasMainShell) isSubclass = true
    }
    const isPinned = pinnedSet.has(item.id) || Boolean(item.starred && !prefs.hiddenCourseIds.includes(item.id))
    const isVisible = isCourseVisibleWithPrefs(
      { id: item.id, isSubclass, isNonAcademic: item.nonAcademic },
      prefs,
    )
    const { explicitSubclass: _e, nonAcademic: _n, ...rest } = item
    return {
      ...rest,
      isSubclass,
      isNonAcademic: item.nonAcademic,
      isPinned,
      isVisible,
    }
  })
}

export function setSingleCourseVisibility(
  prefs: MoodleCoursePrefs,
  courseId: string,
  visible: boolean,
): MoodleCoursePrefs {
  const hidden = new Set(prefs.hiddenCourseIds)
  const shown = new Set(prefs.shownCourseIds)
  if (visible) {
    hidden.delete(courseId)
    shown.add(courseId)
  } else {
    hidden.add(courseId)
    shown.delete(courseId)
  }
  return {
    ...prefs,
    hiddenCourseIds: [...hidden],
    shownCourseIds: [...shown],
  }
}

export function setBatchCourseVisibility(
  prefs: MoodleCoursePrefs,
  courseIds: string[],
  visible: boolean,
): MoodleCoursePrefs {
  const hidden = new Set(prefs.hiddenCourseIds)
  const shown = new Set(prefs.shownCourseIds)
  for (const id of courseIds) {
    if (visible) {
      hidden.delete(id)
      shown.add(id)
    } else {
      hidden.add(id)
      shown.delete(id)
    }
  }
  return {
    ...prefs,
    hiddenCourseIds: [...hidden],
    shownCourseIds: [...shown],
  }
}

export function togglePinnedMoodleCourse(prefs: MoodleCoursePrefs, courseId: string): MoodleCoursePrefs {
  const pinned = new Set(prefs.pinnedCourseIds)
  if (pinned.has(courseId)) pinned.delete(courseId)
  else pinned.add(courseId)
  return {
    ...prefs,
    pinnedCourseIds: [...pinned],
  }
}

/**
 * Accurate course matching that prioritizes exact Moodle courseId first,
 * then exact title/shortname match, and only falls back to course code
 * when no other sibling course has a closer title match.
 */
export function matchesMoodleCourseItem(
  item: { course: string; courseId?: string },
  target: LiveCourse,
  allCourses?: LiveCourse[],
): boolean {
  if (item.courseId && target.id) {
    return item.courseId === target.id
  }
  const normItem = (item.course || '').trim().toLowerCase()
  const normTitle = target.title.trim().toLowerCase()
  if (!normItem) return false
  if (normItem === normTitle) return true
  if (target.shortname && normItem === target.shortname.trim().toLowerCase()) return true
  if (normItem.includes(normTitle) || normTitle.includes(normItem)) {
    if (allCourses && allCourses.length > 1) {
      const exactOther = allCourses.some(
        other => other.id !== target.id && other.title.trim().toLowerCase() === normItem,
      )
      if (exactOther) return false
    }
    return true
  }
  if (target.code) {
    const code = target.code.trim().toLowerCase()
    const compactItem = normItem.replace(/[\s_-]+/g, '')
    const compactCode = code.replace(/[\s_-]+/g, '')
    if (compactCode && compactItem.includes(compactCode)) {
      if (allCourses && allCourses.length > 1) {
        const closerSibling = allCourses.some(other => {
          if (other.id === target.id) return false
          const ot = other.title.trim().toLowerCase()
          return ot === normItem || normItem.includes(ot) || ot.includes(normItem)
        })
        if (closerSibling) return false
      }
      return true
    }
  }
  return false
}

export function filterSnapshotByCoursePrefs(
  snapshot: LiveSnapshot | null,
  prefs: MoodleCoursePrefs,
): LiveSnapshot | null {
  if (!snapshot) return null
  const enriched = enrichMoodleCourses(snapshot.courses, prefs)
  const visibleCourses = enriched.filter(c => c.isVisible)
  const hiddenCourses = enriched.filter(c => !c.isVisible)
  if (hiddenCourses.length === 0) {
    return {
      ...snapshot,
      courses: visibleCourses,
    }
  }
  const visibleIds = new Set(visibleCourses.map(c => c.id))
  const hiddenIds = new Set(hiddenCourses.map(c => c.id))

  const keepItem = (item: { course: string; courseId?: string }) => {
    if (item.courseId) {
      if (hiddenIds.has(item.courseId)) return false
      if (visibleIds.has(item.courseId)) return true
    }
    const matchesVisible = visibleCourses.some(c => matchesMoodleCourseItem(item, c, enriched))
    if (matchesVisible) return true
    const matchesHidden = hiddenCourses.some(c => matchesMoodleCourseItem(item, c, enriched))
    return !matchesHidden
  }

  return {
    ...snapshot,
    courses: visibleCourses,
    assignments: snapshot.assignments.filter(keepItem),
    resources: snapshot.resources.filter(keepItem),
    grades: snapshot.grades.filter(keepItem),
    announcements: snapshot.announcements.filter(keepItem),
  }
}

function compactAlnum(value: string): string {
  return value.toLowerCase().replace(/[\s_\-·.,:/()\[\]]+/g, '')
}

/**
 * Multi-token, code-normalized search matcher.
 * e.g. "glis 1901 essay" matches "GLIS1901 Foundations" + "Final Essay".
 */
export function matchesMoodleQuery(rawQuery: string, ...fields: Array<string | undefined | null>): boolean {
  const trimmed = rawQuery.trim().toLowerCase()
  if (!trimmed) return true
  const rawHaystack = fields
    .filter((f): f is string => typeof f === 'string' && f.length > 0)
    .join(' ')
    .toLowerCase()
  if (!rawHaystack) return false
  if (rawHaystack.includes(trimmed)) return true
  const compactHaystack = compactAlnum(rawHaystack)
  const compactQuery = compactAlnum(trimmed)
  if (compactQuery && compactHaystack.includes(compactQuery)) return true

  const tokens = trimmed.split(/\s+/).filter(Boolean)
  if (tokens.length <= 1) return false

  // Also try joining adjacent alpha + numeric tokens like "glis" + "1901" -> "glis1901"
  const mergedTokens: string[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    const cur = tokens[i]
    const next = tokens[i + 1]
    if (next && /^[a-z]{2,8}$/.test(cur) && /^\d{3,5}[a-z]?$/.test(next)) {
      mergedTokens.push(`${cur}${next}`)
      i += 1
    } else {
      mergedTokens.push(cur)
    }
  }

  return mergedTokens.every(token => {
    if (rawHaystack.includes(token)) return true
    const ct = compactAlnum(token)
    return Boolean(ct && compactHaystack.includes(ct))
  })
}
