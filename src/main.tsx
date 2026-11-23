import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Bell,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  FileText,
  Globe,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  X,
} from 'lucide-react'
import './styles.css'
import { LegalGate } from './legal'
import { AccountSetup } from './components/AccountSetup'
import { CommandPaletteModal } from './components/CommandPaletteModal'
import { CustomTaskModal } from './components/CustomTaskModal'
import { CalendarPage } from './components/CalendarPage'
import { MaterialsPage } from './components/MaterialsPage'
import { MoodleCourseSelectorModal } from './components/MoodleCourseSelectorModal'
import { MoodlePage } from './components/MoodlePage'
import { OverviewPage, type ConnectionPhase } from './components/OverviewPage'
import {
  clearMoodleCoursePrefs,
  filterSnapshotByCoursePrefs,
  getMoodleCoursePrefs,
  saveMoodleCoursePrefs,
  type MoodleCoursePrefs,
} from './services/moodleCourses'
import { SettingsPage } from './components/SettingsPage'
import {
  addCustomTask,
  customTaskToUnified,
  deleteCustomTask,
  getCustomTasks,
  mergeWithCustomTasks,
  toggleCustomTask,
  updateCustomTask,
  type CustomTask,
  type CustomTaskCategory,
} from './services/customTasks'
import { buildDemoSnapshot } from './services/demoData'
import { buildIcsCalendar, downloadIcsFile } from './services/icsExport'
import {
  applyDesktopSessions,
  applyThemeMode,
  cacheSnapshot,
  checkAllConnections,
  clearConnections,
  clearSnapshotScope,
  fetchLiveSnapshot,
  getCachedSnapshot,
  getConnectionStates,
  getDataMode,
  getThemeMode,
  notifySnapshotChanges,
  setDataMode,
  setThemeMode,
  signOutAccount,
  type DataMode,
  type HkuSite,
  type LiveSnapshot,
  type SiteConnection,
  type ThemeMode,
} from './services/hku'
import {
  applyDocumentLocale,
  getLocale,
  localizedGreeting,
  NAV_LABELS,
  setLocale as persistLocale,
  tr,
  type Locale,
} from './services/i18n'
import {
  cleanDueDisplay,
  getNotificationFeed,
  markAllNotificationsRead,
  sortAssignmentsByDue,
  type AppNotificationItem,
  type NavTarget,
} from './services/notifications'
import { findNextOrCurrentClass } from './services/schedule'

const navItems: { key: NavTarget; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'overview', label: '概览', icon: LayoutDashboard },
  { key: 'calendar', label: '我的课表', icon: CalendarDays },
  { key: 'moodle', label: 'Moodle', icon: BookOpen },
  { key: 'materials', label: '课程资料', icon: FileText },
  { key: 'settings', label: '设置', icon: Settings },
]

function isApplePlatform(): boolean {
  if (window.myhkuDesktop?.platform) return window.myhkuDesktop.platform === 'darwin'
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent || '')
}

