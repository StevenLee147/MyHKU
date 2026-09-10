import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell, webFrameMain } from 'electron'
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import crypto from 'node:crypto'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
if (process.env.MYHKU_ELECTRON_DEBUG_PORT) app.commandLine.appendSwitch('remote-debugging-port', process.env.MYHKU_ELECTRON_DEBUG_PORT)
// Electron can read assets from app.asar, but a child Node process cannot
// execute a script whose path is inside the archive. electron-builder
// unpacks the bridge directory and the packaged app points at that real path.
const root = app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked') : join(here, '..')
const bridgeFile = join(root, 'bridge', 'server.mjs')
const preloadFile = join(here, 'preload.cjs')
const sourceRoot = app.isPackaged ? join(process.resourcesPath, 'app.asar') : root
const connectorFile = join(sourceRoot, 'extension', 'content.js')
const dashboardFile = join(sourceRoot, 'dist', 'index.html')
const bridgePort = process.env.MYHKU_BRIDGE_PORT || '17321'
const uiPort = process.env.MYHKU_UI_PORT || '17322'
const devUrl = process.env.MYHKU_DEV_SERVER_URL
const forceOpenLoginOnStartup = process.env.MYHKU_OPEN_LOGIN_ON_STARTUP === '1'
const allowedHosts = new Set([
  'moodle.hku.hk', 'studentportal.hku.hk', 'hkuportal.hku.hk', 'sis-main.hku.hk', 'sweb.hku.hk', 'intraweb.hku.hk', 'adfs.connect.hku.hk',
  // Official Microsoft identity hosts used by HKU Entra redirects.
  'login.microsoftonline.com', 'login.microsoft.com', 'login.windows.net',
  'login.live.com', 'account.live.com', 'account.microsoft.com',
])
let bridgeProcess
let uiServer
let dashboard
const authWindows = new Set()
const autoLoginInFlight = new WeakSet()
let accountCache
const accountFile = () => join(app.getPath('userData'), 'myhku-account.enc')

function readAccount() {
  if (accountCache !== undefined) return accountCache
  accountCache = null
  try {
    if (!safeStorage.isEncryptionAvailable()) return accountCache
    const raw = JSON.parse(readFileSync(accountFile(), 'utf8'))
    const value = JSON.parse(safeStorage.decryptString(Buffer.from(raw.data, 'base64')))
    if (value?.version !== 1 || typeof value.email !== 'string' || typeof value.password !== 'string') return accountCache
    accountCache = { localUsername: typeof value.localUsername === 'string' ? value.localUsername : '', email: value.email, password: value.password }
  } catch { accountCache = null }
  return accountCache
}

function saveAccount(value) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，无法保存账号')
  const account = { localUsername: String(value.localUsername || '').trim().slice(0, 120), email: String(value.email || '').trim().slice(0, 240), password: String(value.password || '') }
  if (!account.localUsername || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.email) || !account.password) throw new Error('请填写本地用户名、HKU 邮箱和密码')
  mkdirSync(app.getPath('userData'), { recursive: true })
  const encrypted = safeStorage.encryptString(JSON.stringify({ version: 1, ...account }))
  const temp = `${accountFile()}.${process.pid}.tmp`
  writeFileSync(temp, JSON.stringify({ version: 1, data: encrypted.toString('base64') }), { mode: 0o600 })
  // Rename is atomic on the same filesystem and avoids a partially written secret.
  renameSync(temp, accountFile())
  accountCache = account
  return { localUsername: account.localUsername, email: account.email }
}

function clearAccount() {
  accountCache = null
  try { unlinkSync(accountFile()) } catch { /* already removed */ }
}

function notifyAuthStatus(payload) {
  if (!dashboard || dashboard.isDestroyed()) return
  try { dashboard.webContents.send('myhku-auth-status', payload) } catch { /* dashboard may be closing */ }
}
// PeopleSoft/SIS timetable endpoint.  It is opened in the same persistent
// partition as Portal/Moodle so the existing SSO session is reused without
// copying cookies or credentials into the bridge.
const sisTimetableUrl = 'https://sweb.hku.hk/student/servlet/MyWeekly/showTimetable'

function isAllowedUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && allowedHosts.has(url.hostname.toLowerCase())
  } catch { return false }
}

