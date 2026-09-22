import { app, BrowserWindow, dialog, ipcMain, safeStorage, session, shell, webFrameMain } from 'electron'
import { fileLinksFromHtml, resolveMoodleDownloads, saveMoodleDownload } from './downloads.mjs'
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
const legalVersion = JSON.parse(readFileSync(join(sourceRoot, 'dist', 'legal', 'agreements.json'), 'utf8')).version
let servicesStarted = false
function hasLegalConsent() {
  try { return JSON.parse(readFileSync(join(app.getPath('userData'), 'myhku-legal-consent.json'), 'utf8')).version === legalVersion }
  catch { return false }
}
function startConsentedServices() {
  if (servicesStarted || !hasLegalConsent()) return
  startBridge()
  servicesStarted = true
  if (readAccount() || forceOpenLoginOnStartup) beginLogin(forceOpenLoginOnStartup)
}
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
let changingAccount = false
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

async function resetAccountSessions() {
  // Destroy old documents before clearing cookies: a late callback must not
  // recreate the signed-out account's session or update a replacement record.
  auth.reset()
  for (const win of authWindows) if (!win.isDestroyed()) win.destroy()
  const official = (await import('electron')).session.fromPartition('persist:myhku-hku')
  await official.clearStorageData()
  await official.clearAuthCache()
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
  return { state, configured: Boolean(readAccount()), detail: manual?.detail || (pending ? '正在自动恢复 HKU 连接…' : ''), sessions }
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

async function inspectFrame(frame, code) {
  let timer
  try {
    return await Promise.race([
      frame.executeJavaScript(code, true),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Auth inspection timed out')), AUTH_TIMING.inspect) }),
    ])
  } finally { clearTimeout(timer) }
}

function serviceFrames(win, site) {
  const frames = [...win.webContents.mainFrame.frames]
  const matching = []
  for (const frame of frames) {
    try {
      frames.push(...frame.frames)
      if (isAllowedUrl(frame.url) && serviceForUrl(frame.url) === site) matching.push(frame)
    } catch { /* detached frame */ }
  }
  return matching
}

function attachConnector(win, record) {
  let generation = 0
  let documentReady = false
  let startedAt = Date.now()
  let busy = null
  let proof = null
  let published = false
  let resumedService = false
  let allowCredentials = true
  let lastInspection = ''
  let confirmationTimer
  const attempts = new Map()
  const currentRecord = () => !win.isDestroyed() && (!record || auth.records.get(record.site) === record)
  const invalidate = () => {
    generation++
    busy = null
    proof = null
    published = false
    clearTimeout(confirmationTimer)
  }
  const requireManual = (state, detail) => {
    if (state === 'manual_required') allowCredentials = false
    if (record.state === state && record.detail === detail) return
    auth.update(record.site, state, detail)
    if (!win.isVisible()) win.show()
  }
  const check = async () => {
    if (!currentRecord()) return
    // A hung document or renderer cannot monopolize the SSO queue.
    if (record && auth.active === record.site && record.state === 'checking' && Date.now() - startedAt >= AUTH_TIMING.timeout) {
      requireManual('manual_required', '登录页面长时间未完成，请查看官方窗口提示；其他服务将继续连接')
    }
    if (busy || !documentReady || record?.state === 'queued') return
    const token = busy = {}
    const version = generation
    const valid = () => currentRecord() && version === generation && busy === token
    try {
      const current = win.webContents.getURL()
      if (!isAllowedUrl(current)) return
      const account = record && allowCredentials && !serviceForUrl(current) ? readAccount() : null
      // Read-only inspection needs only an account hint. Send the password
      // solely when this record owns the automatic action queue.
      const hint = account ? { email: account.email } : null
      const script = `(${inspectAuthPage.toString()})`
      const target = JSON.stringify(record?.site || null)
      const mainFrame = win.webContents.mainFrame
      const primary = inspectFrame(mainFrame, `${script}(${JSON.stringify(hint)}, false, ${target})`)
      let result
      if (record && serviceForUrl(current) === record.site) {
        const children = serviceFrames(win, record.site)
        if (children.length) {
          // Start child checks together. A slow sibling must not hide a
          // usable PeopleSoft frame, but a top-level login form wins over
          // leftover content in an embedded frame.
          const evidence = Promise.any(children.map(async frame => {
            const child = await inspectFrame(frame, `${script}(null, false)`)
            if (child.state !== 'authenticated') throw new Error('No session evidence')
            return child
          }))
          const childResult = evidence.catch(() => null)
          const top = await primary.catch(() => ({ state: 'waiting' }))
          result = top.state === 'waiting' ? (await childResult) || top : top
        } else result = await primary
      } else result = await primary
      if (!valid()) return
      const inspection = `${record?.site || 'browse'} ${result.state} ${result.action || ''}`.trim()
      if (inspection !== lastInspection) {
        lastInspection = inspection
        authTrace('auth-inspection', current, inspection)
      }
      const ownService = result.state === 'authenticated' && (!record || serviceForUrl(current) === record.site)
      if (ownService) {
        if (!proof || proof.url !== current) proof = { url: current, at: Date.now() }
        const remaining = AUTH_TIMING.settle - (Date.now() - proof.at)
        if (remaining > 0) {
          clearTimeout(confirmationTimer)
          confirmationTimer = setTimeout(check, remaining)
          return
        }
        if (record && record.state !== 'connected') {
          record.signedOut = false
          auth.update(record.site, 'connected', '已验证官方登录会话')
          if (!record.browse && win.isVisible()) win.hide()
        }
        // Use the student's official MyWeekly timetable after Portal/SIS SSO.
        // PeopleSoft's weekly view can contain a different set of meetings.
        if (record?.site === 'sis' && !record.browse && new URL(current).hostname === 'sis-main.hku.hk') {
          await win.loadURL(SERVICE_URLS.sis)
          return
        }
        if (!published) {
          published = true
          void publishPage(mainFrame)
          for (const frame of serviceFrames(win, record?.site || serviceForUrl(current))) void publishPage(frame)
        }
        // SIS login is already complete. Opening its timetable must never
        // keep Moodle waiting or turn a connected session back into checking.
        if (result.action === 'sis-timetable' && !record?.browse && (attempts.get(result.action) || 0) < 2) {
          attempts.set(result.action, (attempts.get(result.action) || 0) + 1)
          await inspectFrame(mainFrame, `${script}(null, true, ${target})`)
        }
        return
      }
      proof = null
      if (!record) return
      if (result.state === 'signed_out') {
        allowCredentials = false
        record.signedOut = true
        auth.update(record.site, 'disconnected', result.detail)
        return
      }
      // An explicit logout must not immediately refill the saved password
      // on the destination login page. Only a new connection request resumes.
      if (record.signedOut) return
      const serviceNavigation = ['portal', 'sis-portal', 'sis-entry', 'moodle-cas', 'stay-signed-in'].includes(result.action)
      const resumeService = result.state === 'sso_authenticated' || result.state === 'authenticated'
      const actionable = result.state === 'automatic' && (allowCredentials || serviceNavigation)
      if (record.state === 'connected') {
        // Empty/loading pages are not proof of expiry. Keep a verified
        // session through ordinary navigation; reauthenticate on a challenge.
        if (!['automatic', 'manual_required', 'needs_2fa', 'sso_authenticated'].includes(result.state)) return
        record.revalidate = true
        auth.request(record.site, { refresh: true })
        return
      }
      if (record.state === 'error' && !resumeService && !(actionable && serviceNavigation)) return
      if ((actionable || resumeService) && auth.active !== record.site) {
        auth.request(record.site, { resume: true })
        return
      }
      if (resumeService) {
        if (!resumedService) {
          resumedService = true
          win.loadURL(record.site === 'sis' ? SERVICE_URLS.portal : SERVICE_URLS[record.site]).catch(() => {})
        } else if (Date.now() - startedAt >= AUTH_TIMING.manual) {
          requireManual('manual_required', '身份验证已完成，目标服务尚未返回，请查看官方窗口')
        }
        return
      }
      if (actionable && auth.active === record.site) {
        const count = attempts.get(result.action) || 0
        if (count >= 2) {
          requireManual('manual_required', '官方登录反复返回同一步，请查看窗口提示后继续')
          return
        }
        attempts.set(result.action, count + 1)
        const credentials = account ? { email: account.email, password: account.password } : null
        result = await inspectFrame(mainFrame, `${script}(${JSON.stringify(credentials)}, true, ${target})`)
        if (!valid()) return
      }
      if (result.state === 'needs_2fa' || (result.state === 'manual_required' &&
        (result.immediate || Date.now() - startedAt >= AUTH_TIMING.manual))) {
        requireManual(result.state, result.detail)
      }
    } catch {
      if (!valid()) return
      proof = null
      authTrace('auth-inspection-interrupted', win.webContents.getURL(), record?.site || 'browse')
    } finally {
      if (busy === token) busy = null
    }
  }
  win.webContents.on('did-start-navigation', (_event, url, inPlace, mainFrame) => {
    if (!mainFrame) return
    invalidate()
    if (!inPlace) documentReady = false
    if (record && currentRecord() && isAllowedUrl(url)) {
      const target = new URL(url)
      if (/(?:\/logout(?:\/|\.|$)|\/signout(?:\/|\.|$)|\/Account\/Login\/LogOff(?:\/|$)|\/PortalLogout$|\.PortalLogout$)/i.test(target.pathname) || target.searchParams.get('cmd')?.toLowerCase() === 'logout') {
        allowCredentials = false
        record.signedOut = true
        auth.update(record.site, 'disconnected', '已退出官方登录，请重新连接')
      }
    }
  })
  win.webContents.on('did-navigate', () => { documentReady = true; void check() })
  win.webContents.on('dom-ready', () => { documentReady = true; void check() })
  win.webContents.on('did-navigate-in-page', () => { void check() })
  win.webContents.on('did-stop-loading', () => { documentReady = true; void check() })
  win.webContents.on('did-frame-finish-load', (_event, mainFrame, processId, routingId) => {
    void check()
    if (mainFrame || !currentRecord() || record?.state !== 'connected') return
    const frame = webFrameMain.fromId(processId, routingId)
    if (frame && isAllowedUrl(frame.url) && serviceForUrl(frame.url) === record.site) void publishPage(frame)
  })
  const timer = setInterval(check, AUTH_TIMING.poll)
  windowFlows.set(win, {
    restart({ resume = false } = {}) {
      invalidate()
      startedAt = Date.now()
      if (!resume) { resumedService = false; allowCredentials = true; attempts.clear() }
      // Do not inspect synchronously: startServiceLogin may still navigate.
      queueMicrotask(check)
    },
  })
  win.once('closed', () => { clearInterval(timer); clearTimeout(confirmationTimer) })
}

function startServiceLogin(record) {
  record.signedOut = false
  let win = record.window
  if (!win || win.isDestroyed()) {
    // The SIS deep link displays a blocking JavaScript dialog when its
    // session has expired. Always establish it through the Portal entry.
    win = createAuthWindow(record.site === 'sis' ? SERVICE_URLS.portal : SERVICE_URLS[record.site], false, record)
    record.window = win
  } else {
    windowFlows.get(win)?.restart({ resume: record.resume })
    if (!record.revalidate && !record.resume) {
      const current = win.webContents.getURL()
      const url = record.site === 'sis' ? SERVICE_URLS.portal : record.refresh && serviceForUrl(current) === record.site ? current : SERVICE_URLS[record.site]
      win.loadURL(url).catch(() => {})
    }
  }
  if (record.openWhenStarted) { record.openWhenStarted = false; win.show() }
  record.revalidate = false
  record.resume = false
  record.refresh = false
}

const downloadSessions = new WeakSet()
function attachDownloadHandler(win) {
  if (downloadSessions.has(win.webContents.session)) return
  downloadSessions.add(win.webContents.session)
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
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
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
  win.webContents.setWindowOpenHandler(({ url: childUrl, referrer, postBody }) => {
    if (isAllowedUrl(childUrl)) {
      // Keep the same flow identity and persistent partition through popups.
      // SIS validates that its entry was opened from Portal. Preserve the
      // browser's referrer policy and any official form POST through popups.
      win.loadURL(childUrl, {
        httpReferrer: referrer,
        ...(postBody ? {
          postData: postBody.data,
          extraHeaders: `Content-Type: ${postBody.contentType}${postBody.boundary ? `; boundary=${postBody.boundary}` : ''}`,
        } : {}),
      }).catch(() => {})
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
  win.webContents.on('will-redirect', (event, nextUrl) => {
    if (!isAllowedUrl(nextUrl)) event.preventDefault()
  })
  win.webContents.on('did-navigate', (_event, nextUrl) => authTrace('did-navigate', nextUrl))
  win.webContents.on('did-finish-load', () => authTrace('did-finish-load', win.webContents.getURL()))
  win.webContents.on('did-fail-load', (_event, errorCode, _errorDescription, validatedURL, mainFrame) => {
    authTrace('did-fail-load', validatedURL, String(errorCode))
    if (mainFrame && errorCode !== -3 && record && auth.records.get(record.site) === record) auth.update(record.site, 'error', '官方页面加载失败，请检查网络后重试')
  })
  win.webContents.on('render-process-gone', () => {
    if (record && auth.records.get(record.site) === record) auth.update(record.site, 'error', '官方页面已停止响应，请重试连接')
  })
  attachConnector(win, record)
  attachDownloadHandler(win)
  win.loadURL(url).catch(() => { /* did-fail-load reports real errors, excluding cancelled redirects */ })
  return win
}

function createDashboard() {
  dashboard = new BrowserWindow({
    icon: join(sourceRoot, 'dist', 'brand', 'icon-512.png'),
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
      const record = site && auth.request(site)
      if (record?.window && !record.window.isDestroyed()) {
        // A page opened to finish login should disappear on success. Keep
        // windows open only when the user is browsing a connected service.
        record.browse = record.state === 'connected'
        record.window.show()
        if (record.state === 'connected') record.window.loadURL(url).catch(() => {})
      } else if (record) record.openWhenStarted = true
      else if (!site) createAuthWindow(url)
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

function handleDashboard(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!dashboard || dashboard.isDestroyed() || event.sender !== dashboard.webContents ||
      event.senderFrame !== dashboard.webContents.mainFrame) throw new Error('仅仪表盘可以管理本地账户和登录')
    if (changingAccount) throw new Error('正在切换账户，请稍后重试')
    if (!['myhku-legal-status', 'myhku-accept-legal', 'myhku-decline-legal'].includes(channel) && !hasLegalConsent()) throw new Error('请先阅读并同意使用协议')
    return handler(event, ...args)
  })
}

handleDashboard('myhku-legal-status', () => ({ accepted: hasLegalConsent(), version: legalVersion }))
handleDashboard('myhku-accept-legal', (_event, version) => {
  if (version !== legalVersion) throw new Error('协议版本已变化，请重新阅读')
  const file = join(app.getPath('userData'), 'myhku-legal-consent.json')
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(`${file}.tmp`, JSON.stringify({ version, acceptedAt: new Date().toISOString() }), { mode: 0o600 })
  renameSync(`${file}.tmp`, file)
  startConsentedServices()
})
handleDashboard('myhku-decline-legal', () => app.quit())

handleDashboard('myhku-account-status', async () => {
  const account = readAccount()
  const status = authStatus()
  return account ? { configured: true, localUsername: account.localUsername, email: account.email, authState: status.state, detail: status.detail, sessions: status.sessions } : { configured: false }
})

handleDashboard('myhku-save-account', async (_event, value) => {
  changingAccount = true
  try {
    const previous = readAccount()
    const saved = saveAccount(value || {})
    if (!previous || previous.email.toLowerCase() !== saved.email.toLowerCase() || previous.password !== String(value?.password || '')) {
      await resetAccountSessions()
    }
    notifyAuthStatus({ ...authStatus(), state: 'ready', detail: '账户已安全保存，请开始首次登录' })
    return { configured: true, ...saved }
  } finally { changingAccount = false }
})

handleDashboard('myhku-begin-login', async (_event, show = true) => {
  beginLogin(Boolean(show))
  return true
})

handleDashboard('myhku-clear-account', async () => {
  changingAccount = true
  try {
    clearAccount()
    await resetAccountSessions()
    notifyAuthStatus({ ...authStatus(), state: 'signed_out' })
    return true
  } finally { changingAccount = false }
})

function beginLogin(show = true) {
  for (const site of Object.keys(SERVICE_URLS)) auth.request(site, { show })
}

handleDashboard('myhku-auth-sessions', () => auth.snapshot())
handleDashboard('myhku-login-site', (_event, site) => {
  auth.request(site, { show: true })
  return auth.snapshot()
})

handleDashboard('myhku-refresh-hku', () => {
  if (readAccount()) {
    for (const site of Object.keys(SERVICE_URLS)) auth.request(site, { refresh: true })
  }
  return authWindows.size
})

handleDashboard('myhku-download-resource', async (_event, url) => {
  const authenticated = session.fromPartition('persist:myhku-hku')
  const parser = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  try {
    await parser.loadURL('about:blank')
    const fetchPage = value => authenticated.fetch(value, { redirect: 'manual', signal: AbortSignal.timeout(120_000) })
    const urls = await resolveMoodleDownloads(String(url), fetchPage,
      (html, base) => parser.webContents.executeJavaScript(`(${fileLinksFromHtml.toString()})(${JSON.stringify(html)}, ${JSON.stringify(base)})`))
    for (const file of urls) await saveMoodleDownload(file, app.getPath('downloads'), fetchPage)
    return urls.length
  } finally { parser.destroy() }
})

handleDashboard('myhku-schedule-week', async (_event, rawOffset) => {
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
    await sisWindow.loadURL(SERVICE_URLS.sis)
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
    const doc = frame?.contentDocument || document
    const pattern = ${offset > 0 ? '/next\\s*week|下(?:一)?周/i' : '/prev(?:ious)?\\s*week|上(?:一)?周/i'}
    const button = doc.querySelector('[name="${control}"]') || Array.from(doc.querySelectorAll('button, input[type="button"], input[type="submit"], a[href]')).find(node => pattern.test(node.textContent || node.value || node.getAttribute('aria-label') || ''))
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
  app.setAppUserModelId('hk.my.myhku')
  startDashboardServer()
  createDashboard()
  startConsentedServices()
  app.on('activate', () => { if (!dashboard || dashboard.isDestroyed()) createDashboard() })
}).catch(error => dialog.showErrorBox('MyHKU 启动失败', error.stack || error.message))

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => {
  quitting = true
  if (bridgeProcess && !bridgeProcess.killed) bridgeProcess.kill()
  if (uiServer) uiServer.close()
})
