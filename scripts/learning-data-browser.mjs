import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import { fileLinksFromHtml, resolveMoodleDownloads } from '../desktop/downloads.mjs'

app.setPath('userData', mkdtempSync(join(tmpdir(), 'myhku-learning-test-')))
app.disableHardwareAcceleration()
const connector = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8')
const meetings = [
  [1, 'CAES1001-1C3', '09:00', '11:50', 'CPD-LG.62'],
  [1, 'CAES9920-1R', '13:00', '14:50', 'CPD-G.03'],
  [1, 'GLIS1903-1A', '15:00', '16:50', 'LE3'],
  [2, 'GLIS1901-1A', '12:00', '12:50', ''],
  [3, 'GLIS1905-1A', '09:00', '11:50', 'MB100'],
  [4, 'CAES9920-1R', '09:00', '09:50', ''],
  [4, 'GLIS1903-1A', '10:00', '10:50', ''],
  [4, 'GLIS1901-1A', '13:00', '13:50', ''],
  [4, 'GLIS1908-1A', '15:00', '17:50', 'MB113G'],
  [5, 'GLIS1903-1A', '10:00', '11:50', 'KK315'],
  [5, 'GLIS1901-1A', '13:00', '14:50', 'MW325'],
]
const weekdays = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
function weeklyTable() {
  let html = '<p>Week of 20/09/2026-26/09/2026</p><table id="WEEKLY_SCHED_HTMLAREA"><tr><th>Time</th>' + weekdays.map(day => `<th>${day}</th>`).join('') + '</tr>'
  const occupied = Array(7).fill(0)
  for (let time = 480; time < 1080; time += 30) {
    html += `<tr><td>${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')}</td>`
    for (let day = 0; day < 7; day++) {
      if (occupied[day] > time) continue
      const item = meetings.find(item => item[0] === day && minutes(item[2]) === time)
      if (!item) { html += '<td></td>'; continue }
      const span = Math.ceil((minutes(item[3]) - time) / 30)
      occupied[day] = time + span * 30
      html += `<td rowspan="${span}">${item[1]}<br>${item[2]}-${item[3]}<br>${item[4]}</td>`
    }
    html += '</tr>'
  }
  return html + '</table>'
}
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { sandbox: true, backgroundThrottling: false, offscreen: true } })
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }))
  const run = code => win.webContents.executeJavaScript(code)
  async function extract(html, url, pages = {}) {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const u = new URL(url)
    return run(`(async (location, pages) => {
      let payload;
      const fetch = async (url, options) => {
        if (url.includes('/api/ingest/')) { payload = JSON.parse(options.body); return { ok: true } }
        if (!(url in pages)) throw new Error('Unexpected fixture URL: ' + url);
        return { ok: true, text: async () => pages[url] };
      };
      await ${connector};
      return payload;
    })(${JSON.stringify({ href: u.href, hostname: u.hostname, pathname: u.pathname })}, ${JSON.stringify(pages)})`)
  }
  try {
    const table = await extract(weeklyTable(), 'https://sweb.hku.hk/student/servlet/MyWeekly/showTimetable')
    assert.equal(table.schedule.length, 11)
    for (const [day, title, start, end, room] of meetings) {
      const actual = table.schedule.find(item => item.title === title && item.start === start && item.date === `2026-09-${20 + day}`)
      assert.ok(actual, `${title} ${start} belongs on ${weekdays[day]}`)
      assert.equal(actual.end, end); assert.equal(actual.room || '', room)
    }
    console.log('PASS 11 meetings: rowspans, dates, weekday mapping, original rooms')
    const empty = await extract('<p>Week of 27/09/2026-03/10/2026</p>', 'https://sweb.hku.hk/student/servlet/MyWeekly/showTimetable')
    assert.deepEqual(empty.replaceFields, ['schedule'])
    assert.equal(empty.schedule.length, 0)
    const legacy = await extract('<p>Week of 20/09/2026-26/09/2026</p>' + weekdays.map((day, index) => `<div class="bkgCalViewWDHeader" style="left:${4 + index * 13}%">${day}</div>`).join('') + '<div class="bkgCalViewItem" style="left:56%">GLIS1903-1A<br>10:00-10:50<br>KK315</div>', 'https://sweb.hku.hk/student/servlet/MyWeekly/showTimetable')
    assert.equal(legacy.schedule[0].date, '2026-09-24')
    const myWeeklyCss = '<style>.bkgCalViewcontainer{position:relative;top:0;left:0}.bkgCalViewWDHeader,.bkgCalViewEmptyCell{width:10em;height:2em;box-sizing:border-box;font-size:10pt;border:1px solid #ccc}.bkgCalViewbg{box-sizing:border-box;font-size:10pt;table-layout:fixed;border:1px solid #ccc;border-collapse:collapse;width:auto;position:absolute;top:0;left:0}.bkgCalViewTimelbl,.bkgCalViewtimelbl{box-sizing:border-box;font-size:10pt;width:3em;height:2em;border-right:1px solid #ccc}.bkgCalViewItemLec{position:absolute;box-sizing:border-box;font-size:10pt;border:2px dashed #00a0ff}</style>'
    const myWeeklyGrid = `<table class="bkgCalViewbg" style="width:73em"><tr><th class="bkgCalViewtimelbl">&nbsp;</th>${weekdays.map(d => `<th class="bkgCalViewWDHeader">${d}</th>`).join('')}</tr><tr><td class="bkgCalViewTimelbl">&nbsp;</td>${weekdays.map(() => '<td class="bkgCalViewEmptyCell">&nbsp;</td>').join('')}</tr></table>`
    const myWeeklyNextUrl = 'https://sweb.hku.hk/student/servlet/MyWeekly/showTimetable?week=1'
    const myWeeklyLive = await extract(
      `${myWeeklyCss}<p>Week of 15/11/2026-21/11/2026</p><a href="${myWeeklyNextUrl}">Next Week</a><div class="bkgCalViewcontainer">${myWeeklyGrid}` +
        '<div class="bkgCalViewItemLec" style="top:6.8em;left:13em;width:10em;height:10em"><font size="-2">CAES1001-1C3<br>09:00-11:50<br>CPD-LG.62</font></div>' +
        '<div class="bkgCalViewItemLec" style="top:18.8em;left:23em;width:10em;height:2em"><font size="-2">GLIS1901-1A<br>12:00-12:50<br>MW325</font></div>' +
        '<div class="bkgCalViewItemLec" style="top:6.8em;left:33em;width:10em;height:10em"><font size="-2">GLIS1905-1A<br>09:00-11:50<br>MB100</font></div>' +
        '<div class="bkgCalViewItemLec" style="top:22.8em;left:43em;width:5em;height:2em"><font size="-2">GLIS1901-1A<br>13:00-13:50<br>TT403</font></div>' +
        '<div class="bkgCalViewItemLec" style="top:22.8em;left:48em;width:5em;height:6em"><font size="-2">GLIS1908-1A<br>13:00-14:50<br>MWT5</font></div>' +
        '<div class="bkgCalViewItemLec" style="top:10.8em;left:53em;width:10em;height:6em"><font size="-2">GLIS1903-1A<br>10:00-11:50<br>KK315</font></div></div>',
      'https://sweb.hku.hk/student/servlet/MyWeekly/showTimetable',
      {
        [myWeeklyNextUrl]: `${myWeeklyCss}<p>Week of 22/11/2026-28/11/2026</p><div class="bkgCalViewcontainer">${myWeeklyGrid}<div class="bkgCalViewItemLec" style="top:6.8em;left:33em;width:10em;height:10em">GLIS1905-1A<br>09:00-11:50<br>MB100</div></div>`,
      },
    )
    assert.equal(myWeeklyLive.schedule.find(i => i.title === 'CAES1001-1C3')?.date, '2026-11-16', 'left:13em maps to MON without collapsed-border -1d shift')
    assert.equal(myWeeklyLive.schedule.find(i => i.title === 'GLIS1901-1A' && i.start === '12:00')?.date, '2026-11-17', 'left:23em maps to TUE')
    assert.equal(myWeeklyLive.schedule.find(i => i.title === 'GLIS1905-1A' && i.date === '2026-11-18')?.day, 'WED', 'left:33em maps to WED')
    assert.equal(myWeeklyLive.schedule.find(i => i.room === 'TT403')?.date, '2026-11-19', 'overlapping left:43em width:5em maps to THU')
    assert.equal(myWeeklyLive.schedule.find(i => i.room === 'MWT5')?.date, '2026-11-19', 'overlapping left:48em width:5em maps to THU')
    assert.equal(myWeeklyLive.schedule.find(i => i.room === 'KK315')?.date, '2026-11-20', 'left:53em maps to FRI')
    assert.equal(myWeeklyLive.schedule.some(i => i.title === 'GLIS1905-1A' && i.date === '2026-11-25'), true, 'detached DOMParser em layout maps WED accurately')
    const prevWeekUrl = 'https://sweb.hku.hk/student/servlet/MyWeekly/showTimetable?week=0'
    const nextWeekUrl = 'https://sweb.hku.hk/student/servlet/MyWeekly/showTimetable?week=2'
    const prefetched = await extract(
      `<p>Week of 20/09/2026-26/09/2026</p><a href="${prevWeekUrl}">Previous Week</a><a href="${nextWeekUrl}">Next Week</a><table id="WEEKLY_SCHED_HTMLAREA"><tr><th>Time</th>${weekdays.map(d => `<th>${d}</th>`).join('')}</tr><tr><td>09:00</td><td></td><td>CAES1001-1C3<br>09:00-10:50<br>CPD</td><td></td><td></td><td></td><td></td><td></td></tr></table>`,
      'https://sweb.hku.hk/student/servlet/MyWeekly/showTimetable',
      {
        [prevWeekUrl]: `<p>Week of 13/09/2026</p><table id="WEEKLY_SCHED_HTMLAREA"><tr><th>Time</th>${weekdays.map(d => `<th>${d}</th>`).join('')}</tr><tr><td>1:30 PM - 3:20 PM</td><td></td><td></td><td></td><td></td><td>FINA1310-2A<br>KK101</td><td></td><td></td></tr></table>`,
        [nextWeekUrl]: `<p>Week of 27/09/2026-03/10/2026</p><table id="WEEKLY_SCHED_HTMLAREA"><tr><th>Time</th>${weekdays.map(d => `<th>${d}</th>`).join('')}</tr><tr><td>10:00</td><td></td><td></td><td>1:00 PM - 2:50 PM<br>GLIS1903-1A<br>KK315</td><td></td><td></td><td></td><td></td></tr></table>`,
      },
    )
    assert.equal(prefetched.scheduleWeeks.length, 3, 'SIS sync prefetches recent past and upcoming weeks automatically')
    assert.equal(prefetched.schedule.length, 3)
    assert.equal(prefetched.schedule.some(item => item.date === '2026-09-17' && item.start === '13:30' && item.end === '15:20'), true, 'single-date Week of header and row-time fallback work')
    assert.equal(prefetched.schedule.some(item => item.date === '2026-09-29' && item.start === '13:00' && item.end === '14:50' && item.room === 'KK315'), true, 'AM/PM time-before-course format works')

    const partialLoading = await run(`(async (location) => {
      let payload;
      const fetch = async (url, options) => {
        if (String(url).includes('/api/ingest/')) { payload = JSON.parse(options.body); return { ok: true }; }
        return { ok: false };
      };
      Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'loading' });
      document.body.innerHTML = '<p>Week of 08/11/2026 - 14/11/2026</p>';
      try {
        await ${connector};
      } finally {
        delete document.readyState;
      }
      return payload;
    })({ href: 'https://sweb.hku.hk/student/servlet/MyWeekly/showTimetable', hostname: 'sweb.hku.hk', pathname: '/student/servlet/MyWeekly/showTimetable' })`)
    assert.equal(partialLoading.replaceFields, undefined, 'incomplete SIS load must not wipe cached schedule')
    assert.equal(partialLoading.scheduleWeek, undefined, 'incomplete SIS load must not mark week range as cached')
    assert.equal(partialLoading.scheduleWeeks, undefined, 'incomplete SIS load must not mark week ranges as cached')
    console.log('PASS absolute calendar positions, bidirectional multi-week prefetch, AM/PM + row-time cells, and partial-load guard')

    const scheduleModule = stripTypeScriptTypes(readFileSync(new URL('../src/services/schedule.ts', import.meta.url), 'utf8'))
    const { todayClasses } = await import(`data:text/javascript;base64,${Buffer.from(scheduleModule).toString('base64')}`)
    assert.equal(todayClasses(table, new Date('2026-09-22T01:00:00Z')).length, 1)
    assert.equal(todayClasses(table, new Date('2026-09-23T17:00:00Z')).length, 4, 'Hong Kong midnight is independent of system timezone')
    assert.equal(todayClasses({ schedule: [{ day: 'Tue 09/22', start: '12:00' }], scheduleWeek: table.scheduleWeek }, new Date('2026-09-22T01:00:00Z')).length, 1)
    console.log('PASS today count includes all meetings and uses Hong Kong dates')

    const courseUrl = 'https://moodle.hku.hk/course/view.php?id=123'
    const overviewUrl = 'https://moodle.hku.hk/course/overview.php?id=123'
    const course = '<h1>Example course</h1><li id="module-11"><a href="/mod/assign/view.php?id=11">Assignment 1</a></li><li id="module-12"><a href="/mod/assign/view.php?id=12">Assignment 2</a></li><a href="/mod/resource/view.php?id=13">Lecture slides</a>'
    const overview = '<table><thead><tr><th>Name</th><th>Due date</th><th>Submission status</th><th>Grade</th></tr></thead><tbody><tr><td><a href="/mod/assign/view.php?id=11">Assignment 1</a></td><td>Thursday, 17 September, 11:59 PM</td><td>Submitted for grading</td><td>1.00</td></tr><tr><td><a href="/mod/assign/view.php?id=12">Assignment 2</a></td><td>Today, 22 September, 11:59 PM</td><td>No submission</td><td>-</td></tr></tbody></table>'
    const moodle = await extract(`<a href="${courseUrl}">Example course</a>`, 'https://moodle.hku.hk/my/', { [courseUrl]: course, [overviewUrl]: overview })
    assert.equal(moodle.assignments.length, 2)
    assert.equal(moodle.assignments[0].completed, true)
    assert.equal(moodle.assignments[1].completed, false)
    assert.equal(moodle.assignments[0].due, 'Thursday, 17 September, 11:59 PM')
    assert.equal(moodle.assignments[1].submissionStatus, 'No submission')
    assert.equal(moodle.resources[0].course, 'Example course')
    assert.equal(moodle.grades.find(g => g.title === 'Assignment 1')?.released, true)
    assert.equal(moodle.grades.find(g => g.title === 'Assignment 1')?.value, '1.00')
    assert.equal(moodle.grades.find(g => g.title === 'Assignment 2')?.released, false)
    assert.equal(moodle.grades.find(g => g.title === 'Assignment 2')?.value, undefined)
    const direct = await extract(overview, overviewUrl, { [courseUrl]: course, [overviewUrl]: overview })
    assert.equal(direct.assignments.length, 2, 'visiting overview directly deduplicates course cards')

    const trickyCourseUrl = 'https://moodle.hku.hk/course/view.php?id=456'
    const assign21DetailUrl = 'https://moodle.hku.hk/mod/assign/view.php?id=21'
    const assignIndexUrl = 'https://moodle.hku.hk/mod/assign/index.php?id=456'
    const trickyCourseHtml = `
      <h1>GLIS1905 Seminar</h1>
      <li class="activity" id="module-21">
        <a href="/mod/assign/view.php?id=21">Submit completed declaration form</a>
        <div data-region="activity-dates">
          <div><strong>Opened:</strong> Tuesday, 1 September 2026, 9:00 AM</div>
          <div><strong>Due:</strong> Thursday, 24 September 2026, 11:59 PM</div>
        </div>
        <div data-region="completion-info"><button data-action="toggle-manual-completion">Mark as done</button></div>
      </li>
      <li class="activity" id="module-22">
        <a href="/mod/quiz/view.php?id=22">Midterm Quiz</a>
        <div class="activity-dates">
          <div>Opened: Monday, 21 September 2026, 10:00 AM</div>
          <div>Closes: Friday, 25 September 2026, 5:00 PM</div>
        </div>
        <div data-region="completion-info"><span class="badge">Done: Receive a grade</span></div>
      </li>
      <li class="activity" id="module-23">
        <a href="/mod/turnitintooltwo/view.php?id=23">Final Essay Turnitin</a>
      </li>
    `
    const assign21DetailHtml = '<table class="generaltable"><tr><th>Submission status</th><td>No attempt</td></tr><tr><th>Grading status</th><td>Not graded</td></tr><tr><th>Due date</th><td>Thursday, 24 September 2026, 11:59 PM</td></tr></table>'
    const assignIndexHtml = '<table><thead><tr><th>Name</th><th>Due date</th><th>Status</th></tr></thead><tbody><tr><td><a href="/mod/turnitintooltwo/view.php?id=23">Final Essay Turnitin</a></td><td>Monday, 30 November 2026, 11:59 PM</td><td>Submitted for grading</td></tr></tbody></table>'
    const trickyMoodle = await extract(`<a href="${trickyCourseUrl}">GLIS1905 Seminar</a>`, 'https://moodle.hku.hk/my/', {
      [trickyCourseUrl]: trickyCourseHtml,
      [assignIndexUrl]: assignIndexHtml,
      [assign21DetailUrl]: assign21DetailHtml,
    })
    const a21 = trickyMoodle.assignments.find(a => a.id === '21')
    const q22 = trickyMoodle.assignments.find(a => a.id === '22')
    const t23 = trickyMoodle.assignments.find(a => a.id === '23')
    assert.equal(a21?.due, 'Thursday, 24 September 2026, 11:59 PM', 'must extract Due date rather than Opened date')
    assert.equal(a21?.completed, false, 'title containing completed must not falsely mark unsubmitted assignment done')
    assert.equal(a21?.submissionStatus, 'No attempt', 'individual assign detail view backfills submissionStatus')
    assert.equal(q22?.due, 'Friday, 25 September 2026, 5:00 PM', 'quiz Closes date extracted accurately')
    assert.equal(q22?.completed, true, 'quiz completion badge Done sets completed true')
    assert.equal(t23?.due, 'Monday, 30 November 2026, 11:59 PM', 'turnitin item merged from index summary')
    assert.equal(t23?.completed, true)
    console.log('PASS Moodle overview due dates, Opened/Due separation, false-positive guard, quiz/turnitin & detail fallback')

    const ajaxCourses = Array.from({ length: 24 }, (_, idx) => ({
      id: 2000 + idx,
      fullname: idx === 0
        ? 'GLIS1901_1A_2026 Foundations of Global Studies'
        : idx === 1
          ? 'COMP2113 Programming Technologies [2026]'
          : idx === 2
            ? 'COMP2113_2B_2026 Programming Technologies Tutorial Subclass 2B'
            : `ECON${1000 + idx} Principles Course ${idx}`,
      shortname: idx === 0 ? 'GLIS1901_1A_2026' : idx === 2 ? 'COMP2113_2B_2026' : `ECON${1000 + idx}_2026`,
      coursecategory: 'Faculty of Business and Economics',
      viewurl: `https://moodle.hku.hk/course/view.php?id=${2000 + idx}`,
      isfavourite: idx === 0,
      hidden: false,
    }))
    const ajaxEndpoint = 'https://moodle.hku.hk/lib/ajax/service.php?sesskey=testSess123&info=core_course_get_enrolled_courses_by_timeline_classification'
    const ajaxPages = Object.fromEntries(ajaxCourses.map(c => [`https://moodle.hku.hk/course/view.php?id=${c.id}`, `<h1>${c.fullname}</h1>`]))
    ajaxPages[ajaxEndpoint] = JSON.stringify([
      { error: false, data: { courses: ajaxCourses, nextoffset: 0 } },
      { error: false, data: { courses: ajaxCourses, nextoffset: 0 } },
    ])
    const fullAjaxMoodle = await extract(
      '<input type="hidden" name="sesskey" value="testSess123"><a href="https://moodle.hku.hk/course/view.php?id=2000"><span class="sr-only">Course is starred</span><span class="multiline"><span class="sr-only">GLIS1901_1A_2026</span><span aria-hidden="true">GLIS1901_1A_2026</span></span></a>',
      'https://moodle.hku.hk/my/',
      ajaxPages,
    )
    assert.equal(fullAjaxMoodle.courses.length, 24, 'Moodle AJAX discovers all 24 enrolled courses beyond the legacy 20 cap')
    assert.deepEqual(fullAjaxMoodle.replaceFields, ['courses', 'assignments', 'resources', 'announcements', 'grades'])
    assert.equal(fullAjaxMoodle.courses.find(c => c.id === '2000')?.code, 'GLIS1901', 'underscore shortname extracts GLIS1901')
    assert.equal(fullAjaxMoodle.courses.find(c => c.id === '2002')?.isSubclass, true, 'subclass shell flagged automatically')
    console.log('PASS Moodle full AJAX discovery (>20 courses), underscore code extraction, and subclass tagging')

    const parseHtml = (html, base) => run(`(${fileLinksFromHtml.toString()})(${JSON.stringify(html)}, ${JSON.stringify(base)})`)
    const file = 'https://moodle.hku.hk/pluginfile.php/123/mod_resource/content/1/lecture.pdf'
    const resource = 'https://moodle.hku.hk/mod/resource/view.php?id=13'
    const htmlResponse = html => ({ ok: true, url: resource, headers: new Headers({ 'content-type': 'text/html' }), text: async () => html })
    const resolved = await resolveMoodleDownloads(resource, async () => htmlResponse(`<object data="${file}"></object><a href="${file}">Download</a>`), parseHtml)
    assert.deepEqual(resolved, [file + '?forcedownload=1'])
    const redirected = await resolveMoodleDownloads(resource, async target => target === resource
      ? { status: 303, ok: false, headers: new Headers({ location: file }) }
      : { status: 200, ok: true, url: '', headers: new Headers({ 'content-type': 'application/pdf' }) }, parseHtml)
    assert.deepEqual(redirected, [file], 'manual redirects preserve the final file URL even when Electron omits Response.url')
    await assert.rejects(() => resolveMoodleDownloads(resource, async () => ({ status: 302, ok: false, headers: new Headers({ location: '/login/index.php' }) }), parseHtml), /会话已过期/)
    await assert.rejects(() => resolveMoodleDownloads(resource, async () => ({ ...htmlResponse(''), url: 'https://moodle.hku.hk/login/index.php' }), parseHtml), /会话已过期/)
    await assert.rejects(() => resolveMoodleDownloads('https://example.test/file.pdf', () => {}, parseHtml))
    console.log('PASS authenticated file resolution, duplicate links and expired-session errors')

    // Render the production UI with fixtures and assert the actual download click.
    const index = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8')
    const js = readFileSync(new URL(`../dist/${index.match(/src="\.\/([^"\s]+\.js)"/)[1]}`, import.meta.url), 'utf8')
    const css = readFileSync(new URL(`../dist/${index.match(/href="\.\/([^"\s]+\.css)"/)[1]}`, import.meta.url), 'utf8')
    const snapshot = { ...table, ...moodle, fetchedAt: new Date().toISOString(), resources: [...moodle.resources, { id: 'other', course: 'Second course', title: 'Reading material', url: resource }] }
    const mock = `window.myhkuDesktop = { legalStatus: async () => ({accepted:true}), accountStatus: async () => ({ configured: true, localUsername: 'Fixture', email: 'student@example.test' }), authSessions: async () => Object.fromEntries(['portal','sis','moodle'].map(site => [site,{state:'connected'}])), refreshHku: async () => 3, getStorageConfig: async () => ({ storageDir: 'D:/HKU_Courses', defaultDir: 'D:/Downloads/MyHKU', effectiveDir: 'D:/HKU_Courses', organizeMode: 'bglis', isCustom: true }), scanStorageDirectory: async () => ({ rootDir: 'D:/HKU_Courses', exists: true, courses: ['GLIS1901'], files: [] }), checkResourceUpdates: async items => Object.fromEntries(items.slice(0, 1).map(it => [it.id, { id: it.id, url: it.url, signature: 'sig-rev-2', files: [], hasRemoteUpdate: true, reason: 'Moodle 远端文件已升级至第 2 版', checkedAt: new Date().toISOString() }])), downloadResource: async url => { window.downloadClicked = url; return 1; } }; window.fetch = async () => new Response(JSON.stringify(${JSON.stringify(snapshot)}));`
    win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) && !details.url.startsWith('https://dashboard.example.test/') }))
    await win.webContents.session.protocol.handle('https', () => new Response(`<meta charset="utf-8"><style>${css}</style><div id="root"></div><script>${mock}</script><script type="module">${js}</script>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))
    await win.loadURL('https://dashboard.example.test/')
    async function until(code) {
      for (let i = 0; i < 100; i++) { if (await run(code)) return; await new Promise(resolve => setTimeout(resolve, 50)) }
      throw new Error(`UI assertion timed out: ${code}`)
    }
    await until('document.body.innerText.includes("今日课程")')
    await run('[...document.querySelectorAll("nav button")].find(node => node.innerText.includes("我的课表")).click()')
    await until('document.querySelectorAll(".schedule-event").length === 11')
    assert.equal(await run('document.body.innerText.includes("导出 .ics")'), true, 'ICS export button is visible on CalendarPage')
    await run('[...document.querySelectorAll(".calendar-actions button")].find(node => node.innerText.includes("新建倒计时")).click()')
    await until('document.querySelector("dialog.myhku-modal")?.open === true')
    await run('document.querySelector("dialog.myhku-modal")?.close()')
    await until('document.querySelector("dialog.myhku-modal")?.open === false')
    assert.equal(await run('[...document.querySelectorAll(".schedule-event")].every(node => node.scrollHeight <= node.clientHeight && getComputedStyle(node.querySelector("small")).whiteSpace === "normal")'), true, 'time and room wrap without clipping')
    await new Promise(resolve => setTimeout(resolve, 250))
    writeFileSync(join(app.getPath('userData'), 'calendar.png'), (await win.webContents.capturePage()).toPNG())
    await run('[...document.querySelectorAll("nav button")].find(node => node.innerText.includes("课程资料")).click()')
    await until('document.querySelectorAll(".resource-course").length === 2 && document.querySelector(".materials-sync-alert") !== null')
    assert.equal(await run('document.querySelectorAll(".filter-pill").length >= 8 && document.querySelector(".materials-storage-bar") !== null && document.querySelector(".one-click-sync-btn") !== null && document.querySelector(".updated-resource-badge") !== null && document.body.innerText.includes("D:/HKU_Courses") && document.body.innerText.includes("一键全下")'), true, 'Materials storage bar, update alert banner, one-click sync CTA, and batch download controls render')
    await run('document.querySelector(".resource-row button").click()')
    await until('window.downloadClicked !== undefined')
    assert.equal(await run('window.downloadClicked'), resource)
    await run('document.querySelector(".pin-btn").click()')
    await until('document.querySelector(".pin-btn.pinned") !== null')
    await run('[...document.querySelectorAll("nav button")].find(node => node.innerText.includes("下载队列")).click()')
    await until('document.querySelector(".download-queue-page") !== null && document.querySelector("[role=\\"toolbar\\"]") !== null && document.querySelectorAll(".dl-queue-item").length >= 1')
    await run('[...document.querySelectorAll("nav button")].find(node => node.innerText.includes("课程资料")).click()')
    await until('document.querySelectorAll(".resource-course").length === 2')
    assert.equal(BrowserWindow.getAllWindows().length, 1)
    await new Promise(resolve => setTimeout(resolve, 250))
    writeFileSync(join(app.getPath('userData'), 'materials.png'), (await win.webContents.capturePage()).toPNG())
    await run('[...document.querySelectorAll("nav button")].find(node => node.innerText.includes("Moodle")).click()')
    await until('document.querySelectorAll(".course-select-row").length >= 1 && document.querySelector(".gpa-card") !== null && document.querySelector(".manage-courses-btn") !== null')
    await run('document.querySelector(".manage-courses-btn").click()')
    await until('document.querySelector("dialog.course-selector-modal")?.open === true')
    await run('document.querySelector("dialog.course-selector-modal")?.close()')
    await until('document.querySelector("dialog.course-selector-modal")?.open === false')
    await run('document.querySelector(".course-select-row").click()')
    await until('document.querySelector(".course-detail-page") !== null && document.querySelector(".course-whatif-card") !== null && document.body.innerText.includes("未发布")')
    await run('document.querySelector(".palette-trigger-btn").click()')
    await until('document.querySelector("dialog.command-palette-dialog")?.open === true')
    await run('document.querySelector("dialog.command-palette-dialog")?.close()')
    await until('document.querySelector("dialog.command-palette-dialog")?.open === false')
    await run('[...document.querySelectorAll("nav button")].find(node => node.innerText.includes("设置")).click()')
    await until('document.body.innerText.includes("深色") && document.querySelector(".updater-card") !== null && document.querySelector(".diagnostics-card") !== null && document.querySelector(".backup-card") !== null')
    await run('[...document.querySelectorAll(".mode-switch button")].find(node => node.innerText.includes("深色")).click()')
    await until('document.documentElement.dataset.theme === "dark"')
    await run('document.querySelector(".lang-toggle-btn").click()')
    await until('document.documentElement.lang === "en" && document.body.innerText.includes("HKU Service Connections") && document.body.innerText.includes("App Version & Update Checker")')
    await run('document.querySelector(".lang-toggle-btn").click()')
    await until('document.documentElement.lang === "zh-CN"')
    console.log(`PASS production calendar layout, GPA simulator, EN/ZH i18n, command palette, updater/diagnostics/backup cards, course drill-down, grade states, dark theme, course columns and direct-download button; screenshots: ${app.getPath('userData')}`)
    app.exit(0)
  } catch (error) { console.error(error); app.exit(1) }
})
