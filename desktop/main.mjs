import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import crypto from 'node:crypto'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
// Electron can read assets from app.asar, but a child Node process cannot
// execute a script whose path is inside the archive. electron-builder
// unpacks the bridge directory and the packaged app points at that real path.
const root = app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked') : join(here, '..')
const bridgeFile = join(root, 'bridge', 'server.mjs')
const preloadFile = join(here, 'preload.mjs')
const sourceRoot = app.isPackaged ? join(process.resourcesPath, 'app.asar') : root
const connectorFile = join(sourceRoot, 'extension', 'content.js')
const dashboardFile = join(sourceRoot, 'dist', 'index.html')
const bridgePort = process.env.MYHKU_BRIDGE_PORT || '17321'
const uiPort = process.env.MYHKU_UI_PORT || '17322'
const devUrl = process.env.MYHKU_DEV_SERVER_URL
const forceOpenLoginOnStartup = process.env.MYHKU_OPEN_LOGIN_ON_STARTUP === '1'
const allowedHosts = new Set([
  'moodle.hku.hk', 'studentportal.hku.hk', 'hkuportal.hku.hk', 'adfs.connect.hku.hk',
  // Official Microsoft identity hosts used by HKU Entra redirects.
  'login.microsoftonline.com', 'login.microsoft.com', 'login.windows.net',
  'login.live.com', 'account.live.com', 'account.microsoft.com',
])
let bridgeProcess
let uiServer
let dashboard
const authWindows = new Set()

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

function attachConnector(win) {
  const inject = () => {
    if (win.isDestroyed()) return
    win.webContents.executeJavaScript(connectorScript(), true).catch(() => {})
    // Keep the authenticated WebView alive for refresh and downloads, while
    // removing the two login windows from the user's workspace after the
    // official page has returned. Clicking an official login link creates a
    // visible window again using the same persistent session partition.
    const current = win.webContents.getURL()
    if (current && isAllowedUrl(current) && !/(?:login|signin|sign-in|oauth|authorize|cas|adfs)/i.test(current)) {
      setTimeout(() => { if (!win.isDestroyed() && win.isVisible()) win.hide() }, 1200)
    }
  }
  win.webContents.on('did-finish-load', inject)
  win.webContents.on('did-navigate', inject)
}

function attachDownloadHandler(win) {
  win.webContents.session.on('will-download', (_event, item) => {
    // Downloads are user initiated by clicking a Moodle resource. Electron
    // keeps the authenticated session for the request and writes only the
    // chosen file to the normal Downloads directory.
    item.setSaveDialogOptions({ defaultPath: join(app.getPath('downloads'), item.getFilename()) })
  })
}

function createAuthWindow(url) {
  if (!isAllowedUrl(url)) return null
  const win = new BrowserWindow({
    width: 1120,
    height: 820,
    minWidth: 720,
    minHeight: 560,
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

ipcMain.handle('myhku-refresh-hku', async () => {
  for (const win of authWindows) {
    if (!win.isDestroyed()) {
      try { await win.webContents.reload() } catch { /* closed during refresh */ }
    }
  }
  return authWindows.size
})

app.whenReady().then(() => {
  startBridge()
  startDashboardServer()
  createDashboard()
  const firstLoginMarker = join(app.getPath('userData'), 'myhku-first-login-window-shown')
  const shouldOpenLogin = forceOpenLoginOnStartup || !existsSync(firstLoginMarker)
  if (shouldOpenLogin) {
    // First-run helper: show the official login pages without automating any
    // credential entry. A marker prevents the normal packaged app from
    // reopening both windows on every subsequent launch.
    try { mkdirSync(app.getPath('userData'), { recursive: true }); writeFileSync(firstLoginMarker, new Date().toISOString(), { mode: 0o600 }) } catch { /* best effort */ }
    setTimeout(() => {
      createAuthWindow('https://studentportal.hku.hk/')
      createAuthWindow('https://moodle.hku.hk/login/index.php?authCAS=CAS')
    }, 600)
  }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createDashboard() })
}).catch(error => dialog.showErrorBox('MyHKU 启动失败', error.stack || error.message))

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => {
  if (bridgeProcess && !bridgeProcess.killed) bridgeProcess.kill()
  if (uiServer) uiServer.close()
})
