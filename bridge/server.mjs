#!/usr/bin/env node
/**
 * Tiny localhost bridge for the MyHKU browser extension.
 *
 * It deliberately keeps only normalized, non-secret data. The bridge never
 * accepts credentials, cookies, authorization headers, or page HTML. When a
 * desktop shell supplies an OS-protected key, the normalized cache is
 * encrypted on disk; otherwise it remains memory-only.
 */
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const HOST = '127.0.0.1'
const PORT = Number.parseInt(process.env.MYHKU_BRIDGE_PORT || '17321', 10)
const MAX_BODY = 2 * 1024 * 1024
const CACHE_FILE = process.env.MYHKU_BRIDGE_CACHE_FILE || ''
const CACHE_KEY = decodeCacheKey(process.env.MYHKU_BRIDGE_CACHE_KEY)
const SITES = new Set(['portal', 'sis', 'moodle'])
const ARRAY_FIELDS = ['schedule', 'courses', 'assignments', 'resources', 'grades', 'announcements']
const snapshot = {
  fetchedAt: null,
  schedule: [],
  courses: [],
  assignments: [],
  resources: [],
  grades: [],
  announcements: [],
}
const sessions = Object.fromEntries([...SITES].map(site => [site, {
  connected: false,
  checkedAt: null,
  detail: '尚未从已登录页面同步',
}]))

function decodeCacheKey(value) {
  if (!value) return null
  try {
    const key = Buffer.from(value, 'base64')
    return key.length === 32 ? key : null
  } catch { return null }
}

function cachePayload() {
  return JSON.stringify({ fetchedAt: snapshot.fetchedAt, ...Object.fromEntries(ARRAY_FIELDS.map(field => [field, snapshot[field]])) })
}

function loadEncryptedCache() {
  if (!CACHE_FILE || !CACHE_KEY) return
  try {
    const record = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
    const decipher = crypto.createDecipheriv('aes-256-gcm', CACHE_KEY, Buffer.from(record.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(record.tag, 'base64'))
    const data = JSON.parse(Buffer.concat([decipher.update(Buffer.from(record.data, 'base64')), decipher.final()]).toString('utf8'))
    if (!data || typeof data !== 'object') return
    for (const field of ARRAY_FIELDS) if (Array.isArray(data[field])) snapshot[field] = data[field]
    snapshot.fetchedAt = typeof data.fetchedAt === 'string' ? data.fetchedAt : null
  } catch { /* absent or invalid cache is treated as empty */ }
}

function saveEncryptedCache() {
  if (!CACHE_FILE || !CACHE_KEY) return
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true })
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', CACHE_KEY, iv)
    const encrypted = Buffer.concat([cipher.update(cachePayload(), 'utf8'), cipher.final()])
    const record = JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') })
    const temp = `${CACHE_FILE}.${process.pid}.tmp`
    fs.writeFileSync(temp, record, { mode: 0o600 })
    fs.renameSync(temp, CACHE_FILE)
  } catch { /* cache is an optimization; never fail a live sync */ }
}

loadEncryptedCache()


function isLocalOrigin(origin) {
  if (!origin) return false
  try {
    const url = new URL(origin)
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  } catch { return false }
}

function isTrustedOrigin(origin) {
  if (!origin) return true // native clients and local CLI tests have no Origin
  if (isLocalOrigin(origin)) return true
  try {
    const url = new URL(origin)
    return url.protocol === 'https:' && ['moodle.hku.hk', 'studentportal.hku.hk', 'hkuportal.hku.hk'].includes(url.hostname)
  } catch { return false }
}

function headers(origin) {
  const result = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  }
  // CORS read access is intentionally limited to a local MyHKU UI.  The
  // extension uses a no-cors, text/plain POST and never reads this response.
  if (isLocalOrigin(origin)) {
    result['Access-Control-Allow-Origin'] = origin
    result['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    result['Access-Control-Allow-Headers'] = 'Content-Type'
    result['Access-Control-Allow-Credentials'] = 'true'
    result['Vary'] = 'Origin'
  }
  return result
}

function send(res, status, body, origin) {
  res.writeHead(status, headers(origin))
  res.end(JSON.stringify(body))
}