function App() {
  const [authReady, setAuthReady] = useState(false)
  const [accountConfigured, setAccountConfigured] = useState(false)
  const [account, setAccount] = useState<{ username?: string; email?: string }>({})
  const [editingAccount, setEditingAccount] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [notifMenuOpen, setNotifMenuOpen] = useState(false)
  const [notifFeed, setNotifFeed] = useState<AppNotificationItem[]>(() => getNotificationFeed())
  const [active, setActive] = useState<NavTarget>('overview')
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null)
  const [mobileNav, setMobileNav] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [lastSync, setLastSync] = useState(() => localStorage.getItem('myhku-last-sync') ?? '尚未同步')
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState('')
  const [dataMode, setDataModeState] = useState<DataMode>(() => getDataMode())
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => getThemeMode())
  const [locale, setLocaleState] = useState<Locale>(() => getLocale())
  const [connections, setConnections] = useState<Record<HkuSite, SiteConnection>>(() => getConnectionStates())
  const [liveSnapshot, setLiveSnapshot] = useState<LiveSnapshot | null>(() => getCachedSnapshot())
  const [liveError, setLiveError] = useState('')
  const [customTasks, setCustomTasks] = useState<CustomTask[]>(() => getCustomTasks())
  const [taskModalOpen, setTaskModalOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<CustomTask | null>(null)
  const [defaultTaskCourse, setDefaultTaskCourse] = useState('')
  const [paletteOpen, setPaletteOpen] = useState(false)

  const searchInputRef = useRef<HTMLInputElement>(null)
  const started = useRef(false)
  const syncingRef = useRef(false)
  const pendingSnapshotRead = useRef(false)
  const lastAttemptAt = useRef(0)
  const dataModeRef = useRef(dataMode)
  dataModeRef.current = dataMode
  const syncRef = useRef<(refreshOfficial?: boolean) => void>(() => {})

  useEffect(() => {
    applyThemeMode(themeMode)
  }, [themeMode])

  useEffect(() => {
    applyDocumentLocale(locale)
  }, [locale])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen(prev => !prev)
      } else if (event.key === 'Escape') {
        setUserMenuOpen(false)
        setNotifMenuOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const showToast = useCallback((message: string, duration = 3500) => {
    setNotice(message)
    if (duration > 0) {
      window.setTimeout(() => {
        setNotice(current => (current === message ? '' : current))
      }, duration)
    }
  }, [])

  const handleSetLocale = useCallback(
    (next: Locale) => {
      persistLocale(next)
      setLocaleState(next)
      showToast(next === 'en' ? 'Switched to English' : '已切换为简体中文', 2000)
    },
    [showToast],
  )

  const handleNavigate = useCallback((target: NavTarget, course?: string) => {
    setActive(target)
    if (target === 'moodle') setSelectedCourseId(course || null)
    else setSelectedCourseId(null)
    setMobileNav(false)
    setNotifMenuOpen(false)
    setUserMenuOpen(false)
  }, [])

  useEffect(() => {
    let mounted = true
    let statusEvents = 0
    const stop = window.myhkuDesktop?.onAuthStatus?.(payload => {
      if (!mounted || !payload) return
      statusEvents += 1
      if (payload.sessions) setConnections(applyDesktopSessions(payload.sessions))
      if (payload.configured !== undefined) setAccountConfigured(payload.configured)
      if (payload.state === 'signed_out') {
        clearConnections()
        setConnections(getConnectionStates())
        setAccountConfigured(false)
        setAccount({})
        setLiveSnapshot(null)
        setLiveError('')
        setLastSync('尚未同步')
        setNotifFeed([])
        setCustomTasks([])
      }
    })
    const load = async () => {
      const version = statusEvents
      const status = await window.myhkuDesktop?.accountStatus?.()
      if (!mounted) return
      if (!status) {
        setAuthReady(true)
        setAccountConfigured(true)
        return
      }
      if (version === statusEvents) setAccountConfigured(Boolean(status.configured))
      setAccount({ username: status.localUsername, email: status.email })
      setAuthReady(true)
      if (status.sessions) setConnections(applyDesktopSessions(status.sessions))
    }
    load().catch(() => {
      if (mounted) {
        setAuthReady(true)
        showToast('无法读取本地账户状态')
      }
    })
    return () => {
      mounted = false
      stop?.()
    }
  }, [showToast])

  const sync = (refreshOfficialPages = true) => {
    if (syncingRef.current) {
      if (!refreshOfficialPages) pendingSnapshotRead.current = true
      return
    }
    syncingRef.current = true
    if (refreshOfficialPages) lastAttemptAt.current = Date.now()
    const mode = dataModeRef.current
    setRefreshing(true)
    setNotice('正在同步 Portal、SIS 和 Moodle…')

    const finish = (message?: string, success = true, fetchedAt?: string) => {
      if (success) {
        const fetched = fetchedAt ? new Date(fetchedAt) : new Date()
        const stamp = fetched.toLocaleString('zh-CN', {
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
        setLastSync(stamp)
        try {
          localStorage.setItem('myhku-last-sync', stamp)
          localStorage.setItem('myhku-last-sync-ms', String(fetched.getTime()))
        } catch { /* ignore */ }
      }
      syncingRef.current = false
      setRefreshing(false)
      showToast(message || (mode === 'live' ? '真实数据同步完成' : '演示数据已就绪'), 3000)
      if (pendingSnapshotRead.current) {
        pendingSnapshotRead.current = false
        window.setTimeout(() => syncRef.current(false), 0)
      }
    }

    if (mode === 'live') {
      const previousFetchedAt = liveSnapshot?.fetchedAt
      const refresh = refreshOfficialPages
        ? window.myhkuDesktop?.refreshHku
          ? window.myhkuDesktop.refreshHku()
          : window.myhkuAndroid?.refreshHku
            ? Promise.resolve(window.myhkuAndroid.refreshHku())
            : Promise.resolve()
        : Promise.resolve()

      const readSnapshot = async () => {
        let latest: LiveSnapshot | null = null
        const deadline = Date.now() + (refreshOfficialPages ? 20_000 : 5_000)
        do {
          try {
            latest = await fetchLiveSnapshot()
            if (!previousFetchedAt || latest.fetchedAt !== previousFetchedAt || !refreshOfficialPages) return latest
          } catch { /* page may still be loading */ }
          if (Date.now() < deadline) await new Promise(resolve => window.setTimeout(resolve, 250))
        } while (Date.now() < deadline)
        if (latest) return latest
        throw new Error('尚未收到 HKU 页面数据，数据到达后会自动更新。')
      }

      refresh
        .then(readSnapshot)
        .then(async snapshot => ({ snapshot, states: await checkAllConnections() }))
        .then(({ states, snapshot }) => {
          setConnections(states)
          setLiveSnapshot(snapshot)
          cacheSnapshot(snapshot)
          notifySnapshotChanges(snapshot, handleNavigate, getCustomTasks().map(customTaskToUnified))
          setNotifFeed(getNotificationFeed())
          setLiveError('')
          finish(
            snapshot.fetchedAt === previousFetchedAt ? '已读取现有真实数据，页面仍在更新' : '真实数据同步完成',
            true,
            snapshot.fetchedAt,
          )
        })
        .catch(error => {
          const detail = error instanceof Error ? error.message : '真实数据同步失败'
          setLiveError(liveSnapshot ? `${detail} 当前显示上次成功同步的数据。` : detail)
          finish(
            Object.values(getConnectionStates()).some(item => item.state === 'checking' || item.state === 'login_pending')
              ? '正在连接 HKU，完成后会自动同步数据'
              : '真实数据同步失败，请检查设置中的连接状态',
            false,
          )
        })
    } else {
      window.setTimeout(() => finish('演示数据已刷新', true), 450)
    }
  }
  syncRef.current = sync

  useEffect(() => {
    if (!authReady || !accountConfigured) return
    if (!started.current) {
      started.current = true
      lastAttemptAt.current = Date.now()
      sync(false)
    }
    const stopDesktopListening = window.myhkuDesktop?.onHkuUpdated?.(() => {
      if (dataModeRef.current === 'live') syncRef.current(false)
    })
    const onNativeUpdated = () => {
      if (dataModeRef.current === 'live') syncRef.current(false)
    }
    window.addEventListener('myhku-native-updated', onNativeUpdated)

    const sessionTimer = window.setInterval(() => {
      if (dataModeRef.current === 'live') {
        void checkAllConnections().then(setConnections).catch(() => {})
      }
    }, 5000)
    const dailyTimer = window.setInterval(() => {
      if (Date.now() - lastAttemptAt.current >= 24 * 60 * 60 * 1000) syncRef.current()
    }, 60 * 1000)

    return () => {
      stopDesktopListening?.()
      window.removeEventListener('myhku-native-updated', onNativeUpdated)
      window.clearInterval(dailyTimer)
      window.clearInterval(sessionTimer)
    }
  }, [authReady, accountConfigured])

  const handleSignOut = async () => {
    setUserMenuOpen(false)
    await signOutAccount()
    setConnections(getConnectionStates())
    setLiveSnapshot(null)
    setLiveError('')
    setLastSync('尚未同步')
    setNotifFeed([])
    setCustomTasks([])
    if (window.myhkuDesktop?.accountStatus) {
      setAccount({})
      setAccountConfigured(false)
    } else {
      showToast('已退出官方会话并清空全部本地缓存')
    }
  }

  const openAddTaskModal = useCallback((course = '') => {
    setEditingTask(null)
    setDefaultTaskCourse(course)
    setTaskModalOpen(true)
  }, [])

  const openEditTaskModal = useCallback((task: CustomTask) => {
    setEditingTask(task)
    setDefaultTaskCourse('')
    setTaskModalOpen(true)
  }, [])

  const handleSaveCustomTask = useCallback(
    (input: { id?: string; title: string; course: string; category: CustomTaskCategory; due: string; note?: string }) => {
      const next = input.id ? updateCustomTask(input.id, input) : addCustomTask(input)
      setCustomTasks(next)
      showToast(input.id ? '已更新自建事项' : '已添加自建倒计时事项')
    },
    [showToast],
  )

  const handleToggleCustomTask = useCallback(
    (id: string) => {
      const next = toggleCustomTask(id)
      setCustomTasks(next)
      const updated = next.find(item => item.id === id)
      if (updated) showToast(updated.completed ? '已标记为完成' : '已恢复为待办', 2200)
    },
    [showToast],
  )

  const handleDeleteCustomTask = useCallback(
    (id: string) => {
      setCustomTasks(deleteCustomTask(id))
      showToast('已删除自建事项', 2200)
    },
    [showToast],
  )

  const [coursePrefs, setCoursePrefs] = useState<MoodleCoursePrefs>(() => getMoodleCoursePrefs())
  const [courseSelectorOpen, setCourseSelectorOpen] = useState(false)
  const handleUpdateCoursePrefs = useCallback((next: MoodleCoursePrefs) => {
    setCoursePrefs(saveMoodleCoursePrefs(next))
  }, [])

  const demoSnapshot = useMemo(() => buildDemoSnapshot(), [])
  const rawActiveSnapshot = dataMode === 'demo' ? demoSnapshot : liveSnapshot
  const activeSnapshot = useMemo(
    () => filterSnapshotByCoursePrefs(rawActiveSnapshot, coursePrefs),
    [rawActiveSnapshot, coursePrefs],
  )

  useEffect(() => {
    if (!window.myhkuDesktop?.updateTraySummary) return
    const pushSummary = () => {
      if (!activeSnapshot) {
        void window.myhkuDesktop?.updateTraySummary?.({ nextClass: '', nextDdl: '' })
        return
      }
      const focus = findNextOrCurrentClass(activeSnapshot, new Date())
      const nextClass = focus
        ? `${focus.status === 'ongoing' ? '正在上课' : '下节课'}: ${focus.item.title} (${focus.item.start}${focus.item.room ? ` @ ${focus.item.room}` : ''})`
        : ''
      const topDdl = sortAssignmentsByDue(
        mergeWithCustomTasks(activeSnapshot.assignments, customTasks).filter(item => !item.completed),
      )[0]
      const nextDdl = topDdl ? `近期截止: ${topDdl.course} · ${topDdl.title} (${cleanDueDisplay(topDdl.due)})` : ''
      void window.myhkuDesktop?.updateTraySummary?.({ nextClass, nextDdl })
    }
    pushSummary()
    const timer = window.setInterval(pushSummary, 60_000)
    return () => window.clearInterval(timer)
  }, [activeSnapshot, customTasks])

  const handleExportIcs = useCallback(() => {
    if (!activeSnapshot) {
      showToast('暂无可导出的课表或待办数据')
      return
    }
    const { ics, classCount, ddlCount } = buildIcsCalendar(activeSnapshot, customTasks)
    if (classCount === 0 && ddlCount === 0) {
      showToast('当前没有包含有效日期的课表或待办可导出')
      return
    }
    downloadIcsFile(ics, 'myhku-schedule-and-ddl.ics')
    showToast(`已导出 ${classCount} 节课程与 ${ddlCount} 项待办到 .ics 日历文件`, 4000)
  }, [activeSnapshot, customTasks, showToast])

  const title = NAV_LABELS[locale][active] ?? tr(locale, '概览', 'Overview')
  const connectedCount = Object.values(connections).filter(item => item.state === 'connected').length
  const manualConnection = Object.values(connections).find(item => item.state === 'login_pending')
  const connectionPhase: ConnectionPhase = Object.values(connections).some(item => item.state === 'login_pending')
    ? 'manual'
    : Object.values(connections).some(item => item.state === 'checking')
      ? 'checking'
      : connectedCount > 0
        ? 'connected'
        : 'disconnected'
  const accountLabel =
    dataMode === 'demo'
      ? tr(locale, '演示数据模式', 'Demo Mode')
      : connectedCount === 3
        ? tr(locale, '已安全连接', 'Connected')
        : connectedCount
          ? tr(locale, `${connectedCount}/3 个服务已连接`, `${connectedCount}/3 Connected`)
          : tr(locale, '需要连接 HKU', 'Connect HKU')

  const now = new Date()
  const greeting = localizedGreeting(locale, now)
  const dateFmtLocale = locale === 'en' ? 'en-US' : 'zh-CN'
  const today = {
    weekday: new Intl.DateTimeFormat(dateFmtLocale, { weekday: 'long', timeZone: 'Asia/Hong_Kong' }).format(now),
    date: new Intl.DateTimeFormat(dateFmtLocale, { month: 'long', day: 'numeric', timeZone: 'Asia/Hong_Kong' }).format(now),
  }
  // today ready
  const pendingCount = (activeSnapshot ? activeSnapshot.assignments.filter(a => !a.completed).length : 0) + customTasks.filter(t => !t.completed).length
  const unreadNotifCount = notifFeed.filter(n => !n.read).length
  const shortcutHint = isApplePlatform() ? '⌘ K' : 'Ctrl K'

  if (!authReady) {
    return (
      <div className="account-gate">
        <div className="account-loading">
          <RefreshCw size={22} className="spin" /> 正在准备 MyHKU…
        </div>
      </div>
    )
  }
  if (!accountConfigured) {
    return (
      <AccountSetup
        onReady={next => {
          setAccount(next)
          setAccountConfigured(true)
        }}
      />
    )
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
        <div className="brand">
          <img className="brand-mark" src="./brand/logo.svg" alt="MyHKU" />
          <span>
            My<span>HKU</span>
          </span>
          <button className="close-nav" onClick={() => setMobileNav(false)} aria-label="关闭导航">
            <X size={18} />
          </button>
        </div>

        <div className="workspace">
          <span className="workspace-label">{tr(locale, '当前数据源', 'Workspace')}</span>
          <strong>{dataMode === 'demo' ? tr(locale, '演示学习空间', 'Demo Workspace') : tr(locale, 'HKU 实时学习空间', 'HKU Live Space')}</strong>
        </div>

        <nav>
          {navItems.map(({ key, icon: Icon }) => (
            <button
              key={key}
              className={active === key ? 'active' : ''}
              onClick={() => handleNavigate(key)}
            >
              <Icon size={18} />
              <span>{NAV_LABELS[locale][key]}</span>
              {key === 'moodle' && pendingCount > 0 && <i className="nav-dot" title={`${pendingCount}`} />}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="login-state">
            <span className={`state-dot ${dataMode === 'live' && connectedCount === 0 ? 'offline' : ''}`} />
            <div>
              <small>HKU 账号</small>
              <strong>
                {manualConnection?.nativeState === 'needs_2fa'
                  ? '等待身份验证'
                  : Object.values(connections).some(item => item.state === 'checking')
                    ? '正在自动连接 HKU'
                    : accountLabel}
              </strong>
            </div>
          </div>
          <button
            type="button"
            className="user-mini"
            onClick={() => handleNavigate('settings')}
            title="前往账户与连接设置"
          >
            <span className="avatar">{(account.username || '学').slice(0, 1).toUpperCase()}</span>
            <span>{account.username || '本机用户'}</span>
            <Settings size={13} />
          </button>
        </div>
      </aside>

      {mobileNav && <div className="backdrop" onClick={() => setMobileNav(false)} />}

      <main className="main">
        <header className="topbar">
          <button className="menu-toggle" onClick={() => setMobileNav(true)} aria-label="打开菜单">
            <Menu size={21} />
          </button>
          <div className="crumb">
            <span>{tr(locale, '学习空间', 'Workspace')}</span>
            <b>/</b>
            <strong>{title}</strong>
          </div>
          <div className="top-actions">
            <label className="search">
              <Search size={17} />
              <input
                ref={searchInputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={tr(locale, '搜索课程、课表、作业、资料…', 'Search courses, timetable, tasks, files…')}
              />
              {query ? (
                <button type="button" className="clear-search-btn" onClick={() => setQuery('')} aria-label="Clear search">
                  <X size={13} />
                </button>
              ) : (
                <button
                  type="button"
                  className="palette-trigger-btn"
                  onClick={e => {
                    e.preventDefault()
                    setPaletteOpen(true)
                  }}
                  title={tr(locale, '打开快捷命令面板', 'Open Command Palette')}
                >
                  <kbd>{shortcutHint}</kbd>
                </button>
              )}
            </label>

            <button
              type="button"
              className="lang-toggle-btn"
              aria-label={tr(locale, '切换为英文', 'Switch to Chinese')}
              onClick={() => handleSetLocale(locale === 'zh' ? 'en' : 'zh')}
            >
              <Globe size={15} />
              <span>{locale === 'zh' ? 'EN' : '中文'}</span>
            </button>

            <div className="popover-anchor">
              <button
                type="button"
                className="icon-btn"
                aria-label="通知"
                aria-expanded={notifMenuOpen}
                onClick={() => {
                  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
                    void Notification.requestPermission()
                  }
                  setUserMenuOpen(false)
                  setNotifMenuOpen(prev => {
                    const next = !prev
                    if (next && unreadNotifCount > 0) setNotifFeed(markAllNotificationsRead())
                    return next
                  })
                }}
              >
                <Bell size={19} />
                {unreadNotifCount > 0 && <i />}
              </button>

              {notifMenuOpen && (
                <div className="dropdown-panel notif-dropdown" role="dialog" aria-label="最近提醒">
                  <div className="dropdown-head">
                    <strong>本地同步与截止提醒</strong>
                    <button type="button" className="text-btn" onClick={() => setNotifMenuOpen(false)}>
                      关闭
                    </button>
                  </div>
                  {notifFeed.length ? (
                    <div className="notif-list">
                      {notifFeed.slice(0, 8).map(item => (
                        <button
                          type="button"
                          key={item.id}
                          className="notif-item"
                          onClick={() => handleNavigate(item.target, item.course)}
                        >
                          <strong>{item.title}</strong>
                          <span>{item.body}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="dropdown-empty">暂无新增变更或临近截止提醒</p>
                  )}
                </div>
              )}
            </div>

            <div className="popover-anchor">
              <button
                type="button"
                className="user user-btn"
                aria-expanded={userMenuOpen}
                onClick={() => {
                  setNotifMenuOpen(false)
                  setUserMenuOpen(prev => !prev)
                }}
              >
                <span className="avatar">{(account.username || '学').slice(0, 1).toUpperCase()}</span>
                <span>
                  <b>{account.username || '本机用户'}</b>
                  <small>{account.email || (dataMode === 'demo' ? '演示模式' : 'HKU Student')}</small>
                </span>
                <ChevronDown size={15} />
              </button>

              {userMenuOpen && (
                <div className="dropdown-panel user-dropdown" role="menu">
                  <button type="button" role="menuitem" onClick={() => handleNavigate('settings')}>
                    <Settings size={14} /> 连接与外观设置
                  </button>
                  {Boolean(window.myhkuDesktop?.saveAccount) && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setUserMenuOpen(false)
                        setEditingAccount(true)
                      }}
                    >
                      <KeyRound size={14} /> 修改 HKU 账号凭据
                    </button>
                  )}
                  <button type="button" role="menuitem" className="danger-item" onClick={() => void handleSignOut()}>
                    <LogOut size={14} /> 退出账号并清除缓存
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {manualConnection && (
          <div className="auth-banner">
            <ShieldCheck size={15} />
            <span>{manualConnection.detail || '请在 HKU 官方窗口完成登录；完成后会自动回到 MyHKU'}</span>
          </div>
        )}

        {notice && (
          <div className={`toast ${refreshing ? 'loading' : 'success'}`}>
            {refreshing ? <RefreshCw className="spin" size={15} /> : <CheckCircle2 size={15} />} {notice}
          </div>
        )}

        <div className="content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {today.weekday} · {today.date}
              </p>
              <h1>
                {greeting}{locale === 'en' ? ', ' : '，'}{account.username || tr(locale, '同学', 'Student')} <span>✦</span>
              </h1>
              <p className="subtitle">
                {dataMode === 'demo'
                  ? tr(locale, '当前展示隔离演示数据；可在设置中切换至真实模式。', 'Showing isolated sample data; switch to Live mode in Settings.')
                  : tr(locale, '这是你最新的 HKU 学习空间概览。', 'Here is your latest HKU learning dashboard.')}
              </p>
            </div>
            <button className="refresh-btn" onClick={() => sync()} disabled={refreshing}>
              <RefreshCw size={16} className={refreshing ? 'spin' : ''} />
              {refreshing ? tr(locale, '同步中…', 'Syncing…') : tr(locale, '立即刷新', 'Sync Now')}
            </button>
          </div>

          <div className="sync-line">
            <span>
              <CheckCircle2 size={14} />{' '}
              {dataMode === 'demo'
                ? tr(locale, '演示样例就绪', 'Demo Ready')
                : !liveSnapshot
                  ? tr(locale, '等待自动同步', 'Awaiting Sync')
                  : liveError
                    ? tr(locale, '显示本地缓存', 'Showing Local Cache')
                    : tr(locale, '数据已同步', 'Synced')}
            </span>
            <span>{tr(locale, '上次更新', 'Last sync')} {dataMode === 'demo' ? tr(locale, '内置示例', 'Sample') : lastSync}</span>
            <span className="sync-policy">{tr(locale, '打开应用时刷新 · 每日自动更新一次', 'Syncs on launch · Daily auto-refresh')}</span>
          </div>

          {active === 'overview' && (
            <OverviewPage
              locale={locale}
              snapshot={activeSnapshot}
              customTasks={customTasks}
              dataMode={dataMode}
              query={query}
              error={liveError}
              connectionPhase={connectionPhase}
              todayLabel={today}
              onNavigate={target => handleNavigate(target)}
              onSelectCourse={course => handleNavigate('moodle', course)}
              onRefresh={() => sync()}
              onOpenAddTask={() => openAddTaskModal()}
              onToggleCustomTask={handleToggleCustomTask}
              onExportIcs={handleExportIcs}
            />
          )}

          {active === 'calendar' &&
            (activeSnapshot ? (
              <CalendarPage
                locale={locale}
                snapshot={activeSnapshot}
                customTasks={customTasks}
                dataMode={dataMode}
                sisConnected={connections.sis.state === 'connected'}
                query={query}
                onRefresh={() => sync()}
                onSyncSnapshot={() => sync(false)}
                onNotice={msg => showToast(msg, 4000)}
                onExportIcs={handleExportIcs}
                onOpenAddTask={() => openAddTaskModal()}
              />
            ) : (
              <OverviewPage
                locale={locale}
                snapshot={null}
                dataMode={dataMode}
                query={query}
                error={liveError}
                connectionPhase={connectionPhase}
                todayLabel={today}
                onNavigate={target => handleNavigate(target)}
                onSelectCourse={course => handleNavigate('moodle', course)}
                onRefresh={() => sync()}
              />
            ))}

          {active === 'moodle' &&
            (activeSnapshot ? (
              <MoodlePage
                locale={locale}
                snapshot={activeSnapshot}
                rawSnapshot={rawActiveSnapshot || activeSnapshot}
                coursePrefs={coursePrefs}
                onChangeCoursePrefs={handleUpdateCoursePrefs}
                onOpenCourseSelector={() => setCourseSelectorOpen(true)}
                customTasks={customTasks}
                query={query}
                selectedCourseId={selectedCourseId}
                onSelectCourse={setSelectedCourseId}
                onOpenMaterials={() => handleNavigate('materials')}
                onRefresh={() => sync()}
                onOpenAddTask={openAddTaskModal}
                onToggleCustomTask={handleToggleCustomTask}
                onEditCustomTask={openEditTaskModal}
                onDeleteCustomTask={handleDeleteCustomTask}
              />
            ) : (
              <OverviewPage
                locale={locale}
                snapshot={null}
                dataMode={dataMode}
                query={query}
                error={liveError}
                connectionPhase={connectionPhase}
                todayLabel={today}
                onNavigate={target => handleNavigate(target)}
                onSelectCourse={course => handleNavigate('moodle', course)}
                onRefresh={() => sync()}
              />
            ))}

          {active === 'materials' &&
            (activeSnapshot ? (
              <MaterialsPage
                locale={locale}
                snapshot={activeSnapshot}
                dataMode={dataMode}
                query={query}
                onRefresh={() => sync()}
              />
            ) : (
              <OverviewPage
                locale={locale}
                snapshot={null}
                dataMode={dataMode}
                query={query}
                error={liveError}
                connectionPhase={connectionPhase}
                todayLabel={today}
                onNavigate={target => handleNavigate(target)}
                onSelectCourse={course => handleNavigate('moodle', course)}
                onRefresh={() => sync()}
              />
            ))}

          {active === 'settings' && (
            <SettingsPage
              locale={locale}
              setLocale={handleSetLocale}
              mode={dataMode}
              setMode={mode => {
                setDataMode(mode)
                setDataModeState(mode)
              }}
              theme={themeMode}
              setTheme={theme => {
                setThemeMode(theme)
                setThemeModeState(theme)
              }}
              states={connections}
              setStates={setConnections}
              snapshot={rawActiveSnapshot}
              customTasksCount={customTasks.length}
              account={account}
              onEditAccount={() => setEditingAccount(true)}
              onSignOut={async () => {
                clearMoodleCoursePrefs()
                setCoursePrefs(getMoodleCoursePrefs())
                await handleSignOut()
              }}
              onNotice={msg => showToast(msg, 4000)}
              onRebuildCache={async scope => {
                const remaining = await clearSnapshotScope(scope)
                setLiveSnapshot(remaining)
                if (dataMode === 'live') {
                  sync(true)
                } else {
                  showToast(
                    scope === 'schedule'
                      ? tr(locale, '已清空本地课表缓存；切换真实模式后将自动重抓', 'Cleared timetable cache')
                      : tr(locale, '已清空本地 Moodle 缓存；切换真实模式后将自动重抓', 'Cleared Moodle cache'),
                  )
                }
              }}
              onRestoredBackup={restored => {
                setCustomTasks(getCustomTasks())
                setCoursePrefs(getMoodleCoursePrefs())
                if (restored.themeMode) {
                  setThemeMode(restored.themeMode)
                  setThemeModeState(restored.themeMode)
                }
                if (restored.locale) {
                  persistLocale(restored.locale)
                  setLocaleState(restored.locale)
                }
              }}
            />
          )}
        </div>
      </main>

      {editingAccount && (
        <AccountSetup
          modal
          initialUsername={account.username || ''}
          initialEmail={account.email || ''}
          onCancel={() => setEditingAccount(false)}
          onReady={next => {
            setAccount(next)
            setAccountConfigured(true)
            setEditingAccount(false)
            showToast('账户已更新，正在重新连接官方服务')
          }}
        />
      )}

      <CustomTaskModal
        open={taskModalOpen}
        editingTask={editingTask}
        courses={activeSnapshot?.courses || []}
        defaultCourse={defaultTaskCourse}
        onClose={() => {
          setTaskModalOpen(false)
          setEditingTask(null)
        }}
        onSave={handleSaveCustomTask}
      />

      {rawActiveSnapshot && (
        <MoodleCourseSelectorModal
          open={courseSelectorOpen}
          locale={locale}
          rawSnapshot={rawActiveSnapshot}
          prefs={coursePrefs}
          onChangePrefs={handleUpdateCoursePrefs}
          onClose={() => setCourseSelectorOpen(false)}
        />
      )}

      <CommandPaletteModal
        open={paletteOpen}
        locale={locale}
        themeMode={themeMode}
        snapshot={activeSnapshot}
        customTasks={customTasks}
        onClose={() => setPaletteOpen(false)}
        onNavigate={(target, courseCode) => handleNavigate(target, courseCode)}
        onSelectCourse={course => handleNavigate('moodle', course)}
        onSync={() => sync(true)}
        onOpenAddTask={() => openAddTaskModal()}
        onOpenCourseSelector={
          rawActiveSnapshot
            ? () => {
                setActive('moodle')
                setCourseSelectorOpen(true)
              }
            : undefined
        }
        onExportIcs={handleExportIcs}
        onToggleTheme={next => {
          setThemeMode(next)
          setThemeModeState(next)
          showToast(
            next === 'dark'
              ? tr(locale, '已切换为深色主题', 'Dark theme enabled')
              : tr(locale, '已切换为浅色主题', 'Light theme enabled'),
            2000,
          )
        }}
        onToggleLocale={() => handleSetLocale(locale === 'zh' ? 'en' : 'zh')}
      />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LegalGate>
      <App />
    </LegalGate>
  </StrictMode>,
)
