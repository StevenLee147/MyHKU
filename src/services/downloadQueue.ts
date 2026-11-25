import type { DataMode, LiveResource } from './hku'
import {
  classifyBglisCategory,
  extractCourseCodeFolder,
  markResourceSynced,
  recordLocalDownloadedPaths,
  type OrganizeMode,
} from './materials'

export type DownloadTaskStatus = 'queued' | 'downloading' | 'completed' | 'failed' | 'cancelled'

export type DownloadQueueItem = {
  taskId: string
  resourceId: string
  title: string
  course: string
  courseCode: string
  categoryFolder: string
  url: string
  organizeMode: OrganizeMode
  replaceExisting: boolean
  targetFilePath?: string
  dataMode: DataMode
  status: DownloadTaskStatus
  phase?: 'resolving' | 'downloading' | 'completed' | 'error' | 'cancelled'
  currentFilename?: string
  fileIndex?: number
  fileCount?: number
  transferredBytes: number
  totalBytes?: number
  savedPaths: string[]
  savedDirectory?: string
  signature?: string
  error?: string
  createdAt: string
  startedAt?: string
  completedAt?: string
}

export type DownloadQueueSnapshot = {
  items: DownloadQueueItem[]
  paused: boolean
  activeCount: number
  queuedCount: number
  completedCount: number
  failedCount: number
  totalCompletedBytes: number
}

export type EnqueueDownloadInput = {
  resource: LiveResource
  url: string
  organizeMode?: OrganizeMode
  replaceExisting?: boolean
  targetFilePath?: string
  dataMode?: DataMode
}

export type DownloadCompletionEvent = {
  item: DownloadQueueItem
  paths: string[]
  signature?: string
}

const DOWNLOAD_QUEUE_STORAGE_KEY = 'myhku-download-queue-v1'
const MAX_PERSISTED_ITEMS = 200
const MAX_CONCURRENCY = 2

let queueItems: DownloadQueueItem[] = loadPersistedQueue()
let queuePaused = false
let runningWorkers = 0
let progressListenerBound = false
let cachedSnapshot: DownloadQueueSnapshot = computeSnapshot(queueItems, queuePaused)

const stateListeners = new Set<() => void>()
const completionListeners = new Set<(event: DownloadCompletionEvent) => void>()

function loadPersistedQueue(): DownloadQueueItem[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = JSON.parse(localStorage.getItem(DOWNLOAD_QUEUE_STORAGE_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    return raw
      .filter((x): x is DownloadQueueItem => Boolean(x && typeof x === 'object' && typeof x.taskId === 'string' && typeof x.url === 'string'))
      .slice(0, MAX_PERSISTED_ITEMS)
      .map(item => {
        if (item.status === 'downloading' || item.status === 'queued') {
          return {
            ...item,
            status: 'cancelled' as const,
            phase: 'cancelled' as const,
            error: '应用重启前尚未完成，可点击重试继续下载',
          }
        }
        return item
      })
  } catch {
    return []
  }
}

function persistQueue(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(DOWNLOAD_QUEUE_STORAGE_KEY, JSON.stringify(queueItems.slice(0, MAX_PERSISTED_ITEMS)))
  } catch {
    /* ignore quota errors */
  }
}

function computeSnapshot(items: DownloadQueueItem[], paused: boolean): DownloadQueueSnapshot {
  let activeCount = 0
  let queuedCount = 0
  let completedCount = 0
  let failedCount = 0
  let totalCompletedBytes = 0
  for (const item of items) {
    if (item.status === 'downloading') activeCount += 1
    else if (item.status === 'queued') queuedCount += 1
    else if (item.status === 'completed') {
      completedCount += 1
      totalCompletedBytes += item.transferredBytes || 0
    } else if (item.status === 'failed') failedCount += 1
  }
  return {
    items,
    paused,
    activeCount,
    queuedCount,
    completedCount,
    failedCount,
    totalCompletedBytes,
  }
}

