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
    console.log('PASS absolute calendar positions use headers; empty weeks replace stale entries')

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
    const direct = await extract(overview, overviewUrl, { [courseUrl]: course, [overviewUrl]: overview })
    assert.equal(direct.assignments.length, 2, 'visiting overview directly deduplicates course cards')
    console.log('PASS Moodle overview due dates, submission state, course association and deduplication')

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
    const mock = `window.myhkuDesktop = { accountStatus: async () => ({ configured: true, localUsername: 'Fixture', email: 'student@example.test' }), authSessions: async () => Object.fromEntries(['portal','sis','moodle'].map(site => [site,{state:'connected'}])), refreshHku: async () => 3, downloadResource: async url => { window.downloadClicked = url; return 1; } }; window.fetch = async () => new Response(JSON.stringify(${JSON.stringify(snapshot)}));`
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
    assert.equal(await run('[...document.querySelectorAll(".schedule-event")].every(node => node.scrollHeight <= node.clientHeight && getComputedStyle(node.querySelector("small")).whiteSpace === "normal")'), true, 'time and room wrap without clipping')
    await new Promise(resolve => setTimeout(resolve, 250))
    writeFileSync(join(app.getPath('userData'), 'calendar.png'), (await win.webContents.capturePage()).toPNG())
    await run('[...document.querySelectorAll("nav button")].find(node => node.innerText.includes("课程资料")).click()')
    await until('document.querySelectorAll(".resource-course").length === 2')
    await run('document.querySelector(".resource-row button").click()')
    await until('window.downloadClicked !== undefined')
    assert.equal(await run('window.downloadClicked'), resource)
    assert.equal(BrowserWindow.getAllWindows().length, 1)
    await new Promise(resolve => setTimeout(resolve, 250))
    writeFileSync(join(app.getPath('userData'), 'materials.png'), (await win.webContents.capturePage()).toPNG())
    console.log(`PASS production calendar layout, course columns and direct-download button; screenshots: ${app.getPath('userData')}`)
    app.exit(0)
  } catch (error) { console.error(error); app.exit(1) }
})
