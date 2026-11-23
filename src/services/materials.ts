import type { LiveResource } from './hku'

export type ResourceKind = 'pdf' | 'slides' | 'doc' | 'sheet' | 'archive' | 'folder' | 'link' | 'file'

export const RESOURCE_KIND_LABELS: Record<ResourceKind, string> = {
  pdf: 'PDF',
  slides: 'Slides',
  doc: 'Word',
  sheet: 'Excel',
  archive: 'ZIP',
  folder: '文件夹',
  link: '链接',
  file: '文件',
}

export const PINNED_RESOURCES_KEY = 'myhku-pinned-resources'
export const SEEN_RESOURCES_KEY = 'myhku-seen-resources'
export const NEW_RESOURCES_KEY = 'myhku-new-resources'
export const UPDATED_RESOURCES_KEY = 'myhku-updated-resources'
export const RESOURCE_META_KEY = 'myhku-resource-meta-v1'
export const DOWNLOADED_INDEX_KEY = 'myhku-downloaded-index'
export const WEB_STORAGE_PREFS_KEY = 'myhku-storage-prefs'

export type OrganizeMode = 'bglis' | 'course' | 'flat'

export type ScannedCourseFileItem = {
  path: string
  relativePath: string
  courseFolder: string
  categoryFolder: string
  filename: string
  normalizedKey: string
  size: number
  mtimeMs: number
}

export type MaterialUpdateRecord = {
  id: string
  reason: string
  detectedAt: string
  previousTitle?: string
  remoteSignature?: string
}

type StoredResourceMeta = {
  title: string
  url?: string
  course: string
  remoteSignature?: string
  downloadedSignature?: string
  seenAt: string
}

export const ORGANIZE_MODE_LABELS: Record<OrganizeMode, { zh: string; en: string; hintZh: string; hintEn: string }> = {
  bglis: {
    zh: '课程 + 分类归档',
    en: 'Course + Category',
    hintZh: '如 GLIS1901 / Lecture Notes、Tutorials、Assignments',
    hintEn: 'e.g. GLIS1901 / Lecture Notes, Tutorials, Assignments',
  },
  course: {
    zh: '仅按课程归档',
    en: 'Course Folder Only',
    hintZh: '如 GLIS1901 / 文件名.pdf',
    hintEn: 'e.g. GLIS1901 / filename.pdf',
  },
  flat: {
    zh: '单层目录平铺',
    en: 'Flat Folder',
    hintZh: '所有下载文件直接保存在所选根目录',
    hintEn: 'Save all files directly inside the chosen directory',
  },
}

export function isDirectDownloadableUrl(rawUrl?: string): boolean {
  if (!rawUrl) return false
  try {
    const u = new URL(rawUrl)
    return u.protocol === 'https:' && (u.hostname === 'hku.hk' || u.hostname.endsWith('.hku.hk')) &&
      /\/(?:mod\/(?:resource|folder)\/|pluginfile\.php\/)/.test(u.pathname)
  } catch {
    return false
  }
}

export function classifyResourceKind(title: string, rawUrl?: string): ResourceKind {
  const text = `${title} ${rawUrl || ''}`.toLowerCase()
  if (rawUrl) {
    try {
      const pathname = new URL(rawUrl).pathname.toLowerCase()
      if (pathname.includes('/mod/folder/')) return 'folder'
      if (pathname.includes('/mod/url/') || pathname.includes('/mod/page/')) return 'link'
      if (/\.pdf(?:$|\?)/.test(pathname)) return 'pdf'
      if (/\.(?:pptx?|key)(?:$|\?)/.test(pathname)) return 'slides'
      if (/\.(?:docx?|rtf)(?:$|\?)/.test(pathname)) return 'doc'
      if (/\.(?:xlsx?|csv)(?:$|\?)/.test(pathname)) return 'sheet'
      if (/\.(?:zip|rar|7z|tar|gz)(?:$|\?)/.test(pathname)) return 'archive'
    } catch {
      /* ignore malformed URL */
    }
  }
  if (/\bpdf\b|\.pdf\b/.test(text)) return 'pdf'
  if (/\b(?:slides?|ppt|pptx|deck|lecture\s*\d+|week\s*\d+\s*slides?)\b|课件|幻灯片|讲义/.test(text)) return 'slides'
  if (/\b(?:docx?|word|syllabus|outline|guideline|rubric)\b|大纲/.test(text)) return 'doc'
  if (/\b(?:xlsx?|excel|csv|dataset|spreadsheet)\b|表格|数据/.test(text)) return 'sheet'
  if (/\b(?:zip|archive|code\s*pack|starter)\b|压缩/.test(text)) return 'archive'
  return isDirectDownloadableUrl(rawUrl) ? 'file' : 'link'
}

