import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  XCircle,
} from 'lucide-react'
import '../materials-manager.css'
import {
  cancelAllPendingDownloads,
  cancelDownloadTask,
  clearCompletedDownloads,
  formatDownloadBytes,
  getDownloadQueueSnapshot,
  removeDownloadTask,
  retryAllFailedDownloads,
  retryDownloadTask,
  setDownloadQueuePaused,
  subscribeDownloadQueue,
  type DownloadQueueItem,
} from '../services/downloadQueue'
import { tr, type Locale } from '../services/i18n'
import { getWebFallbackStoragePrefs, ORGANIZE_MODE_LABELS, type OrganizeMode } from '../services/materials'

type QueueFilter = 'all' | 'active' | 'completed' | 'failed'

export function DownloadQueuePage({
  locale = 'zh',
  query = '',
  onOpenMaterials,
  onNotice,
}: {
  locale?: Locale
  query?: string
  onOpenMaterials: () => void
  onNotice?: (message: string) => void
}) {
  const queueSnap = useSyncExternalStore(subscribeDownloadQueue, getDownloadQueueSnapshot, getDownloadQueueSnapshot)
  const [filter, setFilter] = useState<QueueFilter>('all')
  const [statusMessage, setStatusMessage] = useState('')
  const [storageSummary, setStorageSummary] = useState<{ effectiveDir: string; organizeMode: OrganizeMode }>(() => ({
    effectiveDir: '',
    organizeMode: getWebFallbackStoragePrefs().organizeMode,
  }))
  const toolbarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let active = true
    const loadCfg = async () => {
      try {
        const cfg = await window.myhkuDesktop?.getStorageConfig?.()
        if (active && cfg) {
          setStorageSummary({ effectiveDir: cfg.effectiveDir, organizeMode: cfg.organizeMode })
        }
      } catch {
        /* ignore */
      }
    }
    void loadCfg()
    return () => {
      active = false
    }
  }, [])

  // Roving-tabindex fallback when native CSS/HTML focusgroup is unavailable.
  useEffect(() => {
    const bar = toolbarRef.current
    if (!bar || 'focusGroup' in HTMLElement.prototype) return
    const getControls = () => Array.from(bar.querySelectorAll<HTMLButtonElement>('button[type="button"]'))
    const initItems = getControls()
    initItems.forEach((btn, idx) => {
      btn.tabIndex = idx === 0 ? 0 : -1
    })
    const onFocusIn = (event: FocusEvent) => {
      const items = getControls()
      if (event.target instanceof HTMLButtonElement && items.includes(event.target)) {
        items.forEach(btn => {
          btn.tabIndex = btn === event.target ? 0 : -1
        })
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const items = getControls()
      if (!items.length) return
      const currentIdx = items.findIndex(btn => btn === document.activeElement)
      if (currentIdx < 0) return
      const rtl = getComputedStyle(bar).direction === 'rtl'
      let nextIdx = -1
      if (event.key === 'ArrowRight') nextIdx = (currentIdx + (rtl ? -1 : 1) + items.length) % items.length
      else if (event.key === 'ArrowLeft') nextIdx = (currentIdx + (rtl ? 1 : -1) + items.length) % items.length
      else if (event.key === 'Home') nextIdx = 0
      else if (event.key === 'End') nextIdx = items.length - 1
      if (nextIdx >= 0) {
        event.preventDefault()
        items.forEach((btn, idx) => {
          btn.tabIndex = idx === nextIdx ? 0 : -1
        })
        items[nextIdx]?.focus()
      }
    }
    bar.addEventListener('focusin', onFocusIn)
    bar.addEventListener('keydown', onKeyDown)
    return () => {
      bar.removeEventListener('focusin', onFocusIn)
      bar.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const announce = (msg: string) => {
    setStatusMessage(msg)
    onNotice?.(msg)
  }

  const filteredItems = useMemo(() => {
    const kw = query.trim().toLowerCase()
    return queueSnap.items.filter(item => {
      if (kw && !`${item.title} ${item.course} ${item.courseCode} ${item.currentFilename || ''}`.toLowerCase().includes(kw)) {
        return false
      }
      if (filter === 'active') return item.status === 'downloading' || item.status === 'queued'
      if (filter === 'completed') return item.status === 'completed'
      if (filter === 'failed') return item.status === 'failed' || item.status === 'cancelled'
      return true
    })
  }, [queueSnap.items, query, filter])

  const runningTotal = queueSnap.activeCount + queueSnap.queuedCount
  const failedOrCancelledTotal = useMemo(
    () => queueSnap.items.filter(i => i.status === 'failed' || i.status === 'cancelled').length,
    [queueSnap.items],
  )
  const clearableTotal = useMemo(
    () => queueSnap.items.filter(i => i.status === 'completed' || i.status === 'cancelled').length,
    [queueSnap.items],
  )

  const openLocalFile = async (filePath: string) => {
    try {
      await window.myhkuDesktop?.openDownloadedFile?.(filePath)
    } catch (error) {
      announce(error instanceof Error ? error.message : tr(locale, '无法打开本地文件', 'Unable to open file'))
    }
  }

  const revealLocalFile = async (filePath: string) => {
    try {
      await window.myhkuDesktop?.revealDownloadedFile?.(filePath)
    } catch (error) {
      announce(error instanceof Error ? error.message : tr(locale, '无法打开所在文件夹', 'Unable to reveal file in folder'))
    }
  }

  const renderStatusBadge = (item: DownloadQueueItem) => {
    if (item.status === 'downloading') {
      return (
        <em className="dl-status-badge downloading">
          {item.phase === 'resolving'
            ? tr(locale, '解析链接…', 'Resolving…')
            : tr(locale, '下载中', 'Downloading')}
        </em>
      )
    }
    if (item.status === 'queued') {
      return (
        <em className="dl-status-badge queued">
          {queueSnap.paused ? tr(locale, '已暂停', 'Paused') : tr(locale, '排队等待', 'Queued')}
        </em>
      )
    }
    if (item.status === 'completed') {
      return <em className="dl-status-badge completed">{tr(locale, '已完成', 'Completed')}</em>
    }
    if (item.status === 'cancelled') {
      return <em className="dl-status-badge cancelled">{tr(locale, '已取消', 'Cancelled')}</em>
    }
    return <em className="dl-status-badge failed">{tr(locale, '下载失败', 'Failed')}</em>
  }

  return (
    <section className="panel live-page download-queue-page">
      <div className="panel-head">
        <div>
          <h2>{tr(locale, '下载队列', 'Download Queue')}</h2>
          <p>
            {tr(
              locale,
              '实时追踪课程资料下载进度、本地归档路径与异常重试 · 切换页面不会中断后台传输',
              'Track live download progress, local archive paths, and retries without interrupting background transfers',
            )}
          </p>
        </div>
        <div className="head-inline-actions">
          {Boolean(window.myhkuDesktop?.openStorageDirectory) && (
            <button
              type="button"
              className="mini-action-btn"
              onClick={() => void window.myhkuDesktop?.openStorageDirectory?.()}
            >
              <FolderOpen size={12} /> {tr(locale, '打开储存目录', 'Open Storage Folder')}
            </button>
          )}
          <button type="button" className="text-btn" onClick={onOpenMaterials}>
            {tr(locale, '前往课程资料 →', 'Course Materials →')}
          </button>
        </div>
      </div>

      {storageSummary.effectiveDir && (
        <div className="materials-storage-bar">
          <div className="storage-bar-info">
            <div className="storage-bar-icon">
              <FolderOpen size={15} />
            </div>
            <div className="storage-bar-text">
              <strong>
                <span>{tr(locale, '当前归档根目录', 'Active Archive Directory')}</span>
                <span className="storage-mode-pill">
                  {locale === 'en'
                    ? ORGANIZE_MODE_LABELS[storageSummary.organizeMode].en
                    : ORGANIZE_MODE_LABELS[storageSummary.organizeMode].zh}
                </span>
              </strong>
              <span className="storage-bar-path" title={storageSummary.effectiveDir}>
                {storageSummary.effectiveDir}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="dl-queue-metrics">
        <div className="dl-metric-card">
          <Clock3 size={16} className="dl-metric-icon active" />
          <div>
            <small>{tr(locale, '进行中 / 排队', 'Active / Queued')}</small>
            <strong>
              {queueSnap.activeCount} / {queueSnap.queuedCount}
            </strong>
          </div>
        </div>
        <div className="dl-metric-card">
          <CheckCircle2 size={16} className="dl-metric-icon done" />
          <div>
            <small>{tr(locale, '已完成下载', 'Completed')}</small>
            <strong>{queueSnap.completedCount}</strong>
          </div>
        </div>
        <div className="dl-metric-card">
          <AlertCircle size={16} className="dl-metric-icon warn" />
          <div>
            <small>{tr(locale, '失败 / 取消', 'Failed / Cancelled')}</small>
            <strong>{failedOrCancelledTotal}</strong>
          </div>
        </div>
        <div className="dl-metric-card">
          <Download size={16} className="dl-metric-icon info" />
          <div>
            <small>{tr(locale, '累计保存体积', 'Saved Volume')}</small>
            <strong>{formatDownloadBytes(queueSnap.totalCompletedBytes)}</strong>
          </div>
        </div>
      </div>

      <div className="dl-toolbar-wrap">
        <div
          ref={toolbarRef}
          role="toolbar"
          aria-label={tr(locale, '下载队列控制栏', 'Download queue controls')}
          aria-controls="dl-queue-list"
          className="dl-queue-toolbar"
          {...({ focusgroup: 'toolbar wrap' } as Record<string, string>)}
        >
          <div role="group" aria-label={tr(locale, '队列调度', 'Queue execution')} className="dl-toolbar-group">
            <button
              type="button"
              className="mini-action-btn dl-toolbar-btn"
              aria-pressed={queueSnap.paused}
              aria-disabled={runningTotal === 0 && !queueSnap.paused ? 'true' : undefined}
              onClick={() => {
                if (runningTotal === 0 && !queueSnap.paused) return
                const next = !queueSnap.paused
                setDownloadQueuePaused(next)
                announce(
                  next
                    ? tr(locale, '已暂停后续排队任务', 'Paused queued downloads')
                    : tr(locale, '已恢复队列下载', 'Resumed download queue'),
                )
              }}
            >
              {queueSnap.paused ? <Play size={12} aria-hidden="true" /> : <Pause size={12} aria-hidden="true" />}{' '}
              {tr(locale, '暂停队列', 'Pause Queue')}
            </button>

            <button
              type="button"
              className="mini-action-btn dl-toolbar-btn"
              aria-disabled={failedOrCancelledTotal === 0 ? 'true' : undefined}
              onClick={() => {
                if (failedOrCancelledTotal === 0) return
                const count = retryAllFailedDownloads()
                announce(tr(locale, `已重新加入 ${count} 项任务到下载队列`, `Re-queued ${count} download(s)`))
              }}
            >
              <RotateCcw size={12} aria-hidden="true" />{' '}
              {tr(locale, `重试失败项 (${failedOrCancelledTotal})`, `Retry Failed (${failedOrCancelledTotal})`)}
            </button>
          </div>

          <span role="separator" aria-orientation="vertical" className="dl-toolbar-sep" />

          <div role="group" aria-label={tr(locale, '清理操作', 'Cleanup actions')} className="dl-toolbar-group">
            <button
              type="button"
              className="mini-action-btn dl-toolbar-btn"
              aria-disabled={runningTotal === 0 ? 'true' : undefined}
              onClick={() => {
                if (runningTotal === 0) return
                const count = cancelAllPendingDownloads()
                announce(tr(locale, `已取消 ${count} 项进行中/排队下载`, `Cancelled ${count} active/queued task(s)`))
              }}
            >
              <XCircle size={12} aria-hidden="true" /> {tr(locale, '全部取消', 'Cancel All')}
            </button>

            <button
              type="button"
              className="mini-action-btn dl-toolbar-btn"
              aria-disabled={clearableTotal === 0 ? 'true' : undefined}
              onClick={() => {
                if (clearableTotal === 0) return
                const count = clearCompletedDownloads()
                announce(tr(locale, `已清除 ${count} 条已完成记录`, `Cleared ${count} finished record(s)`))
              }}
            >
              <Trash2 size={12} aria-hidden="true" /> {tr(locale, '清空已完成', 'Clear Finished')}
            </button>
          </div>
        </div>

        <div className="materials-filter-bar dl-filter-tabs" role="tablist" aria-label={tr(locale, '队列状态筛选', 'Filter queue by status')}>
          {([
            { key: 'all', zh: `全部 (${queueSnap.items.length})`, en: `All (${queueSnap.items.length})` },
            { key: 'active', zh: `进行中 (${runningTotal})`, en: `Active (${runningTotal})` },
            { key: 'completed', zh: `已完成 (${queueSnap.completedCount})`, en: `Completed (${queueSnap.completedCount})` },
            { key: 'failed', zh: `失败/取消 (${failedOrCancelledTotal})`, en: `Failed (${failedOrCancelledTotal})` },
          ] as const).map(tab => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={filter === tab.key}
              className={`filter-pill ${filter === tab.key ? 'active' : ''}`}
              onClick={() => setFilter(tab.key)}
            >
              {locale === 'en' ? tab.en : tab.zh}
            </button>
          ))}
        </div>
      </div>

      <p className="download-message" role="status" hidden={!statusMessage}>
        {statusMessage}
      </p>

      <div id="dl-queue-list" className="dl-queue-list">
        {filteredItems.length > 0 ? (
          filteredItems.map(item => {
            const hasRealFile =
              item.savedPaths.length > 0 &&
              !item.savedPaths[0].startsWith('downloaded:') &&
              !item.savedPaths[0].startsWith('android:')
            const isDeterminate =
              item.status === 'downloading' &&
              typeof item.totalBytes === 'number' &&
              item.totalBytes > 0 &&
              item.transferredBytes >= 0
            const pct =
              isDeterminate && item.totalBytes
                ? Math.min(100, Math.round((item.transferredBytes / item.totalBytes) * 100))
                : null
            const progressLabel = tr(locale, `${item.title} 下载进度`, `${item.title} download progress`)

            return (
              <article className={`dl-queue-item status-${item.status}`} key={item.taskId}>
                <div className="dl-item-main">
                  <FileText size={16} className="dl-item-file-icon" aria-hidden="true" />
                  <div className="dl-item-body">
                    <div className="dl-item-title-row">
                      <strong>{item.title}</strong>
                      <em className="category-subpath-badge">{item.courseCode}</em>
                      {item.categoryFolder && <em className="category-subpath-badge">{item.categoryFolder}</em>}
                      {item.replaceExisting && (
                        <em className="updated-resource-badge">{tr(locale, '覆盖更新', 'Update')}</em>
                      )}
                      {renderStatusBadge(item)}
                    </div>

                    <small className="dl-item-course">{item.course}</small>

                    {(item.status === 'downloading' || item.status === 'queued') && (
                      <div className="dl-progress-block">
                        {item.status === 'downloading' ? (
                          isDeterminate ? (
                            <progress
                              className="dl-progress"
                              aria-label={progressLabel}
                              value={item.transferredBytes}
                              max={item.totalBytes}
                            />
                          ) : (
                            <progress className="dl-progress" aria-label={progressLabel} />
                          )
                        ) : (
                          <progress className="dl-progress" aria-label={progressLabel} value={0} max={100} />
                        )}
                        <span className="dl-progress-meta">
                          {item.status === 'queued'
                            ? tr(locale, '等待空闲下载通道…', 'Waiting for available download slot…')
                            : item.phase === 'resolving'
                              ? tr(locale, '正在解析 Moodle 文件地址…', 'Resolving Moodle file link…')
                              : (
                                  <>
                                    {item.fileCount && item.fileCount > 1
                                      ? `${tr(locale, '文件', 'File')} ${item.fileIndex || 1}/${item.fileCount} · `
                                      : ''}
                                    {item.currentFilename ? `${item.currentFilename} · ` : ''}
                                    {formatDownloadBytes(item.transferredBytes)}
                                    {item.totalBytes ? ` / ${formatDownloadBytes(item.totalBytes)}` : ''}
                                    {pct !== null ? ` (${pct}%)` : ''}
                                  </>
                                )}
                        </span>
                      </div>
                    )}

                    {item.status === 'completed' && (
                      <small className="dl-item-path">
                        {hasRealFile
                          ? (
                              <>
                                {item.savedPaths.length > 1
                                  ? tr(
                                      locale,
                                      `已保存 ${item.savedPaths.length} 个文件至：${item.savedPaths[0]}`,
                                      `Saved ${item.savedPaths.length} files: ${item.savedPaths[0]}`,
                                    )
                                  : tr(locale, `已保存：${item.savedPaths[0]}`, `Saved: ${item.savedPaths[0]}`)}
                                {item.transferredBytes > 0 ? ` (${formatDownloadBytes(item.transferredBytes)})` : ''}
                              </>
                            )
                          : tr(
                              locale,
                              `已完成下载${item.savedDirectory ? `（${item.savedDirectory}）` : ''}`,
                              `Download finished${item.savedDirectory ? ` (${item.savedDirectory})` : ''}`,
                            )}
                      </small>
                    )}

                    {(item.status === 'failed' || item.status === 'cancelled') && item.error && (
                      <small className="dl-item-error">{item.error}</small>
                    )}
                  </div>
                </div>

                <div className="dl-item-actions">
                  {(item.status === 'downloading' || item.status === 'queued') && (
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => {
                        cancelDownloadTask(item.taskId)
                        announce(tr(locale, `已取消「${item.title}」`, `Cancelled ${item.title}`))
                      }}
                    >
                      <XCircle size={13} aria-hidden="true" /> {tr(locale, '取消', 'Cancel')}
                    </button>
                  )}

                  {item.status === 'completed' && hasRealFile && Boolean(window.myhkuDesktop?.openDownloadedFile) && (
                    <>
                      <button
                        type="button"
                        className="secondary-btn"
                        onClick={() => void openLocalFile(item.savedPaths[0])}
                      >
                        {tr(locale, '打开文件', 'Open')}
                      </button>
                      <button
                        type="button"
                        className="secondary-btn"
                        title={tr(locale, '在文件夹中显示', 'Show in folder')}
                        aria-label={tr(locale, '在文件夹中显示', 'Show in folder')}
                        onClick={() => void revealLocalFile(item.savedPaths[0])}
                      >
                        <FolderOpen size={13} aria-hidden="true" />
                      </button>
                    </>
                  )}

                  {(item.status === 'failed' || item.status === 'cancelled') && (
                    <>
                      <button
                        type="button"
                        className="mini-action-btn"
                        onClick={() => {
                          retryDownloadTask(item.taskId)
                          announce(tr(locale, `正在重试「${item.title}」`, `Retrying ${item.title}`))
                        }}
                      >
                        <RotateCcw size={12} aria-hidden="true" /> {tr(locale, '重试', 'Retry')}
                      </button>
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="secondary-btn dl-ext-link"
                        title={tr(locale, '在官方页面打开', 'Open in official page')}
                        aria-label={tr(locale, '在官方页面打开', 'Open in official page')}
                      >
                        <ExternalLink size={13} aria-hidden="true" />
                      </a>
                    </>
                  )}

                  {item.status !== 'downloading' && item.status !== 'queued' && (
                    <button
                      type="button"
                      className="icon-inline-btn"
                      title={tr(locale, '移除此记录', 'Remove record')}
                      aria-label={tr(locale, '移除此记录', 'Remove record')}
                      onClick={() => removeDownloadTask(item.taskId)}
                    >
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </article>
            )
          })
        ) : (
          <div className="dl-empty-box">
            <Download size={24} aria-hidden="true" />
            <strong>
              {queueSnap.items.length === 0
                ? tr(locale, '下载队列当前为空', 'Download queue is empty')
                : tr(locale, '当前筛选条件下没有下载任务', 'No downloads match this filter')}
            </strong>
            <p>
              {tr(
                locale,
                '在「课程资料」或「Moodle」页面点击任意课件下载或一键同步，即可在此查看实时进度、保存位置与状态。',
                'Click Download or One-Click Sync in Course Materials to view live transfer progress and local paths here.',
              )}
            </p>
            <button type="button" className="mini-action-btn" onClick={onOpenMaterials}>
              {tr(locale, '前往课程资料选择文件', 'Browse Course Materials')}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
