import { open, mkdir, readdir, rename, stat, unlink } from 'node:fs/promises'
import { readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, extname, join, relative } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export function moodleDownloadUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.hostname !== 'moodle.hku.hk' || url.username || url.password ||
      !/^\/(?:pluginfile\.php\/|mod\/(?:resource|folder)\/(?:view|download_folder)\.php$)/.test(url.pathname)) {
    throw new Error('此链接不是 Moodle 文件资料')
  }
  return url
}

// Runs in an isolated DOM parser. No remote HTML is inserted into the page.
export function fileLinksFromHtml(html, base) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  if (doc.querySelector('input[type="password"]')) return []
  const candidates = [...doc.querySelectorAll('a[href], object[data], embed[src], iframe[src]')]
    .map(node => node.getAttribute('href') || node.getAttribute('data') || node.getAttribute('src'))
    .map(value => { try { return new URL(value, base).href } catch { return '' } })
    .filter(value => {
      try {
        const url = new URL(value)
        return url.protocol === 'https:' && url.hostname === 'moodle.hku.hk' &&
          /^\/(?:pluginfile\.php\/|mod\/folder\/download_folder\.php$)/.test(url.pathname)
      } catch { return false }
    })
  return [...new Set(candidates)]
}

async function fetchMoodleFile(value, fetchPage) {
  let target = moodleDownloadUrl(value)
  let response
  for (let hop = 0; hop < 6; hop++) {
    response = await fetchPage(target.href)
    if (![301, 302, 303, 307, 308].includes(response.status)) break
    const next = response.headers.get('location')
    await response.body?.cancel()
    try { if (!next) throw new Error('missing redirect'); target = moodleDownloadUrl(new URL(next, target).href) }
    catch { throw new Error('Moodle 会话已过期，请在设置中重新连接') }
  }
  if (!response.ok) throw new Error(`资料读取失败（HTTP ${response.status}）`)
  // A redirected login page must never be saved as a document.
  // Electron's custom protocol responses may omit Response.url. Requests use
  // manual redirects, so target remains the verified final request address.
  const finalUrl = response.url || target.href
  try { moodleDownloadUrl(finalUrl) } catch { throw new Error('Moodle 会话已过期，请在设置中重新连接') }
  return { response, finalUrl }
}

export async function resolveMoodleDownloads(value, fetchPage, parseHtml) {
  const url = moodleDownloadUrl(value)
  if (url.pathname.startsWith('/pluginfile.php/') || url.pathname.endsWith('/download_folder.php')) {
    url.searchParams.set('forcedownload', '1')
    return [url.href]
  }
  const { response, finalUrl } = await fetchMoodleFile(url.href, fetchPage)
  const type = response.headers.get('content-type') || ''
  if (!/text\/html|application\/xhtml/i.test(type)) {
    await response.body?.cancel()
    return [moodleDownloadUrl(finalUrl).href]
  }
  const links = await parseHtml(await response.text(), finalUrl)
  const files = links.map(link => moodleDownloadUrl(link)).map(link => {
    link.searchParams.set('forcedownload', '1')
    return link.href
  })
  if (!files.length) throw new Error('未找到可下载文件，请确认 Moodle 登录状态或刷新资料')
  return files
}

export function sanitizePathSegment(value, fallback = 'General') {
  let cleaned = String(value || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '').slice(0, 96)
  if (!cleaned) cleaned = fallback
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned)) cleaned = `_${cleaned}`
  return cleaned
}

export function extractCourseFolderName(courseText) {
  const text = String(courseText || '').trim()
  const codeMatch = text.match(/\b([A-Z]{3,6})\s*-?\s*(\d{4}[A-Z]?)(?:-[0-9A-Z]+)?\b/i)
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

function extractResponseFileMeta(response, finalUrl) {
  const disposition = response.headers.get('content-disposition') || ''
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  let filename = disposition.match(/filename="([^"]+)"|filename=([^;]+)/i)?.slice(1).find(Boolean)
  try { filename = encoded ? decodeURIComponent(encoded) : filename || decodeURIComponent(new URL(finalUrl).pathname.split('/').at(-1)) } catch { /* keep plain */ }
  filename = (filename || 'download').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 180) || 'download'
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename)) filename = `_${filename}`
  let canonicalUrl = finalUrl
  let revision
  try {
    const parsed = new URL(finalUrl)
    parsed.searchParams.delete('forcedownload')
    canonicalUrl = parsed.toString()
    const revMatch = parsed.pathname.match(/\/content\/(\d+)\//)
    if (revMatch) revision = Number(revMatch[1])
  } catch { /* ignore */ }
  const etag = response.headers.get('etag') || undefined
  const lastModified = response.headers.get('last-modified') || undefined
  const rawLen = Number(response.headers.get('content-length'))
  const contentLength = Number.isFinite(rawLen) && rawLen > 0 ? rawLen : undefined
  const signature = [canonicalUrl, etag || '', lastModified || '', contentLength ?? ''].join('|')
  return { filename, canonicalUrl, revision, etag, lastModified, contentLength, signature }
}

export async function probeMoodleResource(value, fetchPage, parseHtml) {
  const urls = await resolveMoodleDownloads(value, fetchPage, parseHtml)
  const files = []
  for (const fileUrl of urls.slice(0, 12)) {
    const { response, finalUrl } = await fetchMoodleFile(fileUrl, fetchPage)
    const contentType = response.headers.get('content-type') || ''
    await response.body?.cancel().catch(() => {})
    if (/text\/html|application\/xhtml/i.test(contentType)) continue
    files.push(extractResponseFileMeta(response, finalUrl))
  }
  const signature = files.map(f => f.signature).join(';;')
  return { count: files.length, files, signature, checkedAt: new Date().toISOString() }
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
  let writtenBytes = 0
  const tap = new Transform({
    transform(chunk, _enc, cb) {
      hash.update(chunk)
      writtenBytes += chunk.length
      cb(null, chunk)
    },
  })
  let finalPath
  if (options.replaceExisting) {
    finalPath = options.targetFilePath || join(targetDir, filename)
    await mkdir(join(finalPath, '..'), { recursive: true })
    const tempPath = `${finalPath}.${process.pid}.${Date.now()}.part`
    const handle = await open(tempPath, 'wx')
    try {
      await pipeline(Readable.fromWeb(response.body), tap, handle.createWriteStream())
      await rename(tempPath, finalPath)
    } catch (error) {
      await handle.close().catch(() => {})
      await unlink(tempPath).catch(() => {})
      throw error
    }
  } else {
    const extension = extname(filename)
    const stem = filename.slice(0, filename.length - extension.length)
    let handle
    for (let index = 0; index < 1000; index++) {
      finalPath = join(targetDir, index ? `${stem} (${index})${extension}` : filename)
      try { handle = await open(finalPath, 'wx'); break } catch (error) { if (error.code !== 'EEXIST') throw error }
    }
    if (!handle) throw new Error('无法创建下载文件')
    try {
      await pipeline(Readable.fromWeb(response.body), tap, handle.createWriteStream())
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