function authTrace(event, value, detail = '') {
  try {
    const url = new URL(value)
    const safe = `${url.origin}${url.pathname}`
    const file = join(app.getPath('userData'), 'auth-navigation.log')
    appendFileSync(file, `${new Date().toISOString()} ${event} ${safe}${detail ? ` ${detail}` : ''}\n`, { mode: 0o600 })
  } catch { /* diagnostics must never affect login */ }
}

function startBridge() {
  if (!existsSync(bridgeFile)) throw new Error(`Missing bridge: ${bridgeFile}`)
  const cacheFile = join(app.getPath('userData'), 'myhku-cache.enc.json')
  const keyFile = join(app.getPath('userData'), 'myhku-cache.key')
  let cacheKey
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    if (safeStorage.isEncryptionAvailable()) {
      let encryptedKey
      if (existsSync(keyFile)) encryptedKey = readFileSync(keyFile)
      else {
        encryptedKey = safeStorage.encryptString(crypto.randomBytes(32).toString('base64'))
        writeFileSync(keyFile, encryptedKey, { mode: 0o600 })
      }
      cacheKey = Buffer.from(safeStorage.decryptString(encryptedKey), 'base64')
      if (cacheKey.length !== 32) cacheKey = undefined
    }
  } catch { cacheKey = undefined }
  // The bridge stores normalized, non-secret data only. It is a child process
  // bound to loopback and is terminated with the desktop app. If Electron's
  // OS-backed safeStorage is available, the normalized cache is encrypted by
  // the bridge with a key protected by Windows DPAPI/macOS Keychain.
  bridgeProcess = spawn(process.execPath, [bridgeFile], {
    cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', MYHKU_BRIDGE_PORT: bridgePort, MYHKU_BRIDGE_CACHE_FILE: cacheFile, ...(cacheKey ? { MYHKU_BRIDGE_CACHE_KEY: cacheKey.toString('base64') } : {}) },
    stdio: 'ignore',
    windowsHide: true,
  })
  bridgeProcess.once('error', error => dialog.showErrorBox('MyHKU bridge', error.message))
}

function connectorScript() {
  const source = readFileSync(connectorFile, 'utf8')
  // The extension script self-selects the current HKU host and only reads
  // rendered DOM fields. It never accesses cookies, storage or password input.
  return `${source}\n//# sourceURL=myhku-hku-connector.js`
}

// A login flow can create several child BrowserWindows while following the
// HKU -> Microsoft -> ADFS redirects.  Once one of those windows reaches an
// authenticated HKU page, collapse every authenticated window together so
// the dashboard remains the only visible app window.  Login/redirect pages
// stay visible until the user finishes that flow.
function isAuthenticatedPageUrl(value) {
  if (!isAllowedUrl(value)) return false
  try {
    const url = new URL(value)
    return !/(?:login|signin|sign-in|oauth|authorize|cas|adfs|ProcessAuth|kmsi)/i.test(`${url.pathname}${url.search}`)
  } catch { return false }
}

function hideAuthenticatedWindows() {
  for (const candidate of authWindows) {
    if (candidate.isDestroyed()) continue
    const current = candidate.webContents.getURL()
    // Moodle may render its login form at `/` after an expired session, so
    // URL-only checks would hide a window that still needs user interaction.
    const title = candidate.getTitle().toLowerCase()
    if (/login|sign in|登入|登录/i.test(title)) continue
    if (isAuthenticatedPageUrl(current) && candidate.isVisible()) candidate.hide()
  }
}

function loginPage(url) {
  try {
    const parsed = new URL(url)
    return isAllowedUrl(url) && /(?:login|signin|sign-in|authorize|oauth|cas|adfs|ProcessAuth|kmsi)/i.test(`${parsed.hostname}${parsed.pathname}${parsed.search}`)
  } catch { return false }
}

