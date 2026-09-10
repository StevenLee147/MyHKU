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
  const site = host === 'moodle.hku.hk' ? 'moodle' : (host === 'studentportal.hku.hk' ? 'portal' : (host === 'hkuportal.hku.hk' ? 'sis' : null))
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
      const title = clean(link.textContent) || text(nearest(link), ['.coursename', '.course-title', 'h3', 'h4'])
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

  function timePair(value) {
    const matches = clean(value).match(/\b\d{1,2}(?::|：)\d{2}\s*(?:AM|PM)?\b/gi) || []
    return { start: (matches[0] || '').replace('：', ':'), end: (matches[1] || '').replace('：', ':') }
  }

  function extractSis() {
    const schedule = []
    document.querySelectorAll('table').forEach((table) => {
      const rows = Array.from(table.querySelectorAll('tbody tr, tr')); const headers = Array.from(table.querySelectorAll('thead th')).map((x) => clean(x.textContent).toLowerCase())
      rows.forEach((row, index) => {
        const cells = Array.from(row.querySelectorAll('th,td')).map((x) => clean(x.textContent)); if (!cells.length || (row.querySelector('th') && !row.querySelector('td'))) return
        const whole = cells.join(' · '); const pair = timePair(whole); if (!pair.start || !pair.end) return
        const find = (patterns) => { const i = headers.findIndex((h) => patterns.some((p) => p.test(h))); return i >= 0 ? cells[i] : '' }
        const title = find([/course|subject|class|课程|科目/]) || cells[0]; if (!title || /^(course|subject|课程)$/i.test(title)) return
        const code = find([/code|编号/]) || codeFrom(title) || codeFrom(whole); const day = find([/day|星期/]); const date = find([/date|日期/]); const room = find([/room|location|venue|地点|教室/]); const teacher = find([/teacher|instructor|lecturer|教师|老师/])
        const id = idFrom(row, linkHref(row.querySelector('a')), 'class', title + pair.start + pair.end + index)
        if (!schedule.some((entry) => entry.id === id)) schedule.push({ id, title: title.replace(code, '').trim() || title, ...(code ? { code } : {}), ...(date ? { date } : {}), ...(day ? { day } : {}), start: pair.start, end: pair.end, ...(room ? { room } : {}), ...(teacher ? { teacher } : {}) })
      })
    })
    return schedule
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
    const data = site === 'moodle' ? extractMoodle() : { schedule: extractSis() }
    const fields = Object.fromEntries(Object.entries(data).filter(([, value]) => Array.isArray(value)))
    // Include a page marker so the bridge can report the current session even
    // when a valid page contains no rows (for example an empty course list).
    fields.detail = clean(document.title, 240) || location.pathname
    try {
      await fetch(BRIDGE + site, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(fields), keepalive: true })
    } catch (_) { /* bridge may be stopped; the next page load retries */ }
  }

  publish()
})()