function readStringSet(key: string): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(parsed) ? new Set(parsed.filter((x): x is string => typeof x === 'string')) : new Set()
  } catch {
    return new Set()
  }
}

function writeStringSet(key: string, values: Iterable<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...values].slice(0, 2000)))
  } catch {
    /* ignore */
  }
}

export function getPinnedResourceIds(): Set<string> {
  return readStringSet(PINNED_RESOURCES_KEY)
}

export function togglePinnedResource(id: string): Set<string> {
  const next = getPinnedResourceIds()
  if (next.has(id)) next.delete(id)
  else next.add(id)
  writeStringSet(PINNED_RESOURCES_KEY, next)
  return next
}

export function evaluateNewResources(resources: LiveResource[]): Set<string> {
  if (!resources.length) return readStringSet(NEW_RESOURCES_KEY)
  const rawSeen = localStorage.getItem(SEEN_RESOURCES_KEY)
  const currentIds = resources.map(r => r.id).filter(Boolean)
  if (rawSeen === null) {
    // Establish initial baseline without flooding NEW badges on first sync.
    writeStringSet(SEEN_RESOURCES_KEY, currentIds)
    writeStringSet(NEW_RESOURCES_KEY, [])
    return new Set()
  }
  const seen = readStringSet(SEEN_RESOURCES_KEY)
  const newSet = readStringSet(NEW_RESOURCES_KEY)
  for (const id of currentIds) {
    if (!seen.has(id)) {
      seen.add(id)
      newSet.add(id)
    }
  }
  writeStringSet(SEEN_RESOURCES_KEY, seen)
  writeStringSet(NEW_RESOURCES_KEY, newSet)
  return newSet
}

export function markResourceOpened(id: string): Set<string> {
  const newSet = readStringSet(NEW_RESOURCES_KEY)
  if (newSet.delete(id)) writeStringSet(NEW_RESOURCES_KEY, newSet)
  return newSet
}

export function markAllResourcesSeen(): Set<string> {
  writeStringSet(NEW_RESOURCES_KEY, [])
  return new Set()
}

export function getLocalDownloadedIndex(): Record<string, string[]> {
  try {
    const raw = JSON.parse(localStorage.getItem(DOWNLOADED_INDEX_KEY) || '{}')
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out: Record<string, string[]> = {}
    for (const [key, val] of Object.entries(raw)) {
      if (Array.isArray(val)) {
        const paths = val.filter((p): p is string => typeof p === 'string' && p.length > 0)
        if (paths.length) out[key] = paths
      }
    }
    return out
  } catch {
    return {}
  }
}

export function recordLocalDownloadedPaths(key: string, paths: string[]): Record<string, string[]> {
  const current = getLocalDownloadedIndex()
  if (paths.length > 0) {
    current[key] = paths
    try {
      localStorage.setItem(DOWNLOADED_INDEX_KEY, JSON.stringify(current))
    } catch {
      /* ignore */
    }
  }
  return current
}

export function extractCourseCodeFolder(courseText: string): string {
  const text = String(courseText || '').trim()
  const codeMatch = text.match(/\b([A-Z]{3,6})\s*-?\s*(\d{4}[A-Z]?)(?:-[0-9A-Z]+)?\b/i)
  if (codeMatch) return `${codeMatch[1].toUpperCase()}${codeMatch[2].toUpperCase()}`
  const cleaned = text.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 72)
  return cleaned || 'Uncategorized_Course'
}

