#!/usr/bin/env node
/**
 * MyHKU live desktop connector.
 *
 * This process launches (or attaches to) a Chrome instance with a dedicated
 * persistent profile, connects to Chrome DevTools Protocol, and evaluates the
 * same read-only DOM adapter used by the development extension.  It then
 * sends normalized values to bridge/server.mjs.  Login is always performed by
 * the user in the visible official HKU pages; this connector never reads
 * password values, cookies, storage, headers, or page HTML.
 *
 * The connector is intentionally a local development/runtime adapter.  A
 * packaged desktop client can use the same boundary from its native layer.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EXTENSION_SOURCE = path.join(ROOT, 'extension', 'content.js')
const BRIDGE_SOURCE = path.join(ROOT, 'bridge', 'server.mjs')
const DEFAULT_CDP_PORT = 9222
const DEFAULT_BRIDGE_PORT = 17321
const DEFAULT_WATCH_MS = 5000
const DEFAULT_REFRESH_MS = 24 * 60 * 60 * 1000
const ALLOWED_HOSTS = new Set(['moodle.hku.hk', 'studentportal.hku.hk', 'hkuportal.hku.hk', 'sis-main.hku.hk', 'sweb.hku.hk', 'intraweb.hku.hk'])
const SITE_URLS = {
  moodle: 'https://moodle.hku.hk/',
  portal: 'https://studentportal.hku.hk/',
  sis: 'https://sis-main.hku.hk/psp/sisprod/EMPLOYEE/PSFT_CS/c/SA_LEARNER_SERVICES.SSR_SSENRL_SCHD_W.GBL?pslnkid=Z_HC_SSR_SSENRL_SCHD_W_LNK',
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function parseArgs(argv) {
  const result = { once: false, noLaunch: false, selfTest: false, port: undefined, bridge: undefined, profile: undefined, chrome: undefined, watch: undefined, refresh: undefined }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--once') result.once = true
    else if (arg === '--no-launch') result.noLaunch = true
    else if (arg === '--self-test') result.selfTest = true
    else if (arg === '--port') result.port = argv[++i]
    else if (arg === '--bridge') result.bridge = argv[++i]
    else if (arg === '--profile') result.profile = argv[++i]
    else if (arg === '--chrome') result.chrome = argv[++i]
    else if (arg === '--watch-ms') result.watch = argv[++i]
    else if (arg === '--refresh-ms') result.refresh = argv[++i]
    else if (arg === '--help' || arg === '-h') {
      console.log(`MyHKU Chrome DevTools connector\n\nUsage: npm run bridge:cdp -- [options]\n\nOptions:\n  --once                 Sync currently loaded pages then exit\n  --self-test            Validate adapter source without launching Chrome\n  --no-launch            Require an already running CDP endpoint\n  --port <n>             Chrome debugging port (default ${DEFAULT_CDP_PORT})\n  --bridge <url>         Local bridge URL (default http://127.0.0.1:${DEFAULT_BRIDGE_PORT})\n  --profile <path>       Dedicated Chrome profile directory\n  --chrome <path>        Chrome executable path\n  --watch-ms <n>         Login/tab check interval (default ${DEFAULT_WATCH_MS})\n  --refresh-ms <n>       Refresh interval while running (default 24h)`)
      process.exit(0)
    }
  }
  return result
}

function positiveInt(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback
}

function safeHttpUrl(value, fallback) {
  try {
    const url = new URL(value || fallback)
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('bridge must be local http')
    return url.toString().replace(/\/$/, '')
  } catch {
    return fallback
  }
}

function clean(value, max = 240) {
  const text = String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, max) : ''
}

function pageHost(url) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())
      ? parsed.hostname.toLowerCase()
      : ''
  } catch { return '' }
}

function siteForHost(host) {
  if (host === 'moodle.hku.hk') return 'moodle'
  if (host === 'studentportal.hku.hk') return 'portal'
  if (host === 'hkuportal.hku.hk' || host === 'sis-main.hku.hk' || host === 'sweb.hku.hk' || host === 'intraweb.hku.hk') return 'sis'
  return ''
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(options.timeout || 5000) })
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`)
  return response.json()
}

/** A minimal CDP JSON-RPC client using Node's built-in WebSocket. */
class CdpConnection {
  constructor(url, label = 'cdp') {
    this.url = url
    this.label = label
    this.nextId = 0
    this.pending = new Map()
    this.events = new Map()
    this.ws = null
  }

