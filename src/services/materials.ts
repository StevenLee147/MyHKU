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
export const DOWNLOADED_INDEX_KEY = 'myhku-downloaded-index'

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

export function clearMaterialsState(): void {
  for (const key of [PINNED_RESOURCES_KEY, SEEN_RESOURCES_KEY, NEW_RESOURCES_KEY, DOWNLOADED_INDEX_KEY]) {
    try {
      localStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  }
}
