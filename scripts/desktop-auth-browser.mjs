// Real Chromium DOM regression tests with fictional credentials. No HKU
// requests, stored accounts or installed application profiles are used.
import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectAuthPage } from '../desktop/auth-flow.mjs'

const profile = mkdtempSync(join(tmpdir(), 'myhku-auth-test-'))
app.setPath('userData', profile)
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }))
const credentials = { email: 'student@example.test', password: 'fictional-test-password' }
let passed = 0
async function fixture(name, html, url, verify) {
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  const parsed = new URL(url)
  const location = { protocol: parsed.protocol, hostname: parsed.hostname, pathname: parsed.pathname }
  const run = (act = true) => win.webContents.executeJavaScript(`((location) => (${inspectAuthPage.toString()})(${JSON.stringify(credentials)}, ${act}))(${JSON.stringify(location)})`)
  const read = script => win.webContents.executeJavaScript(script)
  await verify(run, read)
  console.log(`PASS ${name}`)
  passed++
}
try {
  await fixture('SIS Portal Login wins over guest credentials and submits only once', '<a href="#" onclick="window.clicks=(window.clicks||0)+1;return false">Portal Login</a><form><input name="userid"><input type="password"><button>Guest Login</button></form>', 'https://sis-main.hku.hk/sisprod/z_signon.jsp', async (run, read) => {
    assert.equal((await run()).state, 'submitted')
    assert.equal((await run()).state, 'waiting')
    assert.equal(await read('window.clicks'), 1)
    assert.equal(await read('document.querySelector("input[type=password]").value'), '')
    assert.equal(await read('document.querySelector("input").value'), '')
  })
  await fixture('combined identity form fills both fields and duplicate events never resubmit', '<form onsubmit="window.submits=(window.submits||0)+1;return false"><input name="username"><input type="password"><button type="submit">Sign in</button></form>', 'https://adfs.connect.hku.hk/adfs/ls/', async (run, read) => {
    assert.equal((await run()).state, 'submitted')
    await Promise.all([run(), run(), run()])
    assert.equal(await read('window.submits'), 1)
    assert.equal(await read('document.querySelector("input").value'), credentials.email)
    assert.equal(await read('document.querySelector("input[type=password]").value'), credentials.password)
  })
  await fixture('slow identity page waits until fields arrive', '<main>Redirecting…</main>', 'https://login.microsoftonline.com/login.srf', async (run, read) => {
    assert.equal((await run()).state, 'waiting')
    await read('document.body.innerHTML = `<form onsubmit="return false"><input name="loginfmt"><button type="submit">Next</button></form>`')
    assert.equal((await run()).state, 'submitted')
  })
  await fixture('Moodle CAS callback waits for delayed redirect instead of restarting CAS', '<p>Redirecting…</p>', 'https://moodle.hku.hk/login/index.php?authCAS=CAS', async run => assert.equal((await run()).state, 'waiting'))
  await fixture('an MFA challenge stays manual and receives no password', '<p>Approve the sign-in request in your Authenticator</p><input name="otc">', 'https://login.microsoftonline.com/common/SAS/ProcessAuth', async (run, read) => {
    assert.equal((await run()).state, 'needs_2fa')
    assert.equal(await read('document.querySelector("input").value'), '')
  })
  await fixture('business URL with no authentication evidence stays pending', '<h1>Loading</h1>', 'https://studentportal.hku.hk/en-US/', async run => assert.equal((await run()).state, 'waiting'))
  await fixture('guest form is never mistaken for a logged-in SIS page', '<input name="userid"><input type="password"><h1>Guest Login</h1>', 'https://sis-main.hku.hk/psp/sisprod/', async (run, read) => {
    assert.equal((await run()).state, 'manual_required')
    assert.equal(await read('document.querySelector("input[type=password]").value'), '')
  })
  await fixture('Moodle portal user link wins over its local login form', '<a href="#" onclick="window.clicks=1;return false">HKU Portal User</a><input name="username"><input type="password">', 'https://moodle.hku.hk/', async (run, read) => {
    assert.equal((await run()).state, 'submitted')
    assert.equal(await read('window.clicks'), 1)
    assert.equal(await read('document.querySelector("input[type=password]").value'), '')
  })
  await fixture('Moodle authenticated page is recognized even with no courses', '<body><div data-region="myoverview">No courses</div></body>', 'https://moodle.hku.hk/my/', async run => assert.equal((await run()).state, 'authenticated'))
  await fixture('Portal existing SSO needs no form submission', '<a href="/Account/Login/LogOff">Sign out</a>', 'https://studentportal.hku.hk/en-US/', async run => assert.equal((await run()).state, 'authenticated'))
  await fixture('Portal sign-out in a collapsed account menu still proves the session', '<div hidden><a href="/Account/Login/LogOff">Sign out</a></div>', 'https://studentportal.hku.hk/en-US/', async run => assert.equal((await run()).state, 'authenticated'))
  await fixture('empty legacy SIS timetable is still an authenticated session', '<div class="bkgCalViewWDHeader">Monday</div>', 'https://sweb.hku.hk/student/servlet/MyWeekly/showTimetable', async run => assert.equal((await run()).state, 'authenticated'))
  await fixture('identity errors stop automatic credential retries', '<div role="alert">Incorrect password. Try again.</div><form><input name="username"><input type="password"><button type="submit">Sign in</button></form>', 'https://login.microsoftonline.com/login.srf', async (run, read) => {
    assert.equal((await run()).state, 'manual_required')
    assert.equal(await read('document.querySelector("input[type=password]").value'), '')
  })
  await fixture('unrelated host cannot receive saved credentials', '<form><input name="username"><input type="password"><button type="submit">Sign in</button></form>', 'https://evil.example.test/login', async (run, read) => {
    assert.equal((await run()).state, 'waiting')
    assert.equal(await read('document.querySelector("input[type=password]").value'), '')
  })
  console.log(`${passed} Chromium auth regressions passed`)
  win.destroy()
  app.exit(0)
} catch (error) {
  console.error(error)
  win.destroy()
  app.exit(1)
}
}).catch(error => { console.error(error); app.exit(1) })