  async connect() {
    if (typeof WebSocket !== 'function') throw new Error('Node 22 or newer is required (built-in WebSocket missing)')
    this.ws = new WebSocket(this.url)
    await new Promise((resolve, reject) => {
      let settled = false
      const fail = error => { if (!settled) { settled = true; reject(error) } }
      this.ws.onopen = () => { if (!settled) { settled = true; resolve() } }
      this.ws.onerror = event => fail(new Error(`${this.label} WebSocket error: ${event?.message || 'connection failed'}`))
      this.ws.onclose = () => {
        if (!settled) fail(new Error(`${this.label} WebSocket closed before opening`))
        for (const pending of this.pending.values()) pending.reject(new Error(`${this.label} WebSocket closed`))
        this.pending.clear()
      }
      this.ws.onmessage = event => this.#message(event.data)
    })
    return this
  }

  #message(data) {
    let message
    try { message = JSON.parse(typeof data === 'string' ? data : String(data)) } catch { return }
    if (message.id) {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(`${message.error.message || 'CDP error'} (${message.error.code || 'unknown'})`))
      else pending.resolve(message.result || {})
      return
    }
    const listeners = this.events.get(message.method) || []
    for (const listener of listeners) listener(message.params || {})
  }

  on(method, listener) {
    const listeners = this.events.get(method) || []
    listeners.push(listener)
    this.events.set(method, listeners)
    return () => this.events.set(method, listeners.filter(item => item !== listener))
  }

  command(method, params = {}, timeout = 15000) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error(`${this.label} is not connected`))
    const id = ++this.nextId
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP timeout: ${method}`))
      }, timeout)
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value) },
        reject: error => { clearTimeout(timer); reject(error) },
      })
    })
  }

  close() {
    try { this.ws?.close() } catch { /* best effort */ }
  }
}

function findExecutable(explicit) {
  if (explicit) return explicit
  if (process.env.MYHKU_CHROME_PATH) return process.env.MYHKU_CHROME_PATH
  const candidates = process.platform === 'win32'
    ? [
      path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
      : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']
  for (const candidate of candidates) {
    if (!candidate) continue
    if (path.isAbsolute(candidate) && fs.existsSync(candidate)) return candidate
    if (!path.isAbsolute(candidate) && spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [candidate], { stdio: 'ignore' }).status === 0) return candidate
  }
  throw new Error('找不到 Chrome/Chromium。请通过 --chrome 或 MYHKU_CHROME_PATH 指定可执行文件。')
}

async function waitForVersion(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  const endpoint = `http://127.0.0.1:${port}/json/version`
  let lastError
  while (Date.now() < deadline) {
    try {
      const version = await jsonFetch(endpoint, { timeout: 2000 })
      if (version.webSocketDebuggerUrl) return version
    } catch (error) { lastError = error }
    await sleep(250)
  }
  throw new Error(`Chrome CDP endpoint 未就绪（${endpoint}）：${lastError?.message || 'timeout'}`)
}

