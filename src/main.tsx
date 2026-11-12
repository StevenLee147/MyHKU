import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Bell,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  FileText,
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
import { CalendarPage } from './components/CalendarPage'
import { MaterialsPage } from './components/MaterialsPage'
import { MoodlePage } from './components/MoodlePage'
import { OverviewPage, type ConnectionPhase } from './components/OverviewPage'
import { SettingsPage } from './components/SettingsPage'
import { buildDemoSnapshot } from './services/demoData'
import {
  applyDesktopSessions,
  applyThemeMode,
  cacheSnapshot,
  checkAllConnections,
  clearConnections,
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
  getNotificationFeed,
  markAllNotificationsRead,
  type AppNotificationItem,
  type NavTarget,
} from './services/notifications'
import { hongKongGreeting } from './services/schedule'

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
  const [connections, setConnections] = useState<Record<HkuSite, SiteConnection>>(() => getConnectionStates())
  const [liveSnapshot, setLiveSnapshot] = useState<LiveSnapshot | null>(() => getCachedSnapshot())
  const [liveError, setLiveError] = useState('')

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
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
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
          notifySnapshotChanges(snapshot, handleNavigate)
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
    if (window.myhkuDesktop?.accountStatus) {
      setAccount({})
      setAccountConfigured(false)
    } else {
      showToast('已退出官方会话并清空全部本地缓存')
    }
  }

  const demoSnapshot = useMemo(() => buildDemoSnapshot(), [])
  const activeSnapshot = dataMode === 'demo' ? demoSnapshot : liveSnapshot

  const title = navItems.find(n => n.key === active)?.label ?? '概览'
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
      ? '演示数据模式'
      : connectedCount === 3
        ? '已安全连接'
        : connectedCount
          ? `${connectedCount}/3 个服务已连接`
          : '需要连接 HKU'

  const now = new Date()
  const greeting = hongKongGreeting(now)
  const today = {
    weekday: new Intl.DateTimeFormat('zh-CN', { weekday: 'long', timeZone: 'Asia/Hong_Kong' }).format(now),
    date: new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', timeZone: 'Asia/Hong_Kong' }).format(now),
  }
  const pendingCount = activeSnapshot ? activeSnapshot.assignments.filter(a => !a.completed).length : 0
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
          <span className="workspace-label">当前数据源</span>
          <strong>{dataMode === 'demo' ? '演示学习空间' : 'HKU 实时学习空间'}</strong>
        </div>

        <nav>
          {navItems.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              className={active === key ? 'active' : ''}
              onClick={() => handleNavigate(key)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {key === 'moodle' && pendingCount > 0 && <i className="nav-dot" title={`${pendingCount} 项待办`} />}
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
            <span>学习空间</span>
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
                placeholder="搜索课程、课表、作业、资料…"
              />
              {query ? (
                <button type="button" className="clear-search-btn" onClick={() => setQuery('')} aria-label="清除搜索">
                  <X size={13} />
                </button>
              ) : (
                <kbd>{shortcutHint}</kbd>
              )}
            </label>

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
                {greeting}，{account.username || '同学'} <span>✦</span>
              </h1>
              <p className="subtitle">
                {dataMode === 'demo' ? '当前展示隔离演示数据；可在设置中切换至真实模式。' : '这是你最新的 HKU 学习空间概览。'}
              </p>
            </div>
            <button className="refresh-btn" onClick={() => sync()} disabled={refreshing}>
              <RefreshCw size={16} className={refreshing ? 'spin' : ''} />
              {refreshing ? '同步中…' : '立即刷新'}
            </button>
          </div>

          <div className="sync-line">
            <span>
              <CheckCircle2 size={14} />{' '}
              {dataMode === 'demo'
                ? '演示样例就绪'
                : !liveSnapshot
                  ? '等待自动同步'
                  : liveError
                    ? '显示本地缓存'
                    : '数据已同步'}
            </span>
            <span>上次更新 {dataMode === 'demo' ? '内置示例' : lastSync}</span>
            <span className="sync-policy">打开应用时刷新 · 每日自动更新一次</span>
          </div>

          {active === 'overview' && (
            <OverviewPage
              snapshot={activeSnapshot}
              dataMode={dataMode}
              query={query}
              error={liveError}
              connectionPhase={connectionPhase}
              todayLabel={today}
              onNavigate={target => handleNavigate(target)}
              onSelectCourse={course => handleNavigate('moodle', course)}
              onRefresh={() => sync()}
            />
          )}

          {active === 'calendar' &&
            (activeSnapshot ? (
              <CalendarPage
                snapshot={activeSnapshot}
                dataMode={dataMode}
                sisConnected={connections.sis.state === 'connected'}
                query={query}
                onRefresh={() => sync()}
                onSyncSnapshot={() => sync(false)}
                onNotice={msg => showToast(msg, 4000)}
              />
            ) : (
              <OverviewPage
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
                snapshot={activeSnapshot}
                query={query}
                selectedCourseId={selectedCourseId}
                onSelectCourse={setSelectedCourseId}
                onOpenMaterials={() => handleNavigate('materials')}
                onRefresh={() => sync()}
              />
            ) : (
              <OverviewPage
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
                snapshot={activeSnapshot}
                dataMode={dataMode}
                query={query}
                onRefresh={() => sync()}
              />
            ) : (
              <OverviewPage
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
              account={account}
              onEditAccount={() => setEditingAccount(true)}
              onSignOut={handleSignOut}
              onNotice={msg => showToast(msg, 4000)}
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