function clean(value, max = 500) {
  if (typeof value !== 'string') return undefined
  const output = value.replace(/\u0000/g, '').replace(/\s+/g, ' ').trim()
  return output ? output.slice(0, max) : undefined
}

function bool(value) {
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  if (typeof value === 'string' && /^(true|complete|completed|done|submitted)$/i.test(value)) return true
  if (typeof value === 'string' && /^(false|incomplete|pending|todo)$/i.test(value)) return false
  return undefined
}

function safeUrl(value) {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || !(url.hostname === 'hku.hk' || url.hostname.endsWith('.hku.hk'))) return undefined
    return url.toString().slice(0, 2000)
  } catch { return undefined }
}

function idOf(value, fallback) {
  return clean(value, 180) || fallback
}

function normalizeClass(item, index) {
  if (!item || typeof item !== 'object') return null
  const title = clean(item.title || item.name || item.course)
  const start = clean(item.start || item.startTime || item.time)
  const end = clean(item.end || item.endTime)
  if (!title || !start || !end) return null
  return {
    id: idOf(item.id, `class-${index}-${start}`), title,
    ...(clean(item.code) ? { code: clean(item.code, 80) } : {}),
    ...(clean(item.date) ? { date: clean(item.date, 80) } : {}),
    ...(clean(item.day) ? { day: clean(item.day, 40) } : {}),
    start, end,
    ...(clean(item.room || item.location) ? { room: clean(item.room || item.location, 160) } : {}),
    ...(clean(item.teacher || item.instructor) ? { teacher: clean(item.teacher || item.instructor, 160) } : {}),
  }
}

function normalizeCourse(item, index) {
  if (!item || typeof item !== 'object') return null
  const title = clean(item.title || item.name)
  if (!title) return null
  return { id: idOf(item.id, `course-${index}-${title}`), title, ...(clean(item.code) ? { code: clean(item.code, 80) } : {}) }
}

function normalizeAssignment(item, index) {
  if (!item || typeof item !== 'object') return null
  const title = clean(item.title || item.name)
  if (!title) return null
  const completed = bool(item.completed)
  return { id: idOf(item.id, `assignment-${index}-${title}`), title, course: clean(item.course || item.courseName, 180) || '未提供课程', ...(clean(item.due) ? { due: clean(item.due, 120) } : {}), ...(completed === undefined ? {} : { completed }) }
}

function normalizeResource(item, index) {
  if (!item || typeof item !== 'object') return null
  const title = clean(item.title || item.name)
  const url = safeUrl(item.url || item.href)
  if (!title || !url) return null
  return { id: idOf(item.id, `resource-${index}-${title}`), title, course: clean(item.course || item.courseName, 180) || '未提供课程', url }
}

function normalizeGrade(item, index) {
  if (!item || typeof item !== 'object') return null
  const title = clean(item.title || item.name)
  if (!title) return null
  return { id: idOf(item.id, `grade-${index}-${title}`), title, course: clean(item.course || item.courseName, 180) || '未提供课程', ...(clean(item.value || item.grade || item.score) ? { value: clean(item.value || item.grade || item.score, 80) } : {}), ...(typeof item.released === 'boolean' ? { released: item.released } : {}) }
}

function normalizeAnnouncement(item, index) {
  if (!item || typeof item !== 'object') return null
  const title = clean(item.title || item.name)
  if (!title) return null
  const published = clean(item.published || item.date || item.time)
  const url = safeUrl(item.url || item.href)
  return {
    id: idOf(item.id, `announcement-${index}-${title}`),
    title,
    course: clean(item.course || item.courseName, 180) || '未提供课程',
    ...(published ? { published: published.slice(0, 120) } : {}),
    ...(url ? { url } : {}),
  }
}

function normalizeArray(field, value) {
  if (!Array.isArray(value)) return undefined
  const fn = { schedule: normalizeClass, courses: normalizeCourse, assignments: normalizeAssignment, resources: normalizeResource, grades: normalizeGrade, announcements: normalizeAnnouncement }[field]
  return value.map(fn).filter(Boolean).slice(0, 1000)
}

