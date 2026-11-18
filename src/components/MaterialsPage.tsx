import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCheck, Download, ExternalLink, FileText, FolderOpen, Layers, RefreshCw, Star, XCircle } from 'lucide-react'
import { safeHkuUrl, type DataMode, type LiveSnapshot } from '../services/hku'
import { tr, type Locale } from '../services/i18n'
import {
  classifyResourceKind,
  evaluateNewResources,
  getLocalDownloadedIndex,
  getPinnedResourceIds,
  isDirectDownloadableUrl,
  markAllResourcesSeen,
  markResourceOpened,
  recordLocalDownloadedPaths,
  RESOURCE_KIND_LABELS,
  togglePinnedResource,
} from '../services/materials'

type MaterialFilter = 'all' | 'pinned' | 'new' | 'undownloaded' | 'pdf' | 'slides' | 'doc' | 'folder'

const FILTER_OPTIONS: { key: MaterialFilter; zh: string; en: string }[] = [
  { key: 'all', zh: '全部资料', en: 'All' },
  { key: 'pinned', zh: '★ 星标置顶', en: '★ Pinned' },
  { key: 'new', zh: '新增 NEW', en: 'NEW' },
  { key: 'undownloaded', zh: '待下载文件', en: 'Undownloaded' },
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
}: {
  locale?: Locale
  snapshot: LiveSnapshot
  dataMode: DataMode
  query: string
  onRefresh: () => void
}) {
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(() => new Set())
  const [downloadedPaths, setDownloadedPaths] = useState<Record<string, string[]>>(() => getLocalDownloadedIndex())
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => getPinnedResourceIds())
  const [newIds, setNewIds] = useState<Set<string>>(() => new Set())
  const [filter, setFilter] = useState<MaterialFilter>('all')
  const [message, setMessage] = useState('')
  const [batchStatus, setBatchStatus] = useState<{ course: string; done: number; total: number } | null>(null)
  const cancelBatchRef = useRef(false)

  useEffect(() => {
    if (dataMode === 'live') {
      setNewIds(evaluateNewResources(snapshot.resources))
    }
  }, [dataMode, snapshot.resources])

  useEffect(() => {
    let active = true
    const loadNativeIndex = async () => {
      try {
        const nativeIdx = await window.myhkuDesktop?.getDownloadedIndex?.()
        if (!active || !nativeIdx) return
        setDownloadedPaths(prev => ({ ...prev, ...nativeIdx }))
      } catch {
        /* optional desktop index */
      }
    }
    void loadNativeIndex()
    return () => {
      active = false
    }
  }, [])

  const getSavedForItem = (item: LiveSnapshot['resources'][number], url?: string): string[] | undefined => {
    return downloadedPaths[item.id] || (url ? downloadedPaths[url] : undefined)
  }

  const groups = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const map = new Map<string, LiveSnapshot['resources']>()
    for (const item of snapshot.resources) {
      if (keyword && !`${item.title} ${item.course}`.toLowerCase().includes(keyword)) continue
      const url = safeHkuUrl(item.url)
      const kind = classifyResourceKind(item.title, url)
      const saved = downloadedPaths[item.id] || (url ? downloadedPaths[url] : undefined)
      const isPinned = pinnedIds.has(item.id)
      const isNew = newIds.has(item.id)
      if (filter === 'pinned' && !isPinned) continue
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
          return pa - pb
        }),
      )
    }
    return map
  }, [snapshot.resources, query, filter, pinnedPathsKey(downloadedPaths), pinnedIds, newIds])

  const downloadSingle = async (id: string, url: string, silent = false): Promise<boolean> => {
    if (dataMode === 'demo' && !window.myhkuDesktop?.downloadResource && !window.myhkuDesktop?.downloadResourceDetailed) {
      if (!silent) setMessage('当前为演示数据模式；连接真实 HKU 账户后可直接下载课程文件')
      return false
    }
    setDownloadingIds(prev => new Set(prev).add(id))
    if (!silent) setMessage('')
    setNewIds(markResourceOpened(id))
    try {
      if (window.myhkuDesktop?.downloadResourceDetailed) {
        const result = await window.myhkuDesktop.downloadResourceDetailed(url)
        if (result.paths?.length) {
          recordLocalDownloadedPaths(id, result.paths)
          const nextIdx = recordLocalDownloadedPaths(url, result.paths)
          setDownloadedPaths(prev => ({ ...prev, ...nextIdx, [id]: result.paths }))
        }
        if (!silent) setMessage(`已下载 ${result.count} 个文件到下载文件夹`)
        return true
      } else if (window.myhkuDesktop?.downloadResource) {
        const count = await window.myhkuDesktop.downloadResource(url)
        const marker = [`downloaded:${url}`]
        recordLocalDownloadedPaths(id, marker)
        setDownloadedPaths(prev => ({ ...prev, [id]: marker, [url]: marker }))
        if (!silent) setMessage(`已下载 ${count} 个文件到下载文件夹`)
        return true
      } else if (window.myhkuAndroid?.downloadResource) {
        const ok = window.myhkuAndroid.downloadResource(url)
        if (ok) {
          const marker = [`android:${url}`]
          recordLocalDownloadedPaths(id, marker)
          setDownloadedPaths(prev => ({ ...prev, [id]: marker, [url]: marker }))
        }
        if (!silent) setMessage(ok ? '已加入系统下载队列，可在通知栏查看下载进度' : '下载启动失败，请确认 Moodle 已登录')
        return ok
      } else {
        const target = new URL(url)
        if (target.pathname === '/mod/resource/view.php') target.searchParams.set('redirect', '1')
        target.searchParams.set('forcedownload', '1')
        const frame = document.createElement('iframe')
        frame.hidden = true
        frame.src = target.href
        document.body.appendChild(frame)
        setTimeout(() => frame.remove(), 60_000)
        if (!silent) setMessage('已请求下载；若未开始，请使用桌面端或 Android 客户端并确认 Moodle 已连接')
        return true
      }
    } catch (error) {
      if (!silent) setMessage(error instanceof Error ? error.message : '下载失败，请重试')
      return false
    } finally {
      setDownloadingIds(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  const runBatchDownload = async (course: string, targets: Array<{ id: string; url: string }>) => {
    if (!targets.length || batchStatus) return
    if (dataMode === 'demo' && !window.myhkuDesktop?.downloadResource && !window.myhkuDesktop?.downloadResourceDetailed) {
      setMessage('当前为演示数据模式；连接真实 HKU 账户后可执行批量下载')
      return
    }
    cancelBatchRef.current = false
    setBatchStatus({ course, done: 0, total: targets.length })
    let okCount = 0
    for (let i = 0; i < targets.length; i += 1) {
      if (cancelBatchRef.current) break
      setBatchStatus({ course, done: i, total: targets.length })
      const ok = await downloadSingle(targets[i].id, targets[i].url, true)
      if (ok) okCount += 1
      setBatchStatus({ course, done: i + 1, total: targets.length })
    }
    const wasCancelled = cancelBatchRef.current
    setBatchStatus(null)
    setMessage(
      wasCancelled
        ? `已停止批量下载（已完成 ${okCount} / ${targets.length} 项）`
        : `课程「${course}」批量下载完成：成功下载 ${okCount} / ${targets.length} 项资料`,
    )
  }

  const openFile = async (filePath: string) => {
    try {
      await window.myhkuDesktop?.openDownloadedFile?.(filePath)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法打开文件')
    }
  }

  const revealFile = async (filePath: string) => {
    try {
      await window.myhkuDesktop?.revealDownloadedFile?.(filePath)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法打开所在目录')
    }
  }

  return (
    <section className="panel live-page">
      <div className="panel-head">
        <div>
          <h2>{tr(locale, '课程资料', 'Course Materials')}</h2>
          <p>{tr(locale, '按课程批量下载 · 本地文件持久化索引 · 类型筛选与星标置顶', 'Batch download · Persistent local file index · Type filters & pinned items')}</p>
        </div>
        <div className="head-inline-actions">
          {newIds.size > 0 && (
            <button type="button" className="mini-action-btn" onClick={() => setNewIds(markAllResourcesSeen())}>
              <CheckCheck size={12} /> {tr(locale, `全部标为已读 (${newIds.size})`, `Mark All Read (${newIds.size})`)}
            </button>
          )}
          <button className="text-btn" onClick={onRefresh}>
            <RefreshCw size={13} /> {tr(locale, '刷新', 'Refresh')}
          </button>
        </div>
      </div>

      <div className="materials-filter-bar" role="tablist" aria-label={tr(locale, '资料类型筛选', 'Material Filters')}>
        {FILTER_OPTIONS.map(opt => (
          <button
            type="button"
            key={opt.key}
            role="tab"
            aria-selected={filter === opt.key}
            className={`filter-pill ${filter === opt.key ? 'active' : ''}`}
            onClick={() => setFilter(opt.key)}
          >
            {locale === 'en' ? opt.en : opt.zh}
          </button>
        ))}
      </div>

      {batchStatus && (
        <div className="batch-progress-bar" role="status">
          <span>
            正在批量下载「{batchStatus.course}」：{batchStatus.done} / {batchStatus.total}
          </span>
          <button
            type="button"
            className="mini-action-btn"
            onClick={() => {
              cancelBatchRef.current = true
            }}
          >
            <XCircle size={12} /> 停止队列
          </button>
        </div>
      )}

      {message && (
        <p className="download-message" role="status">
          {message}
        </p>
      )}
      <div className="resource-columns">
        {Array.from(groups, ([course, items]) => {
          const downloadableAll = items
            .map(item => ({ id: item.id, url: safeHkuUrl(item.url) || '' }))
            .filter(entry => isDirectDownloadableUrl(entry.url))
          const downloadablePending = downloadableAll.filter(entry => {
            const saved = downloadedPaths[entry.id] || downloadedPaths[entry.url]
            return !saved || saved.length === 0
          })
          return (
            <section className="resource-course" key={course}>
              <div className="resource-course-head">
                <h3>
                  {course}
                  <small>
                    {items.length} 项资料 · {downloadableAll.length - downloadablePending.length}/{downloadableAll.length} 已存本地
                  </small>
                </h3>
                {downloadableAll.length > 0 && (
                  <div className="course-batch-actions">
                    {downloadablePending.length > 0 && downloadablePending.length < downloadableAll.length && (
                      <button
                        type="button"
                        className="mini-action-btn"
                        disabled={Boolean(batchStatus)}
                        onClick={() => void runBatchDownload(course, downloadablePending)}
                      >
                        <Download size={11} /> 仅下未存 ({downloadablePending.length})
                      </button>
                    )}
                    <button
                      type="button"
                      className="mini-action-btn"
                      disabled={Boolean(batchStatus)}
                      onClick={() => void runBatchDownload(course, downloadableAll)}
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
                const isBusy = downloadingIds.has(item.id)
                const saved = getSavedForItem(item, url)
                const hasRealDesktopFile =
                  saved && saved[0] && !saved[0].startsWith('downloaded:') && !saved[0].startsWith('android:')
                const isPinned = pinnedIds.has(item.id)
                const isNew = newIds.has(item.id)
                return (
                  <div className="resource-row" key={item.id}>
                    <FileText size={16} />
                    <span>
                      <strong>
                        {item.title}
                        <em className={`kind-badge kind-${kind}`}>{RESOURCE_KIND_LABELS[kind]}</em>
                        {isNew && <em className="new-resource-badge">NEW</em>}
                      </strong>
                      {saved && saved.length > 0 && <small className="saved-hint">已保存至下载目录</small>}
                    </span>
                    <div className="resource-actions">
                      {url ? (
                        isDownloadableFile ? (
                          <button type="button" disabled={isBusy} onClick={() => void downloadSingle(item.id, url)}>
                            <Download size={14} />
                            {isBusy ? '下载中…' : '下载'}
                          </button>
                        ) : (
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={() => setNewIds(markResourceOpened(item.id))}
                          >
                            <ExternalLink size={14} /> 查看
                          </a>
                        )
                      ) : (
                        <em>无链接</em>
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
