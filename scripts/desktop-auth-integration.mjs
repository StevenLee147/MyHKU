// Exercise the production Electron main process and preload against local
// official-site fixtures, isolated from the installed app and all real data.
import { app, BrowserWindow, session } from 'electron'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import net from 'node:net'

app.setPath('userData', mkdtempSync(join(tmpdir(), 'myhku-integration-')))
app.disableHardwareAcceleration()
// Keep all fixture windows hidden; count visibility requests separately.
let shows = 0
app.on('browser-window-created', (_event, win) => win.on('show', () => { shows++; win.hide() }))
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function freePort() {
  const server = net.createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return String(port)
}
async function until(predicate, label) {
  const deadline = Date.now() + 65_000
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
  const visits = { portal: 0, sis: 0, moodle: 0, credentials: 0 }
  let portalAuthenticated = false
  let sisAuthenticated = false
  let moodleAuthenticated = false
  const html = body => new Response(`<!doctype html><html><body>${body}</body></html>`, { headers: { 'Content-Type': 'text/html' } })
  const redirect = url => html(`<script>setTimeout(() => location.assign(${JSON.stringify(url)}), 2200)</script><p>Redirecting…</p>`)
  await session.fromPartition('persist:myhku-hku').protocol.handle('https', async request => {
    const url = new URL(request.url)
    if (url.hostname === 'studentportal.hku.hk') {
      visits.portal++
      return portalAuthenticated ? html('<a href="/logout">Sign out</a><h1>Student Portal</h1>') : redirect('https://adfs.connect.hku.hk/adfs/ls/')
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
    if (url.hostname === 'sweb.hku.hk') {
      visits.sis++
      if (url.pathname === '/portal-login') sisAuthenticated = true
      return sisAuthenticated ? html('<div class="bkgCalViewWDHeader">Monday</div>') : html('<a href="/portal-login">Portal Login</a><form action="/guest"><input name="username"><input name="password" type="password"><button>Guest Login</button></form>')
    }
    if (url.hostname === 'moodle.hku.hk') {
      visits.moodle++
      if (url.searchParams.has('authCAS')) {
        moodleAuthenticated = true
        return redirect('https://moodle.hku.hk/my/')
      }
      return moodleAuthenticated ? html('<div data-region="myoverview">No courses</div>') : html('<a href="/login/index.php?authCAS=CAS">HKU Portal User</a><input name="username"><input type="password">')
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
  assert.equal(BrowserWindow.getAllWindows().length, 4, 'exactly one retained window for each service')
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
  assert.equal(BrowserWindow.getAllWindows().length, 4)
  assert.equal(shows, dashboardShows, 'automatic redirect and session reuse never reveal a login window')
  console.log('PASS production main/preload: serialized login, duplicate requests, silent SSO, persistent status, safe refresh')
  app.quit()
}).catch(error => { console.error(error); app.once('will-quit', () => app.exit(1)); app.quit() })
