import { copyFile, open, mkdir, readdir, readFile, rename, stat, unlink } from 'node:fs/promises'
import { readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, extname, join, relative } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const MOODLE_ENTRY_PATH = /^\/(?:(?:webservice\/)?pluginfile\.php\/|draftfile\.php\/|mod\/(?:resource|folder|url|page|book)\/(?:view|download_folder)\.php$)/
const LOGIN_REDIRECT_HOST = /^(?:adfs\.connect\.hku\.hk|login\.microsoftonline\.com|login\.microsoft\.com|login\.windows\.net|login\.live\.com)$/i
const LOGIN_REDIRECT_PATH = /\/(?:login\/|cas\/|auth\/|Account\/Login)/i

export function moodleDownloadUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.hostname !== 'moodle.hku.hk' || url.username || url.password ||
      !MOODLE_ENTRY_PATH.test(url.pathname)) {
    throw new Error('此链接不是 Moodle 文件资料')
  }
  return url
}

function isLoginRedirectUrl(url) {
  return LOGIN_REDIRECT_HOST.test(url.hostname) || LOGIN_REDIRECT_PATH.test(url.pathname)
}

function verifiedRedirectDownloadUrl(rawHref) {
  const url = new URL(rawHref)
  if (url.protocol !== 'https:' || url.username || url.password || isLoginRedirectUrl(url)) {
    throw new Error('Moodle 会话已过期，请在设置中重新连接')
  }
  if (url.hostname === 'moodle.hku.hk') {
    return moodleDownloadUrl(url.href)
  }
  if (url.hostname === 'hku.hk' || url.hostname.endsWith('.hku.hk')) {
    return url
  }
  const extErr = new Error(`该资料指向外部链接（${url.hostname}），请点击浏览器图标查看`)
  extErr.code = 'EXTERNAL_LINK'
  extErr.externalUrl = url.href
  throw extErr
}

// Runs in an isolated DOM parser. No remote HTML is inserted into the page.
export function fileLinksFromHtml(html, base) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  if (doc.querySelector('input[type="password"]')) return []
  const mainScope = doc.querySelector('#region-main, [role="main"], .resourcecontent, .foldertree, .box.generalbox') || doc
  const candidates = [...mainScope.querySelectorAll('a[href], object[data], embed[src], iframe[src], video[src], audio[src], source[src]')]
    .map(node => node.getAttribute('href') || node.getAttribute('data') || node.getAttribute('src'))
    .map(value => { try { return new URL(value, base).href } catch { return '' } })
    .filter(value => {
      try {
        const url = new URL(value)
        return url.protocol === 'https:' && url.hostname === 'moodle.hku.hk' &&
          /^\/(?:(?:webservice\/)?pluginfile\.php\/|draftfile\.php\/|mod\/folder\/download_folder\.php$)/.test(url.pathname)
      } catch { return false }
    })
  for (const img of mainScope.querySelectorAll('img[src]')) {
    try {
      const url = new URL(img.getAttribute('src') || '', base)
      if (url.protocol === 'https:' && url.hostname === 'moodle.hku.hk' &&
          /^\/(?:webservice\/)?pluginfile\.php\/[^?#]*\/mod_(?:resource|folder|page|book)\//i.test(url.pathname)) {
        candidates.push(url.href)
      }
    } catch { /* ignore */ }
  }
  const unique = [...new Set(candidates)]
  const directFiles = unique.filter(href => {
    try { return !new URL(href).pathname.endsWith('/download_folder.php') } catch { return true }
  })
  if (directFiles.length > 0) return directFiles
  if (unique.length > 0) return unique
  for (const form of mainScope.querySelectorAll('form[action*="/mod/folder/download_folder.php"]')) {
    try {
      const actionUrl = new URL(form.getAttribute('action') || '', base)
      const idVal = form.querySelector('input[name="id"]')?.getAttribute('value') || ''
      if (actionUrl.hostname === 'moodle.hku.hk' && idVal) {
        actionUrl.searchParams.set('id', idVal)
        return [actionUrl.href]
      }
    } catch { /* ignore */ }
  }
  return []
}

