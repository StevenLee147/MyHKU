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
  const parseDue = (root) => {
    const node = root.querySelector('time[datetime], [data-due-date], .duedate, .due-date, .event-time, time')
    const raw = clean(node && (node.getAttribute('datetime') || node.getAttribute('data-due-date') || node.textContent), 120)
    if (!raw) return undefined
    const number = Number(raw)
    if (Number.isFinite(number) && number > 1000000000) return new Date(number < 100000000000 ? number * 1000 : number).toISOString()
    const parsed = Date.parse(raw.replace(/^due\s*:?\s*/i, ''))
    return Number.isNaN(parsed) ? raw : new Date(parsed).toISOString()
  }
  const completed = (root) => {
    const state = attr(root, ['data-completionstate', 'data-completed', 'data-state'])
    if (/^(1|true|complete|completed|done|submitted)$/i.test(state)) return true
    if (/^(0|false|incomplete|pending|todo)$/i.test(state)) return false
    const value = clean(root.textContent).toLowerCase()
    if (/completed|submitted|已完成|已提交/.test(value)) return true
    if (/not completed|incomplete|未完成|待完成/.test(value)) return false
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
      assignments.push({ id, title, course, ...(due ? { due } : {}), ...(done === undefined ? {} : { completed: done }) })
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
      const root = node.matches('tr') ? node : nearest(node); const cells = Array.from(root.querySelectorAll('th,td')).map((cell) => clean(cell.textContent)).filter(Boolean)
      const title = clean(node.textContent).slice(0, 180) || cells[0]
      if (!title || !/(grade|score|mark|成绩|分数)/i.test(clean(root.textContent))) return
      const id = idFrom(root, linkHref(node.matches('a') ? node : root.querySelector('a')), 'grade', title)
      if (gradeIds.has(id)) return
      gradeIds.add(id); const value = (cells.slice(1).find((value) => /\d+(?:\.\d+)?\s*(?:%|\/\s*\d+)?/.test(value)) || '').slice(0, 80)
      grades.push({ id, title, course: text(root, ['.course-name', '.coursename']) || '未提供课程', ...(value ? { value } : {}), released: true })
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

  // Moodle's dashboard exposes course links, while resources and forum posts
  // live one level deeper. Read those rendered course pages through the
  // authenticated WebView session and return only normalized visible fields.
  async function crawlMoodleCoursePages(baseData) {
    const links = Array.from(document.querySelectorAll('a[href*="/course/view.php"]'))
      .map(link => pageHref(link, location.href)).filter(Boolean)
    const unique = Array.from(new Set(links)).slice(0, 20)
    const extra = { assignments: [], announcements: [], resources: [], grades: [] }
    const seen = { assignments: new Set(), announcements: new Set(), resources: new Set(), grades: new Set() }
    await Promise.all(unique.map(async (courseUrl) => {
      try {
        const response = await fetch(courseUrl, { credentials: 'include' })
        if (!response.ok) return
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
        doc.querySelectorAll('a[href*="/grade/"], a[href*="grade/report"], table.grades tr, table.user-grade tr').forEach(node => {
          const root = node.matches('tr') ? node : nearest(node); const cells = Array.from(root.querySelectorAll('th,td')).map(cell => clean(cell.textContent)).filter(Boolean); const title = clean(node.textContent).slice(0, 180) || cells[0]
          if (!title || !/grade|score|mark|成绩|分数/i.test(clean(root.textContent))) return
          const href = pageHref(node.matches('a') ? node : root.querySelector('a'), courseUrl); const id = idFrom(root, href, 'grade', `${heading}|${title}`)
          if (seen.grades.has(id)) return
          seen.grades.add(id); const value = (cells.slice(1).find(value => /\d+(?:\.\d+)?\s*(?:%|\/\s*\d+)?/.test(value)) || '').slice(0, 80)
          extra.grades.push({ id, title, course: heading, ...(value ? { value } : {}), released: true })
        })
      } catch (_) { /* one unavailable course must not hide the others */ }
    }))
    return {
      courses: baseData.courses,
      assignments: [...baseData.assignments, ...extra.assignments],
      announcements: [...baseData.announcements, ...extra.announcements],
      resources: [...baseData.resources, ...extra.resources],
      grades: [...baseData.grades, ...extra.grades],
    }
  }

  function timePair(value) {
    const matches = clean(value).match(/\b\d{1,2}(?::|：)\d{2}\s*(?:AM|PM)?\b/gi) || []
    return { start: (matches[0] || '').replace('：', ':'), end: (matches[1] || '').replace('：', ':') }
  }

  function extractWeekRange() {
    const raw = String(document.body?.textContent || document.documentElement?.textContent || '')
    const match = raw.match(/Week\s+of\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s*[-–]\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i)
    if (!match) return undefined
    const iso = (day, month, year) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    return { start: iso(Number(match[1]), Number(match[2]), Number(match[3])), end: iso(Number(match[4]), Number(match[5]), Number(match[6])) }
  }

  function extractSis(rootDocument = document, seenDocuments = new Set()) {
    if (!rootDocument || seenDocuments.has(rootDocument)) return []
    seenDocuments.add(rootDocument)
    const schedule = []
    const weeklyTables = []
    const directWeekly = rootDocument.querySelector('#WEEKLY_SCHED_HTMLAREA, table[summary*="Weekly Schedule"]')
    if (directWeekly) weeklyTables.push(directWeekly)
    rootDocument.querySelectorAll('iframe').forEach((frame) => {
      try {
        const nested = frame.contentDocument?.querySelector('#WEEKLY_SCHED_HTMLAREA, table[summary*="Weekly Schedule"]')
        if (nested) weeklyTables.push(nested)
      } catch (_) { /* cross-origin or unloaded frame */ }
    })
    weeklyTables.forEach((table) => {
      const headers = Array.from(table.rows[0]?.cells || []).map((cell) => clean(cell.textContent))
      const seen = new Set()
      Array.from(table.querySelectorAll('td')).forEach((cell, index) => {
        const raw = String(cell.textContent || '').replace(/\u00a0/g, ' ')
        const times = raw.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/)
        if (!times || seen.has(cell)) return
        seen.add(cell)
        const course = raw.match(/\b[A-Z]{2,8}\s*\d{3,5}\s*-\s*[A-Z0-9]+\b/i)?.[0] || raw.split(/--|\d{1,2}:\d{2}/)[0].trim()
        const room = raw.match(/\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s*(.+)$/i)?.[1]?.trim() || ''
        const day = headers[cell.cellIndex] || ''
        schedule.push({ id: `weekly-${index}-${times[1]}-${times[2]}`, title: clean(course), ...(codeFrom(course) ? { code: codeFrom(course) } : {}), ...(day ? { day } : {}), start: times[1], end: times[2], ...(room ? { room: clean(room) } : {}) })
      })
    })
    if (schedule.length) return schedule
    const hasDirectSchedule = rootDocument.querySelector('[class*="bkgCalViewItem"], #WEEKLY_SCHED_HTMLAREA, table[summary*="Weekly Schedule"]')
    if (!hasDirectSchedule) {
      rootDocument.querySelectorAll('iframe').forEach((frame) => {
        try {
          for (const item of extractSis(frame.contentDocument, seenDocuments)) if (!schedule.some((entry) => entry.id === item.id)) schedule.push(item)
        } catch (_) { /* cross-origin or unloaded frame */ }
      })
      return schedule
    }
    // Fast path for the legacy absolute-position timetable. Keep this at the
    // top because the page has no semantic table cells for its course blocks.
    const legacyItems = rootDocument.querySelectorAll('[class*="bkgCalViewItem"]')
    if (legacyItems.length) {
      const days = Array.from(rootDocument.querySelectorAll('.bkgCalViewWDHeader, .bkgCalViewwdheader')).map((node) => clean(node.textContent))
      Array.from(legacyItems).forEach((node, index) => {
        const raw = String(node.innerHTML || node.textContent || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ')
        const times = raw.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/)
        if (!times) return
        const courseMatch = raw.match(/\b[A-Z]{2,8}\s*\d{3,5}\s*-\s*[A-Z0-9]+\b/i); const title = clean(courseMatch?.[0] || raw.split(/\r?\n+/)[0] || '未提供课程'); const roomMatch = raw.match(/\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s*([A-Z][A-Z0-9.-]*)/i); const room = clean(roomMatch?.[1] || '')
        const style = String(node.getAttribute('style') || ''); const left = Number(style.match(/left\s*:\s*([\d.]+)/i)?.[1]); const day = days[Number.isFinite(left) ? Math.round(left / 10) : -1] || ''
        const code = codeFrom(title) || undefined; const id = `legacy-${index}-${times[1]}-${times[2]}`
        schedule.push({ id, title, ...(code ? { code } : {}), ...(day ? { day } : {}), start: times[1], end: times[2], ...(room ? { room } : {}) })
      })
      return schedule
    }
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
    // PeopleSoft's weekly calendar is rendered inside a same-origin iframe
    // and uses a sparse grid with rowspans. Build a logical matrix so each
    // populated day cell gets its own course entry.
    const weekly = rootDocument.querySelector('#WEEKLY_SCHED_HTMLAREA, table[summary*="Weekly Schedule"]')
    if (weekly) {
      const matrix = []
      const cells = []
      Array.from(weekly.rows).forEach((row, rowIndex) => {
        if (!matrix[rowIndex]) matrix[rowIndex] = []
        let column = 0
        Array.from(row.cells).forEach((cell) => {
          while (matrix[rowIndex][column]) column += 1
          const rowSpan = Math.max(1, Number(cell.rowSpan) || 1)
          const colSpan = Math.max(1, Number(cell.colSpan) || 1)
          for (let r = rowIndex; r < rowIndex + rowSpan; r += 1) {
            if (!matrix[r]) matrix[r] = []
            for (let c = column; c < column + colSpan; c += 1) matrix[r][c] = cell
          }
          cells.push({ cell, rowIndex, column })
          column += colSpan
        })
      })
      const headers = (matrix[0] || []).map((cell) => clean(cell?.textContent))
      const seenCells = new Set()
      for (let rowIndex = 1; rowIndex < matrix.length; rowIndex += 1) {
        const startCell = matrix[rowIndex]?.[0]
        const rowStart = clean(startCell?.textContent).match(/\b\d{1,2}:\d{2}\b/)?.[0] || ''
        for (let column = 1; column < (matrix[rowIndex] || []).length; column += 1) {
          const cell = matrix[rowIndex][column]
          if (!cell || seenCells.has(cell)) continue
          seenCells.add(cell)
          const value = String(cell.textContent || '').replace(/\u00a0/g, ' ').trim()
          if (!value || !/\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}/.test(value)) continue
          const times = value.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/)
          if (!times) continue
          const lines = value.split(/\r?\n+/).map(clean).filter(Boolean)
          const title = lines[0] || '未提供课程'
          const room = lines[lines.length - 1] && !/^\d{1,2}:\d{2}\s*-/.test(lines[lines.length - 1]) && lines[lines.length - 1] !== '--' ? lines[lines.length - 1] : ''
          const header = headers[column] || ''
          const code = codeFrom(title) || undefined
          const id = idFrom(cell, '', 'class', `${header}|${title}|${times[1]}|${times[2]}`)
          if (!schedule.some((entry) => entry.id === id)) schedule.push({ id, title, ...(code ? { code } : {}), ...(header ? { day: header } : {}), start: times[1], end: times[2], ...(room ? { room } : {}) })
        }
      }
    }
    // The legacy My Timetable page uses absolutely positioned course blocks
    // instead of table cells. Their text contains the authoritative course,
    // time range and room; the `left` style maps directly to the weekday.
    const dayHeaders = Array.from(rootDocument.querySelectorAll('.bkgCalViewWDHeader, .bkgCalViewwdheader')).map((node) => clean(node.textContent))
    rootDocument.querySelectorAll('[class*="bkgCalViewItem"]').forEach((node, index) => {
      const lines = String(node.innerText || node.textContent || '').replace(/\u00a0/g, ' ').split(/\r?\n+/).map(clean).filter(Boolean)
      const times = (lines.join(' ').match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/) || [])
      if (!times[1] || !times[2]) return
      const title = lines[0] || '未提供课程'
      const room = lines.find((line) => line !== title && !/^\d{1,2}:\d{2}\s*-/.test(line)) || ''
      const style = attr(node, ['style'])
      const left = Number(style.match(/(?:^|;)\s*left\s*:\s*([\d.]+)/i)?.[1])
      const dayIndex = Number.isFinite(left) ? Math.round(left / 10) : -1
      const day = dayHeaders[dayIndex] || ''
      const code = codeFrom(title) || undefined
      const id = `class-${day}-${title}-${times[1]}-${times[2]}-${room}-${index}`.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 180)
      if (!schedule.some((entry) => entry.id === id)) schedule.push({ id, title, ...(code ? { code } : {}), ...(day ? { day } : {}), start: times[1], end: times[2], ...(room ? { room } : {}) })
    })
    // The top PeopleSoft shell contains the actual timetable in a same-origin
    // iframe. Inspect loaded iframe documents without reading any credentials.
    rootDocument.querySelectorAll('iframe').forEach((frame) => {
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

  // PeopleSoft renders one week at a time and exposes the other weeks through
  // ordinary next/previous anchors. Fetch those rendered pages with the same
  // authenticated session so the app receives the complete timetable.
  async function crawlSisSchedule(baseSchedule) {
    const merged = [...baseSchedule]
    const seenUrls = new Set([location.href])
    const queue = [{ url: location.href, method: 'GET' }]
    while (queue.length && seenUrls.size <= 16) {
      const current = queue.shift()
      const url = current?.url
      if (!url) continue
      try {
        const response = await fetch(url, { credentials: 'include', method: current.method || 'GET' })
        if (!response.ok) continue
        const html = await response.text()
        const doc = new DOMParser().parseFromString(html, 'text/html')
        for (const item of extractSis(doc)) if (!merged.some(existing => existing.id === item.id)) merged.push(item)
        for (const link of Array.from(doc.querySelectorAll('a[href]'))) {
          const label = clean(link.textContent).toLowerCase()
          const title = clean(link.getAttribute('title')).toLowerCase()
          const aria = clean(link.getAttribute('aria-label')).toLowerCase()
          if (!/(next|previous|prev|下一|上一|下页|上页|week|周)/i.test(`${label} ${title} ${aria}`)) continue
          const href = pageHref(link, url)
          if (href && !seenUrls.has(href)) { seenUrls.add(href); queue.push({ url: href, method: 'GET' }) }
        }
        for (const form of Array.from(doc.querySelectorAll('form[action*="week="]'))) {
          const href = pageHref(form, url)
          if (href && !seenUrls.has(href)) { seenUrls.add(href); queue.push({ url: href, method: String(form.method || 'GET').toUpperCase() }) }
        }
      } catch (_) { /* one unavailable page must not hide the remaining weeks */ }
    }
    return merged
  }

  async function publish() {
    // A visible login form means the current page is not authenticated.
    const loginPage = document.querySelector('input[type="password"]') ||
      /\/(?:login|signin|sign-in|cas)(?:\/|\.|$)/i.test(location.pathname) ||
      /login|sign in|登入|登录/i.test(document.title)
    if (loginPage) {
      try {
        await fetch(BRIDGE + site, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify({ connected: false, detail: clean(document.title, 240) || location.pathname }), keepalive: true })
      } catch (_) { /* bridge may be stopped; the next page load retries */ }
      return
    }
    const data = site === 'moodle'
      ? await crawlMoodleCoursePages(extractMoodle())
      : site === 'sis'
        ? { schedule: extractSis() }
        : { schedule: await crawlPortalSchedule(extractSis()) }
    if (site === 'sis') data.scheduleWeek = extractWeekRange()
    const fields = Object.fromEntries(Object.entries(data).filter(([key, value]) => Array.isArray(value) || (key === 'scheduleWeek' && value && typeof value === 'object')))
    if (site === 'sis' && Array.isArray(fields.schedule) && fields.schedule.length > 0) fields.replaceFields = ['schedule']
    // Include a page marker so the bridge can report the current session even
    // when a valid page contains no rows (for example an empty course list).
    fields.detail = clean(document.title, 240) || location.pathname
    try {
      await fetch(BRIDGE + site, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(fields), keepalive: true })
    } catch (_) { /* bridge may be stopped; the next page load retries */ }
  }

  publish()
})()
