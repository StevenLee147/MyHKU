/**
 * Small, deliberately boring HTML adapters for the pages returned by HKU.
 *
 * The native bridge owns the authenticated WebView and passes the HTML of a
 * page here.  These functions never make a request and never inspect a
 * browser cookie.  They only return the normalised objects consumed by the
 * dashboard.  Selectors are intentionally grouped in one file so that a
 * Moodle/SIS markup change produces an actionable adapter_needs_update error
 * instead of looking like a successful empty sync.
 */

import type { LiveAnnouncement, LiveAssignment, LiveClass, LiveCourse } from './hku'

export const ADAPTER_NEEDS_UPDATE = 'adapter_needs_update' as const

export class AdapterNeedsUpdateError extends Error {
  readonly code = ADAPTER_NEEDS_UPDATE
  readonly site: 'moodle' | 'sis'
  readonly missingFields: string[]
  readonly reason: string

  constructor(site: 'moodle' | 'sis', reason: string, missingFields: string[] = []) {
    super(`${ADAPTER_NEEDS_UPDATE}: ${reason}`)
    this.name = 'AdapterNeedsUpdateError'
    this.site = site
    this.reason = reason
    this.missingFields = missingFields
  }
}

type Site = 'moodle' | 'sis'

const clean = (value: string | null | undefined): string =>
  (value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()

const lower = (value: string): string => clean(value).toLocaleLowerCase()

function parseHtml(html: string, site: Site): Document {
  if (!clean(html)) throw new AdapterNeedsUpdateError(site, 'empty_html')
  if (typeof DOMParser === 'undefined') throw new AdapterNeedsUpdateError(site, 'dom_parser_unavailable')
  const document = new DOMParser().parseFromString(html, 'text/html')
  if (!document.documentElement || document.querySelector('parsererror')) {
    throw new AdapterNeedsUpdateError(site, 'invalid_html')
  }
  const pageText = lower(document.body?.textContent)
  const title = lower(document.title)
  if (/login|sign in|登录|登入/.test(title) && !/course|moodle|schedule|课表|timetable/.test(title)) {
    throw new AdapterNeedsUpdateError(site, 'authentication_required')
  }
  // A login form is a more reliable signal than a translated page title.
  if (document.querySelector('form[action*="login"], input[type="password"]') &&
      !/course|moodle|schedule|课表|timetable/.test(pageText.slice(0, 400))) {
    throw new AdapterNeedsUpdateError(site, 'authentication_required')
  }
  return document
}

function firstText(root: ParentNode, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const element = root.querySelector(selector)
    const value = clean(element?.getAttribute('data-value') || element?.textContent)
    if (value) return value
  }
  return undefined
}

function attr(root: Element, names: string[]): string | undefined {
  for (const name of names) {
    const value = clean(root.getAttribute(name))
    if (value) return value
  }
  return undefined
}

function stableId(seed: string, prefix: string): string {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `${prefix}-${(hash >>> 0).toString(16)}`
}

function idFrom(root: Element, href: string | undefined, prefix: string, seed: string): string {
  const dataId = attr(root, ['data-id', 'data-course-id', 'data-event-id', 'data-assignment-id', 'id'])
  if (dataId) return dataId.replace(/^course-/, '')
  if (href) {
    try {
      const url = new URL(href, 'https://hku.invalid/')
      const queryId = url.searchParams.get('id') || url.searchParams.get('courseid') || url.searchParams.get('cmid')
      if (queryId) return queryId
      if (url.pathname) return stableId(url.pathname, prefix)
    } catch {
      // A malformed link is still useful as a deterministic seed.
    }
  }
  return stableId(seed, prefix)
}

function hrefOf(root: ParentNode, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const link = root.querySelector(selector) as HTMLAnchorElement | null
    const href = clean(link?.getAttribute('href'))
    if (href) return href
  }
  return undefined
}

function codeFrom(value: string | undefined): string | undefined {
  if (!value) return undefined
  const match = value.match(/\b[A-Z]{2,8}\s?-?\d{3,5}[A-Z]?\b/i)
  return match ? match[0].replace(/\s+/g, '').toUpperCase() : undefined
}

function uniqueElements(document: Document, selectors: string[]): Element[] {
  const output: Element[] = []
  const seen = new Set<Element>()
  for (const selector of selectors) {
    document.querySelectorAll(selector).forEach(element => {
      if (!seen.has(element)) {
        seen.add(element)
        output.push(element)
      }
    })
  }
  return output
}

function hasAny(document: Document, selectors: string[]): boolean {
  return selectors.some(selector => Boolean(document.querySelector(selector)))
}

function isEmptyState(document: Document): boolean {
  return /no (courses|assignments|events|classes)|nothing to display|没有课程|暂无|没有课表/.test(lower(document.body?.textContent))
}

