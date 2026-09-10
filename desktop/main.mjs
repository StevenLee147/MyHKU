import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell, webFrameMain } from 'electron'
import { AuthCoordinator, AUTH_TIMING, SERVICE_URLS, inspectAuthPage, serviceForUrl } from './auth-flow.mjs'
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
const windowFlows = new WeakMap()
const auth = new AuthCoordinator(startServiceLogin, publishAuthStatus)
let quitting = false
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

function publishAuthStatus() {
  notifyAuthStatus(authStatus())
}

function authStatus() {
  const sessions = auth.snapshot()
  const values = Object.values(sessions)
  const manual = values.find(item => ['needs_2fa', 'manual_required'].includes(item.state))
  const pending = values.some(item => ['checking', 'queued'].includes(item.state))
  const state = manual?.state || (pending ? 'checking' : values.every(item => item.state === 'connected') ? 'connected' : 'ready')
  return { state, detail: manual?.detail || (pending ? '正在自动恢复 HKU 连接…' : ''), sessions }
}

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
  const source = readFileSync(connectorFile, 'utf8').replace('http://127.0.0.1:17321/api/ingest/', `http://127.0.0.1:${bridgePort}/api/ingest/`)
  // The extension script self-selects the current HKU host and only reads
  // rendered DOM fields. It never accesses cookies, storage or password input.
  return `${source}\n//# sourceURL=myhku-hku-connector.js`
}

function notifyDashboard() {
  if (!dashboard || dashboard.isDestroyed()) return
  dashboard.webContents.send('myhku-hku-updated', { at: new Date().toISOString() })
}

async function publishPage(frame) {
  try {
    await frame.executeJavaScript(connectorScript(), true)
    notifyDashboard()
  } catch { /* navigation can destroy the old document */ }
}

function attachConnector(win, record) {
  let generation = 0
  let settledAt = Date.now()
  let startedAt = Date.now()
  let busy = false
  let provedAt = 0
  let published = false
  let resumedService = false
  const attempts = new Map()
  const navigate = () => {
    generation++
    settledAt = Date.now()
    provedAt = 0
    published = false
    if (record && record.state === 'connected') {
      // Navigation from an authenticated page may expire the session. Queue
      // revalidation without ever reloading a flow already negotiating SSO.
      record.state = 'queued'
      record.revalidate = true
      auth.pump()
    }
  }
  win.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) navigate()
  })
  win.webContents.on('did-finish-load', () => { settledAt = Date.now() })
  const check = async () => {
    if (busy || win.isDestroyed() || win.webContents.isLoading() || Date.now() - settledAt < AUTH_TIMING.settle) return
    if (record && auth.records.get(record.site) !== record) return
    if (record && auth.active !== record.site && record.state !== 'connected') return
    busy = true
    const version = generation
    try {
      const current = win.webContents.getURL()
      if (!isAllowedUrl(current)) return
      const canAct = record && auth.active === record.site && !['manual_required', 'error'].includes(record.state)
      const account = canAct && !serviceForUrl(current) ? readAccount() : null
      const credentials = account ? { email: account.email, password: account.password } : null
      const script = `(${inspectAuthPage.toString()})`
      let result = await win.webContents.executeJavaScript(`${script}(${JSON.stringify(credentials)}, false)`, true)
      if (win.isDestroyed() || version !== generation) return
      if (canAct && result.state === 'automatic') {
        const count = attempts.get(result.action) || 0
        if (count >= 2) result = { state: 'manual_required', detail: '官方登录反复返回同一步，请查看窗口提示后继续' }
        else {
          // Count before dispatch: navigation may cancel the script result
          // after a successful submit, and must not permit unlimited retries.
          attempts.set(result.action, count + 1)
          result = await win.webContents.executeJavaScript(`${script}(${JSON.stringify(credentials)}, true)`, true)
        }
      }
      if (win.isDestroyed() || version !== generation) return
      if (record && (result.state === 'sso_authenticated' || (result.state === 'authenticated' && serviceForUrl(current) !== record.site))) {
        if (!resumedService) {
          resumedService = true
          await win.loadURL(SERVICE_URLS[record.site])
        } else if (Date.now() - startedAt >= AUTH_TIMING.manual) {
          auth.update(record.site, 'manual_required', '已登录 Portal，目标服务尚未返回，请查看官方窗口')
          if (!win.isVisible()) win.show()
        }
        return
      }
      if (result.state === 'authenticated') {
        provedAt ||= Date.now()
        // Require two stable observations, including a quiet redirect period.
        if (Date.now() - provedAt < AUTH_TIMING.settle) return
        if (record && record.state !== 'connected') {
          auth.update(record.site, 'connected', '已验证官方登录会话')
          if (!record.browse && win.isVisible()) win.hide()
        }
        if (!published) {
          published = true
          void publishPage(win.webContents)
          for (const frame of win.webContents.mainFrame.frames) void publishPage(frame)
        }
        return
      }
      provedAt = 0
      if (!record) return
      if (record.state === 'connected') {
        record.revalidate = true
        auth.request(record.site, { refresh: true })
        return
      }
      if (result.state === 'submitted') {
        settledAt = Date.now()
      }
      if (result.state === 'needs_2fa' || (result.state === 'manual_required' && Date.now() - startedAt >= AUTH_TIMING.manual)) {
        if (record.state !== result.state) {
          auth.update(record.site, result.state, result.detail)
          if (!win.isVisible()) win.show()
        }
      } else if (Date.now() - startedAt >= AUTH_TIMING.timeout && !['manual_required', 'needs_2fa', 'error'].includes(record.state)) {
        auth.update(record.site, 'manual_required', '登录页面长时间未完成，请查看官方窗口提示')
        if (!win.isVisible()) win.show()
      }
    } catch { /* a redirect can cancel executeJavaScript; poll the new page */ }
    finally { busy = false }
  }
  win.webContents.on('did-frame-finish-load', (_event, mainFrame, processId, routingId) => {
    if (mainFrame || win.isDestroyed() || record?.state !== 'connected') return
    const frame = webFrameMain.fromId(processId, routingId)
    if (frame) void publishPage(frame)
  })
  const timer = setInterval(check, AUTH_TIMING.poll)
  windowFlows.set(win, { restart() { startedAt = Date.now(); settledAt = Date.now(); published = false; resumedService = false; attempts.clear() } })
  win.once('closed', () => clearInterval(timer))
}