async function launchChrome({ port, profile, executable, noLaunch }) {
  let launched = null
  try {
    return { version: await waitForVersion(port, 1000), launched }
  } catch (error) {
    if (noLaunch) throw new Error(`未找到已运行的 Chrome CDP。请先用 --port ${port} 启动 Chrome，或去掉 --no-launch。`)
  }
  const executablePath = findExecutable(executable)
  fs.mkdirSync(profile, { recursive: true })
  const args = [
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    `--remote-allow-origins=http://127.0.0.1:${port},http://localhost:${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
    SITE_URLS.moodle,
    SITE_URLS.portal,
  ]
  console.log(`启动 Chrome 专用登录配置：${profile}`)
  launched = spawn(executablePath, args, { detached: true, stdio: 'ignore', windowsHide: false })
  launched.unref()
  return { version: await waitForVersion(port), launched }
}

async function listTargets(port) {
  return jsonFetch(`http://127.0.0.1:${port}/json/list`)
}

async function ensureSiteTabs(browser, port) {
  const targets = await listTargets(port)
  const present = new Set(targets.filter(target => target.type === 'page').map(target => siteForHost(pageHost(target.url))))
  const authInProgress = targets.some(target => target.type === 'page' && /(?:login\.microsoftonline\.com|hkuportal\.hku\.hk\/cas|studentportal\.hku\.hk\/.*(?:login|signin))/i.test(target.url || ''))
  for (const [site, targetUrl] of Object.entries(SITE_URLS)) {
    // During SSO redirects Chrome may briefly expose the identity-provider
    // URL instead of the original HKU URL. Do not open duplicate tabs while
    // that login flow is still in progress.
    if (present.has(site) || (site === 'portal' && authInProgress)) continue
    try {
      await browser.command('Target.createTarget', { url: targetUrl })
      console.log(`已打开 ${site} 官方页面，请在页面中完成登录（如需要）。`)
    } catch (error) {
      console.warn(`无法打开 ${site} 页面：${error.message}`)
    }
  }
}

function extractorSource() {
  const source = fs.readFileSync(EXTENSION_SOURCE, 'utf8')
  // The extension's adapter is deliberately the single source of truth. Its
  // normal entry point posts to the bridge; for CDP we replace only that call
  // with a return value. This keeps both connectors on the same parser.
  const marker = /\n\s*publish\(\)\s*\n\}\)\(\)\s*;?\s*$/
  if (!marker.test(source)) throw new Error('extension/content.js 的 adapter 入口结构已改变，CDP 连接器需要更新')
  return source.replace(marker, "\n  return site === 'moodle' ? extractMoodle() : { schedule: extractSis(), scheduleWeek: (() => { const raw = String(document.body?.textContent || document.documentElement?.textContent || ''); const match = raw.match(/Week\\s+of\\s+(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})\\s*[-–]\\s*(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})/i); if (!match) return undefined; const iso = (d, m, y) => y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); return { start: iso(Number(match[1]), Number(match[2]), Number(match[3])), end: iso(Number(match[4]), Number(match[5]), Number(match[6])) } })() }\n})()")
}

const EXTRACTOR_SOURCE = extractorSource()

async function evaluatePage(target, expression) {
  if (!target.webSocketDebuggerUrl) throw new Error('target 没有 CDP WebSocket 地址')
  const connection = await new CdpConnection(target.webSocketDebuggerUrl, `${target.title || target.url}`).connect()
  try {
    await connection.command('Runtime.enable')
    const result = await connection.command('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: false,
    })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || '页面脚本执行失败')
    if (result.result?.subtype === 'error') throw new Error(result.result.description || '页面脚本执行失败')
    return result.result?.value
  } finally {
    connection.close()
  }
}

async function pageMetadata(target) {
  return evaluatePage(target, `(() => {
    const path = location.pathname || '/';
    const title = document.title || '';
    const hasPassword = Boolean(document.querySelector('input[type="password"]'));
    const loginPath = /\\/(?:login|signin|sign-in|cas)(?:\\/|\\.|$)/i.test(path);
    return { title, path, host: location.hostname, ready: document.readyState, login: hasPassword || loginPath };
  })()`)
}

function detailFor(site, metadata, connected) {
  const title = clean(metadata?.title, 120)
  const pathname = clean(metadata?.path, 100)
  if (!connected) return `${site} 页面需要登录${title ? `：${title}` : ''}`
  return `${site} 已同步${title ? `：${title}` : ''}${pathname && pathname !== '/' ? `（${pathname}）` : ''}`
}