async function fetchMoodleFile(value, fetchPage) {
  let target = verifiedRedirectDownloadUrl(value)
  if (target.hostname === 'moodle.hku.hk') target = moodleDownloadUrl(target.href)
  let response
  for (let hop = 0; hop < 8; hop++) {
    response = await fetchPage(target.href)
    if (![301, 302, 303, 307, 308].includes(response.status)) break
    const next = response.headers.get('location')
    await response.body?.cancel()
    if (!next) throw new Error('Moodle 会话已过期，请在设置中重新连接')
    let resolvedHref
    try { resolvedHref = new URL(next, target).href } catch { throw new Error('Moodle 会话已过期，请在设置中重新连接') }
    target = verifiedRedirectDownloadUrl(resolvedHref)
  }
  if (!response.ok) throw new Error(`资料读取失败（HTTP ${response.status}）`)
  const finalUrl = response.url || target.href
  verifiedRedirectDownloadUrl(finalUrl)
  return { response, finalUrl }
}

function isDirectPluginFilePath(pathname) {
  return pathname.startsWith('/pluginfile.php/') ||
    pathname.startsWith('/webservice/pluginfile.php/') ||
    pathname.startsWith('/draftfile.php/') ||
    pathname.endsWith('/download_folder.php')
}

export async function resolveMoodleDownloads(value, fetchPage, parseHtml) {
  const url = moodleDownloadUrl(value)
  if (isDirectPluginFilePath(url.pathname)) {
    url.searchParams.set('forcedownload', '1')
    return [url.href]
  }
  const { response, finalUrl } = await fetchMoodleFile(url.href, fetchPage)
  const type = response.headers.get('content-type') || ''
  if (!/text\/html|application\/xhtml/i.test(type)) {
    await response.body?.cancel()
    return [verifiedRedirectDownloadUrl(finalUrl).href]
  }
  const links = await parseHtml(await response.text(), finalUrl)
  const files = links.map(link => verifiedRedirectDownloadUrl(link)).map(link => {
    if (link.hostname === 'moodle.hku.hk') link.searchParams.set('forcedownload', '1')
    return link.href
  })
  if (files.length > 0) return files
  if (/^\/mod\/(?:resource|url)\/view\.php$/.test(url.pathname) && !url.searchParams.has('redirect')) {
    const redirectAttempt = new URL(url.href)
    redirectAttempt.searchParams.set('redirect', '1')
    const fallback = await fetchMoodleFile(redirectAttempt.href, fetchPage)
    const fallbackType = fallback.response.headers.get('content-type') || ''
    if (!/text\/html|application\/xhtml/i.test(fallbackType)) {
      await fallback.response.body?.cancel()
      return [verifiedRedirectDownloadUrl(fallback.finalUrl).href]
    }
    const fallbackLinks = await parseHtml(await fallback.response.text(), fallback.finalUrl)
    await fallback.response.body?.cancel?.().catch(() => {})
    const fallbackFiles = fallbackLinks.map(link => verifiedRedirectDownloadUrl(link)).map(link => {
      if (link.hostname === 'moodle.hku.hk') link.searchParams.set('forcedownload', '1')
      return link.href
    })
    if (fallbackFiles.length > 0) return fallbackFiles
  }
  throw new Error('未找到可下载文件，请确认 Moodle 登录状态或刷新资料')
}

export function sanitizePathSegment(value, fallback = 'General') {
  let cleaned = String(value || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '').slice(0, 96)
  if (!cleaned) cleaned = fallback
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned)) cleaned = `_${cleaned}`
  return cleaned
}

export function extractCourseFolderName(courseText) {
  const text = String(courseText || '').trim()
  const codeMatch = text.match(/(?:^|[^A-Za-z0-9])([A-Z]{2,8})\s*[-_]?\s*(\d{3,5}[A-Z]?)(?=$|[^A-Za-z0-9])/i)
  if (codeMatch) return `${codeMatch[1].toUpperCase()}${codeMatch[2].toUpperCase()}`
  return sanitizePathSegment(text, 'Uncategorized_Course')
}