/** Parse Moodle dashboard/course cards into the shared course model. */
export function parseMoodleCourseHtml(html: string): LiveCourse[] {
  const document = parseHtml(html, 'moodle')
  const containers = uniqueElements(document, [
    '.coursebox', '.course-listitem', '.course-card', '.course-summaryitem',
    '[data-course-id]', '[data-region="course-content"] .course',
  ])
  const pageMarker = hasAny(document, [
    '#page-my-index', '#page-course-index', '.block_myoverview', '.coursebox',
    'a[href*="/course/view.php"]',
  ]) || /my courses|my overview|courses|课程/.test(lower(document.title))

  const courses: LiveCourse[] = []
  const seen = new Set<string>()
  for (const root of containers) {
    const link = hrefOf(root, ['a[href*="/course/view.php"]', 'a.aalink', 'a.course-title', 'h3 a', 'h4 a'])
    const title = firstText(root, [
      '.coursename', '.course-title', '.course-name', '[data-region="course-title"]',
      'h3', 'h4', 'a[href*="/course/view.php"]',
    ])
    if (!title) continue
    const code = attr(root, ['data-course-code']) || firstText(root, ['.course-code', '.coursecode']) || codeFrom(title)
    const id = idFrom(root, link, 'course', `${code || ''}|${title}`)
    if (seen.has(id)) continue
    seen.add(id)
    courses.push({ id, title: clean(title), ...(code ? { code } : {}) })
  }
  // Some Moodle themes render only course links without a wrapping card.
  if (!courses.length) {
    const links = Array.from(document.querySelectorAll('a[href*="/course/view.php"]'))
    for (const link of links) {
      const title = clean(link.textContent)
      if (!title) continue
      const id = idFrom(link, link.getAttribute('href') || undefined, 'course', title)
      if (seen.has(id)) continue
      seen.add(id)
      const code = codeFrom(title)
      courses.push({ id, title, ...(code ? { code } : {}) })
    }
  }
  if (!courses.length && !pageMarker && !isEmptyState(document)) {
    throw new AdapterNeedsUpdateError('moodle', 'course_structure_not_found', ['course title', 'course link'])
  }
  return courses
}

function closestAssignmentRoot(element: Element): Element {
  return (element.closest('tr, .event-list-item, .timeline-event, .activity-item, .activity, .course-summaryitem, article, li') || element)
}

function assignmentMarker(root: Element, href: string | undefined): boolean {
  const haystack = `${href || ''} ${root.className || ''} ${root.textContent || ''}`.toLocaleLowerCase()
  return /mod\/assign|assign\/view|assignment|作业|截止|due date|submissionstatus/.test(haystack)
}

function normaliseDue(root: Element): string | undefined {
  const element = root.querySelector('time[datetime], [data-due-date], [data-timestamp], .duedate, .due-date, .event-time, .date, time')
  if (!element) return undefined
  const raw = clean(element.getAttribute('datetime') || element.getAttribute('data-due-date') || element.getAttribute('data-timestamp') || element.textContent)
  if (!raw) return undefined
  const numeric = Number(raw)
  if (Number.isFinite(numeric) && numeric > 1000000000) return new Date(numeric < 100000000000 ? numeric * 1000 : numeric).toISOString()
  const parsed = Date.parse(raw.replace(/^due\s*:?\s*/i, ''))
  return Number.isNaN(parsed) ? raw : new Date(parsed).toISOString()
}

function completionOf(root: Element): boolean | undefined {
  const state = attr(root, ['data-completionstate', 'data-completed', 'data-state'])
  if (state === '1' || /true|complete|completed|done|submitted|已完成|已提交/i.test(state || '')) return true
  if (state === '0' || /false|incomplete|未完成|待完成/i.test(state || '')) return false
  const text = lower(root.textContent)
  if (/completed|complete|submitted|done|已完成|已提交/.test(text)) return true
  if (/not completed|incomplete|未完成|待完成/.test(text)) return false
  return undefined
}

