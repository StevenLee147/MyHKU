// Exercise the production Electron main process and preload against local
// official-site fixtures, isolated from the installed app and all real data.
import { app, BrowserWindow, session } from 'electron'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import net from 'node:net'
import { AUTH_TIMING } from '../desktop/auth-flow.mjs'

app.setPath('userData', mkdtempSync(join(tmpdir(), 'myhku-integration-')))
app.disableHardwareAcceleration()
// Keep all fixture windows hidden; count visibility requests separately.
let shows = 0
const visibility = new WeakMap()
app.on('browser-window-created', (_event, win) => {
  const state = { visible: false, hides: 0 }
  visibility.set(win, state)
  const hide = win.hide.bind(win)
  win.on('show', () => { shows++; hide() })
  win.show = () => { shows++; state.visible = true }
  win.hide = () => { state.hides++; state.visible = false; hide() }
  win.isVisible = () => state.visible
})
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function freePort() {
  const server = net.createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return String(port)
}
async function until(predicate, label, timeout = 65_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await predicate()) return
    await delay(100)
  }
  throw new Error(`Timed out: ${label}`)
}

app.whenReady().then(async () => {
  process.env.MYHKU_BRIDGE_PORT = await freePort()
  process.env.MYHKU_UI_PORT = await freePort()
  process.env.MYHKU_DEV_SERVER_URL = 'data:text/html,<h1>MyHKU isolated auth integration</h1>'
  delete process.env.MYHKU_OPEN_LOGIN_ON_STARTUP
  const visits = { portal: 0, sis: 0, moodle: 0, credentials: 0, casEmail: 0 }
  let portalAuthenticated = false
  let sisAuthenticated = false
  let moodleAuthenticated = false
  let portalMode = 'normal'
  let holdResources = true
  let portalPageServedAt = 0
  const pendingResources = []
  const releaseResources = () => { holdResources = false; for (const release of pendingResources.splice(0)) release() }
  const html = body => new Response(`<!doctype html><html><body>${body}</body></html>`, { headers: { 'Content-Type': 'text/html' } })
  const redirect = url => html(`<script>setTimeout(() => location.assign(${JSON.stringify(url)}), 2200)</script><p>Redirecting…</p>`)
  await session.fromPartition('persist:myhku-hku').protocol.handle('https', async request => {
    const url = new URL(request.url)
    if (url.hostname === 'studentportal.hku.hk') {
      if (url.pathname === '/slow-resource') return new Promise(resolve => pendingResources.push(() => resolve(new Response('', { status: 200 }))))
      visits.portal++
      if (portalMode === 'blank') { portalMode = 'normal'; return html('<p>Waiting for official page…</p><img src="/slow-resource">') }
      if (portalMode === 'mfa') { portalMode = 'normal'; return html('<p>Approve the sign-in request</p><input name="otc">') }
      if (portalAuthenticated) {
        portalPageServedAt ||= Date.now()
        return html('<div hidden><a href="https://hkuportal.hku.hk/cas/servlet/edu.yale.its.tp.cas.servlet.PortalLogout">Log out</a></div><h1>Student Portal</h1><input name="userSearch"><p>Authenticator instructions</p><form method="post" action="https://sis-main.hku.hk/portal-launch" target="_blank"><input type="hidden" name="fixture-ticket" value="fictional-sso"><button type="submit">Student Information System (SIS)</button></form>' + (holdResources ? '<img src="/slow-resource">' : ''))
      }
      return redirect('https://adfs.connect.hku.hk/adfs/ls/')
    }
    if (url.hostname === 'adfs.connect.hku.hk') {
      if (url.pathname === '/complete') {
        const values = new URLSearchParams(await request.text())
        assert.equal(values.get('username'), 'student@example.test')
        assert.equal(values.get('password'), 'fictional-test-password')
        visits.credentials++
        portalAuthenticated = true
        return redirect('https://studentportal.hku.hk/en-US/')
      }
      return html('<form method="post" action="/complete"><input name="username"><input name="password" type="password"><button type="submit">Sign in</button></form>')
    }
    if (url.hostname === 'sis-main.hku.hk') {
      visits.sis++
      if (url.pathname === '/portal-launch') {
        assert.equal(new URL(request.referrer).hostname, 'studentportal.hku.hk', 'SIS popup preserves the official Portal referrer')
        assert.equal(request.method, 'POST')
        assert.equal(new URLSearchParams(await request.text()).get('fixture-ticket'), 'fictional-sso', 'official popup form submission is preserved')
        return redirect('https://hkuportal.hku.hk/cas/aad')
      }
      if (url.pathname === '/sis-home' && sisAuthenticated) return html('<div hidden><a id="pthdr2signout" href="/psp/sisprod/EMPLOYEE/SA/">Sign Out</a></div><a href="/timetable">My Weekly Schedule</a>')
      return sisAuthenticated ? html('<iframe src="https://sweb.hku.hk/timetable"></iframe>') : html('<p>This is not the SIS login page. Please log in from HKU Portal.</p>')
    }
    if (url.hostname === 'hkuportal.hku.hk') {
      if (url.pathname === '/cas/logout') return html('<h1>You have successfully logged out</h1>')
      if (url.pathname === '/cas/manual-success') return html('<h2>Log In Successful</h2><p>You have successfully logged into the Central Authentication Service.</p>')
      if (url.pathname === '/cas/complete') {
        assert.equal(url.searchParams.get('email'), 'student@example.test')
        visits.casEmail++
        sisAuthenticated = true
        return redirect('https://sis-main.hku.hk/sis-home')
      }
      return sisAuthenticated ? redirect('https://sis-main.hku.hk/sis-home') : html('<input type="text" id="email" name="email" placeholder="Email Address"><input type="button" id="login_btn" value="Login" onclick="location.assign(\'/cas/complete?email=\' + encodeURIComponent(document.getElementById(\'email\').value))">')
    }
    if (url.hostname === 'sweb.hku.hk') return html('<div class="bkgCalViewWDHeader">Monday</div>')
    if (url.hostname === 'intraweb.hku.hk') return html('<p>Loading…</p>')
    if (url.hostname === 'moodle.hku.hk') {
      if (url.pathname === '/mod/resource/view.php') return html('<object data="https://moodle.hku.hk/pluginfile.php/123/mod_resource/content/1/fixture.txt"></object>')
      if (url.pathname.startsWith('/pluginfile.php/')) return new Response('Fixture document bytes', { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="fixture.txt"' } })
      visits.moodle++
      if (url.searchParams.has('authCAS')) {
        moodleAuthenticated = true
        return redirect('https://moodle.hku.hk/my/')
      }
      return moodleAuthenticated ? html('<div data-region="myoverview">No courses</div><p>Authenticator instructions</p>') : html('<a href="/login/index.php?authCAS=CAS">HKU Portal User</a><input name="username"><input type="password">')
    }
    throw new Error('Unexpected fixture host')
  })
  await import('../desktop/main.mjs')
  await until(() => BrowserWindow.getAllWindows().some(win => win.webContents.getURL().startsWith('data:') && !win.webContents.isLoading()), 'dashboard preload')
  const dashboard = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().startsWith('data:'))
  const dashboardShows = shows
  const invoke = code => dashboard.webContents.executeJavaScript(code)
  await invoke(`window.myhkuDesktop.saveAccount({ localUsername: 'Fixture', email: 'student@example.test', password: 'fictional-test-password' })`)
  await invoke('window.myhkuDesktop.beginLogin(false)')
  await delay(300)
  for (let i = 0; i < 4; i++) {
    await invoke('window.myhkuDesktop.beginLogin(false)')
    await invoke('window.myhkuDesktop.refreshHku()')
  }
  assert.equal(BrowserWindow.getAllWindows().length, 2, 'only dashboard plus one active SSO window')
  let sessions = await invoke('window.myhkuDesktop.authSessions()')
  assert.equal(sessions.portal.state, 'checking')
  assert.equal(sessions.sis.state, 'queued')
  assert.equal(sessions.moodle.state, 'queued')
  await until(async () => Object.values(await invoke('window.myhkuDesktop.authSessions()')).every(item => item.state === 'connected'), 'three automatic service connections')
  assert.equal(visits.credentials, 1)
  assert.equal(visits.casEmail, 1, 'SIS CAS receives a full email through its official button exactly once')
  assert.equal(BrowserWindow.getAllWindows().length, 4, 'exactly one retained window for each service')
  const initiallyConnected = await invoke('window.myhkuDesktop.authSessions()')
  const firstPortalWindow = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('studentportal.hku.hk'))
  assert.ok(Date.parse(initiallyConnected.portal.checkedAt) - portalPageServedAt < 3000, 'Portal reports success promptly after its authenticated DOM appears')
  assert.equal(firstPortalWindow.webContents.isLoading(), true, 'all three services connect while Portal subresources are still loading')
  assert.equal(await firstPortalWindow.webContents.mainFrame.executeJavaScript('typeof window.myhkuDesktop'), 'undefined', 'official pages cannot manage the local account through the preload')
  console.log('PASS Portal success and subsequent services do not wait for page load completion')
  releaseResources()
  await until(() => !firstPortalWindow.webContents.isLoading(), 'released Portal resources')
  const before = { ...visits }
  await invoke('window.myhkuDesktop.beginLogin(true)')
  await invoke('window.myhkuDesktop.loginSite("sis")')
  await delay(500)
  assert.deepEqual(visits, before, 'connected services do not navigate or start login again')
  await dashboard.webContents.reload()
  await until(() => !dashboard.webContents.isLoading(), 'dashboard reload')
  sessions = await invoke('window.myhkuDesktop.authSessions()')
  assert.ok(Object.values(sessions).every(item => item.state === 'connected'), 'dashboard reload restores native session state')
  await invoke('window.myhkuDesktop.refreshHku()')
  await until(async () => Object.values(await invoke('window.myhkuDesktop.authSessions()')).every(item => item.state === 'connected'), 'session reuse during refresh')
  assert.equal(visits.credentials, 1, 'valid session refresh never submits credentials again')
  assert.equal(visits.casEmail, 1, 'valid SIS refresh reuses the official Portal SSO entry')
  assert.equal(BrowserWindow.getAllWindows().length, 4)
  assert.equal(shows, dashboardShows, 'automatic redirect and session reuse never reveal a login window')
  const downloadPath = join(app.getPath('userData'), 'fixture.txt')
  app.setPath('downloads', app.getPath('userData'))
  assert.equal(await invoke('window.myhkuDesktop.downloadResource("https://moodle.hku.hk/mod/resource/view.php?id=13")'), 1)
  assert.equal(readFileSync(downloadPath, 'utf8'), 'Fixture document bytes')
  await invoke('window.myhkuDesktop.downloadResource("https://moodle.hku.hk/mod/resource/view.php?id=13")')
  assert.equal(readFileSync(join(app.getPath('userData'), 'fixture (1).txt'), 'utf8'), 'Fixture document bytes', 'repeated downloads never overwrite existing files')
  assert.equal(BrowserWindow.getAllWindows().length, 4, 'download parser is disposed and no original page window opens')
  assert.equal(shows, dashboardShows, 'resource download never reveals a window')
  console.log('PASS native resource IPC downloads file bytes without opening the Moodle page')
  const bridgeUrl = `http://127.0.0.1:${process.env.MYHKU_BRIDGE_PORT}`
  const ingest = async assignments => {
    const response = await fetch(`${bridgeUrl}/api/ingest/moodle`, { method: 'POST', headers: { Origin: 'https://moodle.hku.hk', 'Content-Type': 'application/json' }, body: JSON.stringify({ assignments }) })
    assert.equal(response.ok, true)
  }
  await ingest([{ id: 'module-123', title: 'Fixture assignment', course: 'Example course', completed: true }])
  await ingest([{ id: '123', title: 'Fixture assignment', course: 'Example course', due: '22 September, 11:59 PM', completed: false, submissionStatus: 'No submission' }])
  await ingest([{ id: '123', title: 'Fixture assignment', course: 'Example course' }])
  const assignments = (await (await fetch(`${bridgeUrl}/api/snapshot`)).json()).assignments
  assert.equal(assignments.length, 1, 'old course-card IDs merge with overview activity IDs')
  assert.equal(assignments[0].completed, false)
  assert.equal(assignments[0].submissionStatus, 'No submission')
  assert.equal(assignments[0].due, '22 September, 11:59 PM', 'a partial course card cannot erase overview details')
  console.log('PASS bridge retains authoritative assignment dates and status across partial refreshes')
  const portalWindow = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('studentportal.hku.hk'))
  const moodleWindow = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('moodle.hku.hk'))
  const sisWindow = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('sweb.hku.hk'))
  assert.ok(sisWindow.webContents.getURL().includes('/MyWeekly/showTimetable'), 'SIS SSO continues to the official student timetable')
  await sisWindow.webContents.mainFrame.executeJavaScript('document.body.innerHTML = `<iframe src="https://intraweb.hku.hk/slow-frame"></iframe><iframe src="https://sweb.hku.hk/timetable"></iframe>`')
  await until(() => sisWindow.webContents.mainFrame.frames.filter(frame => /https:\/\/(?:intraweb|sweb)\.hku\.hk\//.test(frame.url)).length === 2, 'cross-origin SIS frames')
  const slowFrame = sisWindow.webContents.mainFrame.frames.find(frame => frame.url.includes('intraweb.hku.hk'))
  const slowExecute = slowFrame.executeJavaScript
  slowFrame.executeJavaScript = function(code, gesture) {
    if (code.includes('function inspectAuthPage')) return new Promise(() => {})
    return slowExecute.call(this, code, gesture)
  }
  const normalInspect = AUTH_TIMING.inspect
  AUTH_TIMING.inspect = 5000
  sisWindow.webContents.emit('did-fail-load', {}, -105, 'Fixture frame recovery', sisWindow.webContents.getURL(), true)
  await until(async () => (await invoke('window.myhkuDesktop.authSessions()')).sis.state === 'connected', 'a successful cross-origin frame is not blocked by a stalled sibling', 2500)
  slowFrame.executeJavaScript = slowExecute
  AUTH_TIMING.inspect = normalInspect
  // One never-resolving renderer call must not stop all future inspections.
  const portalFrame = portalWindow.webContents.mainFrame
  const execute = portalFrame.executeJavaScript
  const inspectTimeout = AUTH_TIMING.inspect
  AUTH_TIMING.inspect = 200
  let inspections = 0
  portalFrame.executeJavaScript = function(code, gesture) {
    if (code.includes('function inspectAuthPage') && ++inspections === 1) return new Promise(() => {})
    return execute.call(this, code, gesture)
  }
  // A recoverable navigation error must not permanently stop observation.
  portalWindow.webContents.emit('did-fail-load', {}, -105, 'Fixture network failure', portalWindow.webContents.getURL(), true)
  assert.equal((await invoke('window.myhkuDesktop.authSessions()')).portal.state, 'error')
  portalWindow.show()
  await until(async () => (await invoke('window.myhkuDesktop.authSessions()')).portal.state === 'connected', 'successful page recovers after a load error')
  assert.ok(inspections >= 2, 'stalled inspection releases the lock for a fresh check')
  portalFrame.executeJavaScript = execute
  AUTH_TIMING.inspect = inspectTimeout
  assert.equal(portalWindow.isVisible(), false, 'recovered login window automatically hides')
  // Timeouts release the queue even when load never finishes; the original
  // window remains observable and can finish through a later CAS callback.
  const normalTimeout = AUTH_TIMING.timeout
  AUTH_TIMING.timeout = 1200
  portalMode = 'blank'
  holdResources = true
  await invoke('window.myhkuDesktop.refreshHku()')
  await until(async () => (await invoke('window.myhkuDesktop.authSessions()')).portal.state === 'manual_required', 'hung Portal timeout', 5000)
  AUTH_TIMING.timeout = normalTimeout
  portalMode = 'normal'
  await until(async () => {
    const state = await invoke('window.myhkuDesktop.authSessions()')
    return state.sis.state === 'connected' && state.moodle.state === 'connected'
  }, 'other services continue after Portal timeout', 20_000)
  assert.equal(portalWindow.isVisible(), true)
  await portalWindow.loadURL('https://hkuportal.hku.hk/cas/manual-success').catch(error => { if (error.errno !== -3) throw error })
  await until(async () => (await invoke('window.myhkuDesktop.authSessions()')).portal.state === 'connected', 'late CAS completion resumes a paused flow', 5000)
  assert.equal(portalWindow.isVisible(), false)
  releaseResources()
  console.log('PASS Portal timeout releases the queue and a late CAS result resumes the original window')
  // A real user challenge also releases the queue, without losing its state
  // or submitting credentials in that window while another flow is active.
  portalMode = 'mfa'
  await invoke('window.myhkuDesktop.refreshHku()')
  await until(async () => (await invoke('window.myhkuDesktop.authSessions()')).portal.state === 'needs_2fa', 'Portal MFA')
  portalMode = 'normal'
  await until(async () => {
    const state = await invoke('window.myhkuDesktop.authSessions()')
    return state.portal.state === 'needs_2fa' && state.sis.state === 'connected' && state.moodle.state === 'connected'
  }, 'MFA does not block other services', 20_000)
  await portalWindow.webContents.mainFrame.executeJavaScript('document.body.innerHTML = "<a href=/logout>Log out</a>"')
  await until(async () => (await invoke('window.myhkuDesktop.authSessions()')).portal.state === 'connected', 'MFA completion is observed without queue ownership', 3000)
  assert.equal(portalWindow.isVisible(), false)
  await portalWindow.webContents.mainFrame.executeJavaScript('document.body.innerHTML = "<p>Loading a business page…</p>"')
  await delay(AUTH_TIMING.poll * 3)
  assert.equal((await invoke('window.myhkuDesktop.authSessions()')).portal.state, 'connected', 'ordinary business rendering does not invalidate a verified login')
  console.log('PASS MFA releases the queue and manual completion restores connected state')
  await portalWindow.loadURL('https://hkuportal.hku.hk/cas/logout')
  await until(async () => (await invoke('window.myhkuDesktop.authSessions()')).portal.state === 'disconnected', 'explicit official logout', 3000)
  await portalWindow.loadURL('https://adfs.connect.hku.hk/adfs/ls/')
  await delay(AUTH_TIMING.poll * 3)
  assert.equal((await invoke('window.myhkuDesktop.authSessions()')).portal.state, 'disconnected', 'an explicit logout is not undone by automatic login')
  assert.equal(await portalWindow.webContents.mainFrame.executeJavaScript('document.querySelector("input[type=password]").value'), '')
  await invoke('window.myhkuDesktop.loginSite("portal")')
  await until(async () => (await invoke('window.myhkuDesktop.authSessions()')).portal.state === 'connected', 'explicit reconnect after official logout', 3000)
  // Opening a service during verification uses the same tracked window and
  // still hides it after success, even when another service owns the queue.
  await moodleWindow.webContents.executeJavaScript('document.body.innerHTML = "<p>Approve the sign-in request</p><input name=otc>"')
  await until(async () => (await invoke('window.myhkuDesktop.authSessions()')).moodle.state === 'needs_2fa', 'MFA window')
  await invoke('window.open("https://moodle.hku.hk/my/", "_blank")')
  await delay(300)
  assert.equal(BrowserWindow.getAllWindows().length, 4)
  assert.equal(moodleWindow.isVisible(), true)
  await moodleWindow.webContents.executeJavaScript('document.body.innerHTML = "<div data-region=myoverview>No courses</div>"')
  await until(async () => (await invoke('window.myhkuDesktop.authSessions()')).moodle.state === 'connected', 'manual login updates native status')
  assert.equal(moodleWindow.isVisible(), false, 'manually opened login hides on completion')
  await invoke('window.open("https://moodle.hku.hk/my/", "_blank")')
  await until(async () => (await invoke('window.myhkuDesktop.authSessions()')).moodle.state === 'connected' && !moodleWindow.webContents.isLoading(), 'explicit course browsing')
  assert.equal(moodleWindow.isVisible(), true, 'connected service browsing remains visible')
  const oldFrame = moodleWindow.webContents.mainFrame
  const oldExecute = oldFrame.executeJavaScript
  let finishOldInspection
  oldFrame.executeJavaScript = function(code, gesture) {
    if (code.includes('function inspectAuthPage')) return new Promise(resolve => { finishOldInspection = resolve })
    return oldExecute.call(this, code, gesture)
  }
  await until(() => Boolean(finishOldInspection), 'pending observation before sign-out', 3000)
  await invoke('window.myhkuDesktop.clearAccount()')
  await until(() => BrowserWindow.getAllWindows().length === 1, 'fixture account reset')
  await invoke('window.open("https://moodle.hku.hk/my/", "_blank")')
  await until(async () => (await invoke('window.myhkuDesktop.authSessions()')).moodle.state === 'connected', 'first manually opened service creates a tracked record')
  assert.equal(BrowserWindow.getAllWindows().length, 2)
  assert.equal(BrowserWindow.getAllWindows().find(win => win !== dashboard).isVisible(), false)
  finishOldInspection({ state: 'manual_required', immediate: true, detail: 'Stale fixture document' })
  await delay(AUTH_TIMING.poll * 2)
  assert.equal((await invoke('window.myhkuDesktop.authSessions()')).moodle.state, 'connected', 'old account observations cannot corrupt a new record for the same service')
  await invoke(`window.myhkuDesktop.saveAccount({ localUsername: 'Fixture', email: 'student@example.test', password: 'fictional-test-password' })`)
  const official = session.fromPartition('persist:myhku-hku')
  await official.cookies.set({ url: 'https://moodle.hku.hk/', name: 'fixture-session', value: 'fictional-session' })
  await invoke(`window.myhkuDesktop.saveAccount({ localUsername: 'Second fixture', email: 'second@example.test', password: 'second-fictional-password' })`)
  assert.equal(BrowserWindow.getAllWindows().length, 1, 'changing accounts destroys the old official documents')
  assert.ok(Object.values(await invoke('window.myhkuDesktop.authSessions()')).every(item => item.state === 'disconnected'))
  assert.equal((await official.cookies.get({ name: 'fixture-session' })).length, 0, 'changing accounts clears the previous official session')
  assert.equal((await invoke('window.myhkuDesktop.accountStatus()')).email, 'second@example.test')
  await invoke('window.myhkuDesktop.clearAccount()')
  assert.equal((await invoke('window.myhkuDesktop.accountStatus()')).configured, false)
  console.log('PASS production main/preload: prompt success during unfinished loads, timeout/MFA queue release, late CAS recovery, Portal SIS launch, isolated official windows, persistent status, safe refresh, error recovery, manual auto-hide, explicit browsing')
  app.quit()
}).catch(error => { console.error(error); app.once('will-quit', () => app.exit(1)); app.quit() })