function mergeById(existing, incoming) {
  // A Moodle page often exposes only one data section at a time. Keep the
  // other sections until a caller explicitly asks for replacement.
  const merged = new Map(existing.map(item => [item.id, item]))
  for (const item of incoming) merged.set(item.id, item)
  return [...merged.values()].slice(0, 1000)
}

async function readBody(req) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw Object.assign(new Error('payload_too_large'), { status: 413 })
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function containsSecretKey(raw) {
  // Parse first so words in a title/detail string (for example
  // `"Reset password: ..."`) cannot be mistaken for object keys. JSON also
  // decodes escaped key names before this check.
  let value
  try { value = JSON.parse(raw || '{}') } catch { return false }
  const secret = /^(?:password|passwd|cookie|set-cookie|authorization|access[_-]?token|refresh[_-]?token|client[_-]?secret)$/i
  const walk = item => {
    if (!item || typeof item !== 'object') return false
    if (Array.isArray(item)) return item.some(walk)
    return Object.entries(item).some(([key, child]) => secret.test(key) || walk(child))
  }
  return walk(value)
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin
  // Binding to loopback prevents remote sockets; checking Host also prevents
  // a rebinding page from treating this process as its own local API.
  const requestHost = String(req.headers.host || '').split(':')[0].toLowerCase()
  if (requestHost && requestHost !== HOST && requestHost !== 'localhost') {
    send(res, 421, { error: 'host_not_allowed' }, origin); return
  }
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`)
  if (req.method === 'OPTIONS') {
    res.writeHead(204, headers(origin)); res.end(); return
  }
  const sessionMatch = url.pathname.match(/^\/api\/session\/(portal|sis|moodle)$/)
  if (req.method === 'GET' && sessionMatch) {
    const site = sessionMatch[1]
    send(res, 200, { site, ...sessions[site] }, origin); return
  }
  if (req.method === 'GET' && url.pathname === '/api/snapshot') {
    send(res, 200, { ...snapshot }, origin); return
  }
  const ingestMatch = url.pathname.match(/^\/api\/ingest\/(portal|sis|moodle)$/)
  if (req.method === 'POST' && ingestMatch) {
    const site = ingestMatch[1]
    if (!isTrustedOrigin(origin)) { send(res, 403, { error: 'origin_not_allowed' }, origin); return }
    try {
      const raw = await readBody(req)
      if (containsSecretKey(raw)) { send(res, 400, { error: 'secret_fields_not_allowed' }, origin); return }
      const payload = JSON.parse(raw || '{}')
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Object.assign(new Error('invalid_json'), { status: 400 })
      let changed = 0
      const replaceFields = Array.isArray(payload.replaceFields)
        ? payload.replaceFields.filter(field => ARRAY_FIELDS.includes(field))
        : []
      for (const field of ARRAY_FIELDS) {
        const values = normalizeArray(field, payload[field])
        if (values !== undefined) {
          snapshot[field] = replaceFields.includes(field) ? values : mergeById(snapshot[field], values)
          changed += values.length
        }
      }
      const now = new Date().toISOString()
      const connected = typeof payload.connected === 'boolean' ? payload.connected : true
      if (connected && ARRAY_FIELDS.some(field => Array.isArray(payload[field]))) snapshot.fetchedAt = now
      sessions[site] = { connected, checkedAt: now, detail: clean(payload.detail, 240) || `已从 ${site} 登录页面同步` }
      // Portal is the normal entry point for SIS. A schedule extracted from
      // that page proves the SIS session is usable as well.
      if (site === 'portal' && connected && Array.isArray(payload.schedule)) {
        sessions.sis = { connected: true, checkedAt: now, detail: '已从 Portal 页面同步课表' }
      }
      saveEncryptedCache()
      send(res, 200, { ok: true, site, fetchedAt: now, changed }, origin)
    } catch (error) {
      send(res, error?.status || 400, { error: error?.message || 'invalid_payload' }, origin)
    }
    return
  }
  send(res, 404, { error: 'not_found' }, origin)
})

server.listen(PORT, HOST, () => {
  console.log(`MyHKU bridge listening on http://${HOST}:${PORT}`)
})

function shutdown() { server.close(() => process.exit(0)) }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