async function attemptAutoLogin(win) {
  const account = readAccount()
  const url = win.webContents.getURL()
  if (!account || !loginPage(url) || win.isDestroyed() || autoLoginInFlight.has(win)) return { state: 'idle' }
  autoLoginInFlight.add(win)
  try {
    const payload = JSON.stringify({ email: account.email, password: account.password })
    const result = await win.webContents.executeJavaScript(`(() => {
      const credentials = ${payload}
      const fields = [...document.querySelectorAll('input')]
      const password = fields.find(input => input.type === 'password' || /pass(word|wd)/i.test(input.name || input.id || ''))
      const email = fields.find(input => /^(email|text)$/i.test(input.type || '') && /email|user|login|account/i.test(input.name || input.id || input.autocomplete || input.placeholder || ''))
      const setValue = (input, value) => {
        if (!input) return false
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      }
      if (password) {
        setValue(password, credentials.password)
        const form = password.form || password.closest('form')
        if (form?.requestSubmit) form.requestSubmit()
        else form?.submit()
        return { state: 'submitted_password' }
      }
      if (email) {
        setValue(email, credentials.email)
        const form = email.form || email.closest('form')
        const submit = form?.querySelector('button[type=submit],input[type=submit],button')
        if (submit) submit.click()
        else if (form?.requestSubmit) form.requestSubmit()
        return { state: 'submitted_email' }
      }
      return { state: 'manual_required' }
    })()`, true)
    const state = result?.state || 'manual_required'
    const reportedState = state === 'manual_required' ? 'needs_2fa' : state
    notifyAuthStatus({ state: reportedState, requires2fa: reportedState === 'needs_2fa', url: win.webContents.getURL() })
    if (state === 'manual_required' && !win.isVisible()) win.show()
    return { state }
  } catch (error) {
    notifyAuthStatus({ state: 'error', detail: error?.message || '自动登录失败' })
    return { state: 'error' }
  } finally {
    autoLoginInFlight.delete(win)
  }
}

function attachConnector(win) {
  const notifyDashboard = () => {
    if (!dashboard || dashboard.isDestroyed()) return
    try { dashboard.webContents.send('myhku-hku-updated', { at: new Date().toISOString() }) } catch { /* dashboard may be closing */ }
  }
  const inject = () => {
    if (win.isDestroyed()) return
    void attemptAutoLogin(win)
    const current = win.webContents.getURL()
    if (isAuthenticatedPageUrl(current)) notifyAuthStatus({ state: 'authenticated', url: current })
    else if (loginPage(current)) notifyAuthStatus({ state: 'login_pending', url: current })
    win.webContents.executeJavaScript(connectorScript(), true).catch(() => {})
    setTimeout(notifyDashboard, 2500)
    // Keep the authenticated WebView alive for refresh and downloads, while
    // removing the two login windows from the user's workspace after the
    // official page has returned. Clicking an official login link creates a
    // visible window again using the same persistent session partition.
    if (isAuthenticatedPageUrl(win.webContents.getURL())) {
      // Give redirects a moment to settle, then hide all windows that have
      // completed authentication.  Other windows may still be on MFA pages.
      setTimeout(hideAuthenticatedWindows, 1200)
    }
  }
  win.webContents.on('did-finish-load', inject)
  win.webContents.on('did-navigate', inject)
  // PeopleSoft renders the actual timetable inside a same-origin iframe
  // (typically #ptifrmtgtframe).  executeJavaScript on WebContents targets
  // only the top document, so inject the read-only adapter into child frames
  // as each one finishes loading as well.
  win.webContents.on('did-frame-finish-load', (_event, isMainFrame, frameProcessId, frameRoutingId) => {
    if (isMainFrame || win.isDestroyed()) return
    try {
      const frame = webFrameMain.fromId(frameProcessId, frameRoutingId)
      frame?.executeJavaScript(connectorScript()).catch(() => {})
      setTimeout(notifyDashboard, 2500)
    } catch { /* a frame may disappear during an SSO redirect */ }
  })
}

function attachDownloadHandler(win) {
  win.webContents.session.on('will-download', (_event, item) => {
    // Downloads are user initiated by clicking a Moodle resource. Electron
    // keeps the authenticated session for the request and writes only the
    // chosen file to the normal Downloads directory.
    item.setSaveDialogOptions({ defaultPath: join(app.getPath('downloads'), item.getFilename()) })
  })
}