export function classifyBglisCategory(title = '', filename = '', url = '') {
  const combined = `${title} ${filename} ${url}`.toLowerCase()
  if (/\b(?:syllabus|course\s*info(?:rmation)?|course\s*outline|tentative.*calendar|semester\s*calendar|how\s*to\s*use|notation\s*reference|reading\s*list|handbook)\b|课程大纲|大纲|课程介绍|课程信息|日历|导引/.test(combined)) {
    return 'Course Information'
  }
  if (/python\s*lab|\.(?:ipynb|py)(?:\b|$|\?)/.test(combined)) return 'Python Labs'
  if (/\blabs?\b|\bpractical\b|上机|实验/.test(combined)) return 'Labs'
  if (/\btutorials?\b|\btut[\s_-]*\d|\bhandout\b|tutorial\s*solutions?|导修|辅导/.test(combined)) return 'Tutorials'
  if (/\bfinal[\s_-]*project\b|\bgroup[\s_-]*project\b|\bcapstone\b|期末项目|小组项目/.test(combined)) return 'Final Project'
  if (/study[\s_-]*guides?|reading[\s_-]*guides?|review[\s_-]*guides?|complete[\s_-]*guides?|复习指南|导读/.test(combined)) return 'Study_Guides'
  if (/mock[\s_-]*exam|past[\s_-]*paper|sample[\s_-]*exam|midterm[\s_-]*exam|final[\s_-]*exam|模拟卷|往年题/.test(combined)) return 'Mock Exam'
  if (/\bquiz\b|question[\s_-]*bank|测验|题库/.test(combined)) return 'Quiz Review'
  if (/\bassignments?\b|\ba[1-9][ab]?(?:\b|_)|\bhomework\b|\bhw[\s_-]*\d|\bproblem[\s_-]*set\b|\bassessments?\b|\bessay\b|\bproposal\b|\brubric\b|\bmarking\b|peer[\s_-]*review|作业|评估|论文/.test(combined)) {
    return 'Assignments'
  }
  if (/\bseminars?\b|研讨/.test(combined)) return 'Seminar'
  if (/\bannotated\b|批注/.test(combined)) return 'Annotated Slides'
  if (/\.(?:pptx?|key)(?:\b|$|\?)|\bslides?\b|\bdeck\b|课件|幻灯片/.test(combined)) return 'Lecture Slides'
  if (/\blectures?\b|\blessons?\b|\bweek[\s_-]*\d+\b|\bnotes?\b|讲义|笔记/.test(combined)) return 'Lecture Notes'
  return 'Course Materials'
}

const CATEGORY_SYNONYMS = {
  'Tutorials': ['Tutorials', 'Tutorial'],
  'Lecture Slides': ['Lecture Slides', 'Lecture Notes'],
  'Lecture Notes': ['Lecture Notes', 'Lecture Slides'],
  'Python Labs': ['Python Labs', 'Labs', 'Lab'],
  'Labs': ['Labs', 'Python Labs', 'Lab'],
  'Assignments': ['Assignments', 'Assignment', 'Homework', 'Exercise'],
  'Study_Guides': ['Study_Guides', 'Study Guides'],
  'Quiz Review': ['Quiz Review', 'Question Bank'],
  'Mock Exam': ['Mock Exam', 'Past Papers'],
}

export function resolveCourseStorageDirectory(baseDir, options = {}) {
  const mode = options.organizeMode || 'flat'
  if (!mode || mode === 'flat' || !options.course) return { targetDir: baseDir, courseFolder: '', categoryFolder: '' }
  const courseFolder = extractCourseFolderName(options.course)
  const courseDir = join(baseDir, courseFolder)
  if (mode === 'course') return { targetDir: courseDir, courseFolder, categoryFolder: '' }
  const preferred = classifyBglisCategory(options.title, options.filename, options.url)
  let chosen = preferred
  try {
    const entries = readdirSync(courseDir, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name)
    if (entries.length) {
      const norm = s => s.toLowerCase().replace(/[\s_-]+/g, '')
      const candidates = CATEGORY_SYNONYMS[preferred] || [preferred]
      for (const candidate of candidates) {
        const hit = entries.find(dir => norm(dir) === norm(candidate))
        if (hit) { chosen = hit; break }
      }
    }
  } catch { /* courseDir does not exist yet */ }
  return { targetDir: join(courseDir, chosen), courseFolder, categoryFolder: chosen }
}