function emitQueueChange(): void {
  cachedSnapshot = computeSnapshot(queueItems, queuePaused)
  persistQueue()
  for (const listener of stateListeners) {
    try {
      listener()
    } catch {
      /* ignore listener errors */
    }
  }
}

function bindNativeProgressOnce(): void {
  if (progressListenerBound || typeof window === 'undefined') return
  if (!window.myhkuDesktop?.onDownloadProgress) return
  progressListenerBound = true
  window.myhkuDesktop.onDownloadProgress(payload => {
    if (!payload?.taskId) return
    const idx = queueItems.findIndex(item => item.taskId === payload.taskId)
    if (idx < 0) return
    const current = queueItems[idx]
    if (current.status === 'completed' || current.status === 'cancelled') return
    const next: DownloadQueueItem = {
      ...current,
      phase: payload.phase,
      ...(payload.fileIndex !== undefined ? { fileIndex: payload.fileIndex } : {}),
      ...(payload.fileCount !== undefined ? { fileCount: payload.fileCount } : {}),
      ...(payload.currentFilename ? { currentFilename: payload.currentFilename } : {}),
      ...(typeof payload.transferredBytes === 'number' ? { transferredBytes: payload.transferredBytes } : {}),
      ...(typeof payload.totalBytes === 'number' && payload.totalBytes > 0 ? { totalBytes: payload.totalBytes } : {}),
      ...(payload.targetDir ? { savedDirectory: payload.targetDir } : {}),
    }
    queueItems = [...queueItems.slice(0, idx), next, ...queueItems.slice(idx + 1)]
    cachedSnapshot = computeSnapshot(queueItems, queuePaused)
    for (const listener of stateListeners) {
      try {
        listener()
      } catch {
        /* ignore */
      }
    }
  })
}

function updateTask(taskId: string, updater: (prev: DownloadQueueItem) => DownloadQueueItem): DownloadQueueItem | undefined {
  const idx = queueItems.findIndex(item => item.taskId === taskId)
  if (idx < 0) return undefined
  const updated = updater(queueItems[idx])
  queueItems = [...queueItems.slice(0, idx), updated, ...queueItems.slice(idx + 1)]
  emitQueueChange()
  return updated
}