/** Parse Moodle timeline/assignment tables. Optional values stay undefined. */
export function parseMoodleAssignmentsHtml(html: string): LiveAssignment[] {
  const document = parseHtml(html, 'moodle')
  const anchors = Array.from(document.querySelectorAll('a[href*="/mod/assign/"], a[href*="assign/view"], .activity.assign a, a.assignment-link'))
  const roots: Element[] = []
  const seenRoots = new Set<Element>()
  for (const anchor of anchors) {
    const root = closestAssignmentRoot(anchor)
    if (!seenRoots.has(root) && assignmentMarker(root, anchor.getAttribute('href') || undefined)) {
      seenRoots.add(root)
      roots.push(root)
    }
  }
  uniqueElements(document, ['.event-list-item[data-event-id]', '[data-region="event-item"]', 'tr.assignment', '.activity.assign'])
    .forEach(root => { if (!seenRoots.has(root) && assignmentMarker(root, undefined)) { seenRoots.add(root); roots.push(root) } })
  const pageMarker = hasAny(document, [
    '#page-mod-assign-index', '#page-calendar-view', '.block_timeline', '.event-list-item',
    'a[href*="/mod/assign/"]', 'table.generaltable',
  ]) || /assignments|timeline|作业|待办/.test(lower(document.title))

  const assignments: LiveAssignment[] = []
  const seen = new Set<string>()
  for (const root of roots) {
    const link = hrefOf(root, ['a[href*="/mod/assign/"]', 'a[href*="assign/view"]', 'a.assignment-link', 'a'])
    const title = firstText(root, ['.event-name', '.activityname', '.instancename', '.assignment-name', '.activity-title', 'a[href*="/mod/assign/"]', 'a[href*="assign/view"]'])
    if (!title) continue
    const course = attr(root, ['data-course-name']) || firstText(root, ['.event-course', '.course-name', '.coursename', '[data-region="event-course"]'])
    const id = idFrom(root, link, 'assignment', `${course || ''}|${title}`)
    if (seen.has(id)) continue
    seen.add(id)
    assignments.push({
      id,
      title,
      course: course || '未提供课程',
      ...(normaliseDue(root) ? { due: normaliseDue(root) } : {}),
      ...(completionOf(root) === undefined ? {} : { completed: completionOf(root) }),
    })
  }
  if (!assignments.length && !pageMarker && !isEmptyState(document)) {
    throw new AdapterNeedsUpdateError('moodle', 'assignment_structure_not_found', ['assignment title', 'assignment link'])
  }
  return assignments
}

/** Parse read-only Moodle forum/news links into announcement records. */
export function parseMoodleAnnouncementsHtml(html: string): LiveAnnouncement[] {
  const document = parseHtml(html, 'moodle')
  const roots = uniqueElements(document, [
    '.forum-post', '.discussion', '.discussion-listitem', '[data-region="notification"]',
    'a[href*="/mod/forum/"]', 'a[href*="/mod/forum/view.php"]',
  ])
  const announcements: LiveAnnouncement[] = []
  const seen = new Set<string>()
  for (const root of roots) {
    const link = root.matches('a') ? root as HTMLAnchorElement : root.querySelector('a[href*="/mod/forum/"]') as HTMLAnchorElement | null
    const href = clean(link?.getAttribute('href'))
    const title = firstText(root, ['.discussionname', '.forum-post-title', '.subject', '.notification-title', 'h3', 'h4', 'a[href*="/mod/forum/"]'])
    if (!title || !href) continue
    const text = lower(root.textContent)
    if (!/announcement|news|notice|公告|通知|forum|discussion/.test(`${title} ${text}`)) continue
    const id = idFrom(root, href, 'announcement', title)
    if (seen.has(id)) continue
    seen.add(id)
    const course = attr(root, ['data-course-name']) || firstText(root, ['.course-name', '.coursename', '.discussion-course'])
    const time = root.querySelector('time[datetime], time, .date, .discussion-date')
    const published = clean(time?.getAttribute('datetime') || time?.textContent)
    announcements.push({ id, title, course: course || '未提供课程', ...(published ? { published } : {}), url: new URL(href, 'https://moodle.hku.hk/').toString() })
  }
  const pageMarker = roots.length > 0 || /announcement|news|公告|通知/.test(lower(document.title))
  if (!announcements.length && !pageMarker && !isEmptyState(document)) {
    throw new AdapterNeedsUpdateError('moodle', 'announcement_structure_not_found', ['announcement title', 'forum link'])
  }
  return announcements
}

function headerIndex(headers: string[], patterns: RegExp[]): number {
  return headers.findIndex(header => patterns.some(pattern => pattern.test(header)))
}

function timePair(value: string | undefined): { start?: string; end?: string } {
  if (!value) return {}
  const matches = value.match(/\b\d{1,2}(?::|：)\d{2}\s*(?:AM|PM)?\b/gi)
  if (!matches?.length) return {}
  const values = matches.map(item => item.replace('：', ':').replace(/\s+/g, ' ').trim())
  return { start: values[0], end: values[1] }
}