const MIME_EXTENSION_FALLBACK = [
  [/application\/pdf/i, '.pdf'],
  [/presentationml\.presentation/i, '.pptx'],
  [/ms-powerpoint/i, '.ppt'],
  [/wordprocessingml\.document/i, '.docx'],
  [/msword/i, '.doc'],
  [/spreadsheetml\.sheet/i, '.xlsx'],
  [/ms-excel/i, '.xls'],
  [/text\/csv/i, '.csv'],
  [/application\/zip|x-zip/i, '.zip'],
  [/text\/plain/i, '.txt'],
]

export function normalizeEtagValue(raw) {
  if (!raw) return ''
  return String(raw).trim().replace(/^W\//i, '').replace(/^"+|"+$/g, '').trim()
}

function recoverUtf8HeaderFilename(raw) {
  if (!raw) return ''
  const trimmed = String(raw).trim().replace(/^["']+|["']+$/g, '')
  if (!/[\u0080-\u00ff]/.test(trimmed) || /[\u0100-\uffff]/.test(trimmed)) return trimmed
  try {
    const decoded = Buffer.from(trimmed, 'latin1').toString('utf8')
    if (decoded && !decoded.includes('\ufffd')) return decoded
  } catch { /* keep original */ }
  return trimmed
}

function inferExtensionFromMime(contentType = '') {
  for (const [pattern, ext] of MIME_EXTENSION_FALLBACK) {
    if (pattern.test(contentType)) return ext
  }
  return ''
}

export function buildStableFileSignature({ canonicalUrl = '', etag = '', lastModified = '', uncompressedLength }) {
  const cleanEtag = normalizeEtagValue(etag)
  const lmMs = lastModified ? Date.parse(lastModified) : NaN
  const normLm = Number.isFinite(lmMs) ? String(lmMs) : (lastModified ? String(lastModified).trim() : '')
  // Never include wire Content-Length when ETag or Last-Modified is available:
  // HTTP gzip/chunked responses omit Content-Length on download while Chromium's
  // disk cache synthesizes Content-Length on subsequent probes.
  if (cleanEtag || normLm) {
    return [canonicalUrl, cleanEtag, normLm].join('|')
  }
  return [canonicalUrl, '', '', uncompressedLength ?? ''].join('|')
}

function extractResponseFileMeta(response, finalUrl) {
  const disposition = response.headers.get('content-disposition') || ''
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]?.trim().replace(/^["']+|["']+$/g, '')
  const plainRaw = disposition.match(/filename="([^"]+)"|filename=([^;]+)/i)?.slice(1).find(Boolean)
  let urlFilename = ''
  try { urlFilename = decodeURIComponent(new URL(finalUrl).pathname.split('/').at(-1) || '') } catch { /* ignore */ }
  let filename = ''
  if (encoded) {
    try { filename = decodeURIComponent(encoded) } catch { filename = encoded }
  } else if (plainRaw) {
    filename = recoverUtf8HeaderFilename(plainRaw)
  }
  if (!filename || filename === 'download' || filename.endsWith('.php')) {
    filename = urlFilename || filename || 'download'
  }
  filename = String(filename || 'download').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '') || 'download'
  let ext = extname(filename)
  if (!ext) {
    const inferred = inferExtensionFromMime(response.headers.get('content-type') || '')
    if (inferred) {
      filename = `${filename}${inferred}`
      ext = inferred
    }
  }
  if (filename.length > 160) {
    const stem = filename.slice(0, filename.length - ext.length).slice(0, 140).replace(/[. ]+$/g, '') || 'download'
    filename = `${stem}${ext}`
  }
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename)) filename = `_${filename}`
  let canonicalUrl = finalUrl
  let revision
  try {
    const parsed = new URL(finalUrl)
    parsed.searchParams.delete('forcedownload')
    parsed.searchParams.delete('redirect')
    canonicalUrl = parsed.toString()
    const revMatch = parsed.pathname.match(/\/content\/(\d+)\//)
    if (revMatch) revision = Number(revMatch[1])
  } catch { /* ignore */ }
  const etag = response.headers.get('etag') || undefined
  const cleanEtag = normalizeEtagValue(etag) || undefined
  const lastModified = response.headers.get('last-modified') || undefined
  const contentEncoding = (response.headers.get('content-encoding') || '').trim().toLowerCase()
  const isIdentityEncoding = !contentEncoding || contentEncoding === 'identity'
  const rawLen = Number(response.headers.get('content-length'))
  const wireLength = Number.isFinite(rawLen) && rawLen > 0 ? rawLen : undefined
  const contentLength = isIdentityEncoding ? wireLength : undefined
  const signature = buildStableFileSignature({ canonicalUrl, etag, lastModified, uncompressedLength: contentLength })
  return { filename, canonicalUrl, revision, etag, cleanEtag, lastModified, contentLength, wireLength, isIdentityEncoding, signature }
}

export async function probeMoodleResource(value, fetchPage, parseHtml) {
  const urls = await resolveMoodleDownloads(value, fetchPage, parseHtml)
  const files = []
  for (const fileUrl of urls.slice(0, 60)) {
    const { response, finalUrl } = await fetchMoodleFile(fileUrl, fetchPage)
    const contentType = response.headers.get('content-type') || ''
    await response.body?.cancel().catch(() => {})
    if (/text\/html|application\/xhtml/i.test(contentType)) continue
    files.push(extractResponseFileMeta(response, finalUrl))
  }
  const signature = files.map(f => f.signature).join(';;')
  return { count: files.length, files, signature, checkedAt: new Date().toISOString() }
}

function parseLegacySignatureEntries(rawSignature) {
  if (!rawSignature || typeof rawSignature !== 'string') return []
  return rawSignature
    .split(';;')
    .map(seg => seg.trim())
    .filter(Boolean)
    .map(seg => {
      const [rawUrl = '', rawEtag = '', rawLm = '', rawLen = ''] = seg.split('|')
      let canonicalUrl = rawUrl
      let revision
      try {
        const parsed = new URL(rawUrl)
        parsed.searchParams.delete('forcedownload')
        parsed.searchParams.delete('redirect')
        canonicalUrl = parsed.toString()
        const revMatch = parsed.pathname.match(/\/content\/(\d+)\//)
        if (revMatch) revision = Number(revMatch[1])
      } catch { /* ignore */ }
      const cleanEtag = normalizeEtagValue(rawEtag)
      const lmNum = Number(rawLm)
      const lmMs = Number.isFinite(lmNum) && rawLm !== '' ? lmNum : (rawLm ? Date.parse(rawLm) : NaN)
      const sizeNum = Number(rawLen)
      return {
        canonicalUrl,
        revision,
        cleanEtag,
        lastModifiedMs: Number.isFinite(lmMs) ? lmMs : undefined,
        size: Number.isFinite(sizeNum) && sizeNum > 0 ? sizeNum : undefined,
      }
    })
}

export async function computeFileSha1(filePath, maxBytes = 64 * 1024 * 1024) {
  try {
    const st = await stat(filePath)
    if (!st.isFile() || st.size > maxBytes) return undefined
    const buf = await readFile(filePath)
    return createHash('sha1').update(buf).digest('hex')
  } catch {
    return undefined
  }
}

export function evaluateRemoteResourceUpdate({ probe, savedMeta, localFile }) {
  if (!probe || !Array.isArray(probe.files) || probe.files.length === 0) {
    return { hasRemoteUpdate: false }
  }
  const savedFiles = Array.isArray(savedMeta?.files) && savedMeta.files.length > 0
    ? savedMeta.files.map(f => {
        const lmMs = f.lastModified ? Date.parse(f.lastModified) : NaN
        return {
          canonicalUrl: f.canonicalUrl || '',
          revision: f.revision,
          cleanEtag: normalizeEtagValue(f.cleanEtag || f.etag),
          lastModifiedMs: Number.isFinite(lmMs) ? lmMs : undefined,
          size: typeof f.size === 'number' ? f.size : f.contentLength,
        }
      })
    : parseLegacySignatureEntries(savedMeta?.signature)

  if (savedFiles.length > 0) {
    if (savedFiles.length !== probe.files.length) {
      return { hasRemoteUpdate: true, reason: 'Moodle 文件夹内文件数量已更新' }
    }
    for (let i = 0; i < probe.files.length; i++) {
      const remote = probe.files[i]
      const saved = savedFiles[i]
      const remoteLmMs = remote.lastModified ? Date.parse(remote.lastModified) : NaN
      if (saved.revision !== undefined && remote.revision !== undefined && saved.revision !== remote.revision) {
        return { hasRemoteUpdate: true, reason: `Moodle 远端文件已升级至第 ${remote.revision} 版` }
      }
      if (saved.canonicalUrl && remote.canonicalUrl && saved.canonicalUrl !== remote.canonicalUrl) {
        return { hasRemoteUpdate: true, reason: 'Moodle 远端文件链接或版本已更新' }
      }
      const remoteEtag = normalizeEtagValue(remote.cleanEtag || remote.etag)
      if (saved.cleanEtag && remoteEtag) {
        if (saved.cleanEtag === remoteEtag) continue
        return { hasRemoteUpdate: true, reason: 'Moodle 远端文件内容已更新' }
      }
      if (saved.lastModifiedMs !== undefined && Number.isFinite(remoteLmMs)) {
        if (remoteLmMs > saved.lastModifiedMs + 2000) {
          return { hasRemoteUpdate: true, reason: 'Moodle 远端最后修改时间已更新' }
        }
        continue
      }
      if (typeof saved.size === 'number' && typeof remote.contentLength === 'number' && remote.isIdentityEncoding !== false) {
        if (saved.size !== remote.contentLength) {
          return { hasRemoteUpdate: true, reason: 'Moodle 远端文件大小已变更' }
        }
      }
    }
    return { hasRemoteUpdate: false }
  }

  if (localFile && probe.files.length === 1) {
    const first = probe.files[0]
    const remoteEtag = normalizeEtagValue(first.cleanEtag || first.etag)
    if (remoteEtag && /^[0-9a-f]{40}$/i.test(remoteEtag) && localFile.sha1) {
      if (localFile.sha1.toLowerCase() === remoteEtag.toLowerCase()) {
        return { hasRemoteUpdate: false, verifiedIdentical: true }
      }
    }
    const remoteLmMs = first.lastModified ? Date.parse(first.lastModified) : NaN
    if (Number.isFinite(remoteLmMs) && typeof localFile.mtimeMs === 'number') {
      if (remoteLmMs <= localFile.mtimeMs + 120_000) {
        return { hasRemoteUpdate: false }
      }
      return { hasRemoteUpdate: true, reason: 'Moodle 远端最后修改时间晚于本地文件' }
    }
    if (first.isIdentityEncoding !== false && typeof first.contentLength === 'number' && typeof localFile.size === 'number') {
      if (first.contentLength !== localFile.size) {
        return { hasRemoteUpdate: true, reason: '远端文件大小与本地文件不一致，存在更新版本' }
      }
    }
  }

  return { hasRemoteUpdate: false }
}

async function allocateUniquePath(targetDir, filename) {
  const extension = extname(filename)
  const stem = filename.slice(0, filename.length - extension.length)
  for (let index = 0; index < 1000; index++) {
    const candidate = join(targetDir, index ? `${stem} (${index})${extension}` : filename)
    try {
      const handle = await open(candidate, 'wx')
      return { finalPath: candidate, handle }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
  }
  throw new Error('无法创建下载文件')
}

export async function saveMoodleDownload(url, directory, fetchPage, options = {}) {
  const { response, finalUrl } = await fetchMoodleFile(url, fetchPage)
  if (/text\/html|application\/xhtml/i.test(response.headers.get('content-type') || '') || !response.body) {
    await response.body?.cancel()
    throw new Error('服务器未返回文件，请确认 Moodle 登录状态后重试')
  }
  const meta = extractResponseFileMeta(response, finalUrl)
  const filename = meta.filename
  const { targetDir, courseFolder, categoryFolder } = resolveCourseStorageDirectory(directory, {
    course: options.course,
    title: options.title,
    filename,
    url: finalUrl,
    organizeMode: options.organizeMode,
  })
  await mkdir(targetDir, { recursive: true })
  const hash = createHash('sha256')
  const sha1 = createHash('sha1')
  let writtenBytes = 0
  const totalBytes = meta.contentLength
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null
  if (onProgress) {
    onProgress({ writtenBytes: 0, totalBytes, filename, targetDir })
  }
  const tap = new Transform({
    transform(chunk, _enc, cb) {
      hash.update(chunk)
      sha1.update(chunk)
      writtenBytes += chunk.length
      if (onProgress) onProgress({ writtenBytes, totalBytes, filename, targetDir })
      cb(null, chunk)
    },
  })
  const runPipeline = dest =>
    options.signal
      ? pipeline(Readable.fromWeb(response.body), tap, dest, { signal: options.signal })
      : pipeline(Readable.fromWeb(response.body), tap, dest)
  let finalPath
  if (options.replaceExisting) {
    finalPath = options.targetFilePath || join(targetDir, filename)
    const parentDir = join(finalPath, '..')
    await mkdir(parentDir, { recursive: true })
    const tempPath = join(parentDir, `.myhku-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.part`)
    const handle = await open(tempPath, 'wx')
    try {
      await runPipeline(handle.createWriteStream({ autoClose: true }))
      try {
        await rename(tempPath, finalPath)
      } catch (renameErr) {
        if (renameErr && ['EPERM', 'EACCES', 'EBUSY', 'EXDEV'].includes(renameErr.code)) {
          try {
            await copyFile(tempPath, finalPath)
            await unlink(tempPath).catch(() => {})
          } catch {
            const fallback = await allocateUniquePath(parentDir, basename(finalPath))
            await fallback.handle.close().catch(() => {})
            await copyFile(tempPath, fallback.finalPath)
            await unlink(tempPath).catch(() => {})
            finalPath = fallback.finalPath
          }
        } else {
          throw renameErr
        }
      }
    } catch (error) {
      await handle.close().catch(() => {})
      await unlink(tempPath).catch(() => {})
      throw error
    }
  } else {
    const allocated = await allocateUniquePath(targetDir, filename)
    finalPath = allocated.finalPath
    const handle = allocated.handle
    try {
      await runPipeline(handle.createWriteStream({ autoClose: true }))
    } catch (error) {
      await handle.close().catch(() => {})
      await unlink(finalPath).catch(() => {})
      throw error
    }
  }
  if (options.returnDetailed) {
    return {
      path: finalPath,
      filename,
      courseFolder,
      categoryFolder,
      size: writtenBytes,
      sha256: hash.digest('hex'),
      sha1: sha1.digest('hex'),
      ...meta,
    }
  }
  return finalPath
}

export function normalizeMaterialMatchKey(raw) {
  return String(raw || '')
    .replace(/\.[a-z0-9]{1,6}$/i, '')
    .replace(/\((?:pdf|pptx?|docx?|xlsx?|zip|slides?)\)\s*$/i, '')
    .replace(/\bweek[\s_-]*0*(\d+)\b/gi, 'week$1')
    .replace(/\blesson[\s_-]*0*(\d+)[\s_-]*0*(\d+)\b/gi, 'lesson$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
}

const IGNORED_SCAN_DIRS = new Set(['.git', '.github', '.venv', 'venv', 'node_modules', '__pycache__', '.playwright-mcp', '.impeccable', 'tmp', 'AI Temp'])

export async function scanStorageDirectory(storageDir, maxFiles = 5000) {
  const root = String(storageDir || '').trim()
  if (!root) return { root: '', exists: false, courses: [], files: [] }
  let rootStat
  try { rootStat = await stat(root) } catch { return { root, exists: false, courses: [], files: [] } }
  if (!rootStat.isDirectory()) return { root, exists: false, courses: [], files: [] }
  const courses = []
  const files = []
  async function walk(currentDir, depth, courseFolder, categoryFolder) {
    if (files.length >= maxFiles || depth > 3) return
    let entries
    try { entries = await readdir(currentDir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (files.length >= maxFiles) break
      if (entry.name.startsWith('.') || IGNORED_SCAN_DIRS.has(entry.name)) continue
      const fullPath = join(currentDir, entry.name)
      if (entry.isDirectory()) {
        const nextCourse = depth === 0 ? entry.name : courseFolder
        const nextCategory = depth === 1 ? entry.name : categoryFolder
        if (depth === 0) courses.push(entry.name)
        await walk(fullPath, depth + 1, nextCourse, nextCategory)
      } else if (entry.isFile()) {
        try {
          const st = await stat(fullPath)
          const rel = relative(root, fullPath)
          files.push({
            path: fullPath,
            relativePath: rel,
            courseFolder,
            categoryFolder,
            filename: basename(fullPath),
            normalizedKey: normalizeMaterialMatchKey(entry.name),
            size: st.size,
            mtimeMs: Math.round(st.mtimeMs),
          })
        } catch { /* ignore transient file */ }
      }
    }
  }
  await walk(root, 0, '', '')
  return { root, exists: true, courses: courses.sort(), files }
}