async function executeTask(task: DownloadQueueItem): Promise<void> {
  bindNativeProgressOnce()
  const nowIso = new Date().toISOString()
  const started = updateTask(task.taskId, prev => ({
    ...prev,
    status: 'downloading',
    phase: 'resolving',
    startedAt: nowIso,
    error: undefined,
  }))
  if (!started) return

  try {
    if (typeof window !== 'undefined' && window.myhkuDesktop?.downloadResourceDetailed) {
      const result = await window.myhkuDesktop.downloadResourceDetailed({
        taskId: task.taskId,
        url: task.url,
        course: task.course,
        title: task.title,
        organizeMode: task.organizeMode,
        replaceExisting: task.replaceExisting,
        targetFilePath: task.targetFilePath,
      })
      const paths = result.paths || []
      if (paths.length > 0) {
        recordLocalDownloadedPaths(task.resourceId, paths)
        recordLocalDownloadedPaths(task.url, paths)
      }
      markResourceSynced(task.resourceId, result.signature)
      const bytes =
        typeof result.totalBytes === 'number'
          ? result.totalBytes
          : (result.files || []).reduce((sum, f) => sum + (f.size || 0), 0)
      const finished = updateTask(task.taskId, prev => ({
        ...prev,
        status: 'completed',
        phase: 'completed',
        savedPaths: paths,
        savedDirectory: result.directory || prev.savedDirectory,
        signature: result.signature,
        fileCount: result.count || paths.length,
        fileIndex: result.count || paths.length,
        transferredBytes: bytes || prev.transferredBytes,
        totalBytes: bytes || prev.totalBytes,
        completedAt: new Date().toISOString(),
        error: undefined,
      }))
      if (finished) {
        for (const cb of completionListeners) {
          try { cb({ item: finished, paths, signature: result.signature }) } catch { /* ignore */ }
        }
      }
      return
    }

    if (typeof window !== 'undefined' && window.myhkuDesktop?.downloadResource) {
      await window.myhkuDesktop.downloadResource(task.url)
      const marker = [`downloaded:${task.url}`]
      recordLocalDownloadedPaths(task.resourceId, marker)
      recordLocalDownloadedPaths(task.url, marker)
      markResourceSynced(task.resourceId)
      const finished = updateTask(task.taskId, prev => ({
        ...prev,
        status: 'completed',
        phase: 'completed',
        savedPaths: marker,
        fileCount: 1,
        fileIndex: 1,
        completedAt: new Date().toISOString(),
        error: undefined,
      }))
      if (finished) {
        for (const cb of completionListeners) {
          try { cb({ item: finished, paths: marker }) } catch { /* ignore */ }
        }
      }
      return
    }

    if (typeof window !== 'undefined' && window.myhkuAndroid?.downloadResource) {
      const ok = window.myhkuAndroid.downloadResource(task.url)
      if (!ok) throw new Error('系统下载启动失败，请确认 Moodle 已登录')
      const marker = [`android:${task.url}`]
      recordLocalDownloadedPaths(task.resourceId, marker)
      recordLocalDownloadedPaths(task.url, marker)
      markResourceSynced(task.resourceId)
      const finished = updateTask(task.taskId, prev => ({
        ...prev,
        status: 'completed',
        phase: 'completed',
        savedPaths: marker,
        fileCount: 1,
        fileIndex: 1,
        completedAt: new Date().toISOString(),
        error: undefined,
      }))
      if (finished) {
        for (const cb of completionListeners) {
          try { cb({ item: finished, paths: marker }) } catch { /* ignore */ }
        }
      }
      return
    }

    if (task.dataMode === 'demo') {
      const simulatedTotal = 1_240_000
      updateTask(task.taskId, prev => ({
        ...prev,
        phase: 'downloading',
        fileIndex: 1,
        fileCount: 1,
        transferredBytes: 540_000,
        totalBytes: simulatedTotal,
      }))
      await new Promise(resolve => setTimeout(resolve, 260))
      const currentCheck = queueItems.find(item => item.taskId === task.taskId)
      if (!currentCheck || currentCheck.status === 'cancelled') return
      const demoMarker = [`downloaded:${task.url}`]
      recordLocalDownloadedPaths(task.resourceId, demoMarker)
      markResourceSynced(task.resourceId)
      const finished = updateTask(task.taskId, prev => ({
        ...prev,
        status: 'completed',
        phase: 'completed',
        savedPaths: demoMarker,
        savedDirectory: prev.categoryFolder ? `${prev.courseCode}/${prev.categoryFolder}` : prev.courseCode,
        fileCount: 1,
        fileIndex: 1,
        transferredBytes: simulatedTotal,
        totalBytes: simulatedTotal,
        completedAt: new Date().toISOString(),
      }))
      if (finished) {
        for (const cb of completionListeners) {
          try { cb({ item: finished, paths: demoMarker }) } catch { /* ignore */ }
        }
      }
      return
    }

    const target = new URL(task.url)
    if (target.pathname === '/mod/resource/view.php') target.searchParams.set('redirect', '1')
    target.searchParams.set('forcedownload', '1')
    const frame = document.createElement('iframe')
    frame.hidden = true
    frame.src = target.href
    document.body.appendChild(frame)
    window.setTimeout(() => frame.remove(), 60_000)
    const marker = [`downloaded:${task.url}`]
    recordLocalDownloadedPaths(task.resourceId, marker)
    markResourceSynced(task.resourceId)
    const finished = updateTask(task.taskId, prev => ({
      ...prev,
      status: 'completed',
      phase: 'completed',
      savedPaths: marker,
      fileCount: 1,
      fileIndex: 1,
      completedAt: new Date().toISOString(),
    }))
    if (finished) {
      for (const cb of completionListeners) {
        try { cb({ item: finished, paths: marker }) } catch { /* ignore */ }
      }
    }
  } catch (error) {
    const latest = queueItems.find(i => i.taskId === task.taskId)
    if (latest?.status === 'cancelled') return
    const message = error instanceof Error ? error.message : '下载失败，请重试'
    const isCancelled = /取消|abort/i.test(message)
    updateTask(task.taskId, prev => ({
      ...prev,
      status: isCancelled ? 'cancelled' : 'failed',
      phase: isCancelled ? 'cancelled' : 'error',
      error: isCancelled ? '已取消下载' : message,
      completedAt: new Date().toISOString(),
    }))
  }
}

