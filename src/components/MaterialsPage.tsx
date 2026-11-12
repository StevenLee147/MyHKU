import { useMemo, useState } from 'react'
import { Download, ExternalLink, FileText, FolderOpen, RefreshCw } from 'lucide-react'
import { safeHkuUrl, type DataMode, type LiveSnapshot } from '../services/hku'

export function MaterialsPage({
  snapshot,
  dataMode,
  query,
  onRefresh,
}: {
  snapshot: LiveSnapshot
  dataMode: DataMode
  query: string
  onRefresh: () => void
}) {
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(() => new Set())
  const [downloadedPaths, setDownloadedPaths] = useState<Record<string, string[]>>({})
  const [message, setMessage] = useState('')

  const groups = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const map = new Map<string, LiveSnapshot['resources']>()
    for (const item of snapshot.resources) {
      if (keyword && !`${item.title} ${item.course}`.toLowerCase().includes(keyword)) continue
      map.set(item.course, [...(map.get(item.course) || []), item])
    }
    return map
  }, [snapshot.resources, query])

  const download = async (id: string, url: string) => {
    if (dataMode === 'demo' && !window.myhkuDesktop?.downloadResource && !window.myhkuDesktop?.downloadResourceDetailed) {
      setMessage('当前为演示数据模式；连接真实 HKU 账户后可直接下载课程文件')
      return
    }
    setDownloadingIds(prev => new Set(prev).add(id))
    setMessage('')
    try {
      if (window.myhkuDesktop?.downloadResourceDetailed) {
        const result = await window.myhkuDesktop.downloadResourceDetailed(url)
        if (result.paths?.length) {
          setDownloadedPaths(prev => ({ ...prev, [id]: result.paths }))
        }
        setMessage(`已下载 ${result.count} 个文件到下载文件夹`)
      } else if (window.myhkuDesktop?.downloadResource) {
        const count = await window.myhkuDesktop.downloadResource(url)
        setMessage(`已下载 ${count} 个文件到下载文件夹`)
      } else if (window.myhkuAndroid?.downloadResource) {
        const ok = window.myhkuAndroid.downloadResource(url)
        setMessage(ok ? '已加入系统下载队列，可在通知栏查看下载进度' : '下载启动失败，请确认 Moodle 已登录')
      } else {
        const target = new URL(url)
        if (target.pathname === '/mod/resource/view.php') target.searchParams.set('redirect', '1')
        target.searchParams.set('forcedownload', '1')
        const frame = document.createElement('iframe')
        frame.hidden = true
        frame.src = target.href
        document.body.appendChild(frame)
        setTimeout(() => frame.remove(), 60_000)
        setMessage('已请求下载；若未开始，请使用桌面端或 Android 客户端并确认 Moodle 已连接')
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '下载失败，请重试')
    } finally {
      setDownloadingIds(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
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
          <h2>课程资料</h2>
          <p>按课程分栏 · 文件直接下载并支持一键打开</p>
        </div>
        <button className="text-btn" onClick={onRefresh}>
          <RefreshCw size={13} /> 刷新
        </button>
      </div>
      {message && (
        <p className="download-message" role="status">
          {message}
        </p>
      )}
      <div className="resource-columns">
        {Array.from(groups, ([course, items]) => (
          <section className="resource-course" key={course}>
            <h3>
              {course}
              <small>{items.length} 项资料</small>
            </h3>
            {items.map(item => {
              const url = safeHkuUrl(item.url)
              const isDownloadableFile = url && /\/(?:mod\/(?:resource|folder)\/|pluginfile\.php\/)/.test(new URL(url).pathname)
              const isBusy = downloadingIds.has(item.id)
              const saved = downloadedPaths[item.id]
              return (
                <div className="resource-row" key={item.id}>
                  <FileText size={16} />
                  <span>
                    <strong>{item.title}</strong>
                    {saved && saved.length > 0 && <small className="saved-hint">已保存至下载目录</small>}
                  </span>
                  <div className="resource-actions">
                    {url ? (
                      isDownloadableFile ? (
                        <button type="button" disabled={isBusy} onClick={() => void download(item.id, url)}>
                          <Download size={14} />
                          {isBusy ? '下载中…' : '下载'}
                        </button>
                      ) : (
                        <a href={url} target="_blank" rel="noreferrer">
                          <ExternalLink size={14} /> 查看
                        </a>
                      )
                    ) : (
                      <em>无链接</em>
                    )}
                    {saved && saved[0] && window.myhkuDesktop?.openDownloadedFile && (
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
                  </div>
                </div>
              )
            })}
          </section>
        ))}
      </div>
      {!groups.size && <p className="empty-state">{query.trim() ? '没有匹配搜索条件的课程资料' : '暂无可下载资料'}</p>}
    </section>
  )
}