async function postIngest(bridgeUrl, site, payload) {
  const response = await fetch(`${bridgeUrl}/api/ingest/${site}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error(`bridge ingest HTTP ${response.status}`)
  return response.json()
}

async function syncTarget(bridgeUrl, target, { extract = true } = {}) {
  const host = pageHost(target.url)
  const site = siteForHost(host)
  if (!site) return { site: '', connected: false, skipped: true }
  let metadata
  try {
    metadata = await pageMetadata(target)
  } catch (error) {
    return { site, connected: false, error: `读取页面状态失败：${error.message}` }
  }
  // Do not pass target.url to logs or bridge: an SSO callback can contain a
  // one-time ticket in its query string. Only the host/path are retained.
  // A target can still report its old HKU URL while the browser is in an
  // Entra/CAS redirect. Treat that state as unauthenticated and never run the
  // HKU extractor against an identity-provider page.
  if (String(metadata?.host || '').toLowerCase() !== host) {
    await postIngest(bridgeUrl, site, { connected: false, detail: `${site} 正在完成官方登录跳转` })
    return { site, connected: false, detail: `${site} 正在完成官方登录跳转` }
  }
  if (metadata?.login) {
    await postIngest(bridgeUrl, site, { connected: false, detail: detailFor(site, metadata, false) })
    return { site, connected: false, detail: detailFor(site, metadata, false) }
  }
  if (!extract) return { site, connected: true, skipped: true, detail: detailFor(site, metadata, true) }
  let data
  try {
    data = await evaluatePage(target, EXTRACTOR_SOURCE)
  } catch (error) {
    return { site, connected: false, error: `解析页面失败：${error.message}` }
  }
  const payload = { connected: true, detail: detailFor(site, metadata, true) }
  if (site === 'sis' && Array.isArray(data?.schedule) && data.schedule.length > 0) payload.replaceFields = ['schedule']
  for (const field of ['schedule', 'courses', 'assignments', 'announcements', 'resources', 'grades']) {
    if (Array.isArray(data?.[field])) payload[field] = data[field]
  }
  if (data?.scheduleWeek && typeof data.scheduleWeek.start === 'string' && typeof data.scheduleWeek.end === 'string') payload.scheduleWeek = data.scheduleWeek
  const count = ['schedule', 'courses', 'assignments', 'announcements', 'resources', 'grades'].reduce((sum, field) => sum + (payload[field]?.length || 0), 0)
  if (count === 0) payload.detail += '；当前页面没有可识别的数据'
  const result = await postIngest(bridgeUrl, site, payload)
  return { site, connected: true, count, result, detail: payload.detail }
}

async function syncAll(port, bridgeUrl, { lastSync = new Map(), refreshMs = 0, targetSeen = new Map() } = {}) {
  const targets = await listTargets(port)
  const pages = targets.filter(target => target.type === 'page' && siteForHost(pageHost(target.url)))
  if (!pages.length) return []
  const results = []
  for (const target of pages) {
    try {
      const site = siteForHost(pageHost(target.url))
      const targetChanged = targetSeen.get(site) !== target.id
      const due = targetChanged || !lastSync.has(site) || (refreshMs > 0 && Date.now() - lastSync.get(site) >= refreshMs)
      const result = await syncTarget(bridgeUrl, target, { extract: due })
      results.push(result)
      if (result.connected && !result.skipped) targetSeen.set(site, target.id)
      if (result.error) console.warn(`[${result.site}] ${result.error}`)
      else if (!result.skipped) console.log(`[${result.site}] ${result.detail || '已同步'}`)
    } catch (error) {
      const site = siteForHost(pageHost(target.url))
      console.warn(`[${site}] 同步失败：${error.message}`)
      results.push({ site, connected: false, error: error.message })
    }
  }
  return results
}

async function ensureBridge(bridgeUrl) {
  try {
    await jsonFetch(`${bridgeUrl}/api/snapshot`, { timeout: 1500 })
    return null
  } catch {
    if (process.env.MYHKU_SKIP_BRIDGE === '1') throw new Error(`本地 bridge 不可用：${bridgeUrl}`)
    console.log(`启动本地 bridge：${bridgeUrl}`)
    const bridgePort = new URL(bridgeUrl).port || '17321'
    const child = spawn(process.execPath, [BRIDGE_SOURCE], { cwd: ROOT, env: { ...process.env, MYHKU_BRIDGE_PORT: bridgePort }, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', chunk => process.stdout.write(`[bridge] ${chunk}`))
    child.stderr.on('data', chunk => process.stderr.write(`[bridge] ${chunk}`))
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      try { await jsonFetch(`${bridgeUrl}/api/snapshot`, { timeout: 1000 }); return child } catch { await sleep(100) }
    }
    child.kill()
    throw new Error(`本地 bridge 启动失败：${bridgeUrl}`)
  }
}

function runSelfTest() {
  if (!EXTRACTOR_SOURCE.includes('return site ===')) throw new Error('DOM adapter return hook missing')
  // Parse the exact expression sent to Runtime.evaluate. This catches a
  // malformed adapter edit without requiring a browser or an HKU account.
  // eslint-disable-next-line no-new-func
  new Function(EXTRACTOR_SOURCE)
  const expected = { 'moodle.hku.hk': 'moodle', 'studentportal.hku.hk': 'portal', 'hkuportal.hku.hk': 'sis', 'sis-main.hku.hk': 'sis', 'sweb.hku.hk': 'sis', 'intraweb.hku.hk': 'sis' }
  for (const [host, site] of Object.entries(expected)) {
    if (siteForHost(pageHost(`https://${host}/`)) !== site) throw new Error(`host mapping failed for ${host}`)
  }
  if (pageHost('https://example.com/') || pageHost('http://moodle.hku.hk/')) throw new Error('host allow-list failed')
  console.log('CDP adapter self-test passed (source syntax and HKU host allow-list).')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.selfTest) {
    runSelfTest()
    return
  }
  const port = positiveInt(args.port || process.env.MYHKU_CDP_PORT, DEFAULT_CDP_PORT)
  const bridgePort = positiveInt(process.env.MYHKU_BRIDGE_PORT, DEFAULT_BRIDGE_PORT)
  const bridgeUrl = safeHttpUrl(args.bridge || process.env.MYHKU_BRIDGE_URL, `http://127.0.0.1:${bridgePort}`)
  const watchMs = positiveInt(args.watch || process.env.MYHKU_CDP_WATCH_MS, DEFAULT_WATCH_MS)
  const refreshMs = positiveInt(args.refresh || process.env.MYHKU_CDP_REFRESH_MS, DEFAULT_REFRESH_MS)
  const profile = path.resolve(args.profile || process.env.MYHKU_CHROME_PROFILE || path.join(ROOT, '.myhku', 'chrome-profile'))
  const bridgeChild = await ensureBridge(bridgeUrl)
  let chrome
  let browser
  let timer
  let stopped = false
  const cleanup = () => {
    if (stopped) return
    stopped = true
    if (timer) clearInterval(timer)
    browser?.close()
    if (bridgeChild) bridgeChild.kill()
  }
  process.once('SIGINT', () => { cleanup(); process.exit(130) })
  process.once('SIGTERM', () => { cleanup(); process.exit(143) })
  try {
    chrome = await launchChrome({ port, profile, executable: args.chrome, noLaunch: args.noLaunch })
    browser = await new CdpConnection(chrome.version.webSocketDebuggerUrl, 'browser').connect()
    await ensureSiteTabs(browser, port)
    const lastSync = new Map()
    const targetSeen = new Map()
    let syncing = false
    const sync = async () => {
      if (syncing) return []
      syncing = true
      try {
        const results = await syncAll(port, bridgeUrl, { lastSync, refreshMs, targetSeen })
        const now = Date.now()
        for (const result of results) if (result.site && result.connected && !result.skipped) lastSync.set(result.site, now)
        return results
      } catch (error) {
        console.warn(`扫描 Chrome 页面失败：${error.message}`)
        return []
      } finally {
        syncing = false
      }
    }
    await sync()
    if (args.once) {
      // Keep an auto-started bridge alive so the dashboard can immediately
      // read the one-time snapshot after this process exits. When the caller
      // supplied an existing bridge, there is nothing to detach here.
      if (bridgeChild) {
        bridgeChild.stdout?.unref?.()
        bridgeChild.stderr?.unref?.()
        bridgeChild.unref?.()
        console.log('一次同步完成；本地 bridge 继续运行，仪表盘可读取最新快照。')
      }
      browser.close()
      return
    }
    console.log(`MyHKU CDP 连接器运行中：登录检查每 ${Math.round(watchMs / 1000)} 秒，已登录页面每天刷新一次。`)
    timer = setInterval(async () => {
      if (stopped) return
      try { await ensureSiteTabs(browser, port) } catch (error) { console.warn(`检查 HKU 标签页失败：${error.message}`) }
      const now = Date.now()
      if (syncing) return
      syncing = true
      let results = []
      try {
        results = await syncAll(port, bridgeUrl, { lastSync, refreshMs, targetSeen })
      } catch (error) {
        console.warn(`扫描 Chrome 页面失败：${error.message}`)
      } finally {
        syncing = false
      }
      for (const result of results) {
        if (result.site && result.connected && !result.skipped) lastSync.set(result.site, now)
      }
      // While a page remains on an SSO form, metadata is checked every watch
      // interval. Once connected, extraction runs again only at the daily
      // refresh boundary (or immediately when a newly opened tab is found).
    }, watchMs)
    // Keep the event loop alive without doing work when all pages are closed.
    void refreshMs
  } catch (error) {
    cleanup()
    throw error
  }
}

main().catch(error => {
  console.error(`MyHKU CDP 连接器：${error.message}`)
  process.exitCode = 1
})