function pumpQueue(): void {
  if (queuePaused) return
  while (runningWorkers < MAX_CONCURRENCY) {
    const nextTask = queueItems.find(item => item.status === 'queued')
    if (!nextTask) break
    runningWorkers += 1
    void executeTask(nextTask).finally(() => {
      runningWorkers = Math.max(0, runningWorkers - 1)
      pumpQueue()
    })
  }
}

function buildQueueItem(input: EnqueueDownloadInput): DownloadQueueItem {
  const organizeMode = input.organizeMode || 'bglis'
  const courseCode = extractCourseCodeFolder(input.resource.course)
  const categoryFolder = organizeMode === 'bglis' ? classifyBglisCategory(input.resource.title, input.url) : ''
  const taskId = `dl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return {
    taskId,
    resourceId: input.resource.id,
    title: input.resource.title,
    course: input.resource.course,
    courseCode,
    categoryFolder,
    url: input.url,
    organizeMode,
    replaceExisting: Boolean(input.replaceExisting),
    ...(input.targetFilePath ? { targetFilePath: input.targetFilePath } : {}),
    dataMode: input.dataMode || 'live',
    status: 'queued',
    transferredBytes: 0,
    savedPaths: [],
    createdAt: new Date().toISOString(),
  }
}

export function enqueueDownloadTask(input: EnqueueDownloadInput): { item: DownloadQueueItem; deduplicated: boolean } {
  bindNativeProgressOnce()
  const existingActive = queueItems.find(
    item => (item.resourceId === input.resource.id || item.url === input.url) && (item.status === 'queued' || item.status === 'downloading'),
  )
  if (existingActive) {
    if (queuePaused) {
      queuePaused = false
      emitQueueChange()
      pumpQueue()
    }
    return { item: existingActive, deduplicated: true }
  }
  const created = buildQueueItem(input)
  queueItems = [created, ...queueItems].slice(0, MAX_PERSISTED_ITEMS)
  if (queuePaused) queuePaused = false
  emitQueueChange()
  pumpQueue()
  return { item: created, deduplicated: false }
}

export function enqueueDownloadBatch(inputs: EnqueueDownloadInput[]): { added: number; skipped: number } {
  bindNativeProgressOnce()
  if (!inputs.length) return { added: 0, skipped: 0 }
  const newEntries: DownloadQueueItem[] = []
  let skipped = 0
  for (const input of inputs) {
    const alreadyActive =
      queueItems.some(
        item => (item.resourceId === input.resource.id || item.url === input.url) && (item.status === 'queued' || item.status === 'downloading'),
      ) ||
      newEntries.some(item => item.resourceId === input.resource.id || item.url === input.url)
    if (alreadyActive) {
      skipped += 1
      continue
    }
    newEntries.push(buildQueueItem(input))
  }
  if (newEntries.length > 0) {
    queueItems = [...newEntries, ...queueItems].slice(0, MAX_PERSISTED_ITEMS)
    if (queuePaused) queuePaused = false
    emitQueueChange()
    pumpQueue()
  }
  return { added: newEntries.length, skipped }
}

export function cancelDownloadTask(taskId: string): void {
  const target = queueItems.find(item => item.taskId === taskId)
  if (!target) return
  if (target.status === 'downloading') {
    updateTask(taskId, prev => ({
      ...prev,
      status: 'cancelled',
      phase: 'cancelled',
      error: '已取消下载',
      completedAt: new Date().toISOString(),
    }))
    void window.myhkuDesktop?.cancelDownload?.(taskId)
  } else if (target.status === 'queued') {
    updateTask(taskId, prev => ({
      ...prev,
      status: 'cancelled',
      phase: 'cancelled',
      error: '已从等待队列取消',
      completedAt: new Date().toISOString(),
    }))
  }
}

export function cancelAllPendingDownloads(): number {
  let count = 0
  const activeIds: string[] = []
  const nowIso = new Date().toISOString()
  queueItems = queueItems.map(item => {
    if (item.status === 'queued' || item.status === 'downloading') {
      count += 1
      if (item.status === 'downloading') activeIds.push(item.taskId)
      return {
        ...item,
        status: 'cancelled' as const,
        phase: 'cancelled' as const,
        error: '已取消下载',
        completedAt: nowIso,
      }
    }
    return item
  })
  for (const id of activeIds) {
    void window.myhkuDesktop?.cancelDownload?.(id)
  }
  if (count > 0) emitQueueChange()
  return count
}

export function retryDownloadTask(taskId: string): void {
  const target = queueItems.find(item => item.taskId === taskId)
  if (!target || target.status === 'downloading' || target.status === 'queued') return
  updateTask(taskId, prev => ({
    ...prev,
    status: 'queued',
    phase: undefined,
    error: undefined,
    transferredBytes: 0,
    totalBytes: undefined,
    completedAt: undefined,
  }))
  if (queuePaused) queuePaused = false
  emitQueueChange()
  pumpQueue()
}

export function retryAllFailedDownloads(): number {
  let count = 0
  queueItems = queueItems.map(item => {
    if (item.status === 'failed' || item.status === 'cancelled') {
      count += 1
      return {
        ...item,
        status: 'queued' as const,
        phase: undefined,
        error: undefined,
        transferredBytes: 0,
        totalBytes: undefined,
        completedAt: undefined,
      }
    }
    return item
  })
  if (count > 0) {
    if (queuePaused) queuePaused = false
    emitQueueChange()
    pumpQueue()
  }
  return count
}

export function removeDownloadTask(taskId: string): void {
  const target = queueItems.find(item => item.taskId === taskId)
  if (!target) return
  if (target.status === 'downloading') {
    void window.myhkuDesktop?.cancelDownload?.(taskId)
  }
  queueItems = queueItems.filter(item => item.taskId !== taskId)
  emitQueueChange()
}

export function clearCompletedDownloads(): number {
  const before = queueItems.length
  queueItems = queueItems.filter(item => item.status !== 'completed' && item.status !== 'cancelled')
  const removed = before - queueItems.length
  if (removed > 0) emitQueueChange()
  return removed
}

export function setDownloadQueuePaused(paused: boolean): void {
  if (queuePaused === paused) return
  queuePaused = paused
  emitQueueChange()
  if (!queuePaused) pumpQueue()
}

export function clearAllDownloadQueueState(): void {
  const activeIds = queueItems.filter(i => i.status === 'downloading').map(i => i.taskId)
  for (const id of activeIds) {
    void window.myhkuDesktop?.cancelDownload?.(id)
  }
  queueItems = []
  queuePaused = false
  if (typeof localStorage !== 'undefined') {
    try { localStorage.removeItem(DOWNLOAD_QUEUE_STORAGE_KEY) } catch { /* ignore */ }
  }
  emitQueueChange()
}

export function getDownloadQueueSnapshot(): DownloadQueueSnapshot {
  return cachedSnapshot
}

export function subscribeDownloadQueue(listener: () => void): () => void {
  bindNativeProgressOnce()
  stateListeners.add(listener)
  return () => {
    stateListeners.delete(listener)
  }
}

export function onDownloadItemCompleted(listener: (event: DownloadCompletionEvent) => void): () => void {
  completionListeners.add(listener)
  return () => {
    completionListeners.delete(listener)
  }
}

export function formatDownloadBytes(bytes?: number): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
