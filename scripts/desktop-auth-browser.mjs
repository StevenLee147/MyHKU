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
  const run = (act = true, target = null) => win.webContents.executeJavaScript(`((location) => (${inspectAuthPage.toString()})(${JSON.stringify(credentials)}, ${act}, ${JSON.stringify(target)}))(${JSON.stringify(location)})`)
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
  await fixture('real Portal CAS logout in collapsed menus proves the session', '<div hidden><a href="https://hkuportal.hku.hk/cas/servlet/edu.yale.its.tp.cas.servlet.PortalLogout">Log out</a></div>', 'https://studentportal.hku.hk/en-US/', async run => assert.equal((await run()).state, 'authenticated'))
  await fixture('unrelated CAS logout host cannot prove a Portal session', '<div hidden><a href="https://evil.example.test/cas/servlet/edu.yale.its.tp.cas.servlet.PortalLogout">Log out</a></div>', 'https://studentportal.hku.hk/en-US/', async run => assert.equal((await run()).state, 'waiting'))
  await fixture('logged-in Portal search fields and MFA help are not login challenges', '<input name="userSearch" placeholder="Search users"><a href="/Account/Login/LogOff">Sign out</a><p>Set up your Authenticator</p>', 'https://studentportal.hku.hk/en-US/', async run => assert.equal((await run()).state, 'authenticated'))
  await fixture('Moodle MFA announcements do not override the authenticated dashboard', '<div data-region="myoverview">No courses</div><p>Authenticator setup instructions</p>', 'https://moodle.hku.hk/my/', async run => assert.equal((await run()).state, 'authenticated'))
  await fixture('an unrelated alert cannot override a verified Portal session', '<div role="alert">Failed to load announcements, try again</div><a href="/Account/Login/LogOff">Sign out</a>', 'https://studentportal.hku.hk/', async run => assert.equal((await run()).state, 'authenticated'))
  await fixture('an optional Portal Login link cannot restart an authenticated page', '<a href="#">Portal Login</a><a href="/logout">Sign out</a>', 'https://studentportal.hku.hk/', async run => assert.equal((await run()).state, 'authenticated'))
  await fixture('a hidden logout on another host is not session evidence', '<div hidden><a href="https://evil.example.test/logout">Log out</a></div>', 'https://studentportal.hku.hk/', async run => assert.equal((await run()).state, 'waiting'))
  await fixture('guest Moodle with a logout route does not prove a student session', '<body class="notloggedin"><a href="/login/logout.php">Log out</a><div data-region="myoverview">Guest courses</div></body>', 'https://moodle.hku.hk/', async run => assert.equal((await run()).state, 'waiting'))
  await fixture('a login form wins over leftover logout markup', '<a href="/logout">Log out</a><input name="username"><input type="password">', 'https://studentportal.hku.hk/', async run => assert.equal((await run()).state, 'manual_required'))
  await fixture('CAS success without a logout link resumes the target service', '<h2>Log In Successful</h2><p>You have successfully logged into the Central Authentication Service.</p>', 'https://hkuportal.hku.hk/cas/login', async run => assert.equal((await run()).state, 'sso_authenticated'))
  await fixture('CAS success text cannot override an active login form', '<h2>Log In Successful</h2><input name="username"><input type="password">', 'https://hkuportal.hku.hk/cas/login', async run => assert.notEqual((await run(false)).state, 'sso_authenticated'))
  await fixture('a completed official logout is not an indeterminate loading page', '<h1>You have successfully logged out</h1>', 'https://hkuportal.hku.hk/cas/logout', async run => assert.equal((await run()).state, 'signed_out'))
  await fixture('Moodle guest user menu does not prove a session', '<body class="notloggedin"><div class="usermenu"><button class="userbutton">Guest</button></div></body>', 'https://moodle.hku.hk/', async run => assert.equal((await run()).state, 'waiting'))
  await fixture('nested legacy SIS frames expose timetable evidence', '<iframe srcdoc="&lt;iframe srcdoc=\'&lt;div class=bkgCalViewWDHeader&gt;Monday&lt;/div&gt;\'&gt;&lt;/iframe&gt;"></iframe>', 'https://sweb.hku.hk/student/servlet/MyWeekly/showTimetable', async run => assert.equal((await run()).state, 'authenticated'))
  await fixture('SIS rejection recovers through Portal', '<p>This is not the SIS login page. Please log in from HKU Portal.</p>', 'https://sis-main.hku.hk/sisprod/z_signon.jsp', async run => assert.equal((await run(false, 'sis')).action, 'sis-portal'))
  await fixture('SIS CAS error recovers through Portal', '<p>We encountered an error when processing your request.</p>', 'https://hkuportal.hku.hk/cas/login_error.html', async run => assert.equal((await run(false, 'sis')).action, 'sis-portal'))
  await fixture('authenticated Portal launches its actual SIS entry only for SIS', '<a href="/logout">Sign out</a><a href="#" onclick="window.clicks=(window.clicks||0)+1;return false">Student Information System (SIS)</a>', 'https://studentportal.hku.hk/en-US/', async (run, read) => {
    assert.equal((await run(false, 'portal')).state, 'authenticated')
    assert.equal((await run(true, 'sis')).action, 'sis-entry')
    await run(true, 'sis')
    assert.equal(await read('window.clicks'), 1)
  })
  await fixture('real CAS AAD text email field keeps the domain and clicks its JavaScript login button', '<form onsubmit="window.nativeSubmits=1;return false"><input type="text" id="email" name="email" placeholder="Email Address"><input type="button" id="login_btn" value="Login" onclick="window.clicks=(window.clicks||0)+1"></form>', 'https://hkuportal.hku.hk/cas/aad', async (run, read) => {
    assert.equal((await run()).state, 'submitted')
    await run()
    assert.equal(await read('document.querySelector("#email").value'), credentials.email)
    assert.equal(await read('window.clicks'), 1)
    assert.equal(await read('window.nativeSubmits || 0'), 0)
  })
  await fixture('legacy Portal UID field still uses only the account name', '<form onsubmit="return false"><input name="userid" placeholder="Portal UID"><input type="password"><button type="submit">Login</button></form>', 'https://hkuportal.hku.hk/cas/login', async (run, read) => {
    assert.equal((await run()).state, 'submitted')
    assert.equal(await read('document.querySelector("input").value'), credentials.email.split('@')[0])
  })
  await fixture('Portal alone never proves an SIS connection', '<a href="/logout">Sign out</a>', 'https://studentportal.hku.hk/en-US/', async run => assert.equal((await run(false, 'sis')).state, 'manual_required'))
  await fixture('empty legacy SIS timetable is still an authenticated session', '<div class="bkgCalViewWDHeader">Monday</div>', 'https://sweb.hku.hk/student/servlet/MyWeekly/showTimetable', async run => assert.equal((await run()).state, 'authenticated'))
  await fixture('SIS home with its collapsed PeopleSoft sign-out menu proves login', '<div hidden><a id="pthdr2signout" href="/psp/sisprod/EMPLOYEE/SA/">Sign Out</a></div><h1>SIS Home</h1>', 'https://sis-main.hku.hk/psp/sisprod/EMPLOYEE/SA/h/', async run => assert.equal((await run()).state, 'authenticated'))
  await fixture('SIS home follows its own weekly schedule link after login', '<div hidden><a id="pthdr2signout" href="/psp/sisprod/EMPLOYEE/SA/">Sign Out</a></div><a href="#" onclick="window.clicks=(window.clicks||0)+1;return false">My Weekly Schedule</a>', 'https://sis-main.hku.hk/psp/sisprod/EMPLOYEE/SA/h/', async (run, read) => {
    const initial = await run(false, 'sis')
    assert.equal(initial.state, 'authenticated', 'data navigation never delays login success')
    assert.equal(initial.action, 'sis-timetable')
    assert.equal((await run(true, 'sis')).state, 'authenticated')
    await run(true, 'sis')
    assert.equal(await read('window.clicks'), 1)
    assert.equal((await run(false, 'sis')).state, 'authenticated', 'a dispatched or stalled timetable link cannot erase success')
  })
  await fixture('identity errors stop automatic credential retries even after an unrelated notice', '<div role="alert">Welcome to HKU</div><div role="alert">Incorrect password. Try again.</div><form><input name="username"><input type="password"><button type="submit">Sign in</button></form>', 'https://login.microsoftonline.com/login.srf', async (run, read) => {
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
