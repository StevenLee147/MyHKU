import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { AlertCircle, CheckCheck, Download, ExternalLink, FileText, FolderOpen, Layers, ListChecks, RefreshCw, Sparkles, Star, XCircle } from 'lucide-react'
import '../materials-manager.css'
import {
  cancelAllPendingDownloads,
  enqueueDownloadBatch,
  enqueueDownloadTask,
  formatDownloadBytes,
  getDownloadQueueSnapshot,
  onDownloadItemCompleted,
  subscribeDownloadQueue,
  type DownloadQueueItem,
} from '../services/downloadQueue'
import { safeHkuUrl, type DataMode, type LiveResource, type LiveSnapshot } from '../services/hku'
import { tr, type Locale } from '../services/i18n'
import {
  canonicalizeResourceUrl,
  classifyBglisCategory,
  classifyResourceKind,
  evaluateResourceSnapshotDiff,
  extractCourseCodeFolder,
  getLocalDownloadedIndex,
  getPinnedResourceIds,
  getUpdatedResourcesMap,
  getWebFallbackStoragePrefs,
  isDirectDownloadableUrl,
  markAllMaterialsReadAndAck,
  markResourceOpened,
  markResourceSynced,
  matchResourceToLocalFile,
  mergeRemoteUpdateProbes,
  ORGANIZE_MODE_LABELS,
  previewArchiveSubpath,
  RESOURCE_KIND_LABELS,
  setWebFallbackStoragePrefs,
  togglePinnedResource,
  type MaterialUpdateRecord,
  type OrganizeMode,
  type ScannedCourseFileItem,
} from '../services/materials'

type MaterialFilter = 'all' | 'updated' | 'new' | 'undownloaded' | 'pinned' | 'pdf' | 'slides' | 'doc' | 'folder'

const FILTER_OPTIONS: { key: MaterialFilter; zh: string; en: string }[] = [
  { key: 'all', zh: '全部资料', en: 'All' },
  { key: 'updated', zh: '有更新', en: 'Updated' },
  { key: 'new', zh: '新增 NEW', en: 'NEW' },
  { key: 'undownloaded', zh: '待下载文件', en: 'Undownloaded' },
  { key: 'pinned', zh: '★ 星标置顶', en: '★ Pinned' },
  { key: 'pdf', zh: 'PDF', en: 'PDF' },
  { key: 'slides', zh: 'Slides 课件', en: 'Slides' },
  { key: 'doc', zh: 'Word / 表格', en: 'Docs / Sheets' },
  { key: 'folder', zh: '文件夹 / 链接', en: 'Folders / Links' },
]

