/* global document, location, fetch */
// This script reads rendered text/attributes only. It never accesses
// document.cookie, password inputs, local storage, or authorization headers.

(function () {
  'use strict'

  const BRIDGE = 'http://127.0.0.1:17321/api/ingest/'
  const host = location.hostname.toLowerCase()
  // Keep Portal and SIS session indicators distinct. The Portal page is the
  // usual entry point; bridge mirrors a captured schedule to SIS as proof that
  // the SIS session is usable.
  const site = host === 'moodle.hku.hk' ? 'moodle' : (host === 'studentportal.hku.hk' ? 'portal' : ((host === 'hkuportal.hku.hk' || host === 'sis-main.hku.hk' || host === 'sweb.hku.hk' || host === 'intraweb.hku.hk') ? 'sis' : null))
  if (!site) return

  const clean = (value, max = 500) => {
    const text = String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
    return text ? text.slice(0, max) : ''
  }
  const attr = (node, names) => {
    for (const name of names) {
      const value = clean(node && node.getAttribute && node.getAttribute(name))
      if (value) return value
    }
    return ''
  }
  const text = (node, selectors) => {
    for (const selector of selectors) {
      const value = clean(node && node.querySelector && node.querySelector(selector)?.textContent)
      if (value) return value
    }
    return ''
  }
  const idFrom = (node, href, prefix, seed) => {
    // Activity ids must agree between course cards and overview table rows.
    if (href && ['assignment', 'resource', 'course'].includes(prefix)) {
      try {
        const url = new URL(href, location.href)
        const id = url.searchParams.get('id')
        if (id) return id
      } catch (_) { /* use the DOM identity below */ }
    }
    const direct = attr(node, ['data-id', 'data-course-id', 'data-event-id', 'data-assignment-id', 'id'])
    if (direct) return direct.replace(/^course-/, '')
    try {
      const url = new URL(href || '', location.href)
      const queryId = url.searchParams.get('id') || url.searchParams.get('courseid') || url.searchParams.get('cmid')
      if (queryId) return queryId
      if (url.pathname && url.pathname !== '/') return prefix + '-' + url.pathname.replace(/[^a-z0-9]+/gi, '-').slice(-120)
    } catch (_) { /* deterministic fallback below */ }
    let hash = 2166136261
    for (let i = 0; i < seed.length; i += 1) { hash ^= seed.charCodeAt(i); hash = Math.imul(hash, 16777619) }
    return prefix + '-' + (hash >>> 0).toString(16)
  }
  const linkHref = (node) => {
    const href = node && node.getAttribute && node.getAttribute('href')
    if (!href) return ''
    try {
      const url = new URL(href, location.href)
      return url.protocol === 'https:' && (url.hostname === 'hku.hk' || url.hostname.endsWith('.hku.hk')) ? url.toString() : ''
    } catch (_) { return '' }
  }
  const nearest = (node) => node.closest('tr, article, li, .coursebox, .course-listitem, .course-card, .activity, .activity-item, .event-list-item, [data-region="event-item"]') || node
  const codeFrom = (value) => (clean(value).match(/\b[A-Z]{2,8}\s?-?\d{3,5}[A-Z]?\b/i) || [])[0]?.replace(/\s+/g, '').toUpperCase() || ''
  const tableField = (root, pattern) => {
    const row = root.closest('tr')
    const table = row?.closest('table')
    if (!table) return null
    const headers = Array.from(table.querySelectorAll('thead tr:last-child th, thead tr:last-child td'))
    const cells = headers.length ? headers : Array.from(table.rows[0]?.cells || [])
    const index = cells.findIndex(cell => pattern.test(clean(cell.textContent)))
    return index < 0 ? null : row.cells[index]
  }
  const submissionStatus = root => {
    const cellText = clean(
      tableField(root, /submission\s*status|status|提交狀態|提交状态/i)?.textContent ||
      root.querySelector('.submissionstatus, .submissionstatussubmitted, .submissionstatusdraft, [data-region="submission-status"]')?.textContent,
      160
    )
    if (cellText) return cellText
    const badge = clean(
      root.querySelector('[data-region="completion-info"] [data-toggletype], [data-region="completion-info"] .badge, .automatic-completion-conditions .badge, .activity-completion .badge')?.textContent,
      120
    )
    if (/^(?:done|to\s*do|completed|incomplete)\b/i.test(badge)) return badge
    return ''
  }
  const sanitizeDueString = rawText => {
    const textValue = clean(rawText, 240)
    if (!textValue) return undefined
    const number = Number(textValue)
    if (Number.isFinite(number) && number > 1000000000) {
      return new Date(number < 100000000000 ? number * 1000 : number).toISOString()
    }
    const explicitDue = textValue.match(/(?:\b(?:due(?:\s+date)?|closes?|closing(?:\s+date)?|deadline)\b|截止(?:日期|时间|時間)?|到期(?:日期|时间|時間)?)\s*[:：]?\s*(.+?)(?=\s+(?:\b(?:opened|opens?|opening|time\s+remaining|grading\s+status|submission\s+status|last\s+modified)\b|开放|開放|剩余|剩餘)|$)/i)
    if (explicitDue && clean(explicitDue[1], 120)) {
      return clean(explicitDue[1], 120)
    }
    if (/^(?:opened|opens?|opening|开放|開放)\b/i.test(textValue) && !/(?:\b(?:due|closes?|deadline)\b|截止|到期)/i.test(textValue)) {
      return undefined
    }
    return clean(textValue.replace(/^(?:due(?:\s+date)?|closes?|deadline|截止(?:日期|时间|時間)?|到期(?:日期|时间|時間)?)\s*[:：]?\s*/i, ''), 120) || undefined
  }
  const parseGradeValue = rawText => {
    const raw = clean(rawText, 80)
    if (!raw) return null
    if (/^(?:[-–—]+|empty|not\s*graded|ungraded|n\/a|pending|未评分|未評分|未发布|未發布|暂无)$/i.test(raw)) {
      return { released: false }
    }
    if (/^(?:\d+(?:\.\d+)?(?:\s*(?:%|\/\s*\d+(?:\.\d+)?))?|[A-DF][+-]?|pass|fail|distinction|merit|credit|合格|及格|不及格)$/i.test(raw)) {
      return { value: raw, released: true }
    }
    const embedded = raw.match(/\b\d+(?:\.\d+)?(?:\s*(?:%|\/\s*\d+(?:\.\d+)?))?\b/)
    return embedded ? { value: embedded[0].slice(0, 80), released: true } : null
  }
  const extractGradeFromRow = root => {
    const explicitCell = tableField(root, /^(?:grade|mark|score|成绩|成績|分数|分數|得分)$/i) ||
      tableField(root, /(?:grade|mark|score|成绩|成績|分数|分數)/i)
    if (explicitCell) return parseGradeValue(explicitCell.textContent)
    const row = root.closest('tr')
    const table = row?.closest('table')
    const headers = table ? Array.from(table.querySelectorAll('thead tr:last-child th, thead tr:last-child td')).map(c => clean(c.textContent).toLowerCase()) : []
    const cells = Array.from(root.querySelectorAll('th,td')).map(cell => clean(cell.textContent))
    for (let idx = 1; idx < cells.length; idx += 1) {
      const head = headers[idx] || ''
      if (/weight|range|contribution|rank|feedback|权重|權重|范围|範圍|评语/i.test(head)) continue
      const parsed = parseGradeValue(cells[idx])
      if (parsed) return parsed
    }
    return null
  }
  const parseDue = (root) => {
    const tableDue = clean(tableField(root, /due\s*date|close\s*date|closes|deadline|截止|到期/i)?.textContent, 160)
    if (tableDue) {
      const cleanedTableDue = sanitizeDueString(tableDue)
      if (cleanedTableDue) return cleanedTableDue
    }
    const dateRegion = root.querySelector('[data-region="activity-dates"], .activity-dates, .description-inner')
    if (dateRegion) {
      for (const child of Array.from(dateRegion.querySelectorAll('div, span, li, p'))) {
        const line = clean(child.textContent, 200)
        if (/(?:\b(?:due|closes?|deadline)\b|截止|到期)/i.test(line)) {
          const timeAttr = child.querySelector('time[datetime], [data-due-date]')
          const fromAttr = sanitizeDueString(timeAttr?.getAttribute('datetime') || timeAttr?.getAttribute('data-due-date'))
          if (fromAttr) return fromAttr
          const parsedLine = sanitizeDueString(line)
          if (parsedLine) return parsedLine
        }
      }
      const regionDue = sanitizeDueString(dateRegion.textContent)
      if (regionDue) return regionDue
    }
    const explicitNode = root.querySelector('[data-due-date], .duedate, .due-date')
    if (explicitNode) {
      const explicitDue = sanitizeDueString(explicitNode.getAttribute('data-due-date') || explicitNode.textContent)
      if (explicitDue) return explicitDue
    }
    const timeNodes = Array.from(root.querySelectorAll('time[datetime], .event-time, time'))
    for (const node of timeNodes) {
      const parentText = clean(node.parentElement?.textContent, 200)
      if (/^(?:opened|opens?|opening|开放|開放)\b/i.test(parentText) && !/(?:\b(?:due|closes?|deadline)\b|截止|到期)/i.test(parentText)) {
        continue
      }
      const candidate = sanitizeDueString(node.getAttribute('datetime') || node.textContent)
      if (candidate) return candidate
    }
    return sanitizeDueString(root.textContent && /(?:\b(?:due|closes?|deadline)\s*[:：])/i.test(root.textContent) ? root.textContent : '')
  }
  const completed = (root) => {
    const status = submissionStatus(root)
    if (/no\s*submission|not\s*submitted|no\s*attempt|nothing\s*has\s*been\s*submitted|draft|overdue|to\s*do|incomplete|未提交|尚未提交|未尝试|未嘗試|草稿|待办|待辦|未完成/i.test(status)) return false
    if (/submitted\s*for\s*grading|submitted|graded|complete|completed|done|已提交|已评分|已評分|已完成/i.test(status)) return true
    const state = attr(root, ['data-completionstate', 'data-completed', 'data-state'])
    if (/^(1|true|complete|completed|done|submitted)$/i.test(state)) return true
    if (/^(0|false|incomplete|pending|todo)$/i.test(state)) return false
    const completionNode = root.querySelector('[data-region="completion-info"], .automatic-completion-conditions, .activity-completion, button[data-action="toggle-manual-completion"]')
    if (completionNode) {
      const completionText = clean(
        `${completionNode.textContent || ''} ${completionNode.getAttribute?.('aria-label') || ''} ${completionNode.getAttribute?.('title') || ''}`,
        200
      )
      if (/\b(?:to\s*do|mark\s*as\s*done|not\s*completed|incomplete)\b|待办|待辦|标记为完成|標記為完成|未完成/i.test(completionText)) return false
      if (/\b(?:done\s*:|completed|is\s*marked\s*as\s*done)\b|已完成/i.test(completionText)) return true
    }
    return undefined
  }
  const mergeAssignmentItem = (existing, incoming) => {
    if (!existing) return incoming
    const pickDue = (a, b) => {
      if (!a) return b
      if (!b) return a
      const hasYearA = /\b20\d{2}\b/.test(a)
      const hasYearB = /\b20\d{2}\b/.test(b)
      if (hasYearB && !hasYearA) return b
      if (hasYearA && !hasYearB) return a
      return b.length >= a.length ? b : a
    }
    const mergedDue = pickDue(existing.due, incoming.due)
    const mergedStatus = incoming.submissionStatus || existing.submissionStatus
    const mergedCompleted = incoming.completed !== undefined ? incoming.completed : existing.completed
    const mergedCourse = (incoming.course && incoming.course !== '未提供课程') ? incoming.course : (existing.course || '未提供课程')
    const mergedCourseId = incoming.courseId || existing.courseId
    return {
      id: existing.id || incoming.id,
      title: incoming.title || existing.title,
      course: mergedCourse,
      ...(mergedCourseId ? { courseId: mergedCourseId } : {}),
      ...(mergedDue ? { due: mergedDue } : {}),
      ...(mergedStatus ? { submissionStatus: mergedStatus } : {}),
      ...(mergedCompleted !== undefined ? { completed: mergedCompleted } : {}),
    }
  }

  const moodleCodeFrom = (value) => {
    const match = clean(value).match(/(?:^|[^A-Za-z0-9])([A-Z]{2,8})\s*[-_]?\s*(\d{3,5}[A-Z]?)(?=$|[^A-Za-z0-9])/i)
    return match ? `${match[1]}${match[2]}`.toUpperCase() : ''
  }
  const SUBCLASS_PATTERN = /\b(?:sub[-\s]?class(?:es)?|tutorials?|labs?|laboratory|workshops?|practicums?|discussion\s+groups?|tut\s*[0-9a-z]{1,3})\b|子班|分班|辅导课|輔導課|实验课|實驗課|讨论组|討論組/i
  const NON_ACADEMIC_PATTERN = /\b(?:orientation|anti[-\s]?plagiarism|academic\s+advising|library\s+(?:orientation|training|workshop)|safety\s+training|student\s+handbook|cedars|academic\s+integrity|turnitin\s+practice|sandbox)\b|迎新|学术诚信|學術誠信|图书馆培训|安全培训/i
  const GENERIC_COURSE_LABEL = /^(?:course|courses|my\s+courses|all\s+courses|site\s+home|home|dashboard|general|announcements|participants|grades|competencies|more|课程|我的课程|所有课程|网站首页|主页|仪表盘|概览)$/i
  const decodeHtmlText = (raw, max = 500) => {
    const str = String(raw || '')
    if (!str) return ''
    if (!str.includes('&') && !str.includes('<')) return clean(str, max)
    const doc = new DOMParser().parseFromString(`<!doctype html><body>${str}</body>`, 'text/html')
    return clean(doc.body?.textContent || str, max)
  }
  const stripCourseSrPrefix = (raw) => clean(raw)
    .replace(/^(?:(?:Course\s+image|Course\s+is\s+starred|Starred\s+course|Course\s+name|课程图片|課程圖片|星标课程|课程名称)(?:[\s"'：:|-]+|$))+/gi, '')
    .trim()
  const visibleLabelFromNode = (node) => {
    if (!node || !node.cloneNode) return ''
    const multilineHidden = node.querySelector?.('.multiline [aria-hidden="true"], .coursename [aria-hidden="true"]')
    if (multilineHidden) {
      const direct = stripCourseSrPrefix(multilineHidden.textContent)
      if (direct) return direct
    }
    const clone = node.cloneNode(true)
    clone.querySelectorAll?.('.sr-only, .accesshide, .visually-hidden').forEach(el => el.remove())
    return stripCourseSrPrefix(clone.textContent)
  }
  const extractCourseMeta = (title, shortname = '', category = '') => {
    const combined = `${shortname} ${title}`.trim()
    const code = moodleCodeFrom(shortname) || moodleCodeFrom(title)
    let section = ''
    const explicitSec = combined.match(/\b(?:sub[-\s]?class|section|tutorial|lab|group)\s*[:#-]?\s*([A-Za-z0-9-]{1,8})\b/i)
    if (explicitSec && !/^20\d{2}$/.test(explicitSec[1])) {
      section = explicitSec[1].toUpperCase()
    } else if (code) {
      const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const suffixMatch = combined.match(new RegExp(`(?:^|[^A-Za-z0-9])${escaped}[-_\s]+([0-9]{1,2}[A-Z]{1,3}|[A-Z][0-9]{1,2})(?=$|[^A-Za-z0-9])`, 'i'))
      if (suffixMatch && !/^20\d{2}$/.test(suffixMatch[1])) section = suffixMatch[1].toUpperCase()
    }
    const termMatch = combined.match(/(?:^|[^A-Za-z0-9])(20\d{2}\s*[-/]\s*(?:20)?\d{2}(?:\s*Sem(?:ester)?\s*[12A-Za-z]+)?|20\d{2}\s*Sem(?:ester)?\s*[12A-Za-z]+|20\d{2})(?=$|[^A-Za-z0-9])/i)
    const term = termMatch ? clean(termMatch[1], 40) : ''
    const isSubclass = SUBCLASS_PATTERN.test(combined)
    const isNonAcademic = NON_ACADEMIC_PATTERN.test(`${combined} ${category}`)
    return { code, section, term, isSubclass, isNonAcademic }
  }
  const finalizeCourseList = (courses) => {
    const byCode = new Map()
    for (const c of courses) {
      if (!c.code) continue
      const group = byCode.get(c.code) || []
      group.push(c)
      byCode.set(c.code, group)
    }
    return courses.map(c => {
      let isSubclass = Boolean(c.isSubclass)
      if (!isSubclass && c.code && c.section) {
        const siblings = byCode.get(c.code) || []
        const sameYear = (a, b) => !a || !b || String(a).slice(0, 4) === String(b).slice(0, 4)
        const hasMainShell = siblings.some(other => other.id !== c.id && sameYear(c.term, other.term) && (!other.section || /\b(?:combined|all\s+sections|master|main)\b/i.test(other.title)))
        if (hasMainShell) isSubclass = true
      }
      return {
        ...c,
        ...(isSubclass ? { isSubclass: true } : {}),
      }
    })
  }

  function extractCoursesFromDocument(doc, baseUrl) {
    const coursesMap = new Map()
    const putCourse = (entry) => {
      if (!entry || !entry.id || !entry.title || entry.id === '1') return
      if (GENERIC_COURSE_LABEL.test(entry.title)) return
      const prev = coursesMap.get(entry.id)
      if (!prev) {
        coursesMap.set(entry.id, entry)
        return
      }
      const betterTitle = entry.title.length > prev.title.length ? entry.title : prev.title
      coursesMap.set(entry.id, {
        ...prev,
        ...entry,
        title: betterTitle,
        code: entry.code || prev.code || undefined,
        shortname: entry.shortname || prev.shortname || undefined,
        category: entry.category || prev.category || undefined,
        section: entry.section || prev.section || undefined,
        term: entry.term || prev.term || undefined,
        url: entry.url || prev.url || undefined,
      })
    }
    try {
      const parsedBase = new URL(baseUrl)
      if (/\/course\/(?:view|overview)\.php$/i.test(parsedBase.pathname) && parsedBase.searchParams.get('id')) {
        const cid = parsedBase.searchParams.get('id')
        const heading = stripCourseSrPrefix(doc.querySelector('h1, .page-header-headings')?.textContent)
        if (cid && cid !== '1' && heading && !GENERIC_COURSE_LABEL.test(heading)) {
          const meta = extractCourseMeta(heading)
          putCourse({
            id: cid,
            title: heading,
            url: `${parsedBase.origin}/course/view.php?id=${encodeURIComponent(cid)}`,
            ...(meta.code ? { code: meta.code } : {}),
            ...(meta.section ? { section: meta.section } : {}),
            ...(meta.term ? { term: meta.term } : {}),
            ...(meta.isSubclass ? { isSubclass: true } : {}),
            ...(meta.isNonAcademic ? { isNonAcademic: true } : {}),
          })
        }
      }
    } catch (_) { /* ignore malformed baseUrl */ }

    doc.querySelectorAll('a[href*="/course/view.php"]').forEach((link) => {
      const rawHref = link.getAttribute('href') || ''
      if (/#section-\d+/i.test(rawHref)) return
      const href = pageHref(link, baseUrl)
      if (!href) return
      let parsedHref
      try {
        parsedHref = new URL(href)
        if (parsedHref.searchParams.has('section')) return
      } catch (_) { return }
      const root = link.closest('[data-region="course-content"], tr, article, li, .coursebox, .course-listitem, .course-card') || nearest(link)
      const rawTitle =
        visibleLabelFromNode(link) ||
        visibleLabelFromNode(root.querySelector?.('.coursename, .course-title, [data-region="course-content"] .multiline')) ||
        stripCourseSrPrefix(text(root, ['.coursename', '.course-title', 'h3', 'h4'])) ||
        stripCourseSrPrefix(link.getAttribute('title') || link.getAttribute('aria-label'))
      if (!rawTitle || GENERIC_COURSE_LABEL.test(rawTitle)) return
      const id = idFrom(root, href, 'course', rawTitle)
      if (!id || id === '1') return
      const shortname = attr(root, ['data-course-shortname', 'data-shortname'])
      const category = text(root, ['.categoryname', '[data-region="course-category"]'])
      const meta = extractCourseMeta(rawTitle, shortname, category)
      const code = attr(root, ['data-course-code']) || meta.code
      const canonicalUrl = parsedHref.searchParams.get('id')
        ? `${parsedHref.origin}/course/view.php?id=${encodeURIComponent(parsedHref.searchParams.get('id'))}`
        : href
      const starred = Boolean(root.querySelector?.('[data-region="is-favourite"]:not(.hidden), .fa-star:not(.d-none)'))
      putCourse({
        id,
        title: rawTitle,
        url: canonicalUrl,
        ...(code ? { code } : {}),
        ...(shortname ? { shortname } : {}),
        ...(category ? { category } : {}),
        ...(meta.section ? { section: meta.section } : {}),
        ...(meta.term ? { term: meta.term } : {}),
        ...(meta.isSubclass ? { isSubclass: true } : {}),
        ...(meta.isNonAcademic ? { isNonAcademic: true } : {}),
        ...(starred ? { starred: true } : {}),
      })
    })
    return finalizeCourseList(Array.from(coursesMap.values()))
  }

  function extractMoodle() {
    const courses = extractCoursesFromDocument(document, location.href)

    const assignments = []; const assignmentIds = new Set()
    const assessmentSelector = 'a[href*="/mod/assign/"], a[href*="assign/view"], a[href*="/mod/quiz/"], a[href*="/mod/turnitintooltwo/"]'
    document.querySelectorAll(assessmentSelector).forEach((link) => {
      const href = linkHref(link)
      if (href && /\/(?:index|report|edit)\.php\b/i.test(href)) return
      const root = nearest(link); const title = clean(link.textContent) || text(root, ['.activityname', '.instancename', '.assignment-name', 'h3', 'h4'])
      if (!title || assignmentIds.has(href)) return
      const id = idFrom(root, href, 'assignment', title)
      if (assignmentIds.has(id)) return
      assignmentIds.add(id); const course = attr(root, ['data-course-name']) || text(root, ['.event-course', '.course-name', '.coursename']) || clean(document.querySelector('h1, .page-header-headings')?.textContent) || '未提供课程'
      const status = submissionStatus(root); const done = completed(root); const due = parseDue(root)
      assignments.push({ id, title, course, ...(due ? { due } : {}), ...(status ? { submissionStatus: status } : {}), ...(done === undefined ? {} : { completed: done }) })
    })

    const announcements = []; const announcementIds = new Set()
    document.querySelectorAll('a[href*="/mod/forum/"], a[href*="/course/view.php"].discussion, .forum-post, .discussion, [data-region="notification"] a').forEach((link) => {
      const root = nearest(link)
      const title = clean(link.textContent) || text(root, ['.discussionname', '.forum-post-title', '.subject', 'h3', 'h4'])
      const href = linkHref(link)
      const haystack = clean(root.textContent).toLowerCase()
      if (!title || !href || (!/forum|discussion|announcement|公告|通知/.test(haystack + ' ' + title.toLowerCase()))) return
      const id = idFrom(root, href, 'announcement', title)
      if (announcementIds.has(id)) return
      announcementIds.add(id)
      const course = attr(root, ['data-course-name']) || text(root, ['.course-name', '.coursename', '.discussion-course']) || '未提供课程'
      const timeNode = root.querySelector('time[datetime], time, .date, .discussion-date')
      const published = clean(timeNode && (timeNode.getAttribute('datetime') || timeNode.textContent), 120)
      announcements.push({ id, title, course, ...(published ? { published } : {}), url: href })
    })

    const pageCourseHeading = /^\/course\/(?:view|overview|resources)\.php$/i.test(location.pathname)
      ? stripCourseSrPrefix(document.querySelector('h1, .page-header-headings')?.textContent)
      : ''
    const resources = []; const resourceIds = new Set()
    document.querySelectorAll('a[href*="/mod/resource/"], a[href*="/mod/folder/"], a[href*="/mod/url/"], a[href*="/mod/page/"], a[href*="/mod/book/"]').forEach((link) => {
      const href = linkHref(link)
      if (href && /\/(?:index|edit)\.php\b/i.test(href)) return
      const title = visibleLabelFromNode(link) || clean(link.textContent) || clean(link.getAttribute('aria-label'))
      if (!href || !title) return
      const root = nearest(link); const id = idFrom(root, href, 'resource', title)
      if (resourceIds.has(id)) return
      resourceIds.add(id); resources.push({ id, title, course: attr(root, ['data-course-name']) || text(root, ['.course-name', '.coursename']) || pageCourseHeading || '未提供课程', url: href })
    })

    const grades = []; const gradeIds = new Set()
    document.querySelectorAll('a[href*="/grade/"], a[href*="grade/report"], table.grades tr, table.user-grade tr').forEach((node) => {
      const root = node.matches('tr') ? node : nearest(node)
      const cells = Array.from(root.querySelectorAll('th,td')).map((cell) => clean(cell.textContent)).filter(Boolean)
      if (root.matches('tr') && root.querySelector('th') && !root.querySelector('td')) return
      const title = clean(node.matches('tr') ? cells[0] : node.textContent).slice(0, 180) || cells[0]
      if (!title || /^(?:grade\s*item|item\s*name|course\s*total|name|项目|名称)$/i.test(title)) return
      if (!root.closest('table.grades, table.user-grade') && !/(grade|score|mark|成绩|成績|分数)/i.test(clean(root.textContent))) return
      const parsed = extractGradeFromRow(root)
      if (!parsed && node.matches('a')) return
      const id = idFrom(root, linkHref(node.matches('a') ? node : root.querySelector('a')), 'grade', title)
      if (gradeIds.has(id)) return
      gradeIds.add(id)
      grades.push({
        id,
        title,
        course: text(root, ['.course-name', '.coursename']) || '未提供课程',
        ...(parsed?.value ? { value: parsed.value } : {}),
        released: parsed ? parsed.released : false,
      })
    })
    return { courses, assignments, announcements, resources, grades }
  }

  function pageHref(node, base) {
    const raw = node && node.getAttribute && (node.getAttribute('href') || node.getAttribute('action'))
    if (!raw) return ''
    try {
      const url = new URL(raw, base)
      return url.protocol === 'https:' && (url.hostname === 'hku.hk' || url.hostname.endsWith('.hku.hk')) ? url.toString() : ''
    } catch (_) { return '' }
  }

  async function runBounded(items, limit, worker) {
    const queue = items.slice()
    const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
      while (queue.length) {
        const next = queue.shift()
        if (next !== undefined) await worker(next)
      }
    })
    await Promise.all(runners)
  }

  function extractAssignDetailFields(doc) {
    let due
    let status = ''
    let grade = null
    for (const row of Array.from(doc.querySelectorAll('table.generaltable tr, .submissionstatustable tr, table tr'))) {
      const cells = Array.from(row.querySelectorAll('th, td')).map(c => clean(c.textContent, 200))
      if (cells.length < 2) continue
      const label = cells[0].toLowerCase()
      const value = cells[1]
      if (/^(?:due\s*date|close\s*date|closes|cut-off\s*date|截止|到期)/i.test(label) && !due) {
        due = sanitizeDueString(value)
      } else if (/^(?:submission\s*status|attempt\s*status|提交狀態|提交状态)/i.test(label) && !status) {
        status = value
      } else if (/^(?:grading\s*status|评分状态|評分狀態)/i.test(label) && !status && /graded|已评分|已評分/i.test(value)) {
        status = value
      } else if (/^(?:grade|mark|score|成绩|成績|分数|分數)$/i.test(label) && !grade) {
        grade = parseGradeValue(value)
      }
    }
    if (!due) due = parseDue(doc.body || doc.documentElement)
    let done
    if (/no\s*submission|not\s*submitted|no\s*attempt|nothing\s*has\s*been\s*submitted|draft|overdue|to\s*do|incomplete|未提交|尚未提交|未尝试|未嘗試|草稿|待办|待辦|未完成/i.test(status)) {
      done = false
    } else if (/submitted\s*for\s*grading|submitted|graded|complete|completed|done|已提交|已评分|已評分|已完成/i.test(status)) {
      done = true
    } else {
      done = completed(doc.body || doc.documentElement)
    }
    return { due, status: clean(status, 160), done, grade }
  }

  function mergeAssignmentLists(baseList, extraList) {
    const map = new Map()
    for (const item of [...(baseList || []), ...(extraList || [])]) {
      if (!item || !item.id) continue
      map.set(item.id, mergeAssignmentItem(map.get(item.id), item))
    }
    return Array.from(map.values())
  }

  function readPageSesskey(doc, rawHtml = '') {
    if (doc === document && globalThis.M?.cfg?.sesskey) {
      const direct = clean(globalThis.M.cfg.sesskey, 80)
      if (/^[A-Za-z0-9_-]{6,64}$/.test(direct)) return direct
    }
    const inputVal = clean(doc?.querySelector?.('input[name="sesskey"]')?.getAttribute('value') || doc?.querySelector?.('input[name="sesskey"]')?.value, 80)
    if (/^[A-Za-z0-9_-]{6,64}$/.test(inputVal)) return inputVal
    for (const anchor of Array.from(doc?.querySelectorAll?.('a[href*="sesskey="]') || [])) {
      try {
        const candidate = clean(new URL(anchor.getAttribute('href') || '', location.href).searchParams.get('sesskey'), 80)
        if (/^[A-Za-z0-9_-]{6,64}$/.test(candidate)) return candidate
      } catch (_) { /* ignore */ }
    }
    const m = (rawHtml || String(doc?.documentElement?.innerHTML || '')).match(/"sesskey"\s*:\s*"([A-Za-z0-9_-]{6,64})"/)
    return m ? m[1] : ''
  }

  async function discoverEnrolledMoodleCourses(baseCourses) {
    const mergedMap = new Map()
    const mergeCourseEntry = (item) => {
      if (!item || !item.id || !item.title || item.id === '1' || GENERIC_COURSE_LABEL.test(item.title)) return
      const prev = mergedMap.get(item.id)
      if (!prev) { mergedMap.set(item.id, item); return }
      mergedMap.set(item.id, {
        ...prev, ...item,
        title: item.title.length >= prev.title.length ? item.title : prev.title,
        code: item.code || prev.code || undefined,
        shortname: item.shortname || prev.shortname || undefined,
        category: item.category || prev.category || undefined,
        section: item.section || prev.section || undefined,
        term: item.term || prev.term || undefined,
        url: item.url || existingUrl(prev),
      })
    }
    const existingUrl = p => p?.url || undefined
    for (const c of baseCourses || []) mergeCourseEntry(c)
    const currentUrl = new URL(location.href)
    let sesskey = readPageSesskey(document)
    let authoritativeCourses = false

    if (!/^\/my\/courses\.php$/i.test(currentUrl.pathname)) {
      try {
        const myCoursesUrl = `${currentUrl.origin}/my/courses.php`
        const resp = await fetch(myCoursesUrl, { credentials: 'include' })
        if (resp.ok) {
          const html = await resp.text()
          const doc = new DOMParser().parseFromString(html, 'text/html')
          if (!doc.querySelector('input[type="password"]') && !doc.body?.classList.contains('notloggedin')) {
            if (!sesskey) sesskey = readPageSesskey(doc, html)
            for (const c of extractCoursesFromDocument(doc, myCoursesUrl)) mergeCourseEntry(c)
          }
        }
      } catch (_) { /* optional discovery page */ }
    }

    if (sesskey) {
      try {
        const ajaxUrl = `${currentUrl.origin}/lib/ajax/service.php?sesskey=${encodeURIComponent(sesskey)}&info=core_course_get_enrolled_courses_by_timeline_classification`
        const ingestList = (rawCourses) => {
          for (const raw of rawCourses) {
            if (!raw || typeof raw !== 'object') continue
            const id = clean(String(raw.id ?? ''), 80)
            const fullname = stripCourseSrPrefix(decodeHtmlText(raw.fullname || raw.displayname || raw.shortname, 300))
            if (!id || id === '1' || !fullname) continue
            const shortname = decodeHtmlText(raw.shortname, 120)
            const category = decodeHtmlText(raw.coursecategory, 160)
            const meta = extractCourseMeta(fullname, shortname, category)
            const viewUrl = pageHref({ getAttribute: () => raw.viewurl || `/course/view.php?id=${encodeURIComponent(id)}` }, currentUrl.origin) || `${currentUrl.origin}/course/view.php?id=${encodeURIComponent(id)}`
            mergeCourseEntry({
              id, title: fullname, url: viewUrl,
              ...(meta.code ? { code: meta.code } : {}),
              ...(shortname ? { shortname } : {}),
              ...(category ? { category } : {}),
              ...(meta.section ? { section: meta.section } : {}),
              ...(meta.term ? { term: meta.term } : {}),
              ...(meta.isSubclass ? { isSubclass: true } : {}),
              ...(meta.isNonAcademic ? { isNonAcademic: true } : {}),
              ...(raw.hidden === true ? { moodleHidden: true } : {}),
              ...(raw.isfavourite === true ? { starred: true } : {}),
            })
          }
        }
        const fetchClassificationBatch = async (specs) => {
          const ajaxResp = await fetch(ajaxUrl, {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(specs.map((spec, index) => ({
              index, methodname: 'core_course_get_enrolled_courses_by_timeline_classification',
              args: { offset: spec.offset || 0, limit: 200, classification: spec.classification, sort: 'fullname' },
            }))),
          })
          if (!ajaxResp.ok) return null
          const rawJson = typeof ajaxResp.json === 'function' ? await ajaxResp.json() : JSON.parse(await ajaxResp.text())
          return Array.isArray(rawJson) ? rawJson : null
        }
        const classifications = ['allincludinghidden', 'all', 'inprogress', 'future', 'past']
        const firstBatch = await fetchClassificationBatch(classifications.map(classification => ({ classification, offset: 0 })))
        if (firstBatch) {
          let fullOk = false; let partOk = 0
          let pendingSpecs = []
          for (let i = 0; i < firstBatch.length; i += 1) {
            const item = firstBatch[i]
            if (!item || item.error !== false || !Array.isArray(item.data?.courses)) continue
            if (i <= 1) fullOk = true; else partOk += 1
            ingestList(item.data.courses)
            const nextOffset = Number(item.data.nextoffset)
            if (item.data.courses.length >= 200 && Number.isFinite(nextOffset) && nextOffset > 0 && classifications[i]) {
              pendingSpecs.push({ classification: classifications[i], offset: nextOffset })
            }
          }
          if (fullOk || partOk >= 3) authoritativeCourses = true
          let pageGuard = 0
          while (pendingSpecs.length > 0 && pageGuard < 4) {
            pageGuard += 1
            const moreBatch = await fetchClassificationBatch(pendingSpecs)
            if (!moreBatch) break
            const followUp = []
            for (let i = 0; i < moreBatch.length; i += 1) {
              const item = moreBatch[i]
              const spec = pendingSpecs[i]
              if (!item || item.error !== false || !Array.isArray(item.data?.courses) || !spec) continue
              ingestList(item.data.courses)
              const nextOffset = Number(item.data.nextoffset)
              if (item.data.courses.length >= 200 && Number.isFinite(nextOffset) && nextOffset > spec.offset) {
                followUp.push({ classification: spec.classification, offset: nextOffset })
              }
            }
            pendingSpecs = followUp
          }
        }
        if (!authoritativeCourses) {
          const singleAll = await fetchClassificationBatch([{ classification: 'all', offset: 0 }])
          if (singleAll && singleAll[0]?.error === false && Array.isArray(singleAll[0]?.data?.courses)) {
            ingestList(singleAll[0].data.courses)
            authoritativeCourses = true
          }
        }
      } catch (_) { /* optional Moodle AJAX */ }
    }

    if (!authoritativeCourses) {
      try {
        const profileUrl = `${currentUrl.origin}/user/profile.php?showallcourses=1`
        const profResp = await fetch(profileUrl, { credentials: 'include' })
        if (profResp.ok) {
          const profDoc = new DOMParser().parseFromString(await profResp.text(), 'text/html')
          if (!profDoc.querySelector('input[type="password"]') && !profDoc.body?.classList.contains('notloggedin')) {
            let count = 0
            profDoc.querySelectorAll('a[href*="/user/view.php"], a[href*="/course/view.php"]').forEach(link => {
              const href = pageHref(link, profileUrl)
              if (!href) return
              try {
                const parsed = new URL(href)
                const cid = parsed.pathname.includes('/user/view.php') ? parsed.searchParams.get('course') : parsed.searchParams.get('id')
                const title = visibleLabelFromNode(link) || stripCourseSrPrefix(link.textContent)
                if (!cid || cid === '1' || !title || GENERIC_COURSE_LABEL.test(title)) return
                const meta = extractCourseMeta(title)
                mergeCourseEntry({
                  id: cid, title, url: `${currentUrl.origin}/course/view.php?id=${encodeURIComponent(cid)}`,
                  ...(meta.code ? { code: meta.code } : {}),
                  ...(meta.section ? { section: meta.section } : {}),
                  ...(meta.term ? { term: meta.term } : {}),
                  ...(meta.isSubclass ? { isSubclass: true } : {}),
                  ...(meta.isNonAcademic ? { isNonAcademic: true } : {}),
                })
                count += 1
              } catch (_) { /* ignore */ }
            })
            if (count > 0) authoritativeCourses = true
          }
        }
      } catch (_) { /* optional profile fallback */ }
    }
    return { courses: finalizeCourseList(Array.from(mergedMap.values())), authoritativeCourses }
  }

  async function crawlMoodleCoursePages(baseData) {
    const discovered = await discoverEnrolledMoodleCourses(baseData.courses)
    if (discovered.courses.length > 0) {
      deliverAndroid({
        connected: true,
        courses: discovered.courses,
        ...(discovered.authoritativeCourses ? { replaceFields: ['courses'] } : {}),
        detail: clean(document.title, 240) || location.pathname,
      })
    }
    const coursesMap = new Map(discovered.courses.map(item => [item.id, item]))
    const current = new URL(location.href)
    const orderedCourses = [...discovered.courses].sort((a, b) => {
      const score = c => (c.starred ? 4 : 0) + (c.moodleHidden ? -2 : 1) + (c.isNonAcademic ? -1 : 1)
      return score(b) - score(a)
    })
    const links = orderedCourses
      .map(c => c.url || (/^\d+$/.test(c.id) ? `${current.origin}/course/view.php?id=${encodeURIComponent(c.id)}` : ''))
      .filter(Boolean)
    Array.from(document.querySelectorAll('a[href*="/course/view.php"]')).forEach(link => {
      const rawHref = link.getAttribute('href') || ''
      if (/#section-\d+/i.test(rawHref)) return
      const href = pageHref(link, location.href)
      if (!href) return
      try {
        const parsed = new URL(href)
        if (!parsed.searchParams.has('section')) {
          links.push(parsed.searchParams.get('id') ? `${parsed.origin}/course/view.php?id=${encodeURIComponent(parsed.searchParams.get('id'))}` : href)
        }
      } catch (_) { /* ignore */ }
    })
    if (/\/course\/(view|overview)\.php$/.test(current.pathname) && current.searchParams.has('id')) {
      links.unshift(`${current.origin}/course/view.php?id=${encodeURIComponent(current.searchParams.get('id'))}`)
    }
    const unique = Array.from(new Set(links)).slice(0, 120)
    const cacheKey = `${unique.join('|')}::${coursesMap.size}`
    const cached = globalThis.__myhkuMoodleCrawlCache
    if (!globalThis.__myhkuForceCrawl && cached && cached.key === cacheKey && Date.now() - cached.at < 60_000) {
      return {
        courses: finalizeCourseList(Array.from(coursesMap.values())),
        assignments: mergeAssignmentLists(baseData.assignments, cached.extra.assignments),
        announcements: Array.from(new Map([...baseData.announcements, ...cached.extra.announcements].map(item => [item.id, item])).values()),
        resources: Array.from(new Map([...baseData.resources, ...cached.extra.resources].map(item => [item.id, item])).values()),
        grades: Array.from(new Map([...baseData.grades, ...cached.extra.grades].map(item => [item.id, item])).values()),
        completeCrawl: cached.completeCrawl,
        authoritativeCourses: discovered.authoritativeCourses,
      }
    }
    const extra = { assignments: [], announcements: [], resources: [], grades: [] }
    const seen = { assignments: new Set(), announcements: new Set(), resources: new Set(), grades: new Set() }
    const upsertAssignment = (item) => {
      const index = extra.assignments.findIndex(existing => existing.id === item.id)
      if (index < 0) { seen.assignments.add(item.id); extra.assignments.push(item) }
      else extra.assignments[index] = mergeAssignmentItem(extra.assignments[index], item)
    }
    const resourceSelector = 'a[href*="/mod/resource/"], a[href*="/mod/folder/"], a[href*="/mod/url/"], a[href*="/mod/page/"], a[href*="/mod/book/"], .activity a[href*="/pluginfile.php/"], .section a[href*="/pluginfile.php/"], table.generaltable a[href*="/pluginfile.php/"]'
    const collectDocResources = (rootDoc, base, heading, cidField) => {
      let added = 0
      rootDoc.querySelectorAll(resourceSelector).forEach(link => {
        const href = pageHref(link, base)
        if (!href || /\/(?:index|edit)\.php\b/i.test(href)) return
        const title = visibleLabelFromNode(link) || clean(link.textContent) || clean(link.getAttribute('aria-label'))
        if (!title) return
        const id = idFrom(link, href, 'resource', `${heading}|${title}`)
        if (seen.resources.has(id)) return
        seen.resources.add(id)
        extra.resources.push({ id, title, course: heading, ...cidField, url: href })
        added += 1
      })
      return added
    }
    let failedCourses = 0
    await runBounded(unique, 6, async (courseUrl) => {
      try {
        const response = await fetch(courseUrl, { credentials: 'include' })
        if (!response.ok) { failedCourses += 1; return }
        const html = await response.text()
        const doc = new DOMParser().parseFromString(html, 'text/html')
        const courseId = new URL(courseUrl).searchParams.get('id') || ''
        const knownCourse = courseId ? coursesMap.get(courseId) : undefined
        const pageHeading = stripCourseSrPrefix(doc.querySelector('h1, .page-header-headings, [data-region="header"]')?.textContent)
        const heading = pageHeading || knownCourse?.title || '未提供课程'
        if (courseId && courseId !== '1' && pageHeading && !GENERIC_COURSE_LABEL.test(pageHeading)) {
          const meta = extractCourseMeta(pageHeading, knownCourse?.shortname || '', knownCourse?.category || '')
          coursesMap.set(courseId, {
            ...(knownCourse || { id: courseId, url: courseUrl }),
            id: courseId,
            title: knownCourse?.title && knownCourse.title.length > pageHeading.length ? knownCourse.title : pageHeading,
            ...(knownCourse?.code || meta.code ? { code: knownCourse?.code || meta.code } : {}),
            ...(knownCourse?.section || meta.section ? { section: knownCourse?.section || meta.section } : {}),
            ...(knownCourse?.term || meta.term ? { term: knownCourse?.term || meta.term } : {}),
            ...((knownCourse?.isSubclass || meta.isSubclass) ? { isSubclass: true } : {}),
            ...((knownCourse?.isNonAcademic || meta.isNonAcademic) ? { isNonAcademic: true } : {}),
          })
        }
        const cidField = courseId ? { courseId } : {}
        const pendingDetailLinks = []
        let courseResourcesFound = collectDocResources(doc, courseUrl, heading, cidField)
        doc.querySelectorAll('a[href*="/mod/assign/"], a[href*="assign/view"], a[href*="/mod/quiz/"], a[href*="/mod/turnitintooltwo/"]').forEach(link => {
          const href = pageHref(link, courseUrl)
          if (!href || /\/(?:index|report|edit)\.php\b/i.test(href)) return
          const root = nearest(link); const title = clean(link.textContent) || text(root, ['.activityname', '.instancename', 'h3', 'h4'])
          if (!title) return
          const id = idFrom(root, href, 'assignment', `${heading}|${title}`)
          const due = parseDue(root); const status = submissionStatus(root); const done = completed(root)
          upsertAssignment({ id, title, course: heading, ...cidField, ...(due ? { due } : {}), ...(status ? { submissionStatus: status } : {}), ...(done === undefined ? {} : { completed: done }) })
          if (/\/mod\/assign\/view\.php\b/i.test(href) && (!due || !status || done === undefined)) {
            pendingDetailLinks.push({ id, title, href })
          }
        })
        doc.querySelectorAll('a[href*="/mod/forum/"]').forEach(link => {
          const root = nearest(link); const href = pageHref(link, courseUrl); const title = clean(link.textContent) || text(root, ['.discussionname', '.subject', 'h3', 'h4'])
          if (!href || !title || !/announcement|news|notice|公告|通知|forum|discussion/i.test(`${title} ${clean(root.textContent)}`)) return
          const id = idFrom(root, href, 'announcement', `${heading}|${title}`)
          if (seen.announcements.has(id)) return
          seen.announcements.add(id); const timeNode = root.querySelector('time[datetime], time, .date, .discussion-date'); const published = clean(timeNode && (timeNode.getAttribute('datetime') || timeNode.textContent))
          extra.announcements.push({ id, title, course: heading, ...cidField, ...(published ? { published } : {}), url: href })
        })
        doc.querySelectorAll('table.grades tr, table.user-grade tr').forEach(node => {
          const root = node.matches('tr') ? node : nearest(node)
          if (root.querySelector('th') && !root.querySelector('td')) return
          const cells = Array.from(root.querySelectorAll('th,td')).map(cell => clean(cell.textContent)).filter(Boolean)
          const title = cells[0]
          if (!title || /^(?:grade\s*item|item\s*name|name|项目|名称)$/i.test(title)) return
          const parsed = extractGradeFromRow(root)
          if (!parsed) return
          const href = pageHref(root.querySelector('a'), courseUrl)
          const id = idFrom(root, href, 'grade', `${heading}|${title}`)
          if (seen.grades.has(id)) return
          seen.grades.add(id)
          extra.grades.push({ id, title, course: heading, ...cidField, ...(parsed.value ? { value: parsed.value } : {}), released: parsed.released })
        })
        // Moodle 5 puts due dates, submission states, resources and grades in the course
        // overview or mod/assign/index.php. Fetch summary endpoints in parallel.
        const summaryUrls = courseId ? [
          new URL(`/course/overview.php?id=${encodeURIComponent(courseId)}`, courseUrl).href,
          new URL(`/mod/assign/index.php?id=${encodeURIComponent(courseId)}`, courseUrl).href,
        ] : []
        await Promise.all(summaryUrls.map(async summaryUrl => {
          try {
            const overviewResponse = await fetch(summaryUrl, { credentials: 'include' })
            if (!overviewResponse.ok) return
            const overview = new DOMParser().parseFromString(await overviewResponse.text(), 'text/html')
            courseResourcesFound += collectDocResources(overview, summaryUrl, heading, cidField)
            overview.querySelectorAll('a[href*="/mod/assign/view.php"], a[href*="/mod/quiz/view.php"], a[href*="/mod/turnitintooltwo/view.php"]').forEach(link => {
              const root = nearest(link); const href = pageHref(link, summaryUrl)
              const title = clean(link.textContent)
              if (!href || !title) return
              const id = idFrom(root, href, 'assignment', title)
              const due = parseDue(root); const status = submissionStatus(root); const done = completed(root)
              upsertAssignment({ id, title, course: heading, ...cidField, ...(due ? { due } : {}), ...(status ? { submissionStatus: status } : {}), ...(done === undefined ? {} : { completed: done }) })
              const parsedGrade = extractGradeFromRow(root)
              if (parsedGrade) {
                const gradeId = `grade-${id}`
                const gradeItem = { id: gradeId, title, course: heading, ...cidField, ...(parsedGrade.value ? { value: parsedGrade.value } : {}), released: parsedGrade.released }
                const gradeIdx = extra.grades.findIndex(existing => existing.id === gradeId)
                if (gradeIdx < 0) { seen.grades.add(gradeId); extra.grades.push(gradeItem) }
                else extra.grades[gradeIdx] = gradeItem
              }
            })
          } catch (_) { /* optional summary endpoint */ }
        }))
        if (courseId && courseResourcesFound === 0) {
          try {
            const resIndexUrl = new URL(`/course/resources.php?id=${encodeURIComponent(courseId)}`, courseUrl).href
            const resIndexResp = await fetch(resIndexUrl, { credentials: 'include' })
            if (resIndexResp.ok) {
              const resDoc = new DOMParser().parseFromString(await resIndexResp.text(), 'text/html')
              collectDocResources(resDoc, resIndexUrl, heading, cidField)
            }
          } catch (_) { /* optional resources index fallback */ }
        }
        // For assignments still missing due date or submission status, inspect up to 6 individual assign view pages.
        const unresolved = pendingDetailLinks.filter(candidate => {
          const currentItem = extra.assignments.find(item => item.id === candidate.id)
          return !currentItem || !currentItem.due || !currentItem.submissionStatus || currentItem.completed === undefined
        }).slice(0, 6)
        await runBounded(unresolved, 3, async (candidate) => {
          try {
            const detailResp = await fetch(candidate.href, { credentials: 'include' })
            if (!detailResp.ok) return
            const detailDoc = new DOMParser().parseFromString(await detailResp.text(), 'text/html')
            const detail = extractAssignDetailFields(detailDoc)
            upsertAssignment({
              id: candidate.id,
              title: candidate.title,
              course: heading,
              ...cidField,
              ...(detail.due ? { due: detail.due } : {}),
              ...(detail.status ? { submissionStatus: detail.status } : {}),
              ...(detail.done !== undefined ? { completed: detail.done } : {}),
            })
            if (detail.grade) {
              const gradeId = `grade-${candidate.id}`
              const gradeItem = { id: gradeId, title: candidate.title, course: heading, ...cidField, ...(detail.grade.value ? { value: detail.grade.value } : {}), released: detail.grade.released }
              const gradeIdx = extra.grades.findIndex(existing => existing.id === gradeId)
              if (gradeIdx < 0) { seen.grades.add(gradeId); extra.grades.push(gradeItem) }
              else extra.grades[gradeIdx] = gradeItem
            }
          } catch (_) { /* optional detail endpoint */ }
        })
      } catch (_) { failedCourses += 1 }
    })
    const finalCourses = finalizeCourseList(Array.from(coursesMap.values()))
    const completeCrawl = unique.length > 0 && failedCourses === 0 && unique.length >= finalCourses.length
    globalThis.__myhkuMoodleCrawlCache = { key: cacheKey, at: Date.now(), extra, completeCrawl }
    return {
      courses: finalCourses,
      assignments: mergeAssignmentLists(baseData.assignments, extra.assignments),
      announcements: Array.from(new Map([...baseData.announcements, ...extra.announcements].map(item => [item.id, item])).values()),
      resources: Array.from(new Map([...baseData.resources, ...extra.resources].map(item => [item.id, item])).values()),
      grades: Array.from(new Map([...baseData.grades, ...extra.grades].map(item => [item.id, item])).values()),
      completeCrawl,
      authoritativeCourses: discovered.authoritativeCourses,
    }
  }

  function normalizeClock(value) {
    const match = clean(value).match(/(\d{1,2})(?::|：)(\d{2})\s*(AM|PM)?/i)
    if (!match) return ''
    let hour = Number(match[1])
    const minute = Number(match[2])
    const suffix = match[3]?.toUpperCase()
    if (suffix === 'PM' && hour < 12) hour += 12
    if (suffix === 'AM' && hour === 12) hour = 0
    if (hour > 23 || minute > 59) return ''
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  }

  function addMinutesClock(clock, delta) {
    const match = String(clock || '').match(/^(\d{2}):(\d{2})$/)
    if (!match) return ''
    const total = Number(match[1]) * 60 + Number(match[2]) + delta
    if (total < 0 || total >= 24 * 60) return ''
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
  }

  function timePair(value) {
    const matches = clean(value).match(/\b\d{1,2}(?::|：)\d{2}\s*(?:AM|PM)?\b/gi) || []
    return { start: normalizeClock(matches[0] || ''), end: normalizeClock(matches[1] || '') }
  }

  function plusDaysIso(iso, days) {
    const date = new Date(`${iso}T00:00:00Z`)
    if (Number.isNaN(date.getTime())) return iso
    date.setUTCDate(date.getUTCDate() + days)
    return date.toISOString().slice(0, 10)
  }

  function extractWeekRange(rootDocument = document, seen = new Set()) {
    if (!rootDocument || seen.has(rootDocument)) return undefined
    seen.add(rootDocument)
    const iso = (day, month, year) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const raw = String(rootDocument.body?.textContent || rootDocument.documentElement?.textContent || '')
    const fullDmy = raw.match(/Week\s+of\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(?:[-–—~]+|to)\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i)
    if (fullDmy) {
      return { start: iso(Number(fullDmy[1]), Number(fullDmy[2]), Number(fullDmy[3])), end: iso(Number(fullDmy[4]), Number(fullDmy[5]), Number(fullDmy[6])) }
    }
    const fullIso = raw.match(/Week\s+of\s+(\d{4}-\d{2}-\d{2})\s*(?:[-–—~]+|to)\s*(\d{4}-\d{2}-\d{2})/i)
    if (fullIso) {
      return { start: fullIso[1], end: fullIso[2] }
    }
    const singleDmy = raw.match(/Week\s+of\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i)
    if (singleDmy) {
      const start = iso(Number(singleDmy[1]), Number(singleDmy[2]), Number(singleDmy[3]))
      return { start, end: plusDaysIso(start, 6) }
    }
    const singleIso = raw.match(/Week\s+of\s+(\d{4}-\d{2}-\d{2})/i)
    if (singleIso) {
      return { start: singleIso[1], end: plusDaysIso(singleIso[1], 6) }
    }
    const headerDates = Array.from(rootDocument.querySelectorAll?.('th, .bkgCalViewWDHeader, .bkgCalViewwdheader') || [])
      .map(node => {
        const label = clean(node.textContent)
        const dmy = label.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/)
        if (dmy) return iso(Number(dmy[1]), Number(dmy[2]), Number(dmy[3]))
        const ymd = label.match(/\b(\d{4}-\d{2}-\d{2})\b/)
        return ymd ? ymd[1] : ''
      })
      .filter(Boolean)
      .sort()
    if (headerDates.length >= 2) {
      const first = new Date(`${headerDates[0]}T00:00:00Z`)
      if (!Number.isNaN(first.getTime())) {
        first.setUTCDate(first.getUTCDate() - first.getUTCDay())
        const start = first.toISOString().slice(0, 10)
        return { start, end: plusDaysIso(start, 6) }
      }
    }
    for (const frame of Array.from(rootDocument.querySelectorAll?.('iframe, frame') || [])) {
      try {
        const nested = extractWeekRange(frame.contentDocument, seen)
        if (nested) return nested
      } catch (_) { /* cross-origin frame */ }
    }
    return undefined
  }

  function extractSis(rootDocument = document, seenDocuments = new Set()) {
    if (!rootDocument || seenDocuments.has(rootDocument)) return []
    seenDocuments.add(rootDocument)
    const schedule = []
    const week = extractWeekRange(rootDocument)
    const weekday = value => {
      const raw = clean(value).toLowerCase()
      const english = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].findIndex(day => new RegExp(`\\b${day}(?:day|sday|nesday|rsday|urday)?\\b`).test(raw))
      if (english >= 0) return english
      return ['日', '一', '二', '三', '四', '五', '六'].findIndex(day => raw.includes(`星期${day}`) || raw.includes(`周${day}`))
    }
    const dated = day => {
      const cleaned = clean(day)
      const ymd = cleaned.match(/\b(\d{4}-\d{2}-\d{2})\b/)
      if (ymd) return ymd[1]
      const match = cleaned.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
      if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
      const index = weekday(cleaned)
      if (!week || index < 0) return undefined
      const date = new Date(`${week.start}T00:00:00Z`)
      date.setUTCDate(date.getUTCDate() + (index - date.getUTCDay() + 7) % 7)
      return date.toISOString().slice(0, 10)
    }
    const add = (node, day, fallbackTimes) => {
      const raw = String(node.innerHTML || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ')
      const times = raw.match(/(\d{1,2}(?::|：)\d{2}\s*(?:AM|PM)?)\s*(?:[-–—~]+|to)\s*(\d{1,2}(?::|：)\d{2}\s*(?:AM|PM)?)/i)
      let start = ''
      let end = ''
      let title = ''
      let room = ''
      if (times) {
        start = normalizeClock(times[1])
        end = normalizeClock(times[2])
        const before = clean(raw.slice(0, times.index)).replace(/\s*--\s*$/, '')
        const afterRaw = raw.slice(times.index + times[0].length)
        const after = clean(afterRaw).replace(/^--\s*/, '').replace(/\s*--$/, '')
        if (codeFrom(before)) {
          title = before
          room = after
        } else if (codeFrom(after)) {
          const lines = afterRaw.split(/\n+/).map(line => clean(line).replace(/^--\s*|\s*--$/g, '')).filter(Boolean)
          const codeIdx = lines.findIndex(line => Boolean(codeFrom(line)))
          title = codeIdx >= 0 ? lines[codeIdx] : after
          room = lines.filter((_, idx) => idx !== codeIdx).join(' ')
        }
      } else if (fallbackTimes?.start && fallbackTimes?.end) {
        const lines = raw.split(/\n+/).map(line => clean(line).replace(/^--\s*|\s*--$/g, '')).filter(Boolean)
        const codeIdx = lines.findIndex(line => Boolean(codeFrom(line)))
        if (codeIdx >= 0) {
          start = fallbackTimes.start
          end = fallbackTimes.end
          title = lines[codeIdx]
          room = lines.filter((_, idx) => idx !== codeIdx).join(' ')
        }
      }
      if (!start || !end || !title || !codeFrom(title)) return
      const date = dated(day)
      const id = `meeting-${date || day}-${title}-${start}-${end}`
      if (!schedule.some(item => item.id === id)) schedule.push({ id, title, code: codeFrom(title), day, ...(date ? { date } : {}), start, end, ...(room ? { room } : {}) })
    }

    // cellIndex ignores earlier rowspans. Reconstruct the logical grid first.
    rootDocument.querySelectorAll('table').forEach(table => {
      const matrix = []; const origins = []
      Array.from(table.rows).forEach((row, r) => {
        matrix[r] ||= []
        let c = 0
        Array.from(row.cells).forEach(cell => {
          while (matrix[r][c]) c++
          const height = cell.rowSpan === 0 ? table.rows.length - r : cell.rowSpan || 1
          for (let y = r; y < r + height; y++) {
            matrix[y] ||= []
            for (let x = c; x < c + (cell.colSpan || 1); x++) matrix[y][x] = cell
          }
          origins.push({ cell, r, c, height }); c += cell.colSpan || 1
        })
      })
      const headerRow = matrix.findIndex(row => row.filter(cell => weekday(cell?.textContent) >= 0).length >= 5)
      if (headerRow < 0) return
      const headers = matrix[headerRow].map(cell => clean(cell?.textContent))
      const rowSlot = rowIndex => timePair(matrix[rowIndex]?.[0]?.textContent || '')
      for (const { cell, r, c, height } of origins) {
        if (r <= headerRow || weekday(headers[c]) < 0) continue
        const firstSlot = rowSlot(r)
        const lastSlot = rowSlot(r + height - 1)
        const nextSlot = rowSlot(r + height)
        const fallbackStart = firstSlot.start
        const fallbackEnd = lastSlot.end || nextSlot.start || (fallbackStart ? addMinutesClock(fallbackStart, height * 60 - 10) : '')
        add(cell, headers[c], fallbackStart && fallbackEnd ? { start: fallbackStart, end: fallbackEnd } : undefined)
      }
    })
    if (!schedule.length) {
      const headers = Array.from(rootDocument.querySelectorAll('.bkgCalViewWDHeader, .bkgCalViewwdheader'))
      const styleLength = (node, prop) => {
        const match = (node?.getAttribute?.('style') || '').match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([\\d.]+)(%|px|em|rem)`, 'i'))
        return match ? { value: Number(match[1]), unit: match[2].toLowerCase() } : null
      }
      rootDocument.querySelectorAll('[class*="bkgCalViewItem"]').forEach(node => {
        const pos = styleLength(node, 'left')
        const width = styleLength(node, 'width')
        const matching = pos ? headers.filter(header => styleLength(header, 'left')?.unit === pos.unit) : []
        let header = pos && matching.length
          ? matching.reduce((best, item) => Math.abs(styleLength(item, 'left').value - pos.value) < Math.abs(styleLength(best, 'left').value - pos.value) ? item : best)
          : null
        if (!header) {
          const rect = node.getBoundingClientRect?.()
          if (rect && rect.width > 0) {
            const centerX = rect.left + rect.width / 2
            const measured = headers
              .map(item => ({ item, rect: item.getBoundingClientRect() }))
              .filter(entry => entry.rect.width > 0)
            if (measured.length && (measured.length === 1 || Math.abs(measured[measured.length - 1].rect.left - measured[0].rect.left) > 4)) {
              header = measured.find(entry => centerX >= entry.rect.left && centerX < entry.rect.right)?.item ||
                measured.reduce((best, entry) =>
                  Math.abs(entry.rect.left + entry.rect.width / 2 - centerX) < Math.abs(best.rect.left + best.rect.width / 2 - centerX)
                    ? entry
                    : best
                ).item
            }
          }
        }
        if (!header && pos && pos.unit === 'em' && headers.length === 7) {
          // HKU MyWeekly positions items against a 3em time gutter + seven 10em weekday columns.
          const centerEm = pos.value + (width?.unit === 'em' ? width.value / 2 : 5)
          const colIndex = Math.floor((centerEm - 3) / 10)
          if (colIndex >= 0 && colIndex < headers.length) header = headers[colIndex]
        }
        add(node, clean(header?.textContent))
      })
    }
    if (schedule.length) return schedule
    rootDocument.querySelectorAll('table').forEach((table) => {
      const rows = Array.from(table.querySelectorAll('tbody tr, tr'))
      // PeopleSoft tables often use a <th> header row without <thead>.
      const headerNodes = table.querySelectorAll('thead th').length
        ? table.querySelectorAll('thead th')
        : (table.querySelector('tr')?.querySelectorAll('th') || [])
      const headers = Array.from(headerNodes).map((x) => clean(x.textContent).toLowerCase())
      rows.forEach((row, index) => {
        const cellNodes = Array.from(row.querySelectorAll('th,td'))
        const cells = cellNodes.map((x) => clean(x.textContent))
        // Header-only rows are metadata, never meetings.
        if (!cells.length || (row.querySelector('th') && !row.querySelector('td'))) return
        const cardCells = cells.length ? cells : [
          attr(row, ['data-course-name', 'data-title']) || text(row, ['.course-name', '.course-title', '.subject', 'h2', 'h3', 'h4']) || clean(row.textContent),
          attr(row, ['data-time']) || text(row, ['.time', '.class-time', '[class*="time"]']),
          attr(row, ['data-location', 'data-room']) || text(row, ['.location', '.room', '[class*="room"]']),
          attr(row, ['data-teacher', 'data-instructor']) || text(row, ['.teacher', '.instructor', '[class*="teacher"]']),
        ]
        const whole = cardCells.join(' · '); const timeIndex = headers.findIndex((h) => /time|时段|时间/.test(h)); const pair = timePair(timeIndex >= 0 ? cardCells[timeIndex] : whole)
        const find = (patterns) => {
          const i = headers.findIndex((h) => patterns.some((p) => p.test(h)))
          if (i >= 0) return cardCells[i] || ''
          // Some PeopleSoft skins omit table headers but annotate cells with
          // semantic class/id names. Use those names before positional fallbacks.
          const node = cellNodes.find((candidate) => patterns.some((p) => p.test(`${candidate.className || ''} ${candidate.id || ''} ${candidate.getAttribute?.('aria-label') || ''}`.toLowerCase())))
          return clean(node?.textContent)
        }
        const title = attr(row, ['data-course-name', 'data-title']) || find([/course\s*(?:title|name)?|subject|class|课程|科目/]) || cardCells[0]; if (!title || /^(course|subject|课程|time|时间)$/i.test(title)) return
        if (!pair.start || !pair.end) return
        const code = attr(row, ['data-course-code', 'data-code']) || find([/code|编号/]) || codeFrom(title) || codeFrom(whole); const day = find([/day|星期/]); const date = find([/date|日期/]); const room = attr(row, ['data-room', 'data-location']) || find([/room|location|venue|地点|教室/]); const teacher = attr(row, ['data-teacher', 'data-instructor']) || find([/teacher|instructor|lecturer|教师|老师/])
        const id = idFrom(row, linkHref(row.querySelector('a')), 'class', title + pair.start + pair.end + index)
        if (!schedule.some((entry) => entry.id === id)) schedule.push({ id, title: title.replace(code, '').trim() || title, ...(code ? { code } : {}), ...(date ? { date } : {}), ...(day ? { day } : {}), start: pair.start, end: pair.end, ...(room ? { room } : {}), ...(teacher ? { teacher } : {}) })
      })
    })
    // The top PeopleSoft shell contains the actual timetable in a same-origin
    // iframe or frame. Inspect loaded child documents without reading any credentials.
    rootDocument.querySelectorAll('iframe, frame').forEach((frame) => {
      try {
        const nested = frame.contentDocument
        for (const item of extractSis(nested, seenDocuments)) if (!schedule.some((entry) => entry.id === item.id)) schedule.push(item)
      } catch (_) { /* cross-origin or unloaded frame */ }
    })
    return schedule
  }

  async function crawlPortalSchedule(baseSchedule) {
    const candidates = Array.from(document.querySelectorAll('a[href]')).map(link => {
      const href = pageHref(link, location.href)
      const label = clean(link.textContent)
      return { href, label }
    }).filter(item => item.href && /sis|schedule|timetable|class|course|study|registration|enrol|课表|课程|选课/i.test(`${item.href} ${item.label}`))
    const urls = Array.from(new Set(candidates.map(item => item.href))).slice(0, 25)
    const merged = [...baseSchedule]
    await Promise.all(urls.map(async url => {
      try {
        const response = await fetch(url, { credentials: 'include' })
        if (!response.ok) return
        const html = await response.text()
        const doc = new DOMParser().parseFromString(html, 'text/html')
        for (const item of extractSis(doc)) if (!merged.some(existing => existing.id === item.id)) merged.push(item)
      } catch (_) { /* an unavailable portal tile should not fail the sync */ }
    }))
    return merged
  }

  function findWeekNavRequests(doc, baseUrl, direction = 'next') {
    const pattern = direction === 'prev'
      ? /(?:prev(?:ious)?\s*week|上一?周|上週|prev\s*7|prior\s*week)/i
      : /(?:next\s*week|下一?周|下週|next\s*7|forward)/i
    const results = []
    const collect = (root, seen = new Set()) => {
      if (!root || seen.has(root)) return
      seen.add(root)
      for (const link of Array.from(root.querySelectorAll?.('a[href]') || [])) {
        const label = `${clean(link.textContent)} ${clean(link.getAttribute('title'))} ${clean(link.getAttribute('aria-label'))}`
        if (!pattern.test(label)) continue
        const href = pageHref(link, baseUrl)
        if (href) results.push({ url: href, method: 'GET' })
      }
      for (const btn of Array.from(root.querySelectorAll?.('button[onclick], input[onclick]') || [])) {
        const label = `${clean(btn.textContent)} ${clean(btn.getAttribute('value'))} ${clean(btn.getAttribute('title'))} ${clean(btn.getAttribute('aria-label'))}`
        if (!pattern.test(label)) continue
        const onclick = btn.getAttribute('onclick') || ''
        const urlMatch = onclick.match(/(?:location(?:\.href)?\s*=\s*|window\.open\(\s*)['"]([^'"]+)['"]/i)
        if (urlMatch) {
          try {
            const parsed = new URL(urlMatch[1], baseUrl)
            if (parsed.protocol === 'https:' && (parsed.hostname === 'hku.hk' || parsed.hostname.endsWith('.hku.hk'))) {
              results.push({ url: parsed.toString(), method: 'GET' })
            }
          } catch (_) { /* ignore non-URL script */ }
        }
      }
      for (const form of Array.from(root.querySelectorAll?.('form[action]') || [])) {
        const method = String(form.getAttribute('method') || 'GET').toUpperCase()
        if (method !== 'GET') continue
        const submitter = Array.from(form.querySelectorAll('button, input[type="submit"], input[type="button"]'))
          .find(node => pattern.test(`${clean(node.textContent)} ${clean(node.getAttribute('value'))} ${clean(node.getAttribute('aria-label'))}`))
        if (!submitter) continue
        const actionHref = pageHref(form, baseUrl)
        if (!actionHref) continue
        try {
          const target = new URL(actionHref)
          for (const input of Array.from(form.querySelectorAll('input[name], select[name]'))) {
            const type = String(input.getAttribute('type') || '').toLowerCase()
            if ((type === 'submit' || type === 'button') && input !== submitter) continue
            if ((type === 'checkbox' || type === 'radio') && !input.checked) continue
            const name = input.getAttribute('name')
            if (name) target.searchParams.set(name, input.value || input.getAttribute('value') || '')
          }
          results.push({ url: target.toString(), method: 'GET' })
        } catch (_) { /* ignore malformed form */ }
      }
      for (const frame of Array.from(root.querySelectorAll?.('iframe, frame') || [])) {
        try { collect(frame.contentDocument, seen) } catch (_) { /* cross-origin frame */ }
      }
    }
    collect(doc)
    return results
  }

  function documentsComplete(rootDocument = document, seen = new Set()) {
    if (!rootDocument || seen.has(rootDocument)) return true
    seen.add(rootDocument)
    if (rootDocument.readyState && rootDocument.readyState !== 'complete') return false
    for (const frame of Array.from(rootDocument.querySelectorAll?.('iframe, frame') || [])) {
      try {
        if (frame.contentDocument && !documentsComplete(frame.contentDocument, seen)) return false
      } catch (_) { /* cross-origin frame */ }
    }
    return true
  }

  // Prefetch the current week plus up to 2 recent weeks and 4 upcoming weeks when
  // SIS/MyWeekly exposes stateless GET week links, so multi-week browsing works
  // offline without overwriting other weeks in the bridge.
  async function prefetchSisWeeks() {
    const merged = extractSis(document)
    const initialWeek = extractWeekRange(document)
    const weeksMap = new Map()
    if (initialWeek) weeksMap.set(`${initialWeek.start}..${initialWeek.end}`, initialWeek)
    const seenUrls = new Set([location.href])
    const crawlDirection = async (direction, maxSteps) => {
      let frontier = findWeekNavRequests(document, location.href, direction)
      let step = 0
      while (frontier.length && step < maxSteps) {
        const nextReq = frontier.find(item => item.url && !seenUrls.has(item.url))
        if (!nextReq) break
        seenUrls.add(nextReq.url)
        step += 1
        try {
          const response = await fetch(nextReq.url, { credentials: 'include', method: nextReq.method || 'GET' })
          if (!response.ok) break
          const html = await response.text()
          const doc = new DOMParser().parseFromString(html, 'text/html')
          if (doc.querySelector('input[type="password"]')) break
          const week = extractWeekRange(doc)
          if (week) weeksMap.set(`${week.start}..${week.end}`, week)
          for (const item of extractSis(doc)) {
            if (!merged.some(existing => existing.id === item.id)) merged.push(item)
          }
          frontier = findWeekNavRequests(doc, nextReq.url, direction)
        } catch (_) {
          break
        }
      }
    }
    await crawlDirection('next', 4)
    await crawlDirection('prev', 2)
    const scheduleWeeks = Array.from(weeksMap.values()).sort((a, b) => a.start.localeCompare(b.start))
    return {
      schedule: merged,
      ...(initialWeek ? { scheduleWeek: initialWeek } : scheduleWeeks[0] ? { scheduleWeek: scheduleWeeks[0] } : {}),
      ...(scheduleWeeks.length ? { scheduleWeeks } : {}),
    }
  }

  function deliverAndroid(payload) {
    try {
      if (globalThis.MyHKU && typeof globalThis.MyHKU.ingest === 'function') {
        globalThis.MyHKU.ingest(JSON.stringify({
          version: 4,
          scheduleSchema: 2,
          assignmentSchema: 2,
          site: host,
          siteKey: site,
          fetchedAt: new Date().toISOString(),
          ...payload,
        }))
      }
    } catch (_) { /* optional Android WebView interface */ }
  }

  async function postBridgeFromPage(payloadObj) {
    if (globalThis.__MYHKU_SKIP_POST__) return
    try {
      const body = JSON.stringify(payloadObj)
      const byteLength = typeof TextEncoder === 'function' ? new TextEncoder().encode(body).byteLength : body.length * 2
      await fetch(BRIDGE + site, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body,
        // Chromium rejects fetch() with keepalive:true whenever body exceeds 64 KiB.
        keepalive: byteLength <= 60_000,
        targetAddressSpace: 'loopback',
      })
    } catch (_) { /* bridge may be stopped; the next page load retries */ }
  }

  async function publish() {
    // A visible login form means the current page is not authenticated.
    const loginPage = document.querySelector('input[type="password"]') ||
      /\/(?:login|signin|sign-in|cas)(?:\/|\.|$)/i.test(location.pathname) ||
      /login|sign in|登入|登录/i.test(document.title)
    if (loginPage) {
      const disconnectedPayload = { connected: false, detail: clean(document.title, 240) || location.pathname }
      deliverAndroid(disconnectedPayload)
      await postBridgeFromPage(disconnectedPayload)
      return disconnectedPayload
    }
    if (site === 'moodle' && globalThis.__MYHKU_COURSES_ONLY__) {
      const discovered = await discoverEnrolledMoodleCourses(extractCoursesFromDocument(document, location.href))
      const quickFields = {
        courses: discovered.courses,
        ...(discovered.authoritativeCourses && discovered.courses.length > 0 ? { replaceFields: ['courses'] } : {}),
        detail: clean(document.title, 240) || location.pathname,
      }
      deliverAndroid({ connected: true, ...quickFields })
      await postBridgeFromPage(quickFields)
      return { connected: true, ...quickFields }
    }
    const data = site === 'moodle'
      ? await crawlMoodleCoursePages(extractMoodle())
      : site === 'sis'
        ? await prefetchSisWeeks()
        : { schedule: await crawlPortalSchedule(extractSis()) }
    const fields = Object.fromEntries(Object.entries(data).filter(([key, value]) =>
      (key !== 'completeCrawl' && key !== 'authoritativeCourses' && Array.isArray(value)) ||
      (key === 'scheduleWeek' && value && typeof value === 'object')))
    const sisComplete = documentsComplete()
    if (site === 'sis' && !sisComplete && (!Array.isArray(fields.schedule) || fields.schedule.length === 0)) {
      delete fields.scheduleWeek
      delete fields.scheduleWeeks
    }
    if (site === 'sis' && Array.isArray(fields.schedule) && (fields.schedule.length > 0 || (sisComplete && (fields.scheduleWeek || (fields.scheduleWeeks?.length > 0))))) {
      fields.replaceFields = ['schedule']
    } else if (site === 'moodle' && data.authoritativeCourses && Array.isArray(fields.courses) && fields.courses.length > 0) {
      fields.replaceFields = data.completeCrawl
        ? ['courses', 'assignments', 'resources', 'announcements', 'grades']
        : ['courses']
    }
    // Include a page marker so the bridge can report the current session even
    // when a valid page contains no rows (for example an empty course list).
    fields.detail = clean(document.title, 240) || location.pathname
    deliverAndroid({ connected: true, ...fields })
    await postBridgeFromPage(fields)
    return { connected: true, ...fields }
  }

  return publish()
})()