function createAuthWindow(url, show = true) {
  if (!isAllowedUrl(url)) return null
  const win = new BrowserWindow({
    width: 1120,
    height: 820,
    minWidth: 720,
    minHeight: 560,
    show,
    title: 'MyHKU · HKU 登录',
    webPreferences: {
      preload: preloadFile,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: 'persist:myhku-hku',
    },
  })
  authWindows.add(win)
  win.once('closed', () => authWindows.delete(win))
  win.webContents.setWindowOpenHandler(({ url: childUrl }) => {
    if (isAllowedUrl(childUrl)) { createAuthWindow(childUrl); return { action: 'deny' } }
    shell.openExternal(childUrl).catch(() => {})
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, nextUrl) => {
    if (!isAllowedUrl(nextUrl)) {
      authTrace('blocked-navigation', nextUrl)
      event.preventDefault()
    } else authTrace('will-navigate', nextUrl)
  })
  win.webContents.on('did-navigate', (_event, nextUrl) => authTrace('did-navigate', nextUrl))
  win.webContents.on('did-finish-load', () => authTrace('did-finish-load', win.webContents.getURL()))
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => authTrace('did-fail-load', validatedURL, `${errorCode}:${errorDescription}`))
  attachConnector(win)
  attachDownloadHandler(win)
  win.loadURL(url).catch(error => dialog.showErrorBox('HKU 登录', error.message))
  return win
}

function createDashboard() {
  dashboard = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 980,
    minHeight: 680,
    title: 'MyHKU',
    backgroundColor: '#f6f8fc',
    webPreferences: {
      preload: preloadFile,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  dashboard.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedUrl(url)) { createAuthWindow(url); return { action: 'deny' } }
    shell.openExternal(url).catch(() => {})
    return { action: 'deny' }
  })
  attachDownloadHandler(dashboard)
  if (devUrl) dashboard.loadURL(devUrl)
  else dashboard.loadURL(`http://127.0.0.1:${uiPort}/`)
}

function startDashboardServer() {
  if (devUrl) return
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' }
  uiServer = http.createServer((req, res) => {
    try {
      const rawPath = decodeURIComponent(new URL(req.url || '/', `http://127.0.0.1:${uiPort}`).pathname)
      const relative = rawPath === '/' ? 'index.html' : rawPath.replace(/^\/+/, '')
      if (relative.split('/').includes('..')) { res.writeHead(400); res.end('Bad path'); return }
      const candidate = join(sourceRoot, 'dist', relative)
      const file = existsSync(candidate) && statSync(candidate).isFile() ? candidate : dashboardFile
      const extension = extname(file).toLowerCase()
      res.writeHead(200, { 'Content-Type': mime[extension] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      res.end(readFileSync(file))
    } catch {
      res.writeHead(404); res.end('Not found')
    }
  })
  uiServer.listen(Number(uiPort), '127.0.0.1')
}

ipcMain.handle('myhku-account-status', async () => {
  const account = readAccount()
  return account ? { configured: true, localUsername: account.localUsername, email: account.email } : { configured: false }
})

ipcMain.handle('myhku-save-account', async (_event, value) => {
  const saved = saveAccount(value || {})
  notifyAuthStatus({ state: 'ready', detail: '账户已安全保存，请开始首次登录' })
  return { configured: true, ...saved }
})

ipcMain.handle('myhku-begin-login', async (_event, show = true) => {
  beginLogin(Boolean(show))
  return true
})

ipcMain.handle('myhku-clear-account', async () => {
  clearAccount()
  try { await (await import('electron')).session.fromPartition('persist:myhku-hku').clearStorageData() } catch { /* best effort */ }
  for (const win of authWindows) if (!win.isDestroyed()) win.close()
  notifyAuthStatus({ state: 'signed_out' })
  return true
})

function beginLogin(show = true) {
  const existing = [...authWindows].filter(win => !win.isDestroyed())
  if (!existing.some(win => /studentportal\.hku\.hk/i.test(win.webContents.getURL()))) createAuthWindow('https://studentportal.hku.hk/', show)
  if (!existing.some(win => /moodle\.hku\.hk/i.test(win.webContents.getURL()))) createAuthWindow('https://moodle.hku.hk/login/index.php?authCAS=CAS', show)
  if (!existing.some(win => /(?:sis-main|sweb|intraweb)\.hku\.hk/i.test(win.webContents.getURL()))) createAuthWindow(sisTimetableUrl, false)
}

ipcMain.handle('myhku-refresh-hku', async () => {
  for (const win of authWindows) {
    if (!win.isDestroyed()) {
      try { await win.webContents.reload() } catch { /* closed during refresh */ }
    }
  }
  return authWindows.size
})

ipcMain.handle('myhku-schedule-week', async (_event, rawOffset) => {
  const offset = Math.max(-1, Math.min(1, Number(rawOffset) || 0))
  let sisWindow = [...authWindows].find(win => !win.isDestroyed() && /(?:sis-main|sweb|intraweb)\.hku\.hk/i.test(win.webContents.getURL()))
  if (!sisWindow) sisWindow = createAuthWindow(sisTimetableUrl, false)
  if (!sisWindow) throw new Error('SIS 页面尚未打开')
  if (sisWindow.webContents.isLoading()) {
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 15_000)
      sisWindow.webContents.once('did-finish-load', () => { clearTimeout(timer); resolve() })
    })
  }
  if (offset === 0) {
    await sisWindow.webContents.reload()
    return true
  }
  // PeopleSoft renders the timetable controls inside the same-origin
  // #ptifrmtgtframe iframe.  The top document only contains the portal shell,
  // so submit() on a guessed top-level form silently fails.  Click the real
  // input control so PeopleSoft's own navigation handlers run and preserve
  // its session state.
  const control = offset > 0 ? 'DERIVED_CLASS_S_SSR_NEXT_WEEK' : 'DERIVED_CLASS_S_SSR_PREV_WEEK'
  const clicked = await sisWindow.webContents.executeJavaScript(`(() => {
    const frame = document.querySelector('#ptifrmtgtframe')
    const doc = frame?.contentDocument
    const button = doc?.querySelector('[name="${control}"]')
    if (!button) throw new Error('SIS 周切换按钮不可用')
    button.click()
    return true
  })()`, true)
  if (!clicked) throw new Error('SIS 周切换按钮不可用')
  // PeopleSoft may update the iframe through an in-place postback without a
  // frame navigation event. Re-run the read-only connector after the DOM has
  // settled so the bridge receives the newly selected week's schedule.
  setTimeout(() => {
    if (sisWindow.isDestroyed()) return
    const frame = sisWindow.webContents.mainFrame?.frames?.find(candidate =>
      /(?:sis-main|sweb|intraweb)\.hku\.hk/i.test(candidate.url) && /\/psc\//i.test(candidate.url),
    ) || sisWindow.webContents.mainFrame
    frame?.executeJavaScript(connectorScript(), true).catch(() => {})
    setTimeout(() => {
      if (!dashboard || dashboard.isDestroyed()) return
      try { dashboard.webContents.send('myhku-hku-updated', { at: new Date().toISOString() }) } catch { /* dashboard may be closing */ }
    }, 2500)
  }, 1500)
  return true
})