/** Parse SIS timetable tables or cards into the shared class model. */
export function parseSISScheduleHtml(html: string): LiveClass[] {
  const document = parseHtml(html, 'sis')
  const tables = Array.from(document.querySelectorAll('table')).filter(table => {
    const text = lower(table.textContent)
    return /course|class|subject|time|location|room|teacher|instructor|课程|时间|地点|教师/.test(text) || /\b\d{1,2}:\d{2}\s*(?:-|–|—)\s*\d{1,2}:\d{2}\b/.test(text)
  })
  const cards = uniqueElements(document, ['.schedule-item', '.class-item', '.class-card', '[data-start-time]', '[data-course-code]'])
  const rows: Element[] = []
  for (const table of tables) table.querySelectorAll('tbody tr, tr').forEach(row => rows.push(row))
  rows.push(...cards)
  const pageMarker = tables.length > 0 || cards.length > 0 || hasAny(document, ['#schedule', '#class-schedule', '.timetable', '[data-schedule]']) || /schedule|timetable|课表|课程表/.test(lower(document.title))
  const classes: LiveClass[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const table = row.closest('table')
    const cells = Array.from(row.querySelectorAll('th, td')).map(cell => clean(cell.textContent))
    const cardText = clean(row.textContent)
    // Card based themes use data-* attributes and spans instead of table
    // cells.  Keep their values available to the same normalisation path.
    const cardCells = cells.length ? cells : [
      attr(row, ['data-course-name', 'data-title']) || firstText(row, ['.course-name', '.course-title', '.subject', 'h2', 'h3', 'h4']) || cardText,
      attr(row, ['data-time']) || firstText(row, ['.time', '.class-time', '[class*="time"]']) || '',
      attr(row, ['data-location', 'data-room']) || firstText(row, ['.location', '.room', '[class*="room"]']) || '',
      attr(row, ['data-teacher', 'data-instructor']) || firstText(row, ['.teacher', '.instructor', '[class*="teacher"]']) || '',
    ]
    if (!cardCells.length || !cardCells.some(Boolean)) continue
    const firstTableRow = table?.querySelector('thead tr, tr')
    const headerCells = Array.from(table?.querySelectorAll('thead th') || []).map(cell => clean(cell.textContent))
    const fallbackHeaders = headerCells.length ? headerCells : (firstTableRow && firstTableRow.querySelector('th') ? Array.from(firstTableRow.querySelectorAll('th, td')).map(cell => clean(cell.textContent)) : [])
    // A header row is not a class meeting.  It is used only as metadata when
    // no <thead> exists.
    if (row.querySelector('th') && !row.querySelector('td')) continue
    const headers = fallbackHeaders.map(lower)
    const whole = cardCells.join(' · ')
    const titleIndex = headerIndex(headers, [/course\s+title|subject\s+name|class\s+name|课程名称|科目名称|课名/]) >= 0
      ? headerIndex(headers, [/course\s+title|subject\s+name|class\s+name|课程名称|科目名称|课名/])
      : headerIndex(headers, [/course|subject|class|课程|科目/])
    const codeIndex = headerIndex(headers, [/course\s*code|class\s*code|课程代码|课程编号/])
    const timeIndex = headerIndex(headers, [/time|时段|时间/])
    const roomIndex = headerIndex(headers, [/room|location|venue|地点|教室/])
    const teacherIndex = headerIndex(headers, [/teacher|instructor|lecturer|教师|老师/])
    const titleValue = cardCells[titleIndex >= 0 ? titleIndex : 0]
    const pair = timePair(timeIndex >= 0 ? cardCells[timeIndex] : whole)
    const start = attr(row, ['data-start-time']) || pair.start
    const end = attr(row, ['data-end-time']) || pair.end
    if (!titleValue || !start || !end || /course|subject|课程|time|时间/.test(lower(titleValue)) && !codeFrom(titleValue)) continue
    const code = attr(row, ['data-course-code', 'data-code']) || (codeIndex >= 0 ? codeFrom(cardCells[codeIndex]) || cardCells[codeIndex] : undefined) || codeFrom(titleValue) || codeFrom(whole)
    const title = titleValue.replace(code || '\u0000', '').replace(/^[-–—:：\s]+|[-–—:：\s]+$/g, '').trim() || titleValue
    const id = idFrom(row, hrefOf(row, ['a']), 'class', `${title}|${start}|${end}`)
    if (seen.has(id)) continue
    seen.add(id)
    const room = attr(row, ['data-room', 'data-location']) || (roomIndex >= 0 ? cardCells[roomIndex] : undefined)
    const teacher = attr(row, ['data-teacher', 'data-instructor']) || (teacherIndex >= 0 ? cardCells[teacherIndex] : undefined)
    classes.push({ id, title, ...(code ? { code } : {}), start, end, ...(room ? { room } : {}), ...(teacher ? { teacher } : {}) })
  }
  if (!classes.length && !pageMarker && !isEmptyState(document)) {
    throw new AdapterNeedsUpdateError('sis', 'schedule_structure_not_found', ['course', 'start time', 'end time'])
  }
  return classes
}