function startServiceLogin(record) {
  let win = record.window
  if (!win || win.isDestroyed()) {
    win = createAuthWindow(SERVICE_URLS[record.site], false, record)
    record.window = win
  } else {
    windowFlows.get(win)?.restart()
    if (!record.revalidate && !win.webContents.isLoading()) win.loadURL(SERVICE_URLS[record.site]).catch(() => {})
  }
  record.revalidate = false
}

function attachDownloadHandler(win) {
  win.webContents.session.on('will-download', (_event, item) => {
    // Downloads are user initiated by clicking a Moodle resource. Electron
    // keeps the authenticated session for the request and writes only the
    // chosen file to the normal Downloads directory.
    item.setSaveDialogOptions({ defaultPath: join(app.getPath('downloads'), item.getFilename()) })
  })
}

function createAuthWindow(url, show = true, record = null) {
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
  win.on('close', event => {
    if (!quitting && record && auth.records.get(record.site) === record) {
      event.preventDefault()
      record.browse = false
      win.hide()
    }
  })
  win.once('closed', () => {
    authWindows.delete(win)
    if (!quitting && record && auth.records.get(record.site) === record) {
      record.window = null
      auth.update(record.site, 'disconnected', '官方窗口已关闭，连接检查已停止')
    }
  })
  win.webContents.setWindowOpenHandler(({ url: childUrl }) => {
    if (isAllowedUrl(childUrl)) {
      // Keep the same flow identity and persistent partition through popups.
      win.loadURL(childUrl).catch(() => {})
      return { action: 'deny' }
    }
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
  win.webContents.on('did-fail-load', (_event, errorCode, _errorDescription, validatedURL, mainFrame) => {
    authTrace('did-fail-load', validatedURL, String(errorCode))
    if (mainFrame && errorCode !== -3 && record && auth.records.get(record.site) === record) auth.update(record.site, 'error', '官方页面加载失败，请检查网络后重试')
  })
  attachConnector(win, record)
  attachDownloadHandler(win)
  win.loadURL(url).catch(() => { /* did-fail-load reports real errors, excluding cancelled redirects */ })
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
  dashboard.on('closed', () => {
    dashboard = null
    // Hidden authenticated windows must not leave a second app/bridge behind
    // when the user closes the Windows dashboard and launches MyHKU again.
    if (process.platform === 'win32' && !quitting) app.quit()
  })
  dashboard.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedUrl(url)) {
      const site = serviceForUrl(url)
      const record = site && auth.records.get(site)
      if (record?.window && !record.window.isDestroyed()) {
        record.browse = true
        record.window.show()
        if (record.state === 'connected') record.window.loadURL(url).catch(() => {})
      } else createAuthWindow(url)
      return { action: 'deny' }
    }
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
  const status = authStatus()
  return account ? { configured: true, localUsername: account.localUsername, email: account.email, authState: status.state, detail: status.detail, sessions: status.sessions } : { configured: false }
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
  auth.reset()
  try { await (await import('electron')).session.fromPartition('persist:myhku-hku').clearStorageData() } catch { /* best effort */ }
  for (const win of authWindows) if (!win.isDestroyed()) win.close()
  notifyAuthStatus({ state: 'signed_out' })
  return true
})

function beginLogin(show = true) {
  for (const site of Object.keys(SERVICE_URLS)) auth.request(site, { show })
}

ipcMain.handle('myhku-auth-sessions', () => auth.snapshot())
ipcMain.handle('myhku-login-site', (_event, site) => {
  auth.request(site, { show: true })
  return auth.snapshot()
})

ipcMain.handle('myhku-refresh-hku', () => {
  if (readAccount()) {
    for (const site of Object.keys(SERVICE_URLS)) auth.request(site, { refresh: true })
  }
  return authWindows.size
})

ipcMain.handle('myhku-schedule-week', async (_event, rawOffset) => {
  const offset = Math.max(-1, Math.min(1, Number(rawOffset) || 0))
  const record = auth.request('sis')
  const sisWindow = record.window
  if (!sisWindow || record.state !== 'connected') throw new Error('SIS 正在自动连接，完成后即可切换周次')
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

const ownsInstance = app.requestSingleInstanceLock()
if (!ownsInstance) app.quit()
app.on('second-instance', () => {
  if (!dashboard || dashboard.isDestroyed()) createDashboard()
  if (dashboard.isMinimized()) dashboard.restore()
  dashboard.show()
  dashboard.focus()
})

if (ownsInstance) app.whenReady().then(() => {
  startBridge()
  startDashboardServer()
  createDashboard()
  if (readAccount() || forceOpenLoginOnStartup) beginLogin(forceOpenLoginOnStartup)
  app.on('activate', () => { if (!dashboard || dashboard.isDestroyed()) createDashboard() })
}).catch(error => dialog.showErrorBox('MyHKU 启动失败', error.stack || error.message))

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => {
  quitting = true
  if (bridgeProcess && !bridgeProcess.killed) bridgeProcess.kill()
  if (uiServer) uiServer.close()
})