export function MaterialsPage({
  locale = 'zh',
  snapshot,
  dataMode,
  query,
  onRefresh,
  onOpenDownloads,
  onNotice,
}: {
  locale?: Locale
  snapshot: LiveSnapshot
  dataMode: DataMode
  query: string
  onRefresh: () => void
  onOpenDownloads?: () => void
  onNotice?: (message: string) => void
}) {
  const queueSnap = useSyncExternalStore(subscribeDownloadQueue, getDownloadQueueSnapshot, getDownloadQueueSnapshot)
  const [downloadedPaths, setDownloadedPaths] = useState<Record<string, string[]>>(() => getLocalDownloadedIndex())
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => getPinnedResourceIds())
  const [newIds, setNewIds] = useState<Set<string>>(() => new Set())
  const [updatedMap, setUpdatedMap] = useState<Record<string, MaterialUpdateRecord>>(() => getUpdatedResourcesMap())
  const [storageDirInfo, setStorageDirInfo] = useState<{
    effectiveDir: string
    isCustom: boolean
    organizeMode: OrganizeMode
  }>(() => ({
    effectiveDir: '',
    isCustom: false,
    organizeMode: getWebFallbackStoragePrefs().organizeMode,
  }))
  const [scannedFiles, setScannedFiles] = useState<ScannedCourseFileItem[]>([])
  const [scannedCourseCount, setScannedCourseCount] = useState(0)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [filter, setFilter] = useState<MaterialFilter>('all')
  const [message, setMessage] = useState('')
  const probedKeyRef = useRef('')

  const latestTaskByResourceId = useMemo(() => {
    const map = new Map<string, DownloadQueueItem>()
    for (const entry of queueSnap.items) {
      if (!map.has(entry.resourceId)) map.set(entry.resourceId, entry)
    }
    return map
  }, [queueSnap.items])

  useEffect(() => {
    if (dataMode === 'live') {
      const diff = evaluateResourceSnapshotDiff(snapshot.resources)
      setNewIds(diff.newIds)
      setUpdatedMap(diff.updatedMap)
    } else {
      setNewIds(new Set(['demo-r1']))
      setUpdatedMap({
        'demo-r3': {
          id: 'demo-r3',
          reason: tr(locale, 'Moodle 课件已更新至第 2 版（新增页表例题）', 'Updated to revision 2 on Moodle'),
          detectedAt: snapshot.fetchedAt,
        },
      })
    }
  }, [dataMode, snapshot.resources, snapshot.fetchedAt, locale])

  const refreshStorageAndLocalScan = useCallback(async () => {
    try {
      const [nativeIdx, cfg, scan] = await Promise.all([
        window.myhkuDesktop?.getDownloadedIndex?.(),
        window.myhkuDesktop?.getStorageConfig?.(),
        window.myhkuDesktop?.scanStorageDirectory?.(),
      ])
      const mergedIdx = nativeIdx ? { ...getLocalDownloadedIndex(), ...nativeIdx } : getLocalDownloadedIndex()
      setDownloadedPaths(mergedIdx)
      if (cfg) {
        setStorageDirInfo({
          effectiveDir: cfg.effectiveDir,
          isCustom: cfg.isCustom,
          organizeMode: cfg.organizeMode,
        })
      }
      if (scan) {
        setScannedFiles(scan.files || [])
        setScannedCourseCount(scan.courses?.length || 0)
      }
      return { scan, mergedIdx }
    } catch {
      return { scan: undefined, mergedIdx: getLocalDownloadedIndex() }
    }
  }, [])

  useEffect(() => {
    void refreshStorageAndLocalScan()
  }, [refreshStorageAndLocalScan])

  useEffect(() => {
    return onDownloadItemCompleted(event => {
      const canonical = canonicalizeResourceUrl(event.item.url)
      setDownloadedPaths(prev => ({
        ...prev,
        [event.item.resourceId]: event.paths,
        [event.item.url]: event.paths,
        ...(canonical ? { [canonical]: event.paths } : {}),
      }))
      const synced = markResourceSynced(event.item.resourceId, event.signature)
      setNewIds(synced.newIds)
      setUpdatedMap(synced.updatedMap)
      void refreshStorageAndLocalScan()
    })
  }, [refreshStorageAndLocalScan])

  const localMatchMap = useMemo(() => {
    const map = new Map<string, ScannedCourseFileItem>()
    if (!scannedFiles.length) return map
    for (const item of snapshot.resources) {
      const hit = matchResourceToLocalFile(item, scannedFiles)
      if (hit) map.set(item.id, hit)
    }
    return map
  }, [snapshot.resources, scannedFiles])

  const getSavedForItem = useCallback(
    (item: LiveResource, url?: string): string[] | undefined => {
      const canonical = url ? canonicalizeResourceUrl(url) : ''
      const indexed =
        downloadedPaths[item.id] ||
        (url ? downloadedPaths[url] : undefined) ||
        (canonical ? downloadedPaths[canonical] : undefined)
      if (indexed && indexed.length > 0) return indexed
      const diskHit = localMatchMap.get(item.id)
      return diskHit ? [diskHit.path] : undefined
    },
    [downloadedPaths, localMatchMap],
  )

  const runRemoteUpdateCheck = useCallback(
    async (silent = false) => {
      if (checkingUpdates) return
      setCheckingUpdates(true)
      const syncedWhileProbing = new Set<string>()
      const unsubCompleted = onDownloadItemCompleted(ev => {
        syncedWhileProbing.add(ev.item.resourceId)
      })
      try {
        const { scan, mergedIdx } = await refreshStorageAndLocalScan()
        const latestFiles = scan?.files || scannedFiles
        if (dataMode === 'live' && window.myhkuDesktop?.checkResourceUpdates) {
          const candidates = snapshot.resources
            .map(item => {
              const url = safeHkuUrl(item.url) || ''
              if (!isDirectDownloadableUrl(url)) return null
              const canonical = canonicalizeResourceUrl(url)
              const indexed = mergedIdx[item.id] || mergedIdx[url] || (canonical ? mergedIdx[canonical] : undefined)
              const realIndexedPath = indexed?.find(p => !p.startsWith('downloaded:') && !p.startsWith('android:'))
              const diskMatch = matchResourceToLocalFile(item, latestFiles)
              const hasLocalCopy = Boolean(realIndexedPath || diskMatch)
              return {
                id: item.id,
                url,
                hasLocalCopy,
                ...(diskMatch
                  ? { localPath: diskMatch.path, localSize: diskMatch.size, localMtimeMs: diskMatch.mtimeMs }
                  : realIndexedPath
                    ? { localPath: realIndexedPath }
                    : {}),
              }
            })
            .filter((x): x is NonNullable<typeof x> => x !== null)
            .sort((a, b) => Number(b.hasLocalCopy) - Number(a.hasLocalCopy))
          if (candidates.length > 0) {
            const probes = await window.myhkuDesktop.checkResourceUpdates(candidates)
            const safeProbes: typeof probes = {}
            for (const [id, info] of Object.entries(probes || {})) {
              const currentTask = getDownloadQueueSnapshot().items.find(
                t => t.resourceId === id && (t.status === 'downloading' || t.status === 'queued'),
              )
              if (syncedWhileProbing.has(id) || currentTask) continue
              safeProbes[id] = info
            }
            const merged = mergeRemoteUpdateProbes(safeProbes)
            setUpdatedMap(merged)
            if (!silent) {
              const updCount = Object.keys(merged).length
              const msg =
                updCount > 0
                  ? tr(locale, `已完成检测：发现 ${updCount} 项已存课程文件有更新`, `Check complete: ${updCount} updated files found`)
                  : tr(locale, '已完成检测：当前所有已下载课程资料均为最新版本', 'All local course materials are up to date')
              setMessage(msg)
              onNotice?.(msg)
            }
            return
          }
        }
        if (!silent) {
          const msg = tr(
            locale,
            `已扫描本地目录（共识别 ${latestFiles.length} 个课程文件）`,
            `Scanned local folder (${latestFiles.length} files indexed)`,
          )
          setMessage(msg)
          onNotice?.(msg)
        }
      } catch (error) {
        if (!silent) {
          const errMsg = error instanceof Error ? error.message : '更新检测失败，请稍后重试'
          setMessage(errMsg)
          onNotice?.(errMsg)
        }
      } finally {
        unsubCompleted()
        setCheckingUpdates(false)
      }
    },
    [checkingUpdates, dataMode, locale, onNotice, refreshStorageAndLocalScan, scannedFiles, snapshot.resources],
  )

  useEffect(() => {
    if (dataMode !== 'live' || !window.myhkuDesktop?.checkResourceUpdates || !snapshot.resources.length) return
    const key = `${snapshot.fetchedAt}:${snapshot.resources.length}`
    if (probedKeyRef.current === key) return
    probedKeyRef.current = key
    void runRemoteUpdateCheck(true)
  }, [dataMode, snapshot.fetchedAt, snapshot.resources.length, runRemoteUpdateCheck])

  const updatedIds = useMemo(() => new Set(Object.keys(updatedMap)), [updatedMap])

  const diffSummary = useMemo(() => {
    const updatedTargets: Array<{ item: LiveResource; url: string; replaceExisting: boolean; targetFilePath?: string }> = []
    const newTargets: Array<{ item: LiveResource; url: string; replaceExisting: boolean; targetFilePath?: string }> = []
    const affectedCourses = new Set<string>()
    for (const item of snapshot.resources) {
      const url = safeHkuUrl(item.url) || ''
      const isUpd = updatedIds.has(item.id)
      const isNew = newIds.has(item.id)
      if (!isUpd && !isNew) continue
      affectedCourses.add(extractCourseCodeFolder(item.course))
      if (!isDirectDownloadableUrl(url)) continue
      const diskHit = localMatchMap.get(item.id)
      const saved = getSavedForItem(item, url)
      const targetFilePath = diskHit?.path || (saved?.[0] && !saved[0].startsWith('downloaded:') && !saved[0].startsWith('android:') ? saved[0] : undefined)
      if (isUpd) {
        updatedTargets.push({ item, url, replaceExisting: true, targetFilePath })
      } else if (isNew) {
        newTargets.push({ item, url, replaceExisting: false })
      }
    }
    return {
      updatedTargets,
      newTargets,
      combinedTargets: [...updatedTargets, ...newTargets],
      affectedCourseCodes: [...affectedCourses],
    }
  }, [snapshot.resources, updatedIds, newIds, localMatchMap, getSavedForItem])

  const groups = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const map = new Map<string, LiveSnapshot['resources']>()
    for (const item of snapshot.resources) {
      if (keyword && !`${item.title} ${item.course}`.toLowerCase().includes(keyword)) continue
      const url = safeHkuUrl(item.url)
      const kind = classifyResourceKind(item.title, url)
      const saved = getSavedForItem(item, url)
      const isPinned = pinnedIds.has(item.id)
      const isNew = newIds.has(item.id)
      const isUpdated = updatedIds.has(item.id)
      if (filter === 'pinned' && !isPinned) continue
      if (filter === 'updated' && !isUpdated) continue
      if (filter === 'new' && !isNew) continue
      if (filter === 'undownloaded' && (!isDirectDownloadableUrl(url) || (saved && saved.length > 0))) continue
      if (filter === 'pdf' && kind !== 'pdf') continue
      if (filter === 'slides' && kind !== 'slides') continue
      if (filter === 'doc' && kind !== 'doc' && kind !== 'sheet') continue
      if (filter === 'folder' && kind !== 'folder' && kind !== 'link' && kind !== 'archive') continue
      map.set(item.course, [...(map.get(item.course) || []), item])
    }
    for (const [course, list] of map.entries()) {
      map.set(
        course,
        [...list].sort((a, b) => {
          const pa = pinnedIds.has(a.id) ? 0 : 1
          const pb = pinnedIds.has(b.id) ? 0 : 1
          if (pa !== pb) return pa - pb
          const ua = updatedIds.has(a.id) ? 0 : 1
          const ub = updatedIds.has(b.id) ? 0 : 1
          return ua - ub
        }),
      )
    }
    return map
  }, [snapshot.resources, query, filter, pinnedPathsKey(downloadedPaths), pinnedIds, newIds, updatedIds, getSavedForItem])

  const handleChooseStorageDir = async () => {
    if (!window.myhkuDesktop?.chooseStorageDirectory) {
      setMessage(tr(locale, '自定义储存目录需在 MyHKU 桌面客户端中使用', 'Custom storage directory requires MyHKU Desktop'))
      return
    }
    try {
      const res = await window.myhkuDesktop.chooseStorageDirectory({ apply: true, organizeMode: storageDirInfo.organizeMode })
      if (res.canceled) return
      setStorageDirInfo({ effectiveDir: res.effectiveDir, isCustom: res.isCustom, organizeMode: res.organizeMode })
      await refreshStorageAndLocalScan()
      setMessage(tr(locale, `已设定课程资料储存目录：${res.effectiveDir}`, `Storage folder set to: ${res.effectiveDir}`))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法设定储存目录')
    }
  }

  const handleCycleOrganizeMode = async () => {
    const order: OrganizeMode[] = ['bglis', 'course', 'flat']
    const nextMode = order[(order.indexOf(storageDirInfo.organizeMode) + 1) % order.length]
    setWebFallbackStoragePrefs(nextMode)
    setStorageDirInfo(prev => ({ ...prev, organizeMode: nextMode }))
    if (window.myhkuDesktop?.setStorageConfig) {
      try {
        const res = await window.myhkuDesktop.setStorageConfig({ organizeMode: nextMode })
        setStorageDirInfo({ effectiveDir: res.effectiveDir, isCustom: res.isCustom, organizeMode: res.organizeMode })
      } catch {
        /* ignore */
      }
    }
    setMessage(
      tr(
        locale,
        `已切换文件夹归档模式：${ORGANIZE_MODE_LABELS[nextMode].zh}（${ORGANIZE_MODE_LABELS[nextMode].hintZh}）`,
        `Switched archive structure: ${ORGANIZE_MODE_LABELS[nextMode].en}`,
      ),
    )
  }

  const handleQueueSingle = (
    item: LiveResource,
    url: string,
    options?: { replaceExisting?: boolean; targetFilePath?: string },
  ) => {
    const { deduplicated } = enqueueDownloadTask({
      resource: item,
      url,
      organizeMode: storageDirInfo.organizeMode,
      replaceExisting: Boolean(options?.replaceExisting),
      targetFilePath: options?.targetFilePath,
      dataMode,
    })
    const msg = deduplicated
      ? tr(locale, `「${item.title}」已在下载队列中`, `${item.title} is already in the download queue`)
      : tr(
          locale,
          `已加入下载队列：${item.title}`,
          `Queued for download: ${item.title}`,
        )
    setMessage(msg)
    onNotice?.(msg)
  }

  const handleQueueBatch = (
    label: string,
    targets: Array<{ item: LiveResource; url: string; replaceExisting?: boolean; targetFilePath?: string }>,
  ) => {
    if (!targets.length) return
    const { added, skipped } = enqueueDownloadBatch(
      targets.map(entry => ({
        resource: entry.item,
        url: entry.url,
        organizeMode: storageDirInfo.organizeMode,
        replaceExisting: Boolean(entry.replaceExisting),
        targetFilePath: entry.targetFilePath,
        dataMode,
      })),
    )
    const msg =
      added > 0
        ? tr(
            locale,
            `已将「${label}」${added} 项资料加入下载队列${skipped > 0 ? `（跳过已在队列 ${skipped} 项）` : ''}`,
            `Added ${added} item(s) from ${label} to the download queue`,
          )
        : tr(locale, '所选资料均已在下载队列中', 'Selected items are already in the download queue')
    setMessage(msg)
    onNotice?.(msg)
  }

  const openFile = async (filePath: string) => {
    try {
      await window.myhkuDesktop?.openDownloadedFile?.(filePath)
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : '无法打开文件'
      setMessage(errMsg)
      onNotice?.(errMsg)
    }
  }

  const revealFile = async (filePath: string) => {
    try {
      await window.myhkuDesktop?.revealDownloadedFile?.(filePath)
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : '无法打开所在目录'
      setMessage(errMsg)
      onNotice?.(errMsg)
    }
  }

  const totalDiffBadges = newIds.size + updatedIds.size
  const activeOrQueuedCount = queueSnap.activeCount + queueSnap.queuedCount

  return (
    <section className="panel live-page">
      <div className="panel-head">
        <div>
          <h2>{tr(locale, '课程资料', 'Course Materials')}</h2>
          <p>
            {tr(
              locale,
              '按课程与分类智能归档 · 新增与版本更新检测 · 一键同步下载',
              'Smart Course/Category Archive · New & Updated File Detection · One-Click Sync',
            )}
          </p>
        </div>
        <div className="head-inline-actions">
          {onOpenDownloads && (
            <button type="button" className="mini-action-btn" onClick={onOpenDownloads}>
              <ListChecks size={12} />{' '}
              {activeOrQueuedCount > 0
                ? tr(locale, `下载队列 (${activeOrQueuedCount})`, `Queue (${activeOrQueuedCount})`)
                : tr(locale, '下载队列', 'Downloads')}
            </button>
          )}
          {totalDiffBadges > 0 && (
            <button
              type="button"
              className="mini-action-btn"
              onClick={() => {
                const cleared = markAllMaterialsReadAndAck()
                setNewIds(cleared.newIds)
                setUpdatedMap(cleared.updatedMap)
              }}
            >
              <CheckCheck size={12} /> {tr(locale, `全部标为已读 (${totalDiffBadges})`, `Mark All Read (${totalDiffBadges})`)}
            </button>
          )}
          <button
            type="button"
            className="mini-action-btn"
            disabled={checkingUpdates}
            onClick={() => void runRemoteUpdateCheck(false)}
          >
            <RefreshCw size={12} className={checkingUpdates ? 'spin' : ''} />{' '}
            {checkingUpdates ? tr(locale, '检测中…', 'Checking…') : tr(locale, '检测文件更新', 'Check File Updates')}
          </button>
          <button className="text-btn" onClick={onRefresh}>
            <RefreshCw size={13} /> {tr(locale, '刷新', 'Refresh')}
          </button>
        </div>
      </div>

      <div className={`materials-storage-bar ${!storageDirInfo.isCustom && window.myhkuDesktop?.chooseStorageDirectory ? 'needs-setup' : ''}`}>
        <div className="storage-bar-info">
          <div className="storage-bar-icon">
            <FolderOpen size={15} />
          </div>
          <div className="storage-bar-text">
            <strong>
              <span>
                {storageDirInfo.isCustom
                  ? tr(locale, '课程资料储存目录', 'Materials Storage Folder')
                  : tr(locale, '设置你的课程资料专属目录（支持按课程/分类自动归档）', 'Set your Course Materials Folder (Auto-archive by Course/Category)')}
              </span>
              <span className="storage-mode-pill">
                {locale === 'en'
                  ? ORGANIZE_MODE_LABELS[storageDirInfo.organizeMode].en
                  : ORGANIZE_MODE_LABELS[storageDirInfo.organizeMode].zh}
              </span>
              {scannedFiles.length > 0 && (
                <span className="storage-mode-pill">
                  {tr(locale, `已索引 ${scannedCourseCount} 门课 · ${scannedFiles.length} 个文件`, `${scannedFiles.length} local files`)}
                </span>
              )}
            </strong>
            <span className="storage-bar-path" title={storageDirInfo.effectiveDir}>
              {storageDirInfo.effectiveDir || tr(locale, '默认保存至系统下载目录 / MyHKU（可在桌面端自选任意目录）', 'Default: Downloads / MyHKU (Customizable in Desktop app)')}
            </span>
          </div>
        </div>
        <div className="storage-bar-actions">
          <button type="button" className="mini-action-btn" onClick={() => void handleChooseStorageDir()}>
            <FolderOpen size={12} />{' '}
            {storageDirInfo.isCustom
              ? tr(locale, '更改目录', 'Change Folder')
              : tr(locale, '设定储存目录', 'Set Storage Folder')}
          </button>
          <button
            type="button"
            className="mini-action-btn"
            onClick={() => void handleCycleOrganizeMode()}
            title={tr(locale, '切换目录归档层级结构', 'Switch folder hierarchy mode')}
          >
            <Layers size={12} /> {tr(locale, '切换结构', 'Structure')}
          </button>
          {Boolean(window.myhkuDesktop?.openStorageDirectory) && (
            <button
              type="button"
              className="mini-action-btn"
              onClick={() => void window.myhkuDesktop?.openStorageDirectory?.()}
            >
              <ExternalLink size={12} /> {tr(locale, '打开目录', 'Open')}
            </button>
          )}
        </div>
      </div>

      {(activeOrQueuedCount > 0 || queueSnap.failedCount > 0) && (
        <div className={`materials-queue-strip ${queueSnap.failedCount > 0 && activeOrQueuedCount === 0 ? 'has-error' : ''}`} role="status">
          <span>
            {activeOrQueuedCount > 0
              ? tr(
                  locale,
                  `后台下载队列运行中：${queueSnap.activeCount} 项正在传输 · ${queueSnap.queuedCount} 项排队等待 · 已完成 ${queueSnap.completedCount} 项`,
                  `Download queue running: ${queueSnap.activeCount} active · ${queueSnap.queuedCount} queued · ${queueSnap.completedCount} done`,
                )
              : tr(
                  locale,
                  `下载队列中有 ${queueSnap.failedCount} 项任务需要处理或重试`,
                  `${queueSnap.failedCount} download task(s) failed and can be retried`,
                )}
          </span>
          <div className="storage-bar-actions">
            {activeOrQueuedCount > 0 && (
              <button
                type="button"
                className="mini-action-btn"
                onClick={() => {
                  const cancelled = cancelAllPendingDownloads()
                  if (cancelled > 0) onNotice?.(tr(locale, `已停止 ${cancelled} 项队列任务`, `Stopped ${cancelled} queued download(s)`))
                }}
              >
                <XCircle size={12} /> {tr(locale, '停止队列', 'Stop Queue')}
              </button>
            )}
            {onOpenDownloads && (
              <button type="button" className="mini-action-btn" onClick={onOpenDownloads}>
                <ListChecks size={12} /> {tr(locale, '打开下载队列 →', 'View Queue →')}
              </button>
            )}
          </div>
        </div>
      )}

      {(updatedIds.size > 0 || newIds.size > 0) && (
        <div
          className={`materials-sync-alert ${updatedIds.size === 0 ? 'only-new' : ''}`}
          role="status"
        >
          <div className="sync-alert-copy">
            <strong>
              {updatedIds.size > 0 ? <AlertCircle size={15} /> : <Sparkles size={15} />}
              <span>
                {tr(
                  locale,
                  `变更提示：检测到 ${updatedIds.size} 项文件有更新、${newIds.size} 项新增资料`,
                  `Change Alert: ${updatedIds.size} updated file(s) and ${newIds.size} new item(s) detected`,
                )}
              </span>
            </strong>
            <span>
              {diffSummary.affectedCourseCodes.length > 0
                ? tr(
                    locale,
                    `涉及课程：${diffSummary.affectedCourseCodes.join('、')} · 点击右侧按钮即可一键下载并按课程分类自动归档更新`,
                    `Courses: ${diffSummary.affectedCourseCodes.join(', ')} · One-click download & archive`,
                  )
                : tr(locale, '可一键批量同步所有新增与更新文件到本地课程目录', 'Sync all new and updated files in one click')}
            </span>
          </div>
          <div className="sync-alert-actions">
            {updatedIds.size > 0 && (
              <button
                type="button"
                className="mini-action-btn"
                onClick={() => setFilter(filter === 'updated' ? 'all' : 'updated')}
              >
                {tr(locale, `仅看有更新 (${updatedIds.size})`, `Updated (${updatedIds.size})`)}
              </button>
            )}
            {newIds.size > 0 && (
              <button
                type="button"
                className="mini-action-btn"
                onClick={() => setFilter(filter === 'new' ? 'all' : 'new')}
              >
                {tr(locale, `仅看新增 (${newIds.size})`, `New (${newIds.size})`)}
              </button>
            )}
            {diffSummary.combinedTargets.length > 0 && (
              <button
                type="button"
                className="one-click-sync-btn"
                onClick={() =>
                  handleQueueBatch(
                    tr(locale, '新增与更新资料', 'New & Updated Materials'),
                    diffSummary.combinedTargets,
                  )
                }
              >
                <Download size={13} />{' '}
                {tr(
                  locale,
                  `一键下载新增与更新 (${diffSummary.combinedTargets.length})`,
                  `Sync New & Updated (${diffSummary.combinedTargets.length})`,
                )}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="materials-filter-bar" role="tablist" aria-label={tr(locale, '资料类型筛选', 'Material Filters')}>
        {FILTER_OPTIONS.map(opt => {
          const count = opt.key === 'updated' ? updatedIds.size : opt.key === 'new' ? newIds.size : 0
          return (
            <button
              type="button"
              key={opt.key}
              role="tab"
              aria-selected={filter === opt.key}
              className={`filter-pill ${filter === opt.key ? 'active' : ''}`}
              onClick={() => setFilter(opt.key)}
            >
              {locale === 'en' ? opt.en : opt.zh}
              {count > 0 && <span className="filter-count-chip">{count}</span>}
            </button>
          )
        })}
      </div>

      {message && (
        <p className="download-message" role="status">
          {message}
        </p>
      )}
      <div className="resource-columns">
        {Array.from(groups, ([course, items]) => {
          const downloadableAll = items
            .map(item => {
              const url = safeHkuUrl(item.url) || ''
              const isUpd = updatedIds.has(item.id)
              const diskHit = localMatchMap.get(item.id)
              const saved = getSavedForItem(item, url)
              const targetFilePath = diskHit?.path || (saved?.[0] && !saved[0].startsWith('downloaded:') && !saved[0].startsWith('android:') ? saved[0] : undefined)
              return { item, url, replaceExisting: isUpd, targetFilePath }
            })
            .filter(entry => isDirectDownloadableUrl(entry.url))
          const downloadablePendingOrUpdated = downloadableAll.filter(entry => {
            if (updatedIds.has(entry.item.id)) return true
            const saved = getSavedForItem(entry.item, entry.url)
            return !saved || saved.length === 0
          })
          const courseNewCount = items.filter(i => newIds.has(i.id)).length
          const courseUpdCount = items.filter(i => updatedIds.has(i.id)).length
          const savedCount = downloadableAll.filter(entry => {
            const saved = getSavedForItem(entry.item, entry.url)
            return Boolean(saved && saved.length > 0)
          }).length
          return (
            <section className="resource-course" key={course}>
              <div className="resource-course-head">
                <h3>
                  {course}
                  {(courseUpdCount > 0 || courseNewCount > 0) && (
                    <span className="course-diff-pills">
                      {courseUpdCount > 0 && <em className="updated-resource-badge">{courseUpdCount} 更新</em>}
                      {courseNewCount > 0 && <em className="new-resource-badge">{courseNewCount} NEW</em>}
                    </span>
                  )}
                  <small>
                    {items.length} 项资料 · {savedCount}/{downloadableAll.length} 已存本地 · 归档目录 {extractCourseCodeFolder(course)}
                  </small>
                </h3>
                {downloadableAll.length > 0 && (
                  <div className="course-batch-actions">
                    {downloadablePendingOrUpdated.length > 0 && downloadablePendingOrUpdated.length < downloadableAll.length && (
                      <button
                        type="button"
                        className="mini-action-btn"
                        onClick={() => handleQueueBatch(course, downloadablePendingOrUpdated)}
                      >
                        <Download size={11} /> 一键下新增/更新 ({downloadablePendingOrUpdated.length})
                      </button>
                    )}
                    <button
                      type="button"
                      className="mini-action-btn"
                      onClick={() => handleQueueBatch(course, downloadableAll)}
                    >
                      <Layers size={11} /> 一键全下 ({downloadableAll.length})
                    </button>
                  </div>
                )}
              </div>
              {items.map(item => {
                const url = safeHkuUrl(item.url)
                const isDownloadableFile = isDirectDownloadableUrl(url)
                const kind = classifyResourceKind(item.title, url)
                const categoryFolder = storageDirInfo.organizeMode === 'bglis' ? classifyBglisCategory(item.title, url) : ''
                const rowTask = latestTaskByResourceId.get(item.id)
                const isDownloading = rowTask?.status === 'downloading'
                const isQueued = rowTask?.status === 'queued'
                const isBusy = isDownloading || isQueued
                const saved = getSavedForItem(item, url)
                const diskHit = localMatchMap.get(item.id)
                const hasRealDesktopFile =
                  saved && saved[0] && !saved[0].startsWith('downloaded:') && !saved[0].startsWith('android:')
                const isPinned = pinnedIds.has(item.id)
                const isNew = newIds.has(item.id)
                const updateRecord = updatedMap[item.id]
                const isUpdated = Boolean(updateRecord)
                const targetPathForReplace = diskHit?.path || (hasRealDesktopFile ? saved[0] : undefined)
                const archivePreview = previewArchiveSubpath(item.course, item.title, url, storageDirInfo.organizeMode)
                const livePct =
                  isDownloading && rowTask?.totalBytes && rowTask.totalBytes > 0
                    ? Math.min(100, Math.round((rowTask.transferredBytes / rowTask.totalBytes) * 100))
                    : null
                return (
                  <div className={`resource-row ${isUpdated ? 'is-updated' : ''}`} key={item.id}>
                    <FileText size={16} />
                    <span>
                      <strong>
                        {item.title}
                        <em className={`kind-badge kind-${kind}`}>{RESOURCE_KIND_LABELS[kind]}</em>
                        {categoryFolder && <em className="category-subpath-badge">{categoryFolder}</em>}
                        {isUpdated && <em className="updated-resource-badge">{tr(locale, '有更新', 'UPDATED')}</em>}
                        {isNew && <em className="new-resource-badge">NEW</em>}
                      </strong>
                      {isUpdated && (
                        <small className="update-reason-hint">
                          {updateRecord.reason} · {tr(locale, '点击「一键更新」同步最新文件', 'Click Update to overwrite with latest version')}
                        </small>
                      )}
                      {rowTask?.status === 'failed' && rowTask.error && (
                        <small className="dl-item-error">
                          {tr(locale, `下载失败：${rowTask.error}`, `Failed: ${rowTask.error}`)}
                        </small>
                      )}
                      {isDownloading && rowTask.transferredBytes > 0 && (
                        <small className="saved-hint">
                          {tr(
                            locale,
                            `正在下载：已接收 ${formatDownloadBytes(rowTask.transferredBytes)}${livePct !== null ? ` (${livePct}%)` : ''}`,
                            `Downloading: ${formatDownloadBytes(rowTask.transferredBytes)}${livePct !== null ? ` (${livePct}%)` : ''}`,
                          )}
                        </small>
                      )}
                      {saved && saved.length > 0 ? (
                        <small className="saved-hint">
                          {diskHit
                            ? tr(locale, `已存课程目录：${diskHit.relativePath}`, `In folder: ${diskHit.relativePath}`)
                            : hasRealDesktopFile
                              ? tr(locale, `已保存：${saved[0]}`, `Saved: ${saved[0]}`)
                              : tr(locale, `已保存至本地目录${archivePreview ? ` (${archivePreview})` : ''}`, 'Saved locally')}
                        </small>
                      ) : (
                        isDownloadableFile && archivePreview && (
                          <small className="pending-archive-hint">
                            {tr(locale, `待下载至：${archivePreview}`, `Target: ${archivePreview}`)}
                          </small>
                        )
                      )}
                    </span>
                    <div className="resource-actions">
                      {url ? (
                        isDownloadableFile ? (
                          <button
                            type="button"
                            className={isUpdated ? 'update-download-btn' : ''}
                            disabled={isBusy}
                            onClick={() =>
                              handleQueueSingle(item, url, {
                                replaceExisting: isUpdated,
                                targetFilePath: targetPathForReplace,
                              })
                            }
                          >
                            <Download size={14} />
                            {isDownloading
                              ? livePct !== null
                                ? `${livePct}%`
                                : tr(locale, '下载中…', 'Downloading…')
                              : isQueued
                                ? tr(locale, '排队中…', 'Queued…')
                                : isUpdated
                                  ? tr(locale, '一键更新', 'Update')
                                  : tr(locale, '下载', 'Download')}
                          </button>
                        ) : (
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={() => setNewIds(markResourceOpened(item.id))}
                          >
                            <ExternalLink size={14} /> {tr(locale, '查看', 'Open')}
                          </a>
                        )
                      ) : (
                        <em>{tr(locale, '无链接', 'No link')}</em>
                      )}
                      {hasRealDesktopFile && window.myhkuDesktop?.openDownloadedFile && (
                        <>
                          <button type="button" className="secondary-btn" onClick={() => void openFile(saved[0])}>
                            打开文件
                          </button>
                          <button
                            type="button"
                            className="secondary-btn"
                            onClick={() => void revealFile(saved[0])}
                            title="在文件夹中显示"
                            aria-label="在文件夹中显示"
                          >
                            <FolderOpen size={13} />
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        className={`pin-btn ${isPinned ? 'pinned' : ''}`}
                        title={isPinned ? '取消星标置顶' : '星标置顶'}
                        aria-label={isPinned ? '取消星标置顶' : '星标置顶'}
                        onClick={() => setPinnedIds(togglePinnedResource(item.id))}
                      >
                        <Star size={13} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </section>
          )
        })}
      </div>
      {!groups.size && (
        <p className="empty-state">
          {query.trim() || filter !== 'all' ? '没有匹配筛选或搜索条件的课程资料' : '暂无可下载资料'}
        </p>
      )}
    </section>
  )
}

function pinnedPathsKey(index: Record<string, string[]>): string {
  return Object.entries(index).map(([k, v]) => `${k}:${v.join('|')}`).join(';')
}
// end MaterialsPage
