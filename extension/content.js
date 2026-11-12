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
  const submissionStatus = root => clean(tableField(root, /submission status|提交狀態|提交状态/i)?.textContent || root.querySelector('.submissionstatus, [data-region="submission-status"]')?.textContent, 160)
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
    const node = root.querySelector('time[datetime], [data-due-date], .duedate, .due-date, .event-time, time')
    const raw = clean(node ? (node.getAttribute('datetime') || node.getAttribute('data-due-date') || node.textContent) : tableField(root, /due date|截止|到期/i)?.textContent, 120)
    if (!raw) return undefined
    const number = Number(raw)
    if (Number.isFinite(number) && number > 1000000000) return new Date(number < 100000000000 ? number * 1000 : number).toISOString()
    // Moodle overview omits the year and uses the site's timezone. Preserve
    // its displayed date instead of Date.parse silently assigning year 2001.
    return raw
  }
  const completed = (root) => {
    const status = submissionStatus(root)
    if (/no submission|not submitted|draft|未提交|尚未提交|草稿/i.test(status)) return false
    if (/submitted for grading|submitted|已提交/i.test(status)) return true
    if (status) return undefined
    const state = attr(root, ['data-completionstate', 'data-completed', 'data-state'])
    if (/^(1|true|complete|completed|done|submitted)$/i.test(state)) return true
    if (/^(0|false|incomplete|pending|todo)$/i.test(state)) return false
    const value = clean(root.textContent).toLowerCase()
    if (/not completed|not submitted|no submission|incomplete|未完成|未提交|待完成/.test(value)) return false
    if (/\bcompleted\b|\bsubmitted\b|已完成|已提交/.test(value)) return true
    return undefined
  }

  function extractMoodle() {
    const courses = []; const courseIds = new Set()
    document.querySelectorAll('a[href*="/course/view.php"]').forEach((link) => {
      const title = (clean(link.textContent) || text(nearest(link), ['.coursename', '.course-title', 'h3', 'h4']))
        .replace(/^Course image["'：:\s]*/i, '').trim()
      if (!title) return
      const href = linkHref(link); const root = nearest(link)
      const id = idFrom(root, href, 'course', title)
      if (courseIds.has(id)) return
      courseIds.add(id); const code = attr(root, ['data-course-code']) || codeFrom(title)
      courses.push({ id, title, ...(code ? { code } : {}) })
    })

    const assignments = []; const assignmentIds = new Set()
    document.querySelectorAll('a[href*="/mod/assign/"], a[href*="assign/view"]').forEach((link) => {
      const root = nearest(link); const title = clean(link.textContent) || text(root, ['.activityname', '.instancename', '.assignment-name', 'h3', 'h4'])
      if (!title || assignmentIds.has(linkHref(link))) return
      const href = linkHref(link); const id = idFrom(root, href, 'assignment', title)
      if (assignmentIds.has(id)) return
      assignmentIds.add(id); const course = attr(root, ['data-course-name']) || text(root, ['.event-course', '.course-name', '.coursename']) || '未提供课程'
      const done = completed(root); const due = parseDue(root)
      assignments.push({ id, title, course, ...(due ? { due } : {}), ...(submissionStatus(root) ? { submissionStatus: submissionStatus(root) } : {}), ...(done === undefined ? {} : { completed: done }) })
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

    const resources = []; const resourceIds = new Set()
    document.querySelectorAll('a[href*="/mod/resource/"], a[href*="/mod/folder/"], a[href*="/mod/url/"], a[href*="/mod/page/"]').forEach((link) => {
      const href = linkHref(link); const title = clean(link.textContent) || clean(link.getAttribute('aria-label'))
      if (!href || !title) return
      const root = nearest(link); const id = idFrom(root, href, 'resource', title)
      if (resourceIds.has(id)) return
      resourceIds.add(id); resources.push({ id, title, course: attr(root, ['data-course-name']) || text(root, ['.course-name', '.coursename']) || '未提供课程', url: href })
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

  // Moodle's dashboard exposes course links, while resources and forum posts
  // live one level deeper. Read those rendered course pages through the
  // authenticated WebView session and return only normalized visible fields.
  async function crawlMoodleCoursePages(baseData) {
    const links = Array.from(document.querySelectorAll('a[href*="/course/view.php"]'))
      .map(link => pageHref(link, location.href)).filter(Boolean)
    const current = new URL(location.href)
    if (/\/course\/(view|overview)\.php$/.test(current.pathname) && current.searchParams.has('id')) {
      links.push(`${current.origin}/course/view.php?id=${encodeURIComponent(current.searchParams.get('id'))}`)
    }
    const unique = Array.from(new Set(links)).slice(0, 20)
    const cacheKey = unique.join('|')
    const cached = globalThis.__myhkuMoodleCrawlCache
    if (!globalThis.__myhkuForceCrawl && cached && cached.key === cacheKey && Date.now() - cached.at < 60_000) {
      return {
        courses: baseData.courses,
        assignments: Array.from(new Map([...baseData.assignments, ...cached.extra.assignments].map(item => [item.id, item])).values()),
        announcements: Array.from(new Map([...baseData.announcements, ...cached.extra.announcements].map(item => [item.id, item])).values()),
        resources: Array.from(new Map([...baseData.resources, ...cached.extra.resources].map(item => [item.id, item])).values()),
        grades: Array.from(new Map([...baseData.grades, ...cached.extra.grades].map(item => [item.id, item])).values()),
        completeCrawl: cached.completeCrawl,
      }
    }
    const extra = { assignments: [], announcements: [], resources: [], grades: [] }
    const seen = { assignments: new Set(), announcements: new Set(), resources: new Set(), grades: new Set() }
    let failedCourses = 0
    await runBounded(unique, 4, async (courseUrl) => {
      try {
        const response = await fetch(courseUrl, { credentials: 'include' })
        if (!response.ok) { failedCourses += 1; return }
        const html = await response.text()
        const doc = new DOMParser().parseFromString(html, 'text/html')
        const heading = clean(doc.querySelector('h1, .page-header-headings, [data-region="header"]')?.textContent) || '未提供课程'
        doc.querySelectorAll('a[href*="/mod/resource/"], a[href*="/mod/folder/"], a[href*="/mod/url/"], a[href*="/mod/page/"]').forEach(link => {
          const href = pageHref(link, courseUrl); const title = clean(link.textContent) || clean(link.getAttribute('aria-label'))
          if (!href || !title) return
          const id = idFrom(link, href, 'resource', `${heading}|${title}`)
          if (seen.resources.has(id)) return
          seen.resources.add(id); extra.resources.push({ id, title, course: heading, url: href })
        })
        doc.querySelectorAll('a[href*="/mod/assign/"], a[href*="assign/view"]').forEach(link => {
          const root = nearest(link); const href = pageHref(link, courseUrl); const title = clean(link.textContent) || text(root, ['.activityname', '.instancename', 'h3', 'h4'])
          if (!href || !title) return
          const id = idFrom(root, href, 'assignment', `${heading}|${title}`)
          if (seen.assignments.has(id)) return
          seen.assignments.add(id); const due = parseDue(root); const done = completed(root)
          extra.assignments.push({ id, title, course: heading, ...(due ? { due } : {}), ...(done === undefined ? {} : { completed: done }) })
        })
        doc.querySelectorAll('a[href*="/mod/forum/"]').forEach(link => {
          const root = nearest(link); const href = pageHref(link, courseUrl); const title = clean(link.textContent) || text(root, ['.discussionname', '.subject', 'h3', 'h4'])
          if (!href || !title || !/announcement|news|notice|公告|通知|forum|discussion/i.test(`${title} ${clean(root.textContent)}`)) return
          const id = idFrom(root, href, 'announcement', `${heading}|${title}`)
          if (seen.announcements.has(id)) return
          seen.announcements.add(id); const timeNode = root.querySelector('time[datetime], time, .date, .discussion-date'); const published = clean(timeNode && (timeNode.getAttribute('datetime') || timeNode.textContent))
          extra.announcements.push({ id, title, course: heading, ...(published ? { published } : {}), url: href })
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
          extra.grades.push({ id, title, course: heading, ...(parsed.value ? { value: parsed.value } : {}), released: parsed.released })
        })
        // Moodle 5 puts due dates, submission states and grades in the course overview,
        // not in the course's activity cards. Match rows by the activity URL id.
        const courseId = new URL(courseUrl).searchParams.get('id')
        const overviewUrl = new URL(`/course/overview.php?id=${encodeURIComponent(courseId)}`, courseUrl).href
        try {
          const overviewResponse = await fetch(overviewUrl, { credentials: 'include' })
          if (overviewResponse.ok) {
            const overview = new DOMParser().parseFromString(await overviewResponse.text(), 'text/html')
            overview.querySelectorAll('a[href*="/mod/assign/view.php"]').forEach(link => {
              const root = nearest(link); const href = pageHref(link, overviewUrl)
              const title = clean(link.textContent)
              if (!href || !title) return
              const id = idFrom(root, href, 'assignment', title)
              const due = parseDue(root); const status = submissionStatus(root); const done = completed(root)
              const item = { id, title, course: heading, ...(due ? { due } : {}), ...(status ? { submissionStatus: status } : {}), ...(done === undefined ? {} : { completed: done }) }
              const index = extra.assignments.findIndex(existing => existing.id === id)
              if (index < 0) extra.assignments.push(item)
              else extra.assignments[index] = item
              const parsedGrade = extractGradeFromRow(root)
              if (parsedGrade) {
                const gradeId = `grade-${id}`
                const gradeItem = { id: gradeId, title, course: heading, ...(parsedGrade.value ? { value: parsedGrade.value } : {}), released: parsedGrade.released }
                const gradeIdx = extra.grades.findIndex(existing => existing.id === gradeId)
                if (gradeIdx < 0) { seen.grades.add(gradeId); extra.grades.push(gradeItem) }
                else extra.grades[gradeIdx] = gradeItem
              }
            })
          }
        } catch (_) { /* optional overview endpoint */ }
      } catch (_) { failedCourses += 1 }
    })
    const completeCrawl = unique.length > 0 && failedCourses === 0
    globalThis.__myhkuMoodleCrawlCache = { key: cacheKey, at: Date.now(), extra, completeCrawl }
    return {
      courses: baseData.courses,
      assignments: Array.from(new Map([...baseData.assignments, ...extra.assignments].map(item => [item.id, item])).values()),
      announcements: Array.from(new Map([...baseData.announcements, ...extra.announcements].map(item => [item.id, item])).values()),
      resources: Array.from(new Map([...baseData.resources, ...extra.resources].map(item => [item.id, item])).values()),
      grades: Array.from(new Map([...baseData.grades, ...extra.grades].map(item => [item.id, item])).values()),
      completeCrawl,
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
      const position = node => {
        const match = (node.getAttribute('style') || '').match(/left\s*:\s*([\d.]+)(%|px)/i)
        return match ? { value: Number(match[1]), unit: match[2] } : null
      }
      rootDocument.querySelectorAll('[class*="bkgCalViewItem"]').forEach(node => {
        const pos = position(node)
        const matching = headers.filter(header => position(header)?.unit === pos?.unit)
        let header = pos && matching.length ? matching.reduce((best, item) => Math.abs(position(item).value - pos.value) < Math.abs(position(best).value - pos.value) ? item : best) : null
        if (!header) {
          const rect = node.getBoundingClientRect()
          if (rect.width) header = headers.find(item => { const h = item.getBoundingClientRect(); return h.width && rect.left >= h.left - 2 && rect.left < h.right })
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
          site: host,
          siteKey: site,
          fetchedAt: new Date().toISOString(),
          ...payload,
        }))
      }
    } catch (_) { /* optional Android WebView interface */ }
  }

  async function publish() {
    // A visible login form means the current page is not authenticated.
    const loginPage = document.querySelector('input[type="password"]') ||
      /\/(?:login|signin|sign-in|cas)(?:\/|\.|$)/i.test(location.pathname) ||
      /login|sign in|登入|登录/i.test(document.title)
    if (loginPage) {
      const disconnectedPayload = { connected: false, detail: clean(document.title, 240) || location.pathname }
      deliverAndroid(disconnectedPayload)
      if (!globalThis.__MYHKU_SKIP_POST__) {
        try {
          await fetch(BRIDGE + site, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(disconnectedPayload), keepalive: true })
        } catch (_) { /* bridge may be stopped; the next page load retries */ }
      }
      return disconnectedPayload
    }
    const data = site === 'moodle'
      ? await crawlMoodleCoursePages(extractMoodle())
      : site === 'sis'
        ? await prefetchSisWeeks()
        : { schedule: await crawlPortalSchedule(extractSis()) }
    const fields = Object.fromEntries(Object.entries(data).filter(([key, value]) =>
      (key !== 'completeCrawl' && Array.isArray(value)) ||
      (key === 'scheduleWeek' && value && typeof value === 'object')))
    const sisComplete = documentsComplete()
    if (site === 'sis' && !sisComplete && (!Array.isArray(fields.schedule) || fields.schedule.length === 0)) {
      delete fields.scheduleWeek
      delete fields.scheduleWeeks
    }
    if (site === 'sis' && Array.isArray(fields.schedule) && (fields.schedule.length > 0 || (sisComplete && (fields.scheduleWeek || (Array.isArray(fields.scheduleWeeks) && fields.scheduleWeeks.length > 0))))) {
      fields.replaceFields = ['schedule']
    } else if (site === 'moodle' && /^\/my(?:\/|$)/i.test(location.pathname) && Array.isArray(fields.courses) && fields.courses.length > 0) {
      fields.replaceFields = data.completeCrawl
        ? ['courses', 'assignments', 'resources', 'announcements', 'grades']
        : ['courses']
    }
    // Include a page marker so the bridge can report the current session even
    // when a valid page contains no rows (for example an empty course list).
    fields.detail = clean(document.title, 240) || location.pathname
    deliverAndroid({ connected: true, ...fields })
    if (!globalThis.__MYHKU_SKIP_POST__) {
      try {
        await fetch(BRIDGE + site, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(fields), keepalive: true })
      } catch (_) { /* bridge may be stopped; the next page load retries */ }
    }
    return { connected: true, ...fields }
  }

  return publish()
})()