export function classifyBglisCategory(title: string, rawUrl?: string): string {
  const combined = `${title} ${rawUrl || ''}`.toLowerCase()
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

export function previewArchiveSubpath(
  course: string,
  title: string,
  rawUrl?: string,
  organizeMode: OrganizeMode = 'bglis',
): string {
  if (organizeMode === 'flat') return ''
  const courseFolder = extractCourseCodeFolder(course)
  if (organizeMode === 'course') return courseFolder
  return `${courseFolder} / ${classifyBglisCategory(title, rawUrl)}`
}

export function normalizeMaterialMatchKey(raw: string): string {
  return String(raw || '')
    .replace(/\.[a-z0-9]{1,6}$/i, '')
    .replace(/\((?:pdf|pptx?|docx?|xlsx?|zip|slides?)\)\s*$/i, '')
    .replace(/\bweek[\s_-]*0*(\d+)\b/gi, 'week$1')
    .replace(/\blesson[\s_-]*0*(\d+)[\s_-]*0*(\d+)\b/gi, 'lesson$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
}

function stripLeadingCourseKey(normalized: string, courseCode: string): string {
  const prefix = courseCode.toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (prefix && normalized.startsWith(prefix) && normalized.length > prefix.length) {
    return normalized.slice(prefix.length)
  }
  return normalized
}

export function matchResourceToLocalFile(
  resource: LiveResource,
  scannedFiles: ScannedCourseFileItem[],
): ScannedCourseFileItem | undefined {
  if (!scannedFiles.length) return undefined
  const courseFolder = extractCourseCodeFolder(resource.course)
  const courseKey = courseFolder.toLowerCase()
  const titleKey = normalizeMaterialMatchKey(resource.title)
  const strippedTitleKey = stripLeadingCourseKey(titleKey, courseFolder)
  let urlFileKey = ''
  if (resource.url) {
    try {
      const u = new URL(resource.url)
      if (u.pathname.includes('/pluginfile.php/')) {
        const seg = decodeURIComponent(u.pathname.split('/').pop() || '')
        urlFileKey = normalizeMaterialMatchKey(seg)
      }
    } catch { /* ignore */ }
  }
  const inCourse = scannedFiles.filter(f => !f.courseFolder || f.courseFolder.toLowerCase() === courseKey)
  const pool = inCourse.length ? inCourse : scannedFiles
  for (const file of pool) {
    const fileKey = file.normalizedKey || normalizeMaterialMatchKey(file.filename)
    if (!fileKey) continue
    const strippedFileKey = stripLeadingCourseKey(fileKey, courseFolder)
    if (urlFileKey && (fileKey === urlFileKey || strippedFileKey === stripLeadingCourseKey(urlFileKey, courseFolder))) {
      return file
    }
    if (titleKey && (fileKey === titleKey || strippedFileKey === strippedTitleKey)) {
      return file
    }
  }
  return undefined
}

function readResourceMetaMap(): Record<string, StoredResourceMeta> {
  try {
    const raw = JSON.parse(localStorage.getItem(RESOURCE_META_KEY) || '{}')
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, StoredResourceMeta>) : {}
  } catch {
    return {}
  }
}

function writeResourceMetaMap(map: Record<string, StoredResourceMeta>): void {
  try {
    localStorage.setItem(RESOURCE_META_KEY, JSON.stringify(map))
  } catch { /* ignore */ }
}

export function getUpdatedResourcesMap(): Record<string, MaterialUpdateRecord> {
  try {
    const raw = JSON.parse(localStorage.getItem(UPDATED_RESOURCES_KEY) || '{}')
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, MaterialUpdateRecord>) : {}
  } catch {
    return {}
  }
}

function writeUpdatedResourcesMap(map: Record<string, MaterialUpdateRecord>): void {
  try {
    localStorage.setItem(UPDATED_RESOURCES_KEY, JSON.stringify(map))
  } catch { /* ignore */ }
}

export function evaluateResourceSnapshotDiff(resources: LiveResource[]): {
  newIds: Set<string>
  updatedMap: Record<string, MaterialUpdateRecord>
} {
  const nowIso = new Date().toISOString()
  if (!resources.length) {
    return { newIds: readStringSet(NEW_RESOURCES_KEY), updatedMap: getUpdatedResourcesMap() }
  }
  const rawSeen = localStorage.getItem(SEEN_RESOURCES_KEY)
  const metaMap = readResourceMetaMap()
  const updatedMap = getUpdatedResourcesMap()
  if (rawSeen === null) {
    const ids: string[] = []
    for (const r of resources) {
      if (!r.id) continue
      ids.push(r.id)
      metaMap[r.id] = { title: r.title, url: r.url, course: r.course, seenAt: nowIso }
    }
    writeStringSet(SEEN_RESOURCES_KEY, ids)
    writeStringSet(NEW_RESOURCES_KEY, [])
    writeResourceMetaMap(metaMap)
    return { newIds: new Set(), updatedMap }
  }
  const seen = readStringSet(SEEN_RESOURCES_KEY)
  const newSet = readStringSet(NEW_RESOURCES_KEY)
  for (const r of resources) {
    if (!r.id) continue
    const prev = metaMap[r.id]
    if (!seen.has(r.id)) {
      seen.add(r.id)
      newSet.add(r.id)
      metaMap[r.id] = { title: r.title, url: r.url, course: r.course, seenAt: nowIso }
    } else if (prev) {
      const titleChanged = prev.title && prev.title !== r.title
      const urlChanged = Boolean(prev.url && r.url && prev.url !== r.url)
      if (titleChanged || urlChanged) {
        updatedMap[r.id] = {
          id: r.id,
          reason: titleChanged ? `标题已更新（原：${prev.title}）` : 'Moodle 资源链接已更新',
          detectedAt: nowIso,
          ...(titleChanged ? { previousTitle: prev.title } : {}),
        }
        newSet.delete(r.id)
      }
      metaMap[r.id] = { ...prev, title: r.title, url: r.url, course: r.course }
    } else {
      metaMap[r.id] = { title: r.title, url: r.url, course: r.course, seenAt: nowIso }
    }
  }
  writeStringSet(SEEN_RESOURCES_KEY, seen)
  writeStringSet(NEW_RESOURCES_KEY, newSet)
  writeResourceMetaMap(metaMap)
  writeUpdatedResourcesMap(updatedMap)
  return { newIds: newSet, updatedMap }
}