app.whenReady().then(() => {
  startBridge()
  startDashboardServer()
  createDashboard()
  const firstLoginMarker = join(app.getPath('userData'), 'myhku-first-login-window-shown')
  const savedAccount = readAccount()
  // The account gate owns first-run setup. Login windows are opened only by
  // an explicit debug override or after the encrypted account has been saved.
  const shouldOpenLogin = forceOpenLoginOnStartup
  if (shouldOpenLogin) {
    // First-run helper: show the official login pages without automating any
    // credential entry. A marker prevents the normal packaged app from
    // reopening both windows on every subsequent launch.
    try { mkdirSync(app.getPath('userData'), { recursive: true }); writeFileSync(firstLoginMarker, new Date().toISOString(), { mode: 0o600 }) } catch { /* best effort */ }
    setTimeout(() => {
      createAuthWindow('https://studentportal.hku.hk/')
      createAuthWindow('https://moodle.hku.hk/login/index.php?authCAS=CAS')
      // SIS is read-only and normally authenticates through the same SSO
      // session. Keep it hidden so first-run login remains a two-page flow.
      createAuthWindow(sisTimetableUrl, false)
    }, 600)
  } else {
    // With a saved account, retry the official login pages in hidden windows.
    // Valid persistent cookies complete this silently; an expired session or
    // MFA challenge causes attemptAutoLogin() to reveal the relevant window.
    if (savedAccount) setTimeout(() => beginLogin(false), 600)
  }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createDashboard() })
}).catch(error => dialog.showErrorBox('MyHKU 启动失败', error.stack || error.message))

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => {
  if (bridgeProcess && !bridgeProcess.killed) bridgeProcess.kill()
  if (uiServer) uiServer.close()
})