export function mergeRemoteUpdateProbes(
  probes: Record<string, { signature: string; hasRemoteUpdate: boolean; reason?: string; checkedAt: string }>,
): Record<string, MaterialUpdateRecord> {
  const metaMap = readResourceMetaMap()
  const updatedMap = getUpdatedResourcesMap()
  for (const [id, probe] of Object.entries(probes)) {
    if (!probe || !probe.signature) continue
    const prev = metaMap[id]
    const signatureDiffers =
      Boolean(prev?.downloadedSignature && prev.downloadedSignature !== probe.signature) ||
      Boolean(prev?.remoteSignature && prev.remoteSignature !== probe.signature)
    if (probe.hasRemoteUpdate || signatureDiffers) {
      updatedMap[id] = {
        id,
        reason: probe.reason || 'Moodle 远端文件版本已更新',
        detectedAt: probe.checkedAt || new Date().toISOString(),
        remoteSignature: probe.signature,
      }
    }
    if (prev) {
      metaMap[id] = { ...prev, remoteSignature: probe.signature }
    }
  }
  writeResourceMetaMap(metaMap)
  writeUpdatedResourcesMap(updatedMap)
  return updatedMap
}

export function markResourceSynced(id: string, signature?: string): {
  newIds: Set<string>
  updatedMap: Record<string, MaterialUpdateRecord>
} {
  const newIds = markResourceOpened(id)
  const updatedMap = getUpdatedResourcesMap()
  if (updatedMap[id]) {
    delete updatedMap[id]
    writeUpdatedResourcesMap(updatedMap)
  }
  if (signature) {
    const metaMap = readResourceMetaMap()
    if (metaMap[id]) {
      metaMap[id] = { ...metaMap[id], remoteSignature: signature, downloadedSignature: signature }
      writeResourceMetaMap(metaMap)
    }
  }
  return { newIds, updatedMap }
}

export function markAllMaterialsReadAndAck(): {
  newIds: Set<string>
  updatedMap: Record<string, MaterialUpdateRecord>
} {
  const newIds = markAllResourcesSeen()
  writeUpdatedResourcesMap({})
  return { newIds, updatedMap: {} }
}

export function getWebFallbackStoragePrefs(): { organizeMode: OrganizeMode } {
  try {
    const raw = JSON.parse(localStorage.getItem(WEB_STORAGE_PREFS_KEY) || '{}')
    if (raw?.organizeMode === 'bglis' || raw?.organizeMode === 'course' || raw?.organizeMode === 'flat') {
      return { organizeMode: raw.organizeMode }
    }
  } catch { /* ignore */ }
  return { organizeMode: 'bglis' }
}

export function setWebFallbackStoragePrefs(organizeMode: OrganizeMode): void {
  try {
    localStorage.setItem(WEB_STORAGE_PREFS_KEY, JSON.stringify({ organizeMode }))
  } catch { /* ignore */ }
}

export function clearMaterialsState(): void {
  for (const key of [
    PINNED_RESOURCES_KEY,
    SEEN_RESOURCES_KEY,
    NEW_RESOURCES_KEY,
    UPDATED_RESOURCES_KEY,
    RESOURCE_META_KEY,
    DOWNLOADED_INDEX_KEY,
  ]) {
    try {
      localStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  }
}
